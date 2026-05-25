/**
 * ZenPass 禪流 - 認證中介軟體
 *
 * Role-Based Access Control (RBAC) 系統
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
 */

const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("❌ JWT_SECRET 未設定或太短！請喺 .env 設定一個強密碼");
  process.exit(1);
}
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
 * 檢查當前角色是否達到最低權限要求
 * @param {string} currentRole - 用戶當前角色
 * @param {string} requiredRole - 要求的最低角色
 * @returns {boolean}
 */
function hasMinimumRole(currentRole, requiredRole) {
  const currentLevel = ROLE_HIERARCHY[currentRole];
  const requiredLevel = ROLE_HIERARCHY[requiredRole];

  // Unknown roles are treated as guest (worst case)
  if (currentLevel === undefined) {
    return requiredRole === 'guest';
  }
  if (requiredLevel === undefined) return false;

  // Lower number = higher privilege
  return currentLevel <= requiredLevel;
}

/**
 * 取得用戶完整資料（含 partner 資訊）
 */
function _getUserWithPartner(userId) {
  const db = new Database(DB_PATH);
  try {
    const user = db
      .prepare(`
        SELECT id, email, name, phone, role, is_coach, coach_verified,
               partner_id, credits, membership_type, avatar_url
        FROM users WHERE id = ?
      `)
      .get(userId);
    return user;
  } finally {
    db.close();
  }
}

/**
 * 驗證 JWT Token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "需要登入認證" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // Accept demo token ONLY when ALLOW_DEMO_TOKEN=true (dev/testing only)
    if (token.startsWith("demo_token_") && process.env.ALLOW_DEMO_TOKEN === "true") {
      const role = token.replace("demo_token_", "");
      const db = new Database(DB_PATH);
      let demoUser;
      if (role === "admin") {
        demoUser = db.prepare("SELECT id, email, name, role, partner_id FROM users WHERE email='admin@zenpass.hk'").get();
      } else if (role === "coach") {
        demoUser = db.prepare("SELECT id, email, name, role, partner_id FROM users WHERE email='coach@zenpass.hk'").get();
      } else {
        demoUser = db.prepare("SELECT id, email, name, role, partner_id FROM users WHERE email='student@zenpass.hk'").get();
      }
      if (!demoUser) {
        demoUser = db.prepare("SELECT id, email, name, role, partner_id FROM users LIMIT 1").get();
      }
      db.close();
      if (demoUser) {
        req.user = {
          id: demoUser.id,
          email: demoUser.email,
          name: demoUser.name,
          role: role,
          partner_id: demoUser.partner_id,
        };
        return next();
      }
    }
    return res.status(403).json({ error: "認證無效或已過期" });
  }
}

/**
 * 可選認證（有 token 就解析，冇都唔阻）
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // Token invalid, just continue without user
    }
  }
  next();
}

/**
 * 驗證用戶是否為教練
 */
function requireCoach(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "需要登入認證" });
  }

  try {
    const user = _getUserWithPartner(req.user.id);
    if (!user) {
      return res.status(403).json({ error: "用戶不存在" });
    }

    // Coach via role-based RBAC or legacy is_coach flag
    const isCoachViaRole = hasMinimumRole(user.role, 'coach') && !hasMinimumRole(user.role, 'partner_staff');
    if (!user.is_coach && !isCoachViaRole) {
      return res.status(403).json({ error: "需要教練權限" });
    }

    req.user.is_coach = 1;
    next();
  } catch (err) {
    console.error("❌ requireCoach error:", err.message);
    return res.status(500).json({ error: "驗證權限失敗" });
  }
}

/**
 * [向後兼容] 驗證管理員權限（需要先執行 authenticateToken）
 * 支援三種方式：
 * 1. 新 RBAC: role >= 'admin' 或更高 (super_admin, platform_manager, platform_staff, admin)
 * 2. email 含有 admin 或 @zenpass.hk 域名 (向後兼容)
 * 3. role 欄位為 'admin' (向後兼容)
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "需要登入認證" });
  }

  try {
    const user = _getUserWithPartner(req.user.id);
    if (!user) {
      return res.status(403).json({ error: "用戶不存在" });
    }

    const isAdmin =
      hasMinimumRole(user.role, 'admin') ||
      (user.email &&
        (user.email.includes("admin") || user.email.endsWith("@zenpass.hk")));

    if (!isAdmin) {
      return res.status(403).json({ error: "需要管理員權限" });
    }

    next();
  } catch (err) {
    console.error("❌ requireAdmin error:", err.message);
    return res.status(500).json({ error: "驗證權限失敗" });
  }
}

/**
 * 角色權限檢查中介軟體 (Factory)
 *
 * 使用方式:
 *   router.get("/admin/users", authenticateToken, requireRole('platform_staff'), handler)
 *   router.post("/courses", authenticateToken, requireRole('partner_owner'), handler)
 *
 * @param {string} minimumRole - 最低要求角色名稱
 * @returns {Function} Express middleware
 */
