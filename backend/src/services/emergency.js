/**
 * emergency.js — 教練帳號緊急熔斷（Emergency Kill-Switch）
 *
 *  - 管理員 6 位安全 PIN（bcrypt，逐位管理員）
 *  - 單一 SQLite 原子事務：停權＋撤銷 JWT（token_version +1）＋資金急凍
 *                          ＋還原合法 FPS＋黑客戶口入黑名單＋工單結案＋審計
 *  - 事後 SMS（Twilio）＋站內通知；WhatsApp 未配置時標記 skipped
 *  - 帳號復原：一次性重設連結 → 重新綁定 FPS → 管理員覆核解凍
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDb } = require("./database");
const { audit } = require("./audit");
const { dbNotification } = require("./notification");

const PIN_MAX_FAILS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const pinAttempts = new Map(); // adminId -> { count, firstAt }

function ensureSchema(db) {
  // 工單表必須先存在（lockdown_state 等欄依賴它）
  require("./risk-control").ensureSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_payout_settings_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id TEXT NOT NULL,
      fps_type TEXT,
      fps_proxy_value TEXT,
      bank_code TEXT,
      account_holder_name TEXT,
      is_verified INTEGER DEFAULT 1,
      event TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_psh_coach ON coach_payout_settings_history(coach_id, id DESC);

    CREATE TABLE IF NOT EXISTS fraud_blacklists (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('fps','bank','ip','device')),
      value TEXT NOT NULL,
      reason TEXT,
      coach_id TEXT,
      ticket_id TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_kind_value ON fraud_blacklists(kind, value);
  `);
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("admin_pin_hash")) db.exec("ALTER TABLE users ADD COLUMN admin_pin_hash TEXT");
  if (!cols.includes("admin_pin_set_at")) db.exec("ALTER TABLE users ADD COLUMN admin_pin_set_at DATETIME");
  const tcols = db.prepare("PRAGMA table_info(risk_audit_tickets)").all().map((c) => c.name);
  const add = (name, ddl) => {
    if (!tcols.includes(name)) db.exec(`ALTER TABLE risk_audit_tickets ADD COLUMN ${ddl}`);
  };
  add("lockdown_state", "lockdown_state TEXT");
  add("locked_at", "locked_at DATETIME");
  add("locked_by", "locked_by TEXT");
  add("recovery_reset_at", "recovery_reset_at DATETIME");
  add("recovered_at", "recovered_at DATETIME");

  // 首次部署：把現有已核實戶口記為 baseline，供緊急熔斷還原
  try {
    db.exec(`
      INSERT INTO coach_payout_settings_history
        (coach_id, fps_type, fps_proxy_value, bank_code, account_holder_name, is_verified, event)
      SELECT c.coach_id, c.fps_type, c.fps_proxy_value, c.bank_code, c.account_holder_name, 1, 'baseline'
        FROM coach_payout_settings c
       WHERE NOT EXISTS (SELECT 1 FROM coach_payout_settings_history h WHERE h.coach_id = c.coach_id)
    `);
  } catch (e) {}
}

// ===== 管理員安全 PIN =====
function pinStatus(db, adminId) {
  ensureSchema(db);
  const r = db.prepare("SELECT admin_pin_hash, admin_pin_set_at FROM users WHERE id=?").get(adminId);
  return { configured: !!(r && r.admin_pin_hash), set_at: (r && r.admin_pin_set_at) || null };
}

function setAdminPin(db, adminId, { pin, password }) {
  ensureSchema(db);
  if (!/^\d{6}$/.test(String(pin || ""))) return { ok: false, code: "PIN_FORMAT" };
  const u = db.prepare("SELECT id, password_hash, auth_provider FROM users WHERE id=?").get(adminId);
  if (!u) return { ok: false, code: "NOT_FOUND" };
  if (u.password_hash && u.auth_provider === "email") {
    if (!password || !bcrypt.compareSync(String(password), u.password_hash)) {
      return { ok: false, code: "BAD_PASSWORD" };
    }
  }
  db.prepare("UPDATE users SET admin_pin_hash=?, admin_pin_set_at=datetime('now') WHERE id=?").run(
    bcrypt.hashSync(String(pin), 10),
    adminId,
  );
  try {
    audit({
      actionType: "security.admin_pin_set",
      entityType: "admin",
      entityId: adminId,
      userId: adminId,
      description: "設定／更新風控緊急處置安全 PIN",
    });
  } catch (e) {}
  return { ok: true };
}

function verifyAdminPin(db, adminId, pin) {
  ensureSchema(db);
  const now = Date.now();
  const rec = pinAttempts.get(adminId);
  if (rec && now - rec.firstAt > PIN_WINDOW_MS) pinAttempts.delete(adminId);
  const cur = pinAttempts.get(adminId);
  if (cur && cur.count >= PIN_MAX_FAILS) {
    return { ok: false, code: "PIN_LOCKED", retry_after: Math.ceil((PIN_WINDOW_MS - (now - cur.firstAt)) / 1000) };
  }
  const r = db.prepare("SELECT admin_pin_hash FROM users WHERE id=?").get(adminId);
  if (!r || !r.admin_pin_hash) return { ok: false, code: "PIN_NOT_CONFIGURED" };
  if (!/^\d{6}$/.test(String(pin || "")) || !bcrypt.compareSync(String(pin), r.admin_pin_hash)) {
    const next = cur && now - cur.firstAt <= PIN_WINDOW_MS ? { count: cur.count + 1, firstAt: cur.firstAt } : { count: 1, firstAt: now };
    pinAttempts.set(adminId, next);
    try {
      audit({
        actionType: "security.admin_pin_failed",
        entityType: "admin",
        entityId: adminId,
        userId: adminId,
        newValues: { attempts: next.count },
        description: "風控安全 PIN 驗證失敗",
      });
    } catch (e) {}
    return { ok: false, code: "PIN_INVALID" };
  }
  pinAttempts.delete(adminId);
  return { ok: true };
}

// ===== 黑名單 =====
function addBlacklist(db, { kind, value, reason, coachId, ticketId, adminId }) {
  const v = String(value || "").trim();
  if (!v) return null;
  const id = crypto.randomUUID();
  try {
    db.prepare(
      "INSERT INTO fraud_blacklists (id, kind, value, reason, coach_id, ticket_id, created_by) VALUES (?,?,?,?,?,?,?)",
    ).run(id, kind, v, reason || null, coachId || null, ticketId || null, adminId || null);
    return id;
  } catch (e) {
    if (/UNIQUE constraint/.test(e.message)) return null;
    throw e;
  }
}

function isBlacklisted(db, kind, value) {
  try {
    ensureSchema(db);
    const v = String(value || "").trim();
    if (!v) return false;
    return !!db.prepare("SELECT 1 FROM fraud_blacklists WHERE kind=? AND value=?").get(kind, v);
  } catch (e) {
    return false;
  }
}

function listBlacklist(db) {
  ensureSchema(db);
  return db.prepare("SELECT * FROM fraud_blacklists ORDER BY datetime(created_at) DESC LIMIT 300").all();
}

function removeBlacklist(db, id, adminId) {
  ensureSchema(db);
  const row = db.prepare("SELECT * FROM fraud_blacklists WHERE id=?").get(id);
  if (!row) return { ok: false, code: "NOT_FOUND" };
  db.prepare("DELETE FROM fraud_blacklists WHERE id=?").run(id);
  try {
    audit({
      actionType: "security.blacklist_removed",
      entityType: "fraud_blacklist",
      entityId: id,
      userId: adminId,
      oldValues: row,
      description: "移除風控黑名單",
    });
  } catch (e) {}
  return { ok: true };
}

// ===== 緊急熔斷 =====
function lockdown(db, { coachId, ticketId, adminId, reason, ip = "", userAgent = "" }) {
  ensureSchema(db);
  const risk = require("./risk-control");
  risk.ensureSchema(db);

  const coach = db.prepare("SELECT id, name, phone, role, is_coach, token_version, payout_status FROM users WHERE id=?").get(coachId);
  if (!coach) return { ok: false, code: "COACH_NOT_FOUND" };
  if (["super_admin", "platform_manager"].includes(coach.role)) return { ok: false, code: "PROTECTED_ROLE" };

  const ticket = ticketId
    ? db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(ticketId)
    : db
        .prepare("SELECT * FROM risk_audit_tickets WHERE coach_id=? AND status IN ('open','under_investigation') ORDER BY datetime(created_at) DESC LIMIT 1")
        .get(coachId);
  if (!ticket) return { ok: false, code: "TICKET_REQUIRED" };
  if (ticket.lockdown_state === "account_locked") return { ok: false, code: "ALREADY_LOCKED" };

  const month = ticket.payout_month || risk.hkMonth();
  const amount = Number(ticket.amount_at_stake_cents) || risk.amountAtStake(db, coachId, month);
  const sessionVersion = Number(coach.token_version) || 0;

  let restored = false;
  let blacklisted = 0;
  let previousSettings = null;

  db.transaction(() => {
    const current = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id=?").get(coachId);
    if (current) {
      // 還原上一次已核實、且唔在黑名單嘅戶口
      const history = db
        .prepare("SELECT * FROM coach_payout_settings_history WHERE coach_id=? AND is_verified=1 ORDER BY id DESC LIMIT 20")
        .all(coachId);
      const safe = history.find((h) => h.fps_proxy_value && !isBlacklisted(db, "fps", h.fps_proxy_value));
      const differs = safe && String(safe.fps_proxy_value) !== String(current.fps_proxy_value);
      if (differs) {
        // 現行（疑似黑客）戶口入黑名單
        if (addBlacklist(db, { kind: "fps", value: current.fps_proxy_value, reason: `緊急熔斷：${reason}`, coachId, ticketId: ticket.id, adminId })) blacklisted++;
        if (current.bank_code) {
          if (addBlacklist(db, { kind: "bank", value: `${current.bank_code}|${String(current.account_holder_name || "").toUpperCase()}`, reason: "緊急熔斷：可疑收款戶口", coachId, ticketId: ticket.id, adminId })) blacklisted++;
        }
        previousSettings = safe;
        db.prepare(
          `UPDATE coach_payout_settings SET fps_type=?, fps_proxy_value=?, bank_code=?, account_holder_name=?,
                  updated_at=datetime('now') WHERE coach_id=?`,
        ).run(safe.fps_type, safe.fps_proxy_value, safe.bank_code, safe.account_holder_name, coachId);
        db.prepare(
          "INSERT INTO coach_payout_settings_history (coach_id, fps_type, fps_proxy_value, bank_code, account_holder_name, is_verified, event) VALUES (?,?,?,?,?,1,'rollback_lockdown')",
        ).run(coachId, safe.fps_type, safe.fps_proxy_value, safe.bank_code, safe.account_holder_name);
        restored = true;
      }
    }

    // 工單記錄嘅「嘗試變更」戶口（黑客輸入值）亦要入黑名單
    try {
      const meta = ticket.meta_json ? JSON.parse(ticket.meta_json) : null;
      const att = meta && meta.attempted;
      if (att && att.fps_proxy_masked && att.bank_code) {
        // masked 值唔可作唯一比對，只記錄銀行＋戶名組合作警號
        if (att.account_holder_name) {
          const v = `${att.bank_code}|${String(att.account_holder_name).toUpperCase()}`;
          if (addBlacklist(db, { kind: "bank", value: v, reason: "緊急熔斷：黑客嘗試收款戶口", coachId, ticketId: ticket.id, adminId })) blacklisted++;
        }
      }
    } catch (e) {}

    db.prepare(
      `UPDATE users SET is_active=0, payout_status='frozen_stolen',
              token_version=COALESCE(token_version,0)+1, updated_at=datetime('now')
        WHERE id=?`,
    ).run(coachId);

    if (ticket.ip_address) {
      if (addBlacklist(db, { kind: "ip", value: ticket.ip_address, reason: `緊急熔斷：入侵來源 IP`, coachId, ticketId: ticket.id, adminId })) blacklisted++;
    }
    if (ticket.user_agent) {
      const fp = crypto.createHash("sha256").update(String(ticket.user_agent)).digest("hex").slice(0, 32);
      if (addBlacklist(db, { kind: "device", value: fp, reason: `緊急熔斷：可疑裝置（${String(ticket.user_agent).slice(0, 80)}）`, coachId, ticketId: ticket.id, adminId })) blacklisted++;
    }

    db.prepare(
      `UPDATE risk_audit_tickets
          SET status='resolved', resolution_notes=?, reviewed_by_admin_id=?, resolved_at=datetime('now'),
              lockdown_state='account_locked', locked_at=datetime('now'), locked_by=?
        WHERE id=?`,
    ).run(`[EMERGENCY LOCKDOWN] ${String(reason).trim()}`, adminId, adminId, ticket.id);

    try {
      audit({
        actionType: "security.coach_emergency_lockdown",
        entityType: "coach",
        entityId: coachId,
        userId: adminId,
        oldValues: { is_active: 1, payout_status: coach.payout_status || "active", token_version: sessionVersion },
        newValues: {
          is_active: 0,
          payout_status: "frozen_stolen",
          token_version: sessionVersion + 1,
          ticket_id: ticket.id,
          amount_at_stake_cents: amount,
          fps_restored: restored,
          blacklisted,
          reason: String(reason).trim(),
        },
        description: "🚨 緊急熔斷：帳號停權、JWT 全撤、資金急凍、收款戶口還原",
        ipAddress: ip,
        userAgent: userAgent,
      });
    } catch (e) {}
  })();

  // 通知（事務外）
  let smsStatus = "skipped";
  let whatsappStatus = "not_configured";
  try {
    dbNotification(
      coachId,
      "security",
      "🚨 帳戶安全警報",
      "系統偵測到您的帳戶有異常入侵，已啟動緊急保護：帳戶已暫時登出並凍結資金。請勿理會任何索取驗證碼的要求，官方專員將於短時間內親自致電協助您找回帳戶。",
      { ticket_id: ticket.id, lockdown: true },
    );
  } catch (e) {}
  if (coach.phone) {
    try {
      const sms = require("./sms-service");
      if (sms.isConfigured()) {
        sms
          .sendSms(
            coach.phone,
            "【ZenPass 安全警報】系統偵測到您的帳戶有異常入侵，已啟動緊急保護：帳戶已暫時登出並凍結資金。請勿理會任何索取驗證碼的要求，官方專員將於短時間內親自致電協助您找回帳戶。",
          )
          .then((r) => {
            try {
              audit({
                actionType: "security.alert_sent",
                entityType: "coach",
                entityId: coachId,
                userId: adminId,
                newValues: { channel: "sms", ok: !!r.ok, status: r.status || 0 },
                description: "緊急安全短訊",
              });
            } catch (e) {}
          })
          .catch(() => {});
        smsStatus = "queued";
      }
    } catch (e) {}
  }

  return {
    ok: true,
    ticket_id: ticket.id,
    coach_id: coachId,
    coach_name: coach.name,
    amount_at_stake_cents: amount,
    sessions_revoked: sessionVersion + 1,
    fps_restored: restored,
    restored_to: previousSettings ? { bank_code: previousSettings.bank_code, masked: maskProxy(previousSettings.fps_proxy_value) } : null,
    blacklisted_entries: blacklisted,
    alert: { sms: smsStatus, whatsapp: whatsappStatus, in_app: true },
  };
}

function maskProxy(v) {
  const s = String(v || "");
  if (s.length >= 8) return s.slice(0, 4) + "****";
  return s ? "****" : "";
}

// ===== 帳號復原 =====
function issueReset(db, { coachId, adminId, notes, ip = "" }) {
  ensureSchema(db);
  const u = db.prepare("SELECT id, name, phone, is_active FROM users WHERE id=?").get(coachId);
  if (!u) return { ok: false, code: "NOT_FOUND" };
  if (!u.phone) return { ok: false, code: "NO_PHONE" };
  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + RESET_TTL_MS).toISOString().replace("T", " ").slice(0, 19);
  db.prepare("UPDATE users SET reset_token=?, reset_token_expires=? WHERE id=?").run(token, expires, coachId);
  db.prepare("UPDATE risk_audit_tickets SET recovery_reset_at=datetime('now') WHERE coach_id=? AND lockdown_state='account_locked'").run(coachId);

  const link = `https://zenpass.hk/v2/reset.html?token=${encodeURIComponent(token)}`;
  let smsStatus = "not_configured";
  try {
    const sms = require("./sms-service");
    if (sms.isConfigured()) {
      sms
        .sendSms(
          u.phone,
          `【ZenPass 帳戶復原】請於 30 分鐘內開啟以下連結重設密碼：${link} 。如非本人操作請即致電客服。`,
        )
        .catch(() => {});
      smsStatus = "queued";
    }
  } catch (e) {}

  try {
    audit({
      actionType: "security.recovery_reset_issued",
      entityType: "coach",
      entityId: coachId,
      userId: adminId,
      newValues: { expires_at: expires, sms: smsStatus, notes: String(notes || "").trim() },
      description: "發出一次性帳號復原重設連結",
      ipAddress: ip,
    });
  } catch (e) {}
  return { ok: true, sms: smsStatus, expires_at: expires, reset_link: smsStatus === "not_configured" ? link : undefined };
}

function reactivate(db, { coachId, adminId, notes, idVerified, ip = "" }) {
  ensureSchema(db);
  if (!idVerified) return { ok: false, code: "ID_NOT_VERIFIED" };
  if (String(notes || "").trim().length < 4) return { ok: false, code: "NOTES_REQUIRED" };
  const u = db.prepare("SELECT id, name, is_active, token_version FROM users WHERE id=?").get(coachId);
  if (!u) return { ok: false, code: "NOT_FOUND" };
  const risk = require("./risk-control");
  const month = risk.hkMonth();

  let disbursementId = null;
  db.transaction(() => {
    db.prepare(
      `UPDATE users SET is_active=1, payout_status='active',
              token_version=COALESCE(token_version,0)+1, reset_token=NULL, reset_token_expires=NULL,
              updated_at=datetime('now')
        WHERE id=?`,
    ).run(coachId);
    db.prepare(
      `UPDATE risk_audit_tickets SET lockdown_state='recovered', recovered_at=datetime('now'), resolution_notes=?
        WHERE coach_id=? AND lockdown_state='account_locked'`,
    ).run(`${String(notes).trim()}｜帳號復原完成`, coachId);
    try {
      disbursementId = risk.ensurePendingDisbursement(db, coachId, month);
    } catch (e) {}
    try {
      audit({
        actionType: "security.coach_account_recovered",
        entityType: "coach",
        entityId: coachId,
        userId: adminId,
        newValues: { id_verified: true, notes: String(notes).trim(), disbursement_id: disbursementId, payout_month: month },
        description: "教練帳號復原並解凍出糧",
        ipAddress: ip,
      });
    } catch (e) {}
  })();
  try {
    dbNotification(coachId, "security", "✅ 帳戶已復原", "您的帳戶已完成核實並恢復正常，出糧將按本月批次發放。", { recovered: true });
  } catch (e) {}
  return { ok: true, disbursement_id: disbursementId, payout_month: month };
}

module.exports = {
  ensureSchema,
  pinStatus,
  setAdminPin,
  verifyAdminPin,
  addBlacklist,
  isBlacklisted,
  listBlacklist,
  removeBlacklist,
  lockdown,
  issueReset,
  reactivate,
};
