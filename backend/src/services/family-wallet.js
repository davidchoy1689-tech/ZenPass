/**
 * family-wallet.js — Phase 2 家庭共享錢包（堂數 Pass）
 *
 * 原則：沿用 user_passes + passes.redeemInTx，不另建扣堂邏輯。
 *  - 個人 Pass（user_id = 學員）優先
 *  - 家庭 Pass（family_group 成員且 can_consume_pass=1）次之
 *  - 只支援次數 Pass；月費訂閱暫緩
 */
const { getDb } = require("./database");

const AUDIENCES = ["elderly", "office_worker", "postnatal", "active_50plus", "general_fitness"];

function ensureSchema(db) {
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  if (!ccols.includes("target_audience_enum")) {
    db.exec(
      `ALTER TABLE classes ADD COLUMN target_audience_enum TEXT DEFAULT 'general_fitness' CHECK(target_audience_enum IN ('elderly','office_worker','postnatal','active_50plus','general_fitness'))`,
    );
  }
  if (!ccols.includes("target_audience_label")) db.exec("ALTER TABLE classes ADD COLUMN target_audience_label TEXT");

  const pcols = db.prepare("PRAGMA table_info(user_passes)").all().map((c) => c.name);
  if (!pcols.includes("owner_user_id")) db.exec("ALTER TABLE user_passes ADD COLUMN owner_user_id TEXT");
  if (!pcols.includes("family_group_id")) db.exec("ALTER TABLE user_passes ADD COLUMN family_group_id TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS family_groups (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS family_members (
      id TEXT PRIMARY KEY,
      family_group_id TEXT NOT NULL,
      member_user_id TEXT NOT NULL,
      relation_title TEXT NOT NULL,
      can_consume_pass INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(family_group_id, member_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(member_user_id);
    CREATE INDEX IF NOT EXISTS idx_user_passes_family ON user_passes(family_group_id);
  `);

  // 歷史資料：先寫 label，再按關鍵字正規化 enum
  try {
    db.exec(`
      UPDATE classes SET target_audience_label = COALESCE(NULLIF(target_audience_label,''), target_audience)
      WHERE target_audience_label IS NULL OR target_audience_label = ''
    `);
    db.exec(`
      UPDATE classes SET target_audience_enum = CASE
        WHEN target_audience LIKE '%長者%' OR target_audience LIKE '%熟齡%' OR target_audience LIKE '%樂齡%' THEN 'elderly'
        WHEN target_audience LIKE '%在職%' OR target_audience LIKE '%上班%' OR target_audience LIKE '%成人%' THEN 'office_worker'
        WHEN target_audience LIKE '%產後%' OR target_audience LIKE '%媽媽%' THEN 'postnatal'
        WHEN target_audience LIKE '%50%' OR target_audience LIKE '%退休%' THEN 'active_50plus'
        ELSE COALESCE(target_audience_enum,'general_fitness')
      END
      WHERE target_audience_enum IS NULL OR target_audience_enum = 'general_fitness'
    `);
    db.exec("UPDATE user_passes SET owner_user_id = user_id WHERE owner_user_id IS NULL");
  } catch (e) {}
}

function personalPass(db, studentUserId) {
  return db
    .prepare(
      `SELECT * FROM user_passes
        WHERE user_id = ? AND status='active' AND remaining_credits > 0
          AND datetime(expires_at) > datetime('now')
        ORDER BY datetime(expires_at) ASC LIMIT 1`,
    )
    .get(studentUserId);
}

function familyPass(db, studentUserId) {
  return db
    .prepare(
      `SELECT up.*, fg.owner_user_id, u.name AS owner_name, fm.relation_title
         FROM family_members fm
         JOIN family_groups fg ON fg.id = fm.family_group_id
         JOIN user_passes up ON up.family_group_id = fg.id
         JOIN users u ON u.id = fg.owner_user_id
        WHERE fm.member_user_id = ? AND COALESCE(fm.can_consume_pass,1)=1
          AND up.status='active' AND up.remaining_credits > 0
          AND datetime(up.expires_at) > datetime('now')
        ORDER BY datetime(up.expires_at) ASC LIMIT 1`,
    )
    .get(studentUserId);
}

/** 兩層優先級：本人 Pass → 家庭 Pass */
function findApplicablePass(db, studentUserId) {
  ensureSchema(db);
  const p = personalPass(db, studentUserId);
  if (p) return { pass: p, source: "personal", payerName: null, ownerName: null };
  const f = familyPass(db, studentUserId);
  if (f) {
    const payer = f.owner_name || f.owner_user_id;
    return { pass: f, source: "family", payerName: payer, ownerName: payer, relation: f.relation_title || null };
  }
  return null;
}

/** 點名冊 badge：依 booking 已用 Pass 或可扣 Pass 描述 */
function describePass(db, studentUserId, bookingPassId) {
  ensureSchema(db);
  if (bookingPassId) {
    const p = db
      .prepare(
        `SELECT p.*, fg.owner_user_id, u.name AS owner_name
           FROM user_passes p
           LEFT JOIN family_groups fg ON fg.id = p.family_group_id
           LEFT JOIN users u ON u.id = fg.owner_user_id
          WHERE p.id = ?`,
      )
      .get(bookingPassId);
    if (p) {
      const family = !!p.family_group_id && p.owner_user_id && p.user_id !== studentUserId;
      return {
        has_valid_pass: true,
        pass_type: family ? "family" : "personal",
        display_badge: family ? `👨‍👩‍👧 使用 [${p.owner_name || "家庭"}] 家庭Pass` : `個人 Pass`,
        remaining_units: Number(p.remaining_credits) || 0,
      };
    }
  }
  const a = findApplicablePass(db, studentUserId);
  if (!a) return { has_valid_pass: false, pass_type: null, display_badge: null, remaining_units: 0 };
  return {
    has_valid_pass: true,
    pass_type: a.source,
    display_badge: a.source === "family" ? `👨‍👩‍👧 使用 [${a.payerName}] 家庭Pass` : `個人 Pass`,
    remaining_units: Number(a.pass.remaining_credits) || 0,
  };
}

function badgesForAudience(enumValue) {
  const map = {
    elderly: { label: "🛡️ 熟齡防跌", color: "green" },
    active_50plus: { label: "🛡️ 熟齡防跌", color: "green" },
    office_worker: { label: "💼 辦公室肩頸腰痛", color: "blue" },
    postnatal: { label: "🌸 產後盆骨核心", color: "pink" },
    general_fitness: { label: "🏃 大眾體適能", color: "grey" },
  };
  return map[enumValue] || map.general_fitness;
}

module.exports = { ensureSchema, findApplicablePass, describePass, badgesForAudience, AUDIENCES };
