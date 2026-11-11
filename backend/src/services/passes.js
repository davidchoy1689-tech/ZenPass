/**
 * ZenPass — 4 堂常規通行證（Multi-Pass）
 * 預付 4 堂（預設 HK$480）→ 每次預約扣 1 堂，免 FPS 逐次對數。
 *
 * 鐵律：
 *  - 只可以 UPDATE，唔可以 DELETE pass／redemption（審計鏈）
 *  - 扣堂必須同 booking 喺同一個 SQLite transaction，任何一步失敗即回滾
 *  - 扣堂用條件式 UPDATE（remaining_credits > 0 AND status='active' AND 未過期），天然防超扣
 */
const crypto = require("crypto");

const DEFAULT_TOTAL = 4;
const DEFAULT_PRICE = 480;
const DEFAULT_VALID_DAYS = 60;

const PASS_PLANS = {
  pack_4: { id: "pack_4", name: "4 堂全家健康通行 Pass", units: 4, price_cents: 52000, valid_days: 60 },
  pack_8: { id: "pack_8", name: "8 堂全家健康通行 Pass", units: 8, price_cents: 96000, valid_days: 90 },
};
const PLAN_ALIASES = {
  pack_4_pain_relief: "pack_4",
  pack_8_pain_relief: "pack_8",
};

