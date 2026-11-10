/**
 * referral-rewards.js — 推薦裂變「首堂出席後自動派堂」（工單十三）
 *
 * 商業防線：
 *  - 自己推薦自己（同電話）→ 400
 *  - 同一裝置曾屬推薦人 → 400（device fingerprint）
 *  - 一個學員只可以被推薦一次
 *  - 推薦人每月最多 4 次獎賞（REFERRAL_MONTHLY_CAP）
 *  - 只有被推薦人「生涯首次出席（present/late）」才觸發，雙方各 +1 堂
 *  - 所有派堂寫 audit_log，pass 紀錄保留（唔可以 DELETE）
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const passes = require("./passes");
const { audit } = require("./audit");

const MONTHLY_CAP = Math.max(1, Number(process.env.REFERRAL_MONTHLY_CAP) || 4);
const REWARD_CREDITS = 1;
const REWARD_VALID_DAYS = 60;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL,
      referee_user_id TEXT NOT NULL,
      referee_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_attendance'
        CHECK(status IN ('pending_attendance','rewarded','rejected')),
      qualifying_booking_id TEXT,
      rewarded_at DATETIME,
      reject_reason TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_pair ON referral_rewards(referrer_user_id, referee_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_referee ON referral_rewards(referee_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_rewards(referrer_user_id, status, rewarded_at);

    CREATE TABLE IF NOT EXISTS referral_devices (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_referral_devices_device ON referral_devices(device_id);
  `);
}

function normalizePhone(v) {
  let p = String(v || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

function touchDevice(db, userId, deviceId) {
  const d = String(deviceId || "").trim().slice(0, 120);
  if (!d || !userId) return;
  db.prepare("INSERT OR IGNORE INTO referral_devices (user_id, device_id) VALUES (?, ?)").run(userId, d);
}

function monthlyRewarded(db, referrerId) {
  return db
    .prepare(
      "SELECT COUNT(*) c FROM referral_rewards WHERE referrer_user_id = ? AND status = 'rewarded' AND rewarded_at >= datetime('now','start of month')",
    )
    .get(referrerId).c;
}

/**
 * 綁定推薦碼（被推薦人）
 * @returns {{status:number, body:object}}
 */
function claimCode(userId, code, { deviceId = "", ip = "" } = {}) {
  const db = getDb();
  ensureSchema(db);
  db.pragma("foreign_keys = ON");

  const c = String(code || "").trim().toUpperCase();
  if (!c) return { status: 400, body: { success: false, error: "請輸入推薦碼" } };

  const me = db.prepare("SELECT id, name, phone FROM users WHERE id = ?").get(userId);
  if (!me) return { status: 404, body: { success: false, error: "找不到帳戶" } };
  const myPhone = normalizePhone(me.phone);
  if (!myPhone) {
    return { status: 400, body: { success: false, error: "請先綁定電話號碼，先可以使用推薦碼" } };
  }

  const ref = db.prepare("SELECT * FROM referral_codes WHERE code = ?").get(c);
  if (!ref) return { status: 404, body: { success: false, error: "推薦碼無效" } };
  if (ref.user_id === userId) {
    return { status: 400, body: { success: false, code: "SELF_REFERRAL", error: "唔可以用自己嘅推薦碼" } };
  }

  const referrer = db.prepare("SELECT id, name, phone FROM users WHERE id = ?").get(ref.user_id);
  if (!referrer) return { status: 404, body: { success: false, error: "推薦人不存在" } };
  if (myPhone === normalizePhone(referrer.phone)) {
    return {
      status: 400,
      body: { success: false, code: "SELF_REFERRAL", error: "自己推薦自己（同一電話）唔可以獲得獎賞" },
    };
  }

  const already = db
    .prepare("SELECT id, status FROM referral_rewards WHERE referee_user_id = ? ORDER BY created_at LIMIT 1")
    .get(userId);
  if (already) {
    return {
      status: 409,
      body: { success: false, code: "ALREADY_REFERRED", status: already.status, error: "你已經被推薦過，唔可以再綁定" },
    };
  }

  const oldProgram = db.prepare("SELECT id FROM referral_redemptions WHERE referred_user_id = ?").get(userId);
  if (oldProgram) {
    return { status: 409, body: { success: false, error: "你已經用過推薦計劃" } };
  }

  // 同一裝置曾經屬推薦人 → 判定為一人分飾兩角
  const d = String(deviceId || "").trim().slice(0, 120);
  if (d) {
    const shared = db
      .prepare("SELECT 1 FROM referral_devices WHERE user_id = ? AND device_id = ?")
      .get(referrer.id, d);
    if (shared) {
      return {
        status: 400,
        body: { success: false, code: "SAME_DEVICE", error: "同一部裝置唔可以互相推薦" },
      };
    }
    const usedByOther = db
      .prepare(
        "SELECT 1 FROM referral_rewards WHERE referrer_user_id = ? AND device_id = ? AND status <> 'rejected'",
      )
      .get(referrer.id, d);
    if (usedByOther) {
      return {
        status: 400,
        body: { success: false, code: "SAME_DEVICE", error: "此裝置已用過該推薦碼" },
      };
    }
  }

  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO referral_rewards (id, referrer_user_id, referee_user_id, referee_phone, status, device_id) VALUES (?,?,?,?, 'pending_attendance', ?)",
    ).run(id, referrer.id, userId, myPhone, d || null);
    touchDevice(db, referrer.id, d);
    touchDevice(db, userId, d);
  })();

  try {
    audit({
      actionType: "referral.claimed",
      entityType: "referral_reward",
      entityId: id,
      userId,
      newValues: { referrer_user_id: referrer.id, referee_phone: myPhone, device: d || null },
      description: "被推薦人綁定推薦碼（待首堂出席）",
      ipAddress: ip,
    });
  } catch (e) {}

  return {
    status: 200,
    body: {
      success: true,
      referral_id: id,
      status: "pending_attendance",
      referrer_name: referrer.name,
      message: "已綁定推薦碼！完成第一堂出席後，你同推薦人各得 1 堂。",
    },
  };
}