function requireRole(minimumRole) {
  if (!ROLE_HIERARCHY[minimumRole]) {
    throw new Error(`未知角色: ${minimumRole}。可用角色: ${Object.keys(ROLE_HIERARCHY).join(', ')}`);
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "需要登入認證" });
    }

    try {
      const user = _getUserWithPartner(req.user.id);
      if (!user) {
        return res.status(403).json({ error: "用戶不存在" });
      }

      if (!hasMinimumRole(user.role, minimumRole)) {
        const currentLevel = ROLE_HIERARCHY[user.role] ?? 'unknown';
        const requiredLevel = ROLE_HIERARCHY[minimumRole];
        return res.status(403).json({
          error: `權限不足 (需要: ${minimumRole}/${requiredLevel}, 當前: ${user.role}/${currentLevel})`,
        });
      }

      // Enrich request with user's full info
      req.user.role = user.role;
      req.user.partner_id = user.partner_id;
      req.user.coach_verified = user.coach_verified;
      req.user.is_coach = user.is_coach;

      next();
    } catch (err) {
      console.error("❌ requireRole error:", err.message);
      return res.status(500).json({ error: "驗證權限失敗" });
    }
  };
}

/**
 * 只允許存取自己機構嘅資料
 * 用於商戶端路由，確保 partner_owner/partner_admin/partner_staff
 * 只可以讀寫自己的機構數據
 *
 * 使用方式:
 *   router.get("/bookings", authenticateToken, requireOwnInstitution, handler)
 */
function requireOwnInstitution(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "需要登入認證" });
  }

  try {
    const user = _getUserWithPartner(req.user.id);
    if (!user) {
      return res.status(403).json({ error: "用戶不存在" });
    }

    req.user.role = user.role;
    req.user.partner_id = user.partner_id;
    req.user.coach_verified = user.coach_verified;
    req.user.is_coach = user.is_coach;

    // Platform-level users can access all institutions
    if (hasMinimumRole(user.role, 'admin')) {
      req.user._canAccessAllPartners = true;
      return next();
    }

    // Partner-level users must have a partner_id
    if (!user.partner_id) {
      return res.status(403).json({ error: "你未關聯到任何機構" });
    }

    // For partner-specific routes, the partner_id is typically in req.params
    // or we can check if the user's partner_id matches the request context
    req.user.partner_id = user.partner_id;
    next();
  } catch (err) {
    console.error("❌ requireOwnInstitution error:", err.message);
    return res.status(500).json({ error: "驗證機構權限失敗" });
  }
}

/**
 * 檢查是否平台員工或以上 (platform_manager, super_admin)
 * 適合需要管理所有機構嘅操作
 */
function requirePlatformStaff(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "需要登入認證" });
  }

  try {
    const user = _getUserWithPartner(req.user.id);
    if (!user) {
      return res.status(403).json({ error: "用戶不存在" });
    }

    if (!hasMinimumRole(user.role, 'platform_staff')) {
      return res.status(403).json({
        error: `需要平台員工權限 (當前角色: ${user.role})`,
      });
    }

    req.user.role = user.role;
    req.user.partner_id = user.partner_id;
    req.user._canAccessAllPartners = true;
    next();
  } catch (err) {
    console.error("❌ requirePlatformStaff error:", err.message);
    return res.status(500).json({ error: "驗證權限失敗" });
  }
}

/**
 * 驗證用戶是否屬於某個 partner 機構
 * 用於跨機構存取控制
 */
function requirePartnerAccess(partnerIdField = 'partner_id') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "需要登入認證" });
    }

    // Platform-level users can access any partner
    if (req.user._canAccessAllPartners) {
      return next();
    }

    // Check if the requested partner_id matches user's partner
    const targetPartnerId = req.params[partnerIdField] || req.body[partnerIdField] || req.query[partnerIdField];
    if (targetPartnerId && targetPartnerId !== req.user.partner_id) {
      return res.status(403).json({ error: "你無法存取其他機構嘅資料" });
    }

    next();
  };
}

/**
 * 取得合作夥伴 ID 的輔助函數
 * 用於路由 handler 內 SQL query 過濾
 *
 * @param {object} req - Express request object
 * @returns {string|null} partner_id or null (for all-access users)
 */
function getQueryPartnerId(req) {
  // Platform-level with all-access: return null (no filter)
  if (req.user._canAccessAllPartners) return null;
  return req.user.partner_id || null;
}

/**
 * 生成 JWT Token（含角色資訊）
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'user',
      partner_id: user.partner_id || null,
      is_coach: user.is_coach || 0,
      membership_type: user.membership_type || "none",
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireCoach,
  requireAdmin,
  requireRole,
  requireOwnInstitution,
  requirePlatformStaff,
  requirePartnerAccess,
  getQueryPartnerId,
  generateToken,
  ROLE_HIERARCHY,
  hasMinimumRole,
};
