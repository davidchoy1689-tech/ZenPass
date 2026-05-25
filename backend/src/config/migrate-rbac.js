/**
 * ZenPass 禪流 — RBAC 全角色權限管理 Migration
 *
 * Phase 2: 10 級角色權限系統
 *
 * 角色層級 (數字越低權限越高):
 *   0: super_admin      — 平台擁有者 (David)
 *   1: platform_manager — 平台管理 (睇晒所有商戶)
 *   2: platform_staff   — 平台員工 (管理所有商戶日常運作)
 *   3: admin            — 管理員 (訂單、用戶、客服)
 *   4: partner_owner    — 商戶負責人 (管理自己場地/教練/課程/提現)
 *   5: partner_admin    — 機構日常運營
 *   6: partner_staff    — 前台/報到
 *   7: coach            — 教練 (授課、租場、私人班、錢包)
 *   8: user             — 學生 (預約課程)
 *   9: guest            — 瀏覽訪客
 *
 * 設計原則:
 * - 金融記錄保護保持不變 (DELETE triggers, blockchain audit)
 * - 商戶負責人只能見到自己機構嘅數據
 * - 平台管理員可以見到所有機構嘅數據
 * - Coach 可屬多個機構 + 獨立身份
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== 角色層級定義 =====
const ROLE_HIERARCHY = {
  super_admin: 0,
  platform_manager: 1,
  platform_staff: 2,
  admin: 3,
  partner_owner: 4,
  partner_admin: 5,
  partner_staff: 6,
  coach: 7,
  user: 8,
  guest: 9,
};

/**
 * 檢查某角色是否有足夠權限 (current 必須 <= required 先通過)
 */
function hasMinimumRole(currentRole, requiredRole) {
  const currentLevel = ROLE_HIERARCHY[currentRole] ?? 99;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 99;
  return currentLevel <= requiredLevel;
}

/**
 * 取得角色名稱列表
 */
function getRoleNames() {
  return Object.keys(ROLE_HIERARCHY);
}

/**
 * 取得角色層級
 */
function getRoleLevel(roleName) {
  return ROLE_HIERARCHY[roleName] ?? 99;
}

