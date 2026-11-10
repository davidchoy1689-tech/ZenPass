/**
 * risk-control.js — 教練資金風控（工單二十二 + 風控審核台）
 *  - 風控工單 risk_audit_tickets
 *  - 觸發即凍結出糧（users.payout_status = frozen），教學功能不受影響
 *  - 只有 admin 可以解凍（寫審核者／備註／審計）
 *  - 大額（> HK$10,000）解凍需 Maker–Checker 雙人覆核：
 *      第一位管理員批准 → 產生一次性 challenge（10 分鐘、單次）
 *      第二位不同管理員持 challenge 完成覆核，才正式解凍
 *  - 解凍同一事務內：恢復出糧、標記收款戶口已人工核實、重新納入當月發放隊列
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const { audit } = require("./audit");
const { dbNotification } = require("./notification");

const REASONS = {
  pre_payout_change: { level: "high", label: "出糧前更改收款資料" },
  unusual_ip: { level: "high", label: "異地／陌生裝置登入" },
  otp_exhausted: { level: "medium", label: "OTP 連續錯誤" },
  transaction_spike: { level: "medium", label: "交易量異常" },
};

const DEFAULT_DUAL_THRESHOLD_CENTS = 1000000; // HK$10,000
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_audit_tickets (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      trigger_reason TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','under_investigation','resolved','rejected')),
      resolution_notes TEXT,
      reviewed_by_admin_id TEXT,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_risk_coach ON risk_audit_tickets(coach_id, status);
    CREATE INDEX IF NOT EXISTS idx_risk_status ON risk_audit_tickets(status, created_at);
  `);
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("payout_status")) {
    db.exec("ALTER TABLE users ADD COLUMN payout_status TEXT DEFAULT 'active'");
  }
  // 追加欄（idempotent，舊 DB 自動補）
  const tcols = db.prepare("PRAGMA table_info(risk_audit_tickets)").all().map((c) => c.name);
  const add = (name, ddl) => {
    if (!tcols.includes(name)) db.exec(`ALTER TABLE risk_audit_tickets ADD COLUMN ${ddl}`);
  };
  add("meta_json", "meta_json TEXT");
  add("payout_month", "payout_month TEXT");
  add("amount_at_stake_cents", "amount_at_stake_cents INTEGER DEFAULT 0");
  add("requires_secondary", "requires_secondary INTEGER DEFAULT 0");
  add("primary_approved_by", "primary_approved_by TEXT");
  add("primary_approved_at", "primary_approved_at DATETIME");
  add("secondary_challenge_hash", "secondary_challenge_hash TEXT");
  add("secondary_challenge_expires", "secondary_challenge_expires DATETIME");
  add("secondary_approved_by", "secondary_approved_by TEXT");
  add("secondary_approved_at", "secondary_approved_at DATETIME");
  add("settings_verified_at", "settings_verified_at DATETIME");
  add("disbursement_id", "disbursement_id TEXT");
  add("lockdown_state", "lockdown_state TEXT");
  add("locked_at", "locked_at DATETIME");
  add("locked_by", "locked_by TEXT");
  add("recovery_reset_at", "recovery_reset_at DATETIME");
  add("recovered_at", "recovered_at DATETIME");
}

function hkMonth(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 7);
}

function dualThresholdCents(db) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key='risk.dual_approval_threshold_cents'").get();
    const n = Number(r && r.value);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DUAL_THRESHOLD_CENTS;
  } catch (e) {
    return DEFAULT_DUAL_THRESHOLD_CENTS;
  }
}

/** 該教練該月可發放金額（cents）；計算失敗回 0，唔會擋流程 */
function amountAtStake(db, coachId, month) {
  try {
    const { buildMonthlyBreakdown } = require("../routes/coach-earnings");
    const d = buildMonthlyBreakdown(db, coachId, month);
    const net = Number(d.net_payout_cents) || 0;
    return net > 0 ? net : Number(d.total_payout_cents) || 0;
  } catch (e) {
    return 0;
  }
}