/**
 * 出席 Hook — 必須喺點名 transaction 內呼叫
 * @param {object} db better-sqlite3 instance
 * @param {{userId:string, bookingId:string}} p
 * @returns {null|{rewarded:boolean, reason?:string, referrer_pass?:string, referee_pass?:string}}
 */
function onAttendance(db, { userId, bookingId }) {
  try {
    if (!userId || !bookingId) return null;
    ensureSchema(db);

    const row = db
      .prepare("SELECT * FROM referral_rewards WHERE referee_user_id = ? AND status = 'pending_attendance' LIMIT 1")
      .get(userId);
    if (!row) return null;

    // 生涯首次出席：唔可以有其他已出席紀錄（以點名冊為準，涵蓋 walk-in）
    let other = 0;
    try {
      other = db
        .prepare(
          `SELECT COUNT(*) c FROM attendances a JOIN bookings b ON b.id = a.booking_id
            WHERE b.user_id = ? AND a.status IN ('present','late') AND a.booking_id <> ?`,
        )
        .get(userId, bookingId).c;
    } catch (e) {
      other = db
        .prepare("SELECT COUNT(*) c FROM bookings WHERE user_id = ? AND status = 'attended' AND id <> ?")
        .get(userId, bookingId).c;
    }
    if (other > 0) return null;

    const referrer = db.prepare("SELECT id, name, phone FROM users WHERE id = ?").get(row.referrer_user_id);
    if (!referrer) {
      db.prepare(
        "UPDATE referral_rewards SET status='rejected', reject_reason='REFERRER_MISSING' WHERE id = ?",
      ).run(row.id);
      return { rewarded: false, reason: "REFERRER_MISSING" };
    }

    if (monthlyRewarded(db, referrer.id) >= MONTHLY_CAP) {
      db.prepare(
        "UPDATE referral_rewards SET status='rejected', reject_reason='MONTHLY_CAP' WHERE id = ?",
      ).run(row.id);
      return { rewarded: false, reason: "MONTHLY_CAP" };
    }

    const referee = db.prepare("SELECT id, name, phone FROM users WHERE id = ?").get(userId);
    const refundeeName = (referee && referee.name) || "學員";
    const refPhone = normalizePhone(rawPhoneOf(referee, row.referee_phone));

    const rPass = passes.issuePass(db, {
      userId: referrer.id,
      phone: referrer.phone,
      studentName: referrer.name || "推薦人",
      totalCredits: REWARD_CREDITS,
      pricePaid: 0,
      validDays: REWARD_VALID_DAYS,
      notes: `🎁 推薦獎賞：${refundeeName} 首次出席`,
      createdBy: "system:referral",
    });
    const ePass = passes.issuePass(db, {
      userId: userId,
      phone: refPhone,
      studentName: refundeeName,
      totalCredits: REWARD_CREDITS,
      pricePaid: 0,
      validDays: REWARD_VALID_DAYS,
      notes: "🎁 首堂出席獎賞（推薦計劃）",
      createdBy: "system:referral",
    });
    if (!rPass.ok || !ePass.ok) {
      throw new Error(`發放通行證失敗: ${(rPass.error || ePass.error) || "UNKNOWN"}`);
    }

    db.prepare(
      "UPDATE referral_rewards SET status='rewarded', qualifying_booking_id=?, rewarded_at=datetime('now') WHERE id = ? AND status='pending_attendance'",
    ).run(bookingId, row.id);

    try {
      audit({
        actionType: "referral.reward_issued",
        entityType: "referral_reward",
        entityId: row.id,
        userId: null,
        newValues: {
          referrer_user_id: referrer.id,
          referee_user_id: userId,
          booking_id: bookingId,
          referrer_pass_id: rPass.pass.id,
          referee_pass_id: ePass.pass.id,
        },
        description: "親友首次出席，雙方各獲 1 堂",
      });
    } catch (e) {}

    return { rewarded: true, referrer_pass: rPass.pass.id, referee_pass: ePass.pass.id };
  } catch (e) {
    console.error("[REFERRAL] onAttendance:", e.message);
    return { rewarded: false, reason: "ERROR", error: e.message };
  }
}

