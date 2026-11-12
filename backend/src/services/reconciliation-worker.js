/**
 * Phase 6.0 — 每日財務平帳巡檢（Daily Ledger Reconciliation）
 *
 * 每日 HKT 03:00 對「前一日」跑四條紅線：
 *   ① PRESENT_WITHOUT_PAYMENT   已出席但無 Pass 扣減亦無付款
 *   ② MISSING_COACH_EARNING     已出席但該班次無 coach_earnings 分錄
 *   ③ NEGATIVE_PASS_CREDITS     Pass 剩餘堂數為負
 *   ④ ORPHAN_PASS_REDEMPTION    已扣堂但對應 booking 唔存在
 *
 * 結果寫入 daily_reconciliation_logs（一日一筆，INSERT OR REPLACE 保證 idempotent）。
 * 驗收測試資料（is_acceptance_test = 1）一律排除出正式帳。
 *
 * 安全：
 *  - 只讀業務表，唯一寫入係稽核表
 *  - 稽核表未建立（未做 Phase 6.0 migration）時，只輸出 console 警報，唔會拋錯
 */

function hasTable(db, name) {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
  } catch (e) {
    return false;
  }
}

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (e) {
    return false;
  }
}

function hktToday(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hktYesterday(d = new Date()) {
  return hktToday(new Date(d.getTime() - 86400000));
}

/**
 * @param {string} [targetDateStr] YYYY-MM-DD（HKT），預設昨日
 * @returns {{auditDate:string, status:string, discrepancies:Array, summary:object, logged:boolean}}
 */
function runDailyReconciliation(targetDateStr, opts = {}) {
  const { getDb } = require("./database");
  const db = opts.db || getDb();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(targetDateStr || ""))
    ? String(targetDateStr)
    : hktYesterday();

  const testCol = {
    bookings: hasColumn(db, "bookings", "is_acceptance_test"),
    earnings: hasColumn(db, "coach_earnings", "is_acceptance_test"),
    passes: hasColumn(db, "user_passes", "is_acceptance_test"),
  };
  const notTest = (table) => (testCol[table] ? `AND COALESCE(b.is_acceptance_test,0) = 0` : "");
  const notTestEarn = testCol.earnings ? `AND COALESCE(ce.is_acceptance_test,0) = 0` : "";
  const notTestPass = testCol.passes ? `AND COALESCE(is_acceptance_test,0) = 0` : "";

  const discrepancies = [];

  // ① 已出席但無付款／無 Pass
  try {
    const rows = db
      .prepare(
        `SELECT b.id AS booking_id, b.user_id, b.schedule_id, b.payment_type, b.payment_status
           FROM bookings b
          WHERE date(b.created_at) = ?
            AND b.attendance_status = 'present'
            AND COALESCE(b.status,'') <> 'cancelled'
            ${notTest("bookings")}
            AND b.pass_id IS NULL
            AND COALESCE(b.payment_status,'') <> 'paid'`,
      )
      .all(date);
    if (rows.length) discrepancies.push({ type: "PRESENT_WITHOUT_PAYMENT", count: rows.length, items: rows });
  } catch (e) {
    discrepancies.push({ type: "CHECK_ERROR", check: "PRESENT_WITHOUT_PAYMENT", error: e.message });
  }

  // ② 已出席但漏寫 coach_earnings
  try {
    const rows = db
      .prepare(
        `SELECT b.schedule_id, COUNT(b.id) AS present_count
           FROM bookings b
          WHERE date(b.created_at) = ?
            AND b.attendance_status = 'present'
            AND COALESCE(b.status,'') <> 'cancelled'
            ${notTest("bookings")}
            AND NOT EXISTS (
              SELECT 1 FROM coach_earnings ce
               WHERE ce.schedule_id = b.schedule_id
                 AND COALESCE(ce.status,'') <> 'cancelled'
                 ${notTestEarn}
            )
          GROUP BY b.schedule_id`,
      )
      .all(date);
    if (rows.length) discrepancies.push({ type: "MISSING_COACH_EARNING", count: rows.length, items: rows });
  } catch (e) {
    discrepancies.push({ type: "CHECK_ERROR", check: "MISSING_COACH_EARNING", error: e.message });
  }

  // ③ Pass 負數
  try {
    const rows = db
      .prepare(
        `SELECT id, user_id, remaining_credits FROM user_passes
          WHERE remaining_credits < 0 ${notTestPass}`,
      )
      .all();
    if (rows.length) discrepancies.push({ type: "NEGATIVE_PASS_CREDITS", count: rows.length, items: rows });
  } catch (e) {
    discrepancies.push({ type: "CHECK_ERROR", check: "NEGATIVE_PASS_CREDITS", error: e.message });
  }

  // ④ 已扣堂但 booking 唔存在（掉單）
  try {
    if (hasTable(db, "pass_redemptions")) {
      const rows = db
        .prepare(
          `SELECT r.id, r.pass_id, r.booking_id, r.credits
             FROM pass_redemptions r
            WHERE r.status = 'used'
              AND date(r.created_at) = ?
              AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = r.booking_id)`,
        )
        .all(date);
      if (rows.length) discrepancies.push({ type: "ORPHAN_PASS_REDEMPTION", count: rows.length, items: rows });
    }
  } catch (e) {
    discrepancies.push({ type: "CHECK_ERROR", check: "ORPHAN_PASS_REDEMPTION", error: e.message });
  }

  // 摘要數字（寫入稽核表；只作對帳參考）
  const summary = { passes: 0, stripeCents: 0, presents: 0, coachEarningsCents: 0 };
  try {
    const p = db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN payment_intent_id IS NOT NULL THEN ROUND(price_paid*100) ELSE 0 END),0) AS s
           FROM user_passes WHERE date(created_at) = ? ${notTestPass}`,
      )
      .get(date);
    summary.passes = Number(p && p.c) || 0;
    summary.stripeCents = Number(p && p.s) || 0;
  } catch (e) {}
  try {
    const b = db
      .prepare(
        `SELECT COUNT(*) AS c FROM bookings b
          WHERE date(b.created_at) = ? AND b.attendance_status='present'
            AND COALESCE(b.status,'') <> 'cancelled' ${notTest("bookings")}`,
      )
      .get(date);
    summary.presents = Number(b && b.c) || 0;
  } catch (e) {}
  try {
    const e2 = db
      .prepare(
        `SELECT COALESCE(SUM(ce.net_amount_cents),0) AS s FROM coach_earnings ce
          WHERE date(ce.created_at) = ? AND COALESCE(ce.status,'') <> 'cancelled' ${notTestEarn}`,
      )
      .get(date);
    summary.coachEarningsCents = Number(e2 && e2.s) || 0;
  } catch (e) {}

  const status = discrepancies.length === 0 ? "balanced" : "discrepancy_detected";

  // 寫入稽核表（未建表 → console 警報，唔會拋錯）
  let logged = false;
  if (hasTable(db, "daily_reconciliation_logs")) {
    try {
      db.prepare(
        `INSERT OR REPLACE INTO daily_reconciliation_logs
           (id, audit_date, total_passes_sold, total_stripe_cents, total_bookings_present,
            total_coach_earnings_cents, discrepancy_count, discrepancy_details, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`,
      ).run(
        "audit_" + date.replace(/-/g, ""),
        date,
        summary.passes,
        summary.stripeCents,
        summary.presents,
        summary.coachEarningsCents,
        discrepancies.length,
        JSON.stringify(discrepancies),
        status,
      );
      logged = true;
    } catch (e) {
      console.error("[RECON-6.0] 寫入稽核表失敗:", e.message);
    }
  }

  if (status !== "balanced") {
    console.error(
      `🚨 [RECON-6.0] ${date} 平帳異常 ${discrepancies.length} 類：` +
        discrepancies.map((d) => d.type + (d.count ? `(${d.count})` : "")).join(", "),
    );
  } else {
    console.log(`✅ [RECON-6.0] ${date} 三方平帳：balanced（present ${summary.presents}、教練分帳 ${summary.coachEarningsCents}c）`);
  }

  return { auditDate: date, status, discrepancies, summary, logged };
}

/** 每日 HKT 03:00 跑一次（呼叫方負責時間判斷） */
function startHourlyCheck(intervalMs = 60 * 60 * 1000) {
  let lastRun = null;
  const timer = setInterval(() => {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      const get = (t) => (parts.find((p) => p.type === t) || {}).value;
      const hour = Number(get("hour"));
      const today = `${get("year")}-${get("month")}-${get("day")}`;
      if (hour !== 3 || lastRun === today) return;
      lastRun = today;
      runDailyReconciliation(hktYesterday());
    } catch (e) {
      console.error("[RECON-6.0] cron:", e.message);
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { runDailyReconciliation, startHourlyCheck, hktToday, hktYesterday, hasColumn, hasTable };