function trigger(db, { coachId, reason, ip = "", userAgent = "", level, freeze = true, notes = "", meta = null }) {
  ensureSchema(db);
  const metaInfo = REASONS[reason] || { level: "medium", label: reason };
  const month = hkMonth();
  const amount = amountAtStake(db, coachId, month);
  const existing = db
    .prepare("SELECT * FROM risk_audit_tickets WHERE coach_id=? AND trigger_reason=? AND status IN ('open','under_investigation') LIMIT 1")
    .get(coachId, reason);
  if (existing) {
    if (freeze) db.prepare("UPDATE users SET payout_status='frozen' WHERE id=?").run(coachId);
    if (meta) {
      db.prepare("UPDATE risk_audit_tickets SET meta_json=?, amount_at_stake_cents=?, payout_month=? WHERE id=?").run(
        JSON.stringify(meta),
        amount,
        month,
        existing.id,
      );
    }
    return { ticket: db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(existing.id), duplicated: true };
  }
  const id = "TICKET-RISK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  db.prepare(
    `INSERT INTO risk_audit_tickets
       (id, coach_id, trigger_reason, ip_address, user_agent, risk_level, status, resolution_notes,
        meta_json, payout_month, amount_at_stake_cents)
     VALUES (?,?,?,?,?,?,'open',?,?,?,?)`,
  ).run(
    id,
    coachId,
    reason,
    ip || null,
    userAgent ? String(userAgent).slice(0, 300) : null,
    level || metaInfo.level,
    notes || null,
    meta ? JSON.stringify(meta) : null,
    month,
    amount,
  );
  if (freeze) db.prepare("UPDATE users SET payout_status='frozen' WHERE id=?").run(coachId);
  try {
    dbNotification(
      coachId,
      "risk",
      "⚠️ 帳戶安全保護中",
      `偵測到「${metaInfo.label}」，為保障資金安全，本月出糧已暫時保留；帶班、點名、記帳功能不受影響。請聯絡客服核實。`,
      { ticket_id: id, reason },
    );
  } catch (e) {}
  try {
    audit({
      actionType: "risk.ticket_opened",
      entityType: "coach",
      entityId: coachId,
      newValues: {
        ticket_id: id,
        reason,
        level: level || metaInfo.level,
        ip,
        amount_at_stake_cents: amount,
        payout_month: month,
      },
      description: `風控觸發：${metaInfo.label}`,
    });
  } catch (e) {}
  return { ticket: db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(id), duplicated: false };
}

function listTickets(db, { status } = {}) {
  ensureSchema(db);
  const where = status === "open" ? "WHERE (r.status IN ('open','under_investigation') OR r.lockdown_state='account_locked')" : status ? "WHERE r.status=?" : "";
  const params = status && status !== "open" ? [status] : [];
  return db
    .prepare(
      `SELECT r.*, u.name AS coach_name, u.phone AS coach_phone, u.payout_status AS coach_payout_status
         FROM risk_audit_tickets r LEFT JOIN users u ON u.id=r.coach_id
         ${where}
        ORDER BY (r.lockdown_state='account_locked') DESC, (r.status IN ('open','under_investigation')) DESC, datetime(r.created_at) DESC LIMIT 200`,
    )
    .all(...params);
}

/** 風控台首屏統計：待審工單、凍結人數、本月攔截金額 */
function summary(db) {
  ensureSchema(db);
  const open = db
    .prepare("SELECT COUNT(*) c FROM risk_audit_tickets WHERE status IN ('open','under_investigation')")
    .get().c;
  const frozen = db.prepare("SELECT id FROM users WHERE payout_status='frozen'").all();
  const month = hkMonth();
  let blocked = 0;
  for (const f of frozen) blocked += amountAtStake(db, f.id, month);
  const monthBlocked = db
    .prepare(
      "SELECT COALESCE(SUM(amount_at_stake_cents),0) c FROM risk_audit_tickets WHERE substr(created_at,1,7)=? AND status IN ('open','under_investigation')",
    )
    .get(month).c;
  return {
    open_tickets: Number(open) || 0,
    frozen_coaches: frozen.length,
    blocked_amount_cents: blocked,
    month_blocked_cents: Number(monthBlocked) || 0,
    payout_month: month,
    dual_threshold_cents: dualThresholdCents(db),
  };
}

function parseMeta(t) {
  try {
    return t && t.meta_json ? JSON.parse(t.meta_json) : null;
  } catch (e) {
    return null;
  }
}

