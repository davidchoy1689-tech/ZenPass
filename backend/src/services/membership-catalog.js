/**
 * ZenPass v2.1 — 會籍 Catalog（計劃版本化）+ Entitlements
 *
 * - plan_versions：計劃嘅版本（價格/credits/功能），改價 = 出新 version，舊記錄保留（可審計）
 * - entitlements：用戶按會籍獲得嘅權益（例如 priority_booking / pt_sessions）
 *
 * non-throwing（呼叫方仍可包 try/catch）。
 */
const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

// 各計劃帶嘅權益（key → value）
const PLAN_ENTITLEMENTS = {
  lite: { priority_booking: 1, free_cancel: 1 },
  standard: { priority_booking: 1, free_cancel: 1, premium_peak: 1 },
  silver: { priority_booking: 2, free_cancel: 1, unlimited_cancel: 1, pt_sessions: 1 },
  gold: { priority_booking: 3, free_cancel: 1, unlimited_cancel: 1, pt_sessions: 2, dedicated_support: 1 },
};

/**
 * Seed 計劃版本（每個 plan 若無 version 就寫入 version=1）。
 * @param {Object} plans - MEMBERSHIP_PLANS 物件
 */
function seedPlanVersions(plans) {
  const db = getDb();
  let added = 0;
  for (const key of Object.keys(plans || {})) {
    const p = plans[key];
    const exists = db
      .prepare("SELECT id FROM plan_versions WHERE plan_key = ?")
      .get(key);
    if (exists) continue;
    db.prepare(
      `INSERT INTO plan_versions (id, plan_key, version, price_hkd, credits_granted, features_json)
       VALUES (?, ?, 1, ?, ?, ?)`,
    ).run(uuidv4(), key, p.price_hkd || 0, p.credits_granted || 0, JSON.stringify(p.features || []));
    added++;
  }
  return added;
}

function listPlanVersions() {
  try {
    return getDb()
      .prepare("SELECT * FROM plan_versions ORDER BY plan_key, version DESC")
      .all();
  } catch (e) {
    return [];
  }
}

/**
 * 依會籍授予 entitlements（upsert）。
 */
function grantEntitlements(userId, planKey, validUntil) {
  const ent = PLAN_ENTITLEMENTS[planKey];
  if (!userId || !ent) return 0;
  const db = getDb();
  let n = 0;
  for (const key of Object.keys(ent)) {
    db.prepare(
      `INSERT INTO entitlements (id, user_id, key, value, source, valid_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, key) DO UPDATE SET
         value = excluded.value, source = excluded.source,
         valid_until = excluded.valid_until, updated_at = datetime('now')`,
    ).run(uuidv4(), userId, key, ent[key], "membership:" + planKey, validUntil || null);
    n++;
  }
  return n;
}

function getEntitlements(userId) {
  try {
    return getDb()
      .prepare("SELECT key, value, source, valid_until FROM entitlements WHERE user_id = ?")
      .all(userId);
  } catch (e) {
    return [];
  }
}

function hasEntitlement(userId, key) {
  try {
    const row = getDb()
      .prepare("SELECT value, valid_until FROM entitlements WHERE user_id = ? AND key = ?")
      .get(userId, key);
    if (!row || !(row.value > 0)) return false;
    if (row.valid_until && new Date(row.valid_until) < new Date()) return false;
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  PLAN_ENTITLEMENTS,
  seedPlanVersions,
  listPlanVersions,
  grantEntitlements,
  getEntitlements,
  hasEntitlement,
};
