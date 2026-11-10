/**
 * risk-control.js — 教練資金風控（工單二十二）
 *  - 風控工單 risk_audit_tickets
 *  - 觸發即凍結出糧（users.payout_status = frozen），教學功能不受影響
 *  - 只有 admin 可以解凍（寫審核者／備註／審計）
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
}

function trigger(db, { coachId, reason, ip = "", userAgent = "", level, freeze = true, notes = "" }) {
  ensureSchema(db);
  const meta = REASONS[reason] || { level: "medium", label: reason };
  const existing = db
    .prepare("SELECT * FROM risk_audit_tickets WHERE coach_id=? AND trigger_reason=? AND status IN ('open','under_investigation') LIMIT 1")
    .get(coachId, reason);
  if (existing) {
    if (freeze) db.prepare("UPDATE users SET payout_status='frozen' WHERE id=?").run(coachId);
    return { ticket: existing, duplicated: true };
  }
  const id = "TICKET-RISK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  db.prepare(
    `INSERT INTO risk_audit_tickets (id, coach_id, trigger_reason, ip_address, user_agent, risk_level, status, resolution_notes)
     VALUES (?,?,?,?,?,?,'open',?)`,
  ).run(id, coachId, reason, ip || null, userAgent ? String(userAgent).slice(0, 300) : null, level || meta.level, notes || null);
  if (freeze) db.prepare("UPDATE users SET payout_status='frozen' WHERE id=?").run(coachId);
  try {
    dbNotification(
      coachId,
      "risk",
      "⚠️ 帳戶安全保護中",
      `偵測到「${meta.label}」，為保障資金安全，本月出糧已暫時保留；帶班、點名、記帳功能不受影響。請聯絡客服核實。`,
      { ticket_id: id, reason },
    );
  } catch (e) {}
  try {
    audit({
      actionType: "risk.ticket_opened",
      entityType: "coach",
      entityId: coachId,
      newValues: { ticket_id: id, reason, level: level || meta.level, ip },
      description: `風控觸發：${meta.label}`,
    });
  } catch (e) {}
  return { ticket: db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(id), duplicated: false };
}

function listTickets(db, { status } = {}) {
  ensureSchema(db);
  const where = status ? "WHERE r.status=?" : "";
  const params = status ? [status] : [];
  return db
    .prepare(
      `SELECT r.*, u.name AS coach_name, u.phone AS coach_phone
         FROM risk_audit_tickets r LEFT JOIN users u ON u.id=r.coach_id
         ${where} ORDER BY (r.status IN ('open','under_investigation')) DESC, datetime(r.created_at) DESC LIMIT 200`,
    )
    .all(...params);
}

function resolve(db, { ticketId, action, notes, adminId }) {
  ensureSchema(db);
  const t = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(ticketId);
  if (!t) return { ok: false, code: "NOT_FOUND" };
  if (!["unlock", "reject"].includes(action)) return { ok: false, code: "BAD_ACTION" };
  if (String(notes || "").trim().length < 4) return { ok: false, code: "NOTES_REQUIRED" };

  const status = action === "unlock" ? "resolved" : "rejected";
  db.transaction(() => {
    db.prepare(
      "UPDATE risk_audit_tickets SET status=?, resolution_notes=?, reviewed_by_admin_id=?, resolved_at=datetime('now') WHERE id=?",
    ).run(status, String(notes).trim(), adminId, ticketId);
    if (action === "unlock") db.prepare("UPDATE users SET payout_status='active' WHERE id=?").run(t.coach_id);
  })();
  try {
    audit({
      actionType: "risk.ticket_resolved",
      entityType: "coach",
      entityId: t.coach_id,
      userId: adminId,
      oldValues: { status: t.status },
      newValues: { status, action, notes: String(notes).trim(), ticket_id: ticketId },
      description: action === "unlock" ? "風控解凍（可補發）" : "風控駁回",
    });
  } catch (e) {}
  return { ok: true, status };
}

function payoutState(db, coachId) {
  ensureSchema(db);
  const u = db.prepare("SELECT payout_status FROM users WHERE id=?").get(coachId);
  return (u && u.payout_status) || "active";
}

module.exports = { ensureSchema, trigger, listTickets, resolve, payoutState, REASONS };