/** 確保該教練當月有一筆 pending 發放紀錄；回傳 disbursement id 或 null */
function ensurePendingDisbursement(db, coachId, month) {
  const dsvc = require("./payout-disbursements");
  dsvc.ensureSchema(db);
  const existing = db
    .prepare("SELECT * FROM coach_payout_disbursements WHERE coach_id=? AND payout_month=?")
    .get(coachId, month);
  if (existing) return existing.id;
  const { buildMonthlyBreakdown } = require("../routes/coach-earnings");
  const d = buildMonthlyBreakdown(db, coachId, month);
  const gross = Number(d.total_payout_cents) || 0;
  const offset = Number(d.cash_collected_cents) || 0;
  const net = Number(d.net_payout_cents) || 0;
  if (net <= 0) return null;
  const coach = db.prepare("SELECT phone FROM users WHERE id=?").get(coachId) || {};
  const out = dsvc.record(db, {
    coachId,
    month,
    grossCents: gross,
    offsetCents: offset,
    netCents: net,
    proxyId: coach.phone || null,
    status: "pending",
  });
  return out.id;
}

function maskPhone(p) {
  const s = String(p || "").replace(/\D/g, "");
  if (s.length === 8) return s.slice(0, 4) + "****";
  return s ? s.slice(0, 3) + "****" : "";
}

/** 工單詳情（證據鏈） */
function detail(db, ticketId) {
  ensureSchema(db);
  const t = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(ticketId);
  if (!t) return null;
  const coach =
    db.prepare("SELECT id, name, phone, email, role, payout_status, is_active, token_version FROM users WHERE id=?").get(t.coach_id) || {};
  const month = t.payout_month || hkMonth();
  let breakdown = null;
  try {
    const { buildMonthlyBreakdown } = require("../routes/coach-earnings");
    const d = buildMonthlyBreakdown(db, t.coach_id, month);
    breakdown = {
      month,
      total_payout_cents: Number(d.total_payout_cents) || 0,
      teaching_earnings_cents: Number(d.teaching_earnings_cents) || 0,
      own_student_uplift_cents: Number(d.own_student_uplift_cents) || 0,
      affiliate_passive_cents: Number(d.affiliate_passive_cents) || 0,
      cash_collected_cents: Number(d.cash_collected_cents) || 0,
      net_payout_cents: Number(d.net_payout_cents) || 0,
    };
  } catch (e) {}
  const meta = parseMeta(t) || {};
  let settings = null;
  try {
    const { getSettings } = require("./payout-settings");
    settings = getSettings(db, t.coach_id);
  } catch (e) {}
  const disbursement = db
    .prepare("SELECT id, payout_month, net_payout_cents, status, bank_reference_no FROM coach_payout_disbursements WHERE coach_id=? AND payout_month=?")
    .get(t.coach_id, month);
  const recent = db
    .prepare(
      `SELECT action_type, description, created_at, ip_address FROM audit_log
        WHERE entity_id=? AND entity_type IN ('coach','coach_payout_setting','user')
        ORDER BY datetime(created_at) DESC LIMIT 8`,
    )
    .all(t.coach_id);
  return {
    ticket: {
      ...t,
      coach_name: coach.name || t.coach_id,
      coach_phone_masked: maskPhone(coach.phone),
      coach_email: coach.email || "",
      coach_role: coach.role || "",
      coach_payout_status: coach.payout_status || "active",
      coach_is_active: coach.is_active === undefined ? 1 : Number(coach.is_active),
      coach_token_version: Number(coach.token_version) || 0,
      reason_label: (REASONS[t.trigger_reason] || {}).label || t.trigger_reason,
    },
    amount_at_stake_cents: Number(t.amount_at_stake_cents) || (breakdown ? breakdown.net_payout_cents : 0),
    dual_threshold_cents: dualThresholdCents(db),
    breakdown,
    settings,
    attempted: meta.attempted || null,
    environment: {
      ip: t.ip_address || "",
      user_agent: t.user_agent || "",
      country: meta.country || "",
      device_hint: /iPhone|iPad|Android|Mobile/i.test(t.user_agent || "") ? "流動裝置" : t.user_agent ? "桌面裝置" : "",
    },
    disbursement: disbursement || null,
    recent_audit: recent,
  };
}