function resolvePlan(id) {
  const key = String(id || "");
  return PASS_PLANS[key] || PASS_PLANS[PLAN_ALIASES[key]] || null;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_passes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_phone TEXT NOT NULL,
      student_name TEXT NOT NULL,
      total_credits INTEGER NOT NULL DEFAULT 4,
      remaining_credits INTEGER NOT NULL DEFAULT 4,
      price_paid REAL NOT NULL DEFAULT 480,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pass_redemptions (
      id TEXT PRIMARY KEY,
      pass_id TEXT NOT NULL,
      booking_id TEXT,
      user_id TEXT,
      credits INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'used',
      created_at TEXT DEFAULT (datetime('now')),
      refunded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pass_purchase_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      family_group_id TEXT,
      amount_cents INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT 'fps',
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      confirmed_by TEXT,
      confirmed_at TEXT,
      payment_ref TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_passes_phone ON user_passes(user_phone, status);
    CREATE INDEX IF NOT EXISTS idx_user_passes_user ON user_passes(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_pass_redemptions_pass ON pass_redemptions(pass_id, status);
    CREATE INDEX IF NOT EXISTS idx_pass_redemptions_booking ON pass_redemptions(booking_id);
    CREATE INDEX IF NOT EXISTS idx_pass_orders_status ON pass_purchase_orders(status, created_at);
  `);
  const pcols = db.prepare("PRAGMA table_info(user_passes)").all().map((c) => c.name);
  if (!pcols.includes("owner_user_id")) db.exec("ALTER TABLE user_passes ADD COLUMN owner_user_id TEXT");
  if (!pcols.includes("family_group_id")) db.exec("ALTER TABLE user_passes ADD COLUMN family_group_id TEXT");
  if (!pcols.includes("payment_intent_id")) db.exec("ALTER TABLE user_passes ADD COLUMN payment_intent_id TEXT");
  if (!pcols.includes("pass_type")) db.exec("ALTER TABLE user_passes ADD COLUMN pass_type TEXT");
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_passes_pi ON user_passes(payment_intent_id) WHERE payment_intent_id IS NOT NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_user_passes_family ON user_passes(family_group_id)");
  } catch (e) {}
  // bookings.pass_id（舊 DB 自動補欄）
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    if (!cols.includes("pass_id")) db.exec("ALTER TABLE bookings ADD COLUMN pass_id TEXT");
    if (!cols.includes("updated_at")) db.exec("ALTER TABLE bookings ADD COLUMN updated_at TEXT");
  } catch (e) {
    console.error("[PASS] bookings.pass_id migration 失敗:", e.message);
  }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_bookings_pass ON bookings(pass_id)");
  } catch (e) {}
  ensurePaymentTypeCheck(db);
}

/**
 * SQLite 改唔到 CHECK → 用「建新表→抄資料→改名」方式放寬 payment_type
 * 保留所有欄位／index／trigger；只喺舊 schema 未包含 'pass' 時執行一次。
 */
function ensurePaymentTypeCheck(db) {
  try {
    const bk = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'")
      .get();
    if (!bk || !bk.sql || /['"]pass['"]/.test(bk.sql)) return;
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const idxSqls = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='bookings' AND sql IS NOT NULL")
      .all().map((r) => r.sql);
    const trgSqls = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='bookings'")
      .all().map((r) => r.sql);
    const newSql = bk.sql
      .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?bookings"?/i, "CREATE TABLE bookings_new")
      .replace(
        /payment_type\s+IN\s*\([^)]*\)/i,
        "payment_type IN ('single','credits','membership_trial','membership_standard','membership_unlimited','corporate','free','pass')",
      );
    if (!/['"]pass['"]/.test(newSql)) throw new Error("payment_type CHECK 未匹配");
    db.pragma("foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(newSql);
      db.prepare(`INSERT INTO bookings_new (${colList}) SELECT ${colList} FROM bookings`).run();
      db.exec("DROP TABLE bookings");
      db.exec("ALTER TABLE bookings_new RENAME TO bookings");
      for (const s of idxSqls) db.exec(s);
      for (const s of trgSqls) db.exec(s);
      db.exec("COMMIT");
      console.log("✅ Migration: bookings.payment_type 加入 corporate/free/pass");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  } catch (e) {
    console.error("[PASS] payment_type CHECK migration 失敗:", e.message);
  }
}

function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "").replace(/^852(?=\d{8}$)/, "");
}

function newPassId() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let x = "";
  for (let i = 0; i < 4; i++) x += abc[crypto.randomInt(abc.length)];
  const d = new Date();
  const ym = String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, "0");
  return `PASS-${ym}-${x}`;
}

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    student_name: row.student_name,
    phone_masked: row.user_phone ? row.user_phone.slice(0, 4) + "****" : "",
    total_credits: Number(row.total_credits) || 0,
    remaining_credits: Number(row.remaining_credits) || 0,
    used_credits: Math.max(0, (Number(row.total_credits) || 0) - (Number(row.remaining_credits) || 0)),
    price_paid: Number(row.price_paid) || 0,
    status: row.status,
    expires_at: row.expires_at,
    family_group_id: row.family_group_id || null,
    owner_user_id: row.owner_user_id || null,
    expired: !!row.expired,
    days_left: row.days_left == null ? null : Number(row.days_left),
  };
}

/** 目前用戶嘅有效通行證（user_id 優先；舊卡只有電話都對得上） */
function listActiveForUser(db, user) {
  if (!user || !user.id) return [];
  const phone = normalizePhone(user.phone);
  const rows = db
    .prepare(
      `SELECT *, CAST(julianday(expires_at) - julianday('now') AS INTEGER) AS days_left,
              (datetime(expires_at) <= datetime('now')) AS expired
         FROM user_passes
        WHERE status = 'active' AND remaining_credits > 0
          AND datetime(expires_at) > datetime('now')
          AND (user_id = ? OR (user_id IS NULL AND ? <> '' AND user_phone = ?))
        ORDER BY datetime(expires_at) ASC`,
    )
    .all(user.id, phone, phone);
  return rows.map((r) => {
    const out = shape(r);
    out.used_slots = db
      .prepare(
        `SELECT b.id AS booking_id, b.class_id, cs.start_time, c.venue_name, c.title
           FROM pass_redemptions pr
           JOIN bookings b ON b.id = pr.booking_id
           LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
           LEFT JOIN classes c ON c.id = b.class_id
          WHERE pr.pass_id = ? AND pr.status = 'used'
          ORDER BY datetime(cs.start_time) ASC
          LIMIT 8`,
      )
      .all(r.id);
    return out;
  });
}

/** 只限本人／本人電話，避免用 pass_id 掃別人卡 */
function findUsable(db, passId, user) {
  const row = db.prepare("SELECT * FROM user_passes WHERE id = ?").get(passId);
  if (!row) return { ok: false, code: "PASS_NOT_FOUND", error: "找唔到呢張通行證" };
  const phone = normalizePhone(user && user.phone);
  const mine =
    (row.user_id && user && row.user_id === user.id) ||
    (!row.user_id && phone && row.user_phone === phone);
  if (!mine) return { ok: false, code: "PASS_FORBIDDEN", error: "呢張通行證唔屬於此帳戶" };
  if (row.status !== "active") {
    return { ok: false, code: "PASS_INACTIVE", error: row.status === "exhausted" ? "通行證堂數已用完" : "通行證已失效" };
  }
  if (Number(row.remaining_credits) <= 0) {
    return { ok: false, code: "PASS_EXHAUSTED", error: "通行證堂數已用完" };
  }
  if (new Date(String(row.expires_at).replace(" ", "T") + (String(row.expires_at).includes("Z") ? "" : "Z")) <= new Date()) {
    return { ok: false, code: "PASS_EXPIRED", error: "通行證已過期" };
  }
  return { ok: true, pass: row };
}

/**
 * 扣 1 堂（必須喺 booking transaction 內呼叫）
 * 失敗 throw，讓外層 transaction 全部回滾。
 */
function redeemInTx(db, { passId, userId, bookingId }) {
  return redeemUnitsInTx(db, { passId, userId, bookingId, units: 1 });
}

function redeemUnitsInTx(db, { passId, userId, bookingId, units }) {
  const n = Math.max(1, Math.floor(Number(units) || 1));
  const r = db
    .prepare(
      `UPDATE user_passes
          SET remaining_credits = remaining_credits - ?,
              status = CASE WHEN remaining_credits - ? <= 0 THEN 'exhausted' ELSE status END,
              updated_at = datetime('now')
        WHERE id = ? AND status = 'active' AND remaining_credits >= ?
          AND datetime(expires_at) > datetime('now')`,
    )
    .run(n, n, passId, n);
  if (r.changes !== 1) {
    const err = new Error("通行證堂數不足或已過期");
    err.code = "PASS_UNAVAILABLE";
    throw err;
  }
  db.prepare(
    `INSERT INTO pass_redemptions (id, pass_id, booking_id, user_id, credits, status)
     VALUES (?, ?, ?, ?, ?, 'used')`,
  ).run("PRD-" + crypto.randomUUID(), passId, bookingId, userId || null, n);
}

/** 取消預約回滾 1 堂（同一個 transaction 內呼叫；每張 booking 只回一次） */
function restoreInTx(db, { passId, bookingId }) {
  const red = db
    .prepare(
      "SELECT id, credits FROM pass_redemptions WHERE pass_id = ? AND booking_id = ? AND status = 'used' LIMIT 1",
    )
    .get(passId, bookingId);
  if (!red) return false;
  db.prepare(
    "UPDATE pass_redemptions SET status = 'refunded', refunded_at = datetime('now') WHERE id = ?",
  ).run(red.id);
  db.prepare(
    `UPDATE user_passes
        SET remaining_credits = MIN(total_credits, remaining_credits + ?),
            status = CASE WHEN status = 'exhausted' AND datetime(expires_at) > datetime('now') THEN 'active' ELSE status END,
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(Number(red.credits) || 1, passId);
  return true;
}

function issuePass(db, opts) {
  try {
    require("./family-wallet").ensureSchema(db);
  } catch (e) {}
  const phone = normalizePhone(opts.phone);
  if (!/^[4-9]\d{7}$/.test(phone)) {
    return { ok: false, error: "請提供有效香港 8 位電話" };
  }
  const name = String(opts.studentName || "").trim();
  if (name.length < 2) return { ok: false, error: "請提供學員姓名" };
  const total = Math.max(1, Math.min(20, Number(opts.totalCredits) || DEFAULT_TOTAL));
  const price = Number(opts.pricePaid);
  const paid = Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : DEFAULT_PRICE;
  const days = Math.max(1, Math.min(365, Number(opts.validDays) || DEFAULT_VALID_DAYS));

  let userId = opts.userId || null;
  if (!userId) {
    const u = db.prepare("SELECT id FROM users WHERE phone = ? OR phone = ? LIMIT 1").get(phone, "852" + phone);
    userId = u ? u.id : null;
  }

  let id = newPassId();
  for (let i = 0; i < 5 && db.prepare("SELECT 1 FROM user_passes WHERE id = ?").get(id); i++) id = newPassId();

  const expiresAt = new Date(Date.now() + days * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const ownerUserId = opts.familyGroupId ? opts.ownerUserId || userId : null;
  const familyGroupId = opts.familyGroupId || null;
  db.prepare(
    `INSERT INTO user_passes (id, user_id, user_phone, student_name, total_credits, remaining_credits,
                              price_paid, status, expires_at, notes, created_by, owner_user_id, family_group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    phone,
    name,
    total,
    total,
    paid,
    expiresAt,
    opts.notes || null,
    opts.createdBy || null,
    ownerUserId,
    familyGroupId,
  );

  return { ok: true, pass: shape(db.prepare("SELECT * FROM user_passes WHERE id = ?").get(id)) };
}

/** Stripe 付款成功後發卡（idempotent；只可由已驗證 session / webhook 呼叫） */
function fulfillPassPurchase(db, opts) {
  const plan = resolvePlan(opts.planId);
  if (!plan) return { ok: false, error: "PASS_PLAN_INVALID" };
  const userId = String(opts.userId || "");
  if (!userId) return { ok: false, error: "USER_REQUIRED" };
  const pi = String(opts.paymentIntentId || opts.sessionId || "");
  if (!pi) return { ok: false, error: "PAYMENT_REF_REQUIRED" };

  const existing = db.prepare("SELECT * FROM user_passes WHERE payment_intent_id = ?").get(pi);
  if (existing) return { ok: true, pass: shape(existing), duplicated: true };

  const user = db.prepare("SELECT id, name, phone FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };
  const phone = normalizePhone(user.phone);
  if (!/^[4-9]\d{7}$/.test(phone)) return { ok: false, error: "USER_PHONE_INVALID" };

  let familyGroupId = opts.familyGroupId || null;
  if (familyGroupId) {
    const g = db.prepare("SELECT * FROM family_groups WHERE id = ?").get(familyGroupId);
    if (!g) return { ok: false, error: "FAMILY_GROUP_NOT_FOUND" };
    if (g.owner_user_id !== userId) return { ok: false, error: "FAMILY_OWNER_MISMATCH" };
  } else {
    familyGroupId = null;
  }

  const id = "pass_" + crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + plan.valid_days * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  db.prepare(
    `INSERT INTO user_passes (id, user_id, user_phone, student_name, total_credits, remaining_credits,
                              price_paid, status, expires_at, notes, created_by, owner_user_id, family_group_id,
                              payment_intent_id, pass_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    phone,
    user.name || "學員",
    plan.units,
    plan.units,
    plan.price_cents / 100,
    expiresAt,
    `online:${plan.id}`,
    userId,
    userId,
    familyGroupId,
    pi,
    plan.id,
  );
  return { ok: true, pass: shape(db.prepare("SELECT * FROM user_passes WHERE id = ?").get(id)), duplicated: false };
}

module.exports = {
  ensureSchema,
  ensurePaymentTypeCheck,
  normalizePhone,
  listActiveForUser,
  findUsable,
  redeemInTx,
  redeemUnitsInTx,
  restoreInTx,
  issuePass,
  fulfillPassPurchase,
  PASS_PLANS,
  PLAN_ALIASES,
  resolvePlan,
  shape,
  DEFAULT_TOTAL,
  DEFAULT_PRICE,
  DEFAULT_VALID_DAYS,
};
