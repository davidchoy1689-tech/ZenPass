/**
 * coach-affiliate.js — 工單十六
 *  • 私域自有學生：平台 0% 抽成（教練實收 100%）
 *  • 跨界報讀其他教練課程：原教練終身 5% 被動回佣（由平台 20% 份額提撥）
 *
 * 設計：
 *  - 現有 coach_earnings 仍按班次計 80% 底薪，唔改舊帳
 *  - 自有學生另記 coach_own_student_uplifts（補足 20% → 合共 100%）
 *  - 跨界回佣記 coach_affiliate_payouts（5%）
 *  - 兩者都以 booking_id 做 UNIQUE 冪等，重覆點名／重覆結算唔會重複出糧
 *  - 全部金額用整數 cents 計，避免浮點誤差
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const { audit } = require("./audit");

const AFFILIATE_RATE = 0.05;
const DEFAULT_BASE_RATE = 0.8;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_coach_affiliations (
      student_user_id TEXT PRIMARY KEY,
      origin_coach_id TEXT NOT NULL,
      bound_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      commission_rate REAL DEFAULT 0.05,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'))
    );
    CREATE INDEX IF NOT EXISTS idx_affiliations_coach ON student_coach_affiliations(origin_coach_id);

    CREATE TABLE IF NOT EXISTS coach_affiliate_payouts (
      id TEXT PRIMARY KEY,
      beneficiary_coach_id TEXT NOT NULL,
      actual_coach_id TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      order_amount_cents INTEGER NOT NULL,
      commission_amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cleared','paid')),
      cleared_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_unique ON coach_affiliate_payouts(beneficiary_coach_id, booking_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_beneficiary ON coach_affiliate_payouts(beneficiary_coach_id, status);

    CREATE TABLE IF NOT EXISTS coach_own_student_uplifts (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      booking_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      order_amount_cents INTEGER NOT NULL,
      uplift_cents INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_uplifts_coach ON coach_own_student_uplifts(coach_id, created_at);
  `);
}

function cents(v) {
  return Math.round(Number(v || 0) * 100);
}

function toMoney(c) {
  return Math.round(Number(c || 0)) / 100;
}

/** 綁定學員與原教練（第一位教練永遠保留；INSERT OR IGNORE） */
function bindStudent(db, studentUserId, coachId, rate = AFFILIATE_RATE) {
  if (!studentUserId || !coachId) return { bound: false, reason: "MISSING" };
  ensureSchema(db);
  const coach = db.prepare("SELECT id, role, is_coach FROM users WHERE id = ?").get(coachId);
  if (!coach) return { bound: false, reason: "COACH_NOT_FOUND" };
  const r = db
    .prepare(
      "INSERT OR IGNORE INTO student_coach_affiliations (student_user_id, origin_coach_id, commission_rate) VALUES (?,?,?)",
    )
    .run(studentUserId, coachId, Number(rate) || AFFILIATE_RATE);
  if (r.changes) {
    try {
      audit({
        actionType: "affiliation.bound",
        entityType: "user",
        entityId: studentUserId,
        userId: coachId,
        newValues: { origin_coach_id: coachId, commission_rate: Number(rate) || AFFILIATE_RATE },
        description: "學員綁定原教練（私域）",
      });
    } catch (e) {}
  }
  return { bound: r.changes === 1 };
}

function originCoachId(db, studentUserId) {
  try { ensureSchema(db); } catch (e) {}
  const row = db
    .prepare("SELECT origin_coach_id FROM student_coach_affiliations WHERE student_user_id = ? AND status='active'")
    .get(studentUserId);
  return row ? row.origin_coach_id : null;
}