function finalize(db, t, { adminId, notes, secondaryAdminId = null }) {
  const month = t.payout_month || hkMonth();
  let disbursementId = t.disbursement_id || null;
  let stillFrozen = false;
  let net = 0;

  db.transaction(() => {
    // 其他未結工單仍然凍結 → 保持 frozen（避免一張單解凍就放行全部）
    const others = db
      .prepare("SELECT COUNT(*) c FROM risk_audit_tickets WHERE coach_id=? AND id<>? AND status IN ('open','under_investigation')")
      .get(t.coach_id, t.id).c;
    stillFrozen = Number(others) > 0;

    db.prepare(
      `UPDATE risk_audit_tickets
          SET status='resolved', resolution_notes=?, reviewed_by_admin_id=?, resolved_at=datetime('now'),
              secondary_approved_by=?, secondary_approved_at=?, secondary_challenge_hash=NULL,
              secondary_challenge_expires=NULL, settings_verified_at=datetime('now')
        WHERE id=?`,
    ).run(String(notes || "").trim(), adminId, secondaryAdminId, secondaryAdminId ? new Date().toISOString() : null, t.id);

    if (!stillFrozen) db.prepare("UPDATE users SET payout_status='active' WHERE id=?").run(t.coach_id);

    // 收款戶口：標記為人工核實
    try {
      db.prepare("UPDATE coach_payout_settings SET verified_at=datetime('now') WHERE coach_id=?").run(t.coach_id);
    } catch (e) {}

    // 重新納入當月發放隊列（pending，待財務正式登記 FPS）
    try {
      require("./payout-disbursements").ensureSchema(db);
      const existing = db
        .prepare("SELECT * FROM coach_payout_disbursements WHERE coach_id=? AND payout_month=?")
        .get(t.coach_id, month);
      disbursementId = existing ? existing.id : ensurePendingDisbursement(db, t.coach_id, month);
      net = Number((existing && existing.net_payout_cents) || 0);
      if (!net && disbursementId) {
        const row = db.prepare("SELECT net_payout_cents FROM coach_payout_disbursements WHERE id=?").get(disbursementId);
        net = Number((row && row.net_payout_cents) || 0);
      }
      db.prepare("UPDATE risk_audit_tickets SET disbursement_id=? WHERE id=?").run(disbursementId, t.id);
    } catch (e) {
      if (process.env.RISK_DEBUG === "1") console.error("[RISK] enqueue payout:", e.message);
    }
  })();

  try {
    dbNotification(
      t.coach_id,
      "risk",
      "✅ 帳戶審核完成",
      stillFrozen
        ? "本案已審核完成；因仍有其他安全事項待處理，出糧暫維持保留。帶班與記帳不受影響。"
        : `您的收款資料變更已通過人工審核，帳戶已恢復正常${net > 0 ? `，本月淨收益 HK$${(net / 100).toFixed(2)} 已納入發放隊列` : ""}。`,
      { ticket_id: t.id, disbursement_id: disbursementId },
    );
  } catch (e) {}

  try {
    audit({
      actionType: secondaryAdminId ? "risk.ticket_dual_approved" : "risk.ticket_resolved",
      entityType: "coach",
      entityId: t.coach_id,
      userId: adminId,
      oldValues: { status: t.status },
      newValues: {
        status: "resolved",
        ticket_id: t.id,
        notes: String(notes || "").trim(),
        primary_approved_by: t.primary_approved_by || null,
        secondary_approved_by: secondaryAdminId,
        still_frozen: stillFrozen,
        disbursement_id: disbursementId,
        payout_month: month,
      },
      description: stillFrozen ? "風控解凍（仍有其他未結工單，維持凍結）" : "風控解凍並恢復發放",
    });
  } catch (e) {}

  return { ok: true, status: "resolved", still_frozen: stillFrozen, disbursement_id: disbursementId, net_payout_cents: net };
}

/**
 * resolve — 解凍 / 駁回
 * unlock：
 *   金額 ≤ 門檻 → 即時解凍
 *   金額 > 門檻 → 第一次為「初審核准」，回傳 challenge；第二位管理員帶 challenge 完成覆核
 */
