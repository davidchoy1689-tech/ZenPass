/**
 * Phase 4.5 — 先進先出（FIFO）跨卡扣堂引擎
 *
 * 問題：舊邏輯只查 LIMIT 1 一張 Pass。當第一張卡剩 1 堂（即將到期）而新卡有 4 堂，
 *      私人時段要 2 堂時會直接拋「堂數不足」，新卡變死卡。
 *
 * 解法：
 *  1) 按 expires_at ASC（快到期先用）＋ remaining_credits DESC 排序
 *  2) 同一 SQLite 事務內逐張扣，可跨多張卡
 *  3) bookings.pass_id = 第一張卡；secondary_pass_id / secondary_units_consumed = 第二張
 *  4) 每張卡各自寫一筆 pass_redemptions（退款時逐張還原）
 *
 * 鐵律：
 *  - 只扣 status='active' 且未過期、remaining_credits > 0 的卡
 *  - 扣到 0 → status='exhausted'
 *  - 堂數不足 → 拋 INSUFFICIENT_CREDITS，外層 rollback，絕不留半截扣款
 */
const crypto = require("crypto");

const MAX_CARDS_PER_BOOKING = 5;

function ensureSchema(db) {
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const add = (name, type) => {
    if (!cols.includes(name)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`).run();
  };
  add("secondary_pass_id", "TEXT");
  add("secondary_units_consumed", "INTEGER DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS checkin_access_tokens (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_token_lookup ON checkin_access_tokens(token_hash, is_used, expires_at);
  `);

  // 多教練分帳：coach_earnings 加 earning_type（primary / assistant）
  const ecols = db.prepare("PRAGMA table_info(coach_earnings)").all().map((c) => c.name);
  if (!ecols.includes("earning_type")) {
    db.prepare("ALTER TABLE coach_earnings ADD COLUMN earning_type TEXT DEFAULT 'primary'").run();
  }
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_coach_earnings_split
      ON coach_earnings (schedule_id, coach_id, earning_type)
    `);
  } catch (e) {
    // 舊資料有重複（理論上唔應該）→ 留待人手清理，唔阻啟動
    console.error("[FIFO] uq_coach_earnings_split 建立失敗:", e.message);
  }
}

/**
 * 計算扣堂計劃（唔改資料）
 * @returns {{plan:Array<{passId:string,units:number,expires_at:string,remaining:number}>, total:number, source:string}}
 */
function planPassDeduction(db, { userId, familyGroupId = null, units = 1 }) {
  const need = Math.max(1, Math.floor(Number(units) || 1));
  let rows = [];
  let source = "personal";

  // 家庭群組：未指定時自動解析（家人代訂或本人用家庭卡）
  let groupIds = [];
  if (familyGroupId) groupIds = [familyGroupId];
  else if (userId) {
    try {
      groupIds = db
        .prepare(
          `SELECT fm.family_group_id FROM family_members fm
             JOIN family_groups fg ON fg.id = fm.family_group_id
            WHERE fm.member_user_id = ? AND COALESCE(fm.can_consume_pass,1) = 1`,
        )
        .all(userId)
        .map((r) => r.family_group_id);
    } catch (e) {
      groupIds = [];
    }
  }

  if (userId) {
    rows = db
      .prepare(
        `SELECT id, remaining_credits, expires_at
           FROM user_passes
          WHERE user_id = ? AND COALESCE(status,'active') = 'active'
            AND remaining_credits > 0 AND datetime(expires_at) > datetime('now')
          ORDER BY datetime(expires_at) ASC, remaining_credits DESC`,
      )
      .all(userId);
    if (rows.length) source = "personal";
  }

  // 個人卡不足（或冇個人卡）→ 用家庭卡補（同一家庭群組、可消耗）
  const personalTotal = rows.reduce((a, r) => a + Number(r.remaining_credits), 0);
  if (personalTotal < need && groupIds.length) {
    const placeholders = groupIds.map(() => "?").join(",");
    const fam = db
      .prepare(
        `SELECT id, remaining_credits, expires_at
           FROM user_passes
          WHERE family_group_id IN (${placeholders}) AND COALESCE(status,'active') = 'active'
            AND remaining_credits > 0 AND datetime(expires_at) > datetime('now')
          ORDER BY datetime(expires_at) ASC, remaining_credits DESC`,
      )
      .all(...groupIds);
    if (fam.length) {
      // 個人卡先用盡，再用家庭卡（個人優先原則不變）
      const personalIds = new Set(rows.map((r) => r.id));
      const extra = fam.filter((f) => !personalIds.has(f.id));
      if (extra.length) {
        if (!rows.length) source = "family";
        rows = rows.concat(extra);
      }
    }
  }

  const total = rows.reduce((a, r) => a + Number(r.remaining_credits), 0);
  if (total < need) {
    const err = new Error("可用堂數不足");
    err.code = "INSUFFICIENT_CREDITS";
    err.available = total;
    err.required = need;
    throw err;
  }

  const plan = [];
  let left = need;
  for (const r of rows) {
    if (left <= 0 || plan.length >= MAX_CARDS_PER_BOOKING) break;
    const take = Math.min(Number(r.remaining_credits), left);
    if (take <= 0) continue;
    plan.push({ passId: r.id, units: take, expires_at: r.expires_at, remaining: Number(r.remaining_credits) });
    left -= take;
  }
  return { plan, total, source, shortage: 0 };
}

/** 在現有事務內執行扣堂（呼叫前必須已 BEGIN） */
function applyPlanInTx(db, { plan, bookingId, userId }) {
  for (const item of plan) {
    const upd = db
      .prepare(
        `UPDATE user_passes
            SET remaining_credits = remaining_credits - ?,
                status = CASE WHEN remaining_credits - ? <= 0 THEN 'exhausted' ELSE status END,
                updated_at = datetime('now')
          WHERE id = ? AND remaining_credits >= ? AND datetime(expires_at) > datetime('now')`,
      )
      .run(item.units, item.units, item.passId, item.units);
    if (upd.changes !== 1) {
      const err = new Error("扣堂失敗（餘額或有效期已變）");
      err.code = "PASS_CHANGED";
      throw err;
    }
    db.prepare(
      `INSERT INTO pass_redemptions (id, pass_id, booking_id, user_id, credits, status)
       VALUES (?, ?, ?, ?, ?, 'used')`,
    ).run("PRD-" + crypto.randomUUID(), item.passId, bookingId, userId || null, item.units);
  }
  return plan.length;
}

/** 獨立事務版（外層未開事務時使用） */
function deductFIFO(db, { userId, familyGroupId = null, bookingId, units = 1 }) {
  const { plan, source } = planPassDeduction(db, { userId, familyGroupId, units });
  const run = db.transaction(() => applyPlanInTx(db, { plan, bookingId, userId }));
  run();
  return { plan, source };
}

/** 寫入 bookings 的跨卡欄位 */
function recordPlanOnBooking(db, bookingId, plan) {
  const first = plan[0];
  const second = plan[1];
  db.prepare(
    `UPDATE bookings
        SET pass_id = COALESCE(NULLIF(pass_id,''), ?),
            secondary_pass_id = ?,
            secondary_units_consumed = ?
      WHERE id = ?`,
  ).run(first ? first.passId : null, second ? second.passId : null, second ? second.units : 0, bookingId);
}

module.exports = {
  ensureSchema,
  planPassDeduction,
  applyPlanInTx,
  deductFIFO,
  recordPlanOnBooking,
  MAX_CARDS_PER_BOOKING,
};
