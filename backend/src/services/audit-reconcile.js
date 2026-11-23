/**
 * ZenPass — 對數引擎（Audit Reconciliation）
 * -------------------------------------------------
 * 將 scripts/reconcile-audit.py 的 C1–C7 核對邏輯搬入 Node，
 * 額外提供結構化資料（每筆問題附 booking / 用戶 / 課程資訊），
 * 供後台「🧾 對數報告」一頁顯示。全程唯讀，不會寫入任何資料。
 *
 * 用法：const { runAuditReconcile } = require("../services/audit-reconcile");
 *       const report = runAuditReconcile(getDb());
 */

const TOL = 0.01;
// Double-entry ledger 上線日（commit f0516e24）。之前建立嘅 booking 冇 ledger 屬已知歷史。
const LEDGER_GO_LIVE = "2026-10-12";

const CHECK_META = [
  { code: "C1.split", label: "四邊拆賬（平台／場地）", help: "付款金額應等於平台收入＋場地收入" },
  { code: "C1.rate", label: "平台分成比例", help: "平台收入應等於金額 × 分成率" },
  { code: "C2.double_entry", label: "Ledger 借貸平衡", help: "同一 reference 的 debit 總額應等於 credit 總額" },
  { code: "C3.coverage", label: "已付款有 Ledger", help: "每筆已付款預約都應有雙式記帳分錄" },
  { code: "C3.coverage_legacy", label: "上線前歷史預約", help: "Ledger 上線前的舊預約，無分錄屬已知歷史（毋須處理）" },
  { code: "C3.zero_amount", label: "零金額預約", help: "$0 通行證／免費活動毋須 ledger（毋須處理）" },
  { code: "C4.wallet_math", label: "錢包餘額計算", help: "每筆錢包交易 before ± amount 應等於 after" },
  { code: "C4.wallet_chain", label: "錢包餘額連續性", help: "下一筆 before 應接上一筆 after" },
  { code: "C5.earning_math", label: "教練收入計算", help: "gross × commission 應等於 net" },
  { code: "C5.eaming_paid", label: "教練出糧掛鈎", help: "狀態 paid 的教練收入必須有 payout_id" },
  { code: "C6.ref", label: "引用完整性", help: "Ledger／錢包紀錄指向的 booking 必須存在" },
  { code: "C7.credits_cost", label: "課程 Credits 定價", help: "收費課程的 credits_cost 不可為 0（否則 Credits 付款變免費）" },
];
const META = Object.fromEntries(CHECK_META.map((c) => [c.code, c]));