function resolve(db, { ticketId, action, notes, adminId, challenge = "" }) {
  ensureSchema(db);
  const t = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(ticketId);
  if (!t) return { ok: false, code: "NOT_FOUND" };
  if (!["unlock", "reject"].includes(action)) return { ok: false, code: "BAD_ACTION" };
  if (String(notes || "").trim().length < 4) return { ok: false, code: "NOTES_REQUIRED" };
  if (["resolved", "rejected"].includes(t.status)) return { ok: false, code: "ALREADY_CLOSED" };

  if (action === "reject") {
    db.prepare(
      `UPDATE risk_audit_tickets SET status='rejected', resolution_notes=?, reviewed_by_admin_id=?, resolved_at=datetime('now')
        WHERE id=?`,
    ).run(String(notes).trim(), adminId, ticketId);
    try {
      audit({
        actionType: "risk.ticket_resolved",
        entityType: "coach",
        entityId: t.coach_id,
        userId: adminId,
        oldValues: { status: t.status },
        newValues: { status: "rejected", action: "reject", notes: String(notes).trim(), ticket_id: ticketId },
        description: "風控駁回（維持凍結）",
      });
    } catch (e) {}
    return { ok: true, status: "rejected", still_frozen: true };
  }

  const amount = Number(t.amount_at_stake_cents) || 0;
  const threshold = dualThresholdCents(db);

  if (amount > threshold) {
    if (!t.primary_approved_by) {
      const raw = crypto.randomBytes(16).toString("hex").toUpperCase();
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      const expires = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString().replace("T", " ").slice(0, 19);
      db.prepare(
        `UPDATE risk_audit_tickets
            SET status='under_investigation', requires_secondary=1, primary_approved_by=?, primary_approved_at=datetime('now'),
                secondary_challenge_hash=?, secondary_challenge_expires=?, resolution_notes=?
          WHERE id=?`,
      ).run(adminId, hash, expires, String(notes).trim(), ticketId);
      try {
        audit({
          actionType: "risk.ticket_primary_approved",
          entityType: "coach",
          entityId: t.coach_id,
          userId: adminId,
          newValues: {
            ticket_id: ticketId,
            amount_at_stake_cents: amount,
            threshold_cents: threshold,
            challenge_expires: expires,
          },
          description: "大額解凍初審核准（待第二位管理員覆核）",
        });
      } catch (e) {}
      return {
        ok: true,
        requires_secondary: true,
        status: "under_investigation",
        challenge: raw,
        challenge_expires: expires,
        message: "金額超過雙人覆核門檻，已記錄初審；請由另一位管理員於 10 分鐘內完成二次簽署。",
      };
    }

    // 第二簽
    if (String(adminId) === String(t.primary_approved_by)) {
      return { ok: false, code: "SAME_ADMIN", error: "初審與覆核必須由不同管理員執行" };
    }
    const ch = String(challenge || "").trim();
    if (!ch) return { ok: false, code: "CHALLENGE_REQUIRED", error: "請輸入初審產生的一次性覆核碼" };
    const hash = crypto.createHash("sha256").update(ch).digest("hex");
    if (hash !== t.secondary_challenge_hash) return { ok: false, code: "CHALLENGE_INVALID", error: "覆核碼不正確" };
    if (t.secondary_challenge_expires) {
      const exp = new Date(String(t.secondary_challenge_expires).replace(" ", "T") + "Z").getTime();
      if (Date.now() > exp) return { ok: false, code: "CHALLENGE_EXPIRED", error: "覆核碼已過期，請重新初審" };
    }
    return finalize(db, t, { adminId, notes, secondaryAdminId: adminId });
  }

  return finalize(db, t, { adminId, notes });
}

function payoutState(db, coachId) {
  ensureSchema(db);
  const u = db.prepare("SELECT payout_status FROM users WHERE id=?").get(coachId);
  return (u && u.payout_status) || "active";
}

module.exports = {
  ensureSchema,
  trigger,
  listTickets,
  summary,
  detail,
  resolve,
  ensurePendingDisbursement,
  payoutState,
  amountAtStake,
  dualThresholdCents,
  hkMonth,
  REASONS,
};