function rawPhoneOf(referee, fallback) {
  return (referee && referee.phone) || fallback || "";
}

/** 學員端：我的推薦摘要（碼、待處理、已獎賞、堂數） */
function summaryForUser(userId) {
  const db = getDb();
  ensureSchema(db);
  let code = db.prepare("SELECT code FROM referral_codes WHERE user_id = ?").get(userId);
  if (!code) {
    const newCode =
      "ZP" + crypto.randomBytes(2).toString("hex").toUpperCase() + String(userId).slice(-4).toUpperCase();
    db.prepare("INSERT OR IGNORE INTO referral_codes (id, user_id, code) VALUES (?, ?, ?)").run(
      crypto.randomUUID(),
      userId,
      newCode,
    );
    code = db.prepare("SELECT code FROM referral_codes WHERE user_id = ?").get(userId);
  }

  const invited = db
    .prepare("SELECT COUNT(*) c FROM referral_rewards WHERE referrer_user_id = ?")
    .get(userId).c;
  const rewarded = db
    .prepare("SELECT COUNT(*) c FROM referral_rewards WHERE referrer_user_id = ? AND status = 'rewarded'")
    .get(userId).c;
  const pending = db
    .prepare(
      "SELECT COUNT(*) c FROM referral_rewards WHERE referrer_user_id = ? AND status = 'pending_attendance'",
    )
    .get(userId).c;

  const recent = db
    .prepare(
      `SELECT r.status, r.referee_phone, r.rewarded_at, r.created_at, u.name AS referee_name
         FROM referral_rewards r LEFT JOIN users u ON u.id = r.referee_user_id
        WHERE r.referrer_user_id = ? ORDER BY datetime(r.created_at) DESC LIMIT 5`,
    )
    .all(userId);

  const user = db.prepare("SELECT phone FROM users WHERE id = ?").get(userId);
  const myRef = db
    .prepare(
      `SELECT r.status, r.rewarded_at, u.name AS referrer_name
         FROM referral_rewards r LEFT JOIN users u ON u.id = r.referrer_user_id
        WHERE r.referee_user_id = ? ORDER BY datetime(r.created_at) DESC LIMIT 1`,
    )
    .get(userId);

  let passTotal = 0;
  try {
    const list = passes.listActiveForUser(db, { id: userId, phone: user && user.phone });
    passTotal = list.reduce((s, p) => s + (Number(p.remaining_credits) || 0), 0);
  } catch (e) {}

  return {
    code: code ? code.code : null,
    referral_link_token: code ? code.code : null,
    stats: { invited, rewarded, pending, monthly_cap: MONTHLY_CAP },
    recent: recent.map((r) => ({
      status: r.status,
      name: maskName(r.referee_name),
      phone_masked: r.referee_phone ? r.referee_phone.slice(0, 4) + "****" : "",
      rewarded_at: r.rewarded_at,
      created_at: r.created_at,
    })),
    my_referral: myRef
      ? {
          status: myRef.status,
          referrer_name: myRef.referrer_name || "朋友",
          rewarded_at: myRef.rewarded_at,
        }
      : null,
    pass_balance: passTotal,
  };
}

function maskName(n) {
  const s = String(n || "").trim();
  if (!s) return "親友";
  if (s.length <= 1) return s + "*";
  return s[0] + "*".repeat(Math.max(1, s.length - 1));
}

module.exports = {
  ensureSchema,
  normalizePhone,
  touchDevice,
  claimCode,
  onAttendance,
  summaryForUser,
  MONTHLY_CAP,
  REWARD_CREDITS,
};