const close = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= TOL;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function runAuditReconcile(db, opts = {}) {
  const integrityOnly = !!opts.integrityOnly;
  const findings = [];
  const add = (code, severity, message, extra = {}) =>
    findings.push({ code, severity, message: String(message), ...extra });

  const hasTable = (t) => {
    try {
      return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    } catch {
      return false;
    }
  };
  const colset = (t) => {
    try {
      return new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));
    } catch {
      return new Set();
    }
  };
  const one = (sql, ...args) => {
    try {
      return db.prepare(sql).get(...args) || {};
    } catch {
      return {};
    }
  };

  // ---- booking 資訊（附在每筆問題上，方便後台直接睇）----
  const bCache = new Map();
  const bookingInfo = (id) => {
    if (!id) return null;
    if (bCache.has(id)) return bCache.get(id);
    let info = {
      booking_id: id,
      booking_reference: null,
      amount: null,
      payment_status: null,
      status: null,
      created_at: null,
      user_name: null,
      user_email: null,
      class_title: null,
      start_time: null,
    };
    try {
      const row = db
        .prepare(
          `SELECT b.id, b.booking_reference, b.amount, b.payment_status, b.status, b.created_at, b.schedule_id,
                  u.name AS user_name, u.email AS user_email,
                  COALESCE(cl.title, cs.title) AS class_title, cs.start_time
             FROM bookings b
             LEFT JOIN users u ON u.id = b.user_id
             LEFT JOIN classes cl ON cl.id = b.class_id
             LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
            WHERE b.id = ?`,
        )
        .get(id);
      if (row) info = { ...info, ...row };
    } catch {
      const row = (() => {
        try {
          return db.prepare("SELECT id, amount, payment_status, status, created_at FROM bookings WHERE id=?").get(id);
        } catch {
          return null;
        }
      })();
      if (row) info = { ...info, ...row };
    }
    info.is_test =
      /^prodtest/i.test(String(info.schedule_id || "")) ||
      /prodtest/i.test(String(info.user_email || "")) ||
      /\[PROD-TEST\]/i.test(String(info.class_title || ""));
    bCache.set(id, info);
    return info;
  };

  // ---- C1: 四邊拆賬 ----
  if (!hasTable("bookings")) {
    add("C1.schema", "advisory", "bookings 表不存在（略過）");
  } else {
    const bc = colset("bookings");
    const need = ["amount", "platform_earned_amount", "venue_earned_amount"];
    if (!need.every((c) => bc.has(c))) {
      add("C1.schema", "advisory", `bookings schema drift：缺少欄位（略過拆賬核對）`);
    } else {
      const hasRate = bc.has("platform_commission_rate");
      const rows = db
        .prepare(
          `SELECT id, amount, payment_status, status, platform_earned_amount, venue_earned_amount${
            hasRate ? ", platform_commission_rate" : ""
          }
             FROM bookings WHERE amount IS NOT NULL AND amount > 0`,
        )
        .all();
      for (const b of rows) {
        const amt = Number(b.amount) || 0;
        const plat = Number(b.platform_earned_amount) || 0;
        const venue = Number(b.venue_earned_amount) || 0;
        const sum = plat + venue;
        const info = bookingInfo(b.id);
        if (plat === 0 && venue === 0) {
          // 測試單、未付款／未確認嘅 booking 都未需要拆賬，只列作已知；已付款真單才跟進
          const paidNow =
            b.payment_status === "paid" && ["confirmed", "attended", "no_show"].includes(b.status);
          const isTest = !!(info && info.is_test);
          add(
            "C1.split",
            paidNow && !isTest ? "advisory" : "info",
            `booking ${String(b.id).slice(0, 8)} amount=${r2(amt)} 但平台/場地拆賬都係 0` +
              (isTest
                ? "（🧪 測試單，唔計真帳）"
                : paidNow
                  ? "（未計拆賬）"
                  : "（未付款／待確認，暫毋須拆賬）"),
            { booking_id: b.id, amount: amt, meta: info },
          );
        } else if (!close(sum, amt)) {
          add(
            "C1.split",
            "block",
            `booking ${String(b.id).slice(0, 8)} amount=${r2(amt)} ≠ 平台${r2(plat)}+場地${r2(venue)}=${r2(sum)}`,
            { booking_id: b.id, amount: amt, meta: info },
          );
        }
        if (
          hasRate &&
          b.platform_commission_rate !== null &&
          b.platform_commission_rate !== undefined &&
          plat > 0 &&
          !close(plat, amt * Number(b.platform_commission_rate))
        ) {
          add("C1.rate", "advisory", `booking ${String(b.id).slice(0, 8)} 平台 ${r2(plat)} ≠ amount×rate（${r2(amt * Number(b.platform_commission_rate))}）`, {
            booking_id: b.id,
            amount: amt,
            meta: info,
          });
        }
      }
    }
  }

  // ---- C2 + C3: ledger ----
  if (!hasTable("ledger")) {
    add("C2.schema", "advisory", "ledger 表不存在（略過）");
  } else {
    const ledgerRows = db.prepare("SELECT booking_id, reference, debit, credit FROM ledger").all();
    const byRef = new Map();
    const byBooking = new Map();
    for (const r of ledgerRows) {
      const cur = byRef.get(r.reference) || [0, 0];
      cur[0] += Number(r.debit) || 0;
      cur[1] += Number(r.credit) || 0;
      byRef.set(r.reference, cur);
      byBooking.set(r.booking_id, (byBooking.get(r.booking_id) || 0) + 1);
    }
    for (const [ref, [d, c]] of byRef) {
      if (!close(d, c)) {
        add("C2.double_entry", "block", `ledger reference ${String(ref).slice(0, 12)} 借貸不平：debit=${r2(d)} credit=${r2(c)}`, {
          meta: { reference: ref, debit: r2(d), credit: r2(c) },
        });
      }
    }
    if (hasTable("bookings")) {
      const paid = db
        .prepare(
          `SELECT id, amount, created_at FROM bookings
            WHERE payment_status='paid' AND status IN ('confirmed','attended','no_show')`,
        )
        .all();
      for (const b of paid) {
        if (byBooking.get(b.id)) continue;
        const amt = Number(b.amount) || 0;
        if (!(amt > 0)) {
          add("C3.zero_amount", "info", `booking ${String(b.id).slice(0, 8)} amount=0（免費／通行證預約），毋須 ledger`, {
            booking_id: b.id,
            amount: amt,
            meta: bookingInfo(b.id),
          });
          continue;
        }
        const created = String(b.created_at || "").slice(0, 10);
        const binfo = bookingInfo(b.id);
        if (binfo && binfo.is_test) {
          add("C3.coverage", "info", `已付款 booking ${String(b.id).slice(0, 8)} (amount=${r2(amt)}) 冇 ledger（🧪 測試單，唔計真帳）`, {
            booking_id: b.id,
            amount: amt,
            meta: binfo,
          });
          continue;
        }
        if (created && created < LEDGER_GO_LIVE) {
          add(
            "C3.coverage_legacy",
            "info",
            `已付款 booking ${String(b.id).slice(0, 8)} (amount=${r2(amt)}, ${created}) 冇 ledger（上線前歷史 booking）`,
            { booking_id: b.id, amount: amt, meta: bookingInfo(b.id) },
          );
        } else {
          add("C3.coverage", "block", `已付款 booking ${String(b.id).slice(0, 8)} (amount=${r2(amt)}) 冇 ledger 記錄（double-entry 缺失）`, {
            booking_id: b.id,
            amount: amt,
            meta: bookingInfo(b.id),
          });
        }
      }
    }
  }

  // ---- C7: 課程 Credits 定價 ----
  if (hasTable("classes")) {
    const cc = colset("classes");
    if (cc.has("price_hkd") && cc.has("credits_cost")) {
      const rows = db.prepare("SELECT id,title,price_hkd,credits_cost,status FROM classes").all();
      for (const c of rows) {
        if (c.status !== "active") continue;
        if ((Number(c.price_hkd) || 0) > 0 && !(Number(c.credits_cost) > 0)) {
          add(
            "C7.credits_cost",
            "block",
            `課程 ${String(c.title || "").slice(0, 16)} (${String(c.id).slice(0, 8)}) 價格 HK$${c.price_hkd} 但 credits_cost=${c.credits_cost} — Credits 預約會變免費`,
            { meta: { class_id: c.id, title: c.title, price_hkd: c.price_hkd, credits_cost: c.credits_cost } },
          );
        }
      }
    }
  }

  // ---- C4: 錢包鏈 ----
  if (!hasTable("wallet_transactions")) {
    add("C4.schema", "advisory", "wallet_transactions 表不存在（略過）");
  } else {
    const rows = db
      .prepare(
        `SELECT id, user_id, amount, balance_before, balance_after, created_at
           FROM wallet_transactions ORDER BY user_id, created_at, id`,
      )
      .all();
    const prev = new Map();
    for (const w of rows) {
      const u = w.user_id;
      const bb = Number(w.balance_before) || 0;
      const ba = Number(w.balance_after) || 0;
      const amt = Number(w.amount) || 0;
      if (!(close(ba, bb + amt) || close(ba, bb - amt))) {
        add("C4.wallet_math", "block", `wallet ${String(w.id).slice(0, 8)} user ${String(u).slice(0, 8)} 餘額跳動異常：${bb} → ${ba} (amount ${amt})`, {
          meta: { wallet_tx_id: w.id, user_id: u },
        });
      }
      if (prev.has(u) && !close(bb, prev.get(u))) {
        add("C4.wallet_chain", "advisory", `wallet user ${String(u).slice(0, 8)} 餘額斷鏈：前次 after=${prev.get(u)} 但 before=${bb}`, {
          meta: { wallet_tx_id: w.id, user_id: u },
        });
      }
      prev.set(u, ba);
    }
  }

  // ---- C5: 教練收入 ----
  if (hasTable("coach_earnings")) {
    const rows = db
      .prepare("SELECT id,coach_id,gross_amount,commission_rate,net_amount,status,payout_id FROM coach_earnings")
      .all();
    for (const e of rows) {
      const exp = (Number(e.gross_amount) || 0) * (Number(e.commission_rate) || 0);
      if (!close(exp, e.net_amount)) {
        add("C5.earning_math", "block", `coach_earning ${String(e.id).slice(0, 8)} gross×rate=${r2(exp)} ≠ net=${e.net_amount}`, {
          meta: { earning_id: e.id, coach_id: e.coach_id },
        });
      }
      if (e.status === "paid" && !e.payout_id) {
        add("C5.eaming_paid", "block", `coach_earning ${String(e.id).slice(0, 8)} status=paid 但冇 payout_id`, {
          meta: { earning_id: e.id, coach_id: e.coach_id },
        });
      }
    }
  } else {
    add("C5.schema", "advisory", "coach_earnings 表不存在（略過）");
  }

  // ---- C6: 引用完整性 ----
  if (hasTable("bookings") && hasTable("ledger")) {
    const ids = new Set(db.prepare("SELECT id FROM bookings").all().map((r) => r.id));
    for (const r of db.prepare("SELECT booking_id FROM ledger").all()) {
      if (!ids.has(r.booking_id)) {
        add("C6.ref", "block", `ledger 指向唔存在嘅 booking ${String(r.booking_id).slice(0, 8)}`, {
          meta: { booking_id: r.booking_id },
        });
      }
    }
  }
  if (hasTable("bookings") && hasTable("wallet_transactions")) {
    const wc = colset("wallet_transactions");
    if (wc.has("source_type") && wc.has("source_id")) {
      const ids = new Set(db.prepare("SELECT id FROM bookings").all().map((r) => r.id));
      for (const w of db
        .prepare("SELECT id,source_type,source_id FROM wallet_transactions WHERE source_type='booking' AND source_id<>''")
        .all()) {
        if (!ids.has(w.source_id)) {
          add("C6.ref", "advisory", `wallet ${String(w.id).slice(0, 8)} source_id ${String(w.source_id).slice(0, 8)} 唔存在於 bookings`, {
            meta: { wallet_tx_id: w.id, source_id: w.source_id },
          });
        }
      }
    }
  }

  // ---- 統計 ----
  const counts = {};
  for (const t of ["bookings", "ledger", "wallet_transactions", "coach_earnings", "coach_payouts"]) {
    counts[t] = hasTable(t) ? one(`SELECT COUNT(*) c FROM ${t}`).c || 0 : "n/a";
  }
  for (const t of ["users", "classes", "class_schedules", "audit_log"]) {
    if (hasTable(t)) counts[t] = one(`SELECT COUNT(*) c FROM ${t}`).c || 0;
  }

  // ---- 金額總覽 ----
  const money = {};
  if (hasTable("bookings")) {
    const bc = colset("bookings");
    const JOIN = `FROM bookings b
      LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
      LEFT JOIN classes cl ON cl.id = b.class_id
      LEFT JOIN users u ON u.id = b.user_id`;
    // 測試單（prodtest）唔計入真帳，同 ledger-reconcile / check-ledger-completeness 一致
    const TEST = `(b.schedule_id LIKE 'prodtest%' OR COALESCE(cl.title,'') LIKE '%[PROD-TEST]%' OR COALESCE(u.email,'') LIKE '%prodtest%')`;
    const paidWhere = `b.payment_status='paid' AND b.status IN ('confirmed','attended','no_show')`;
    const aggPaid = (cols, extra = "") => one(`SELECT ${cols} ${JOIN} WHERE ${paidWhere} ${extra}`);
    const allPaid = aggPaid("COUNT(*) n, COALESCE(SUM(b.amount),0) s");
    const testPaid = aggPaid("COUNT(*) n, COALESCE(SUM(b.amount),0) s", `AND ${TEST}`);
    money.paid_bookings = (allPaid.n || 0) - (testPaid.n || 0);
    money.paid_revenue = r2((allPaid.s || 0) - (testPaid.s || 0));
    money.test_paid_bookings = testPaid.n || 0;
    money.test_paid_revenue = r2(testPaid.s);
    money.paid_revenue_incl_test = r2(allPaid.s);
    if (bc.has("platform_earned_amount")) {
      const pAll = aggPaid("COALESCE(SUM(b.platform_earned_amount),0) s");
      const pTest = aggPaid("COALESCE(SUM(b.platform_earned_amount),0) s", `AND ${TEST}`);
      money.platform_earned = r2((pAll.s || 0) - (pTest.s || 0));
    }
    if (bc.has("venue_earned_amount")) {
      const vAll = aggPaid("COALESCE(SUM(b.venue_earned_amount),0) s");
      const vTest = aggPaid("COALESCE(SUM(b.venue_earned_amount),0) s", `AND ${TEST}`);
      money.venue_earned = r2((vAll.s || 0) - (vTest.s || 0));
    }
    const zeroSplit = `b.amount > 0 AND COALESCE(b.platform_earned_amount,0)=0 AND COALESCE(b.venue_earned_amount,0)=0`;
    const un = one(`SELECT COUNT(*) n, COALESCE(SUM(b.amount),0) s ${JOIN} WHERE ${zeroSplit} AND NOT ${TEST}`);
    money.undistributed_bookings = un.n || 0;
    money.undistributed_amount = r2(un.s);
    const unPaid = one(`SELECT COUNT(*) n, COALESCE(SUM(b.amount),0) s ${JOIN} WHERE ${paidWhere} AND ${zeroSplit} AND NOT ${TEST}`);
    money.undistributed_paid_bookings = unPaid.n || 0;
    money.undistributed_paid_amount = r2(unPaid.s);
    money.undistributed_paid_test = r2(
      one(`SELECT COALESCE(SUM(b.amount),0) s ${JOIN} WHERE ${paidWhere} AND ${zeroSplit} AND ${TEST}`).s,
    );
  }
  if (hasTable("ledger")) {
    money.ledger_debit = r2(one("SELECT COALESCE(SUM(debit),0) s FROM ledger").s);
    money.ledger_credit = r2(one("SELECT COALESCE(SUM(credit),0) s FROM ledger").s);
  }
  if (hasTable("users")) {
    money.wallet_balance_total = r2(one("SELECT COALESCE(SUM(wallet_balance),0) s FROM users").s);
  }
  if (hasTable("coach_earnings")) {
    const ce = one(
      `SELECT COALESCE(SUM(gross_amount),0) g, COALESCE(SUM(net_amount),0) n,
              COALESCE(SUM(CASE WHEN status='paid' THEN net_amount ELSE 0 END),0) p
         FROM coach_earnings`,
    );
    money.coach_gross = r2(ce.g);
    money.coach_net = r2(ce.n);
    money.coach_paid = r2(ce.p);
    money.coach_unpaid = r2((Number(ce.n) || 0) - (Number(ce.p) || 0));
  }

  // ---- 分組 ----
  const groups = CHECK_META.map((m) => {
    const items = findings.filter((f) => f.code === m.code);
    const hasBlock = items.some((i) => i.severity === "block");
    const onlyInfo = items.length > 0 && items.every((i) => i.severity === "info");
    const level = !items.length ? "pass" : hasBlock ? "block" : onlyInfo ? "info" : "advisory";
    return { ...m, level, count: items.length, items };
  });
  // 未列入 META 的 schema 提示
  for (const f of findings) {
    if (!META[f.code] && !groups.some((g) => g.code === f.code)) {
      groups.push({ code: f.code, label: f.code, help: "", level: f.severity, count: 1, items: [f] });
    }
  }

  // ---- 摘要 ----
  const blocks = findings.filter((f) => f.severity === "block");
  const advisories = findings.filter((f) => f.severity === "advisory");
  const infos = findings.filter((f) => f.severity === "info");

  const checks = groups.map((g) => ({
    code: g.code,
    label: g.label,
    help: g.help,
    level: g.level,
    count: g.count,
  }));

  return {
    generated_at: new Date().toISOString(),
    ledger_go_live: LEDGER_GO_LIVE,
    summary: {
      block: blocks.length,
      advisory: advisories.length,
      info: infos.length,
      total: findings.length,
      clean: blocks.length === 0 && advisories.length === 0,
    },
    counts,
    money,
    checks,
    groups: groups.filter((g) => g.count > 0),
    findings,
    integrity_only: integrityOnly,
  };
}

module.exports = { runAuditReconcile, CHECK_META, LEDGER_GO_LIVE };
