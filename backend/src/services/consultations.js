/**
 * ZenPass — 一對一健康諮詢／身體評估（會籍權益）
 *
 * 配額（David 2026-10-18 定）：
 *   - 高階 Pass（silver）：每月 1 次（會員本人）
 *   - VIP Pass（gold）：每月 1 次（會員本人）＋ 1 次免費邀請朋友
 *   - 其他計劃：不適用
 *
 * 流程：會員提交申請（pending）→ admin 安排時間（scheduled）→ 完成（completed）
 * 每月配額以 period（YYYY-MM，香港時間）計算，取消唔計配額。
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const { writeBlock } = require("./blockchain-audit");

const PLAN_QUOTA = {
  silver: { member: 1, vip_guest: 0 },
  gold: { member: 1, vip_guest: 1 },
};
const KIND_LABEL = { member: "會員健康諮詢／身體評估", vip_guest: "VIP 邀請朋友（健康諮詢／身體評估）" };

function hkPeriod(date = new Date()) {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 7);
}

/** 取得生效中嘅會籍計劃（silver/gold 才有諮詢配額） */
function getActivePlan(db, userId) {
  const u = db
    .prepare("SELECT membership_type, membership_expires_at FROM users WHERE id = ?")
    .get(userId);
  if (u && PLAN_QUOTA[u.membership_type]) {
    const exp = u.membership_expires_at ? new Date(u.membership_expires_at) : null;
    if (!exp || isNaN(exp) || exp >= new Date()) return u.membership_type;
  }
  const m = db
    .prepare(
      `SELECT type FROM memberships
       WHERE user_id = ? AND status = 'active' AND date(end_date) >= date('now')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId);
  return m && PLAN_QUOTA[m.type] ? m.type : null;
}

/** 本月已用配額（cancelled 唔計） */
function getUsedQuota(db, userId, period = hkPeriod()) {
  const rows = db
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM consultations
       WHERE user_id = ? AND period = ? AND status != 'cancelled'
       GROUP BY kind`,
    )
    .all(userId, period);
  const out = { member: 0, vip_guest: 0 };
  for (const r of rows) out[r.kind] = r.n;
  return out;
}

function getQuotaSummary(userId) {
  const db = getDb();
  const period = hkPeriod();
  const plan = getActivePlan(db, userId);
  const quota = plan ? PLAN_QUOTA[plan] : { member: 0, vip_guest: 0 };
  const used = getUsedQuota(db, userId, period);
  return {
    period,
    plan,
    quota,
    used,
    remaining: {
      member: Math.max(0, quota.member - used.member),
      vip_guest: Math.max(0, quota.vip_guest - used.vip_guest),
    },
  };
}

function listMine(userId) {
  const db = getDb();
  const records = db
    .prepare(
      `SELECT id, kind, period, guest_name, guest_phone, preferred_time, notes, status,
              scheduled_at, admin_note, created_at
       FROM consultations WHERE user_id = ? ORDER BY created_at DESC LIMIT 24`,
    )
    .all(userId);
  return { ...getQuotaSummary(userId), kind_labels: KIND_LABEL, records };
}

function requestConsultation(userId, body = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const plan = getActivePlan(db, userId);
  if (!plan) {
    const err = new Error("此服務只限高階 Pass／VIP Pass 會員");
    err.status = 403;
    throw err;
  }

  const kind = body.kind === "vip_guest" ? "vip_guest" : "member";
  const quota = PLAN_QUOTA[plan];
  if (!quota[kind]) {
    const err = new Error(
      kind === "vip_guest" ? "VIP 邀請朋友名額只限 VIP Pass" : "你嘅會籍未包括此服務",
    );
    err.status = 403;
    throw err;
  }

  const period = hkPeriod();
  const used = getUsedQuota(db, userId, period);
  if (used[kind] >= quota[kind]) {
    const err = new Error("本月名額已用完");
    err.status = 409;
    throw err;
  }

  const guestName = (body.guest_name || "").trim();
  const guestPhone = (body.guest_phone || "").trim();
  if (kind === "vip_guest" && !guestName) {
    const err = new Error("請填寫朋友姓名");
    err.status = 400;
    throw err;
  }

  const preferred = (body.preferred_time || "").trim() || null;
  const notes = (body.notes || "").trim() || null;

  const id = uuidv4();
  db.prepare(
    `INSERT INTO consultations (id, user_id, kind, period, guest_name, guest_phone, preferred_time, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(
    id,
    userId,
    kind,
    period,
    kind === "vip_guest" ? guestName : null,
    kind === "vip_guest" ? guestPhone || null : null,
    preferred,
    notes,
  );

  try {
    writeBlock({
      entityType: "consultation",
      entityId: id,
      data: { user_id: userId, kind, period, guest_name: guestName || null, preferred_time: preferred },
    });
  } catch (e) {
    console.error("⚠️ Blockchain write failed (consultation):", e.message);
  }

  return {
    id,
    kind,
    kind_label: KIND_LABEL[kind],
    period,
    status: "pending",
    ...getQuotaSummary(userId),
  };
}

function listForAdmin(status = "pending") {
  const db = getDb();
  const where = status && status !== "all" ? "WHERE c.status = ?" : "";
  const args = where ? [status] : [];
  return db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
       FROM consultations c JOIN users u ON c.user_id = u.id
       ${where} ORDER BY c.created_at ASC LIMIT 200`,
    )
    .all(...args);
}

function updateByAdmin(id, { status, scheduled_at, admin_note, adminId } = {}) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM consultations WHERE id = ?").get(id);
  if (!row) {
    const err = new Error("申請不存在");
    err.status = 404;
    throw err;
  }
  const allowed = ["pending", "scheduled", "completed", "cancelled"];
  if (status && !allowed.includes(status)) {
    const err = new Error("無效狀態");
    err.status = 400;
    throw err;
  }

  db.prepare(
    `UPDATE consultations
     SET status = COALESCE(?, status),
         scheduled_at = COALESCE(?, scheduled_at),
         admin_note = COALESCE(?, admin_note),
         admin_id = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(status || null, scheduled_at || null, admin_note || null, adminId || null, id);

  try {
    writeBlock({
      entityType: "consultation",
      entityId: id,
      data: { status: status || row.status, scheduled_at: scheduled_at || row.scheduled_at, admin_id: adminId || null },
    });
  } catch (e) {}

  return db.prepare("SELECT * FROM consultations WHERE id = ?").get(id);
}

module.exports = {
  PLAN_QUOTA,
  KIND_LABEL,
  hkPeriod,
  getActivePlan,
  getQuotaSummary,
  listMine,
  requestConsultation,
  listForAdmin,
  updateByAdmin,
};