function migrate() {
  const db = new Database(DB_PATH);
  console.log(`[MIGRATE-RBAC] Running RBAC migration on ${DB_PATH}...`);

  // Step 1: Add partner_id column to users (link user to institution)
  let cols = db.prepare("PRAGMA table_info(users)").all();
  const hasPartnerId = cols.some(c => c.name === "partner_id");
  if (!hasPartnerId) {
    db.exec(`
      ALTER TABLE users ADD COLUMN partner_id TEXT REFERENCES partner_venues(id);
      CREATE INDEX IF NOT EXISTS idx_users_partner ON users(partner_id);
    `);
    console.log("[MIGRATE-RBAC] ✓ Added partner_id to users");
  } else {
    console.log("[MIGRATE-RBAC] ✓ partner_id column already exists on users");
  }

  // Step 2: Update roles — convert old string roles to new RBAC roles
  // Old: 'admin', 'user', 'coach'   New: full RBAC roles
  // Any role not in the hierarchy gets mapped to the closest match
  const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users").get().cnt;
  console.log(`[MIGRATE-RBAC] Migrating ${userCount} user roles...`);

  // Map old-style roles to new RBAC roles
  const roleMap = {
    'admin': 'admin',
    'user': 'user',
    'coach': 'coach',
  };

  // Users with email containing 'admin' or '@zenpass.hk' → platform_manager if not already mapped
  const adminUsers = db.prepare(`
    SELECT id, email, role, is_coach FROM users WHERE (email LIKE '%admin%' OR email LIKE '%@zenpass.hk%')
  `).all();

  for (const u of adminUsers) {
    // Skip if already has a proper RBAC role
    if (u.role && ROLE_HIERARCHY[u.role] !== undefined) continue;

    // David (super_admin)
    if (u.email === 'david@zenpass.hk' || u.email === 'davidchoy1689@gmail.com') {
      db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(u.id);
      console.log(`  → ${u.email}: super_admin`);
    }
    // Admin staff → platform_manager
    else if (u.email === 'admin@zenpass.hk') {
      db.prepare("UPDATE users SET role = 'platform_manager' WHERE id = ?").run(u.id);
      console.log(`  → ${u.email}: platform_manager`);
    }
    // Other zenpass.hk → platform_staff
    else if (u.email.endsWith('@zenpass.hk')) {
      db.prepare("UPDATE users SET role = 'platform_staff' WHERE id = ?").run(u.id);
      console.log(`  → ${u.email}: platform_staff`);
    }
  }

  // Coaches → coach role
  const coachUsers = db.prepare("SELECT id, email FROM users WHERE is_coach = 1 AND (role IS NULL OR role NOT IN ('super_admin','platform_manager','platform_staff','admin'))").all();
  for (const u of coachUsers) {
    if (!u.role || !ROLE_HIERARCHY[u.role] || ROLE_HIERARCHY[u.role] > ROLE_HIERARCHY.coach) {
      db.prepare("UPDATE users SET role = 'coach' WHERE id = ?").run(u.id);
    }
  }
  console.log(`[MIGRATE-RBAC] ✓ Coaches mapped: ${coachUsers.length}`);

  // Remaining users with no role → 'user'
  const noRoleUsers = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role IS NULL OR role NOT IN ('super_admin','platform_manager','platform_staff','admin','partner_owner','partner_admin','partner_staff','coach','user','guest')").get();
  if (noRoleUsers.cnt > 0) {
    db.prepare("UPDATE users SET role = 'user' WHERE role IS NULL OR role NOT IN ('super_admin','platform_manager','platform_staff','admin','partner_owner','partner_admin','partner_staff','coach','user','guest')").run();
    console.log(`[MIGRATE-RBAC] ✓ Mapped ${noRoleUsers.cnt} users with no/unknown role → 'user'`);
  }

  // Step 3: Add owner_id column to partner_venues (who owns the institution)
  cols = db.prepare("PRAGMA table_info(partner_venues)").all();
  const hasOwnerId = cols.some(c => c.name === "owner_id");
  if (!hasOwnerId) {
    db.exec(`
      ALTER TABLE partner_venues ADD COLUMN owner_id TEXT REFERENCES users(id);
      CREATE INDEX IF NOT EXISTS idx_partner_venues_owner ON partner_venues(owner_id);
    `);
    console.log("[MIGRATE-RBAC] ✓ Added owner_id to partner_venues");
  } else {
    console.log("[MIGRATE-RBAC] ✓ owner_id column already exists on partner_venues");
  }

  // Auto-link existing partner_venues to their user_id as owner
  const unlinkedVenues = db.prepare("SELECT id, user_id FROM partner_venues WHERE owner_id IS NULL AND user_id IS NOT NULL").all();
  for (const v of unlinkedVenues) {
    db.prepare("UPDATE partner_venues SET owner_id = ? WHERE id = ?").run(v.user_id, v.id);
  }
  console.log(`[MIGRATE-RBAC] ✓ Auto-linked ${unlinkedVenues.length} venues to owners`);

  // Set partner_owner role for venue owners
  for (const v of unlinkedVenues) {
    const ownerUser = db.prepare("SELECT id, role FROM users WHERE id = ?").get(v.user_id);
    if (ownerUser && (!ownerUser.role || ROLE_HIERARCHY[ownerUser.role] === undefined || ROLE_HIERARCHY[ownerUser.role] > ROLE_HIERARCHY.partner_owner)) {
      db.prepare("UPDATE users SET role = 'partner_owner', partner_id = ? WHERE id = ?").run(v.id, v.user_id);
    }
  }
  console.log(`[MIGRATE-RBAC] ✓ Set partner_owner roles for venue owners`);

  // Step 4: Add partner_id column to classes
  cols = db.prepare("PRAGMA table_info(classes)").all();
  const hasPartnerCol = cols.some(c => c.name === "partner_id");
  if (!hasPartnerCol) {
    db.exec(`
      ALTER TABLE classes ADD COLUMN partner_id TEXT REFERENCES partner_venues(id);
      CREATE INDEX IF NOT EXISTS idx_classes_partner_id ON classes(partner_id);
    `);
    console.log("[MIGRATE-RBAC] ✓ Added partner_id to classes");

    // Copy partner_venue_id → partner_id for backward compatibility
    if (cols.some(c => c.name === "partner_venue_id")) {
      const linked = db.prepare(`
        UPDATE classes SET partner_id = partner_venue_id WHERE partner_venue_id IS NOT NULL AND partner_id IS NULL
      `).run();
      console.log(`[MIGRATE-RBAC] ✓ Synced ${linked.changes} classes partner_venue_id → partner_id`);
    }
  } else {
    console.log("[MIGRATE-RBAC] ✓ partner_id column already exists on classes");
  }

  // Step 5: Create partner_members table (coach ↔ partner memberships)
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_members (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'coach',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (partner_id) REFERENCES partner_venues(id)
    );
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_partner_members_user ON partner_members(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members(partner_id)");
  } catch (e) {}
  console.log("[MIGRATE-RBAC] ✓ Created partner_members table");

  // Step 6: Add coach_commission_rate to partner_members (per-coach rate for each venue)
  try {
    cols = db.prepare("PRAGMA table_info(partner_members)").all();
    if (!cols.some(c => c.name === "commission_rate")) {
      db.exec("ALTER TABLE partner_members ADD COLUMN commission_rate REAL DEFAULT 0.75");
    }
    if (!cols.some(c => c.name === "updated_at")) {
      db.exec("ALTER TABLE partner_members ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))");
    }
  } catch (e) {
    console.warn("[MIGRATE-RBAC] ⚠️ partner_members column add failed:", e.message);
  }

  // Auto-add existing coaches who taught at partner venues to partner_members
  const coachVenues = db.prepare(`
    SELECT DISTINCT c.coach_id, c.partner_id
    FROM classes c
    WHERE c.partner_id IS NOT NULL AND c.coach_id IS NOT NULL
  `).all();

  for (const cv of coachVenues) {
    const existing = db.prepare("SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?").get(cv.coach_id, cv.partner_id);
    if (!existing) {
      const { v4: uuidv4 } = require("uuid");
      const id = uuidv4();
      db.prepare(`
        INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at)
        VALUES (?, ?, ?, 'coach', 'active', datetime('now'))
      `).run(id, cv.coach_id, cv.partner_id);
    }
  }
  console.log(`[MIGRATE-RBAC] ✓ Auto-linked ${coachVenues.length} coach-venue relationships`);

  db.close();
  console.log("[MIGRATE-RBAC] ✅ RBAC migration complete");
  return true;
}

if (require.main === module) {
  require("dotenv").config({ path: __dirname + "/../../.env" });
  migrate();
}

module.exports = {
  migrate,
  ROLE_HIERARCHY,
  hasMinimumRole,
  getRoleNames,
  getRoleLevel,
};