/** 直接寫錢包（class_income），以 source_type+source_id 防重 */
function creditWallet(db, { userId, amountCents, sourceType, sourceId, description }) {
  if (!amountCents || amountCents <= 0) return null;
  const dup = db
    .prepare("SELECT id FROM wallet_transactions WHERE source_type = ? AND source_id = ? AND type='class_income'")
    .get(sourceType, sourceId);
  if (dup) return dup.id;

  const u = db.prepare("SELECT wallet_balance FROM users WHERE id = ?").get(userId);
  if (!u) return null;
  const before = cents(u.wallet_balance);
  const after = before + amountCents;
  const txId = crypto.randomUUID();
  db.prepare("UPDATE users SET wallet_balance = ?, pending_payout = ? WHERE id = ?").run(
    toMoney(after),
    toMoney(after),
    userId,
  );
  db.prepare(
    `INSERT INTO wallet_transactions
       (id, user_id, type, amount, balance_before, balance_after, source_type, source_id, coach_earning_id, description, status)
     VALUES (?, ?, 'class_income', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
  ).run(txId, userId, toMoney(amountCents), toMoney(before), toMoney(after), sourceType, sourceId, sourceId, description);
  return txId;
}

/**
 * 為一個班次結算所有「私域差額」與「跨界 5%」
 * 可重覆呼叫（冪等）。
 */
function settleSchedule(scheduleId) {
  const db = getDb();
  ensureSchema(db);
  const sched = db
    .prepare(
      `SELECT s.id AS session_id, s.class_id, COALESCE(s.coach_override_id, c.coach_id) AS actual_coach_id,
              COALESCE(pv.is_sandbox,0) AS is_sandbox, c.class_reference, c.title, s.studio_id
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id
        WHERE s.id = ?`,
    )
    .get(scheduleId);
  if (!sched) return { ok: false, error: "SESSION_NOT_FOUND" };
  if (Number(sched.is_sandbox) === 1) return { ok: true, skipped: "SANDBOX", uplifts: 0, affiliates: 0 };
  if (sched.studio_id) return { ok: true, skipped: "STUDIO_SCHEDULE", uplifts: 0, affiliates: 0 };
  if (String(sched.session_id || "").indexOf("prodtest-") === 0 || String(sched.class_reference || "").indexOf("VERIFIED_TEST") === 0) {
    return { ok: true, skipped: "SANDBOX", uplifts: 0, affiliates: 0 };
  }

  const bookings = db
    .prepare(
      `SELECT b.id, b.user_id, b.amount, b.payment_type, b.payment_status, b.status,
              c.price_hkd
         FROM bookings b
         JOIN classes c ON c.id = b.class_id
        WHERE b.schedule_id = ? AND b.payment_status = 'paid'
          AND b.status IN ('confirmed','attended')`,
    )
    .all(scheduleId);

  const baseRateRow = db.prepare("SELECT commission_rate FROM users WHERE id = ?").get(sched.actual_coach_id);
  const baseRate =
    baseRateRow && Number(baseRateRow.commission_rate) > 0 ? Number(baseRateRow.commission_rate) : DEFAULT_BASE_RATE;

  const result = { ok: true, uplifts: 0, affiliates: 0, uplift_cents: 0, affiliate_cents: 0 };

  const work = db.transaction(() => {
    for (const b of bookings) {
      const origin = originCoachId(db, b.user_id);
      if (!origin) continue;
      // Pass 扣堂：booking amount = 0，但課堂價值 = 課程價（用嚟計 100%／5% 分佣）
      const amountCents =
        Number(b.amount) > 0 ? cents(b.amount) : b.payment_type === "pass" ? cents(b.price_hkd) : 0;
      if (amountCents <= 0) continue;

      if (origin === sched.actual_coach_id) {
        // 私域：補足到 100%
        const upliftRate = Math.max(0, 1 - baseRate);
        const upliftCents = Math.round(amountCents * upliftRate);
        if (upliftCents <= 0) continue;
        const id = crypto.randomUUID();
        const ins = db
          .prepare(
            `INSERT OR IGNORE INTO coach_own_student_uplifts
               (id, coach_id, student_user_id, booking_id, session_id, order_amount_cents, uplift_cents)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .run(id, origin, b.user_id, b.id, scheduleId, amountCents, upliftCents);
        if (ins.changes) {
          creditWallet(db, {
            userId: origin,
            amountCents: upliftCents,
            sourceType: "own_student_uplift",
            sourceId: id,
            description: `👑 自有學生 100% 拆帳補足（${sched.title}）`,
          });
          try {
            audit({
              actionType: "own_student.uplift",
              entityType: "booking",
              entityId: b.id,
              userId: origin,
              newValues: { uplift_cents: upliftCents, order_amount_cents: amountCents, session_id: scheduleId },
              description: "私域學生報讀自己課堂：平台 0% 抽成",
            });
          } catch (e) {}
          result.uplifts += 1;
          result.uplift_cents += upliftCents;
        }
      } else {
        // 跨界：5% 由平台份額提撥
        const platformShare = Math.max(0, 1 - baseRate);
        const rate = Math.min(AFFILIATE_RATE, platformShare);
        const commission = Math.round(amountCents * rate);
        if (commission <= 0) continue;
        const id = crypto.randomUUID();
        const ins = db
          .prepare(
            `INSERT OR IGNORE INTO coach_affiliate_payouts
               (id, beneficiary_coach_id, actual_coach_id, student_user_id, booking_id, session_id, course_id,
                order_amount_cents, commission_amount_cents, status, cleared_at)
             VALUES (?,?,?,?,?,?,?,?,?, 'cleared', datetime('now'))`,
          )
          .run(id, origin, sched.actual_coach_id, b.user_id, b.id, scheduleId, sched.class_id, amountCents, commission);
        if (ins.changes) {
          creditWallet(db, {
            userId: origin,
            amountCents: commission,
            sourceType: "affiliate",
            sourceId: id,
            description: `💎 跨界被動分佣 5%（${sched.title}）`,
          });
          try {
            audit({
              actionType: "affiliate.commission_earned",
              entityType: "booking",
              entityId: b.id,
              userId: origin,
              newValues: {
                beneficiary_coach_id: origin,
                actual_coach_id: sched.actual_coach_id,
                order_amount_cents: amountCents,
                commission_amount_cents: commission,
              },
              description: "學員跨班消費，原教練獲 5% 被動回佣",
            });
          } catch (e) {}
          result.affiliates += 1;
          result.affiliate_cents += commission;
        }
      }
    }
  });
  work();
  return result;
}

/** 指定月份的被動收入摘要 */
function monthSummary(db, coachId, month) {
  ensureSchema(db);
  const m = /^\d{4}-\d{2}$/.test(String(month || "")) ? month : new Date().toISOString().slice(0, 7);
  const range = [`${m}-01`, `${m}-31T23:59:59`];
  const aff = db
    .prepare(
      `SELECT COALESCE(SUM(commission_amount_cents),0) cents, COUNT(DISTINCT student_user_id) students
         FROM coach_affiliate_payouts
        WHERE beneficiary_coach_id = ? AND substr(created_at,1,7) = ? AND status IN ('cleared','paid')`,
    )
    .get(coachId, m);
  const own = db
    .prepare(
      `SELECT COALESCE(SUM(uplift_cents),0) cents, COUNT(DISTINCT student_user_id) students
         FROM coach_own_student_uplifts
        WHERE coach_id = ? AND substr(created_at,1,7) = ?`,
    )
    .get(coachId, m);
  const recent = db
    .prepare(
      `SELECT p.id, p.student_user_id, p.booking_id, p.session_id, p.order_amount_cents,
              p.commission_amount_cents, p.created_at, p.status, p.cleared_at,
              u.name AS student_name, u.phone AS student_phone,
              c.title AS course_title, ac.name AS actual_coach_name
         FROM coach_affiliate_payouts p
         LEFT JOIN users u ON u.id = p.student_user_id
         LEFT JOIN classes c ON c.id = p.course_id
         LEFT JOIN users ac ON ac.id = p.actual_coach_id
        WHERE p.beneficiary_coach_id = ? AND substr(p.created_at,1,7) = ?
        ORDER BY datetime(p.created_at) DESC LIMIT 50`,
    )
    .all(coachId, m);
  return {
    affiliate_passive_cents: Number(aff.cents) || 0,
    affiliate_students_count: Number(aff.students) || 0,
    own_student_uplift_cents: Number(own.cents) || 0,
    own_student_count: Number(own.students) || 0,
    affiliate_recent: recent.map((r) => ({
      id: r.id,
      booking_id: r.booking_id,
      session_id: r.session_id,
      student_name: maskName(r.student_name),
      student_phone_masked: r.student_phone ? String(r.student_phone).slice(0, 4) + "****" : "",
      course_title: r.course_title || "",
      actual_coach_name: r.actual_coach_name || "教練",
      order_amount: toMoney(r.order_amount_cents),
      order_amount_cents: Number(r.order_amount_cents) || 0,
      commission: toMoney(r.commission_amount_cents),
      commission_cents: Number(r.commission_amount_cents) || 0,
      commission_rate: AFFILIATE_RATE,
      status: r.status,
      cleared_at: r.cleared_at,
      created_at: r.created_at,
    })),
    _range: range,
  };
}

function maskName(n) {
  const s = String(n || "").trim();
  if (!s) return "學員";
  if (s.length <= 1) return s + "*";
  if (s.length === 2) return s[0] + "*";
  return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
}

/** 某班次的自有學生出席數（給月結顯示） */
function ownStudentAttended(db, scheduleId, coachId) {
  return db
    .prepare(
      `SELECT COUNT(*) c
         FROM bookings b
         LEFT JOIN attendances a ON a.booking_id = b.id
         JOIN student_coach_affiliations f ON f.student_user_id = b.user_id AND f.origin_coach_id = ?
        WHERE b.schedule_id = ? AND b.payment_status = 'paid'
          AND (a.status IN ('present','late') OR (a.status IS NULL AND b.status = 'attended'))`,
    )
    .get(coachId, scheduleId).c;
}

module.exports = {
  ensureSchema,
  bindStudent,
  originCoachId,
  settleSchedule,
  monthSummary,
  ownStudentAttended,
  AFFILIATE_RATE,
};
