/**
 * ZenPass - 企業健康計劃 (B2B) — ClassPass 模式
 *
 * 功能：
 * - 企業帳戶管理（create / edit / suspend）
 * - 員工 Credit Pool（公司埋單）
 * - 批量開 account（CSV 上傳）
 * - 用量報表（月結用）
 * - Invoice 產生
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { writeBlock } = require("../services/blockchain-audit");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");

const router = express.Router();

// ===== Helper: Admin check =====
function isAdmin(userId) {
  const db = getDb();
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);

  return u && u.role === "admin";
}

// ===== GET /api/corporate/companies — 企業列表（Admin）=====
router.get("/companies", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const db = getDb();
    const companies = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM corporate_members cm JOIN users u ON cm.user_id = u.id WHERE cm.company_id = c.id AND u.id IS NOT NULL) as active_employees,
        (SELECT COALESCE(SUM(b.amount), 0) FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id WHERE cm.company_id = c.id AND b.status IN ('confirmed', 'attended')) as total_spent
      FROM corporate_companies c ORDER BY c.created_at DESC
    `).all();

    res.json({ companies });
  } catch (err) {
    console.error("[CORPORATE] List error:", err);
    res.status(500).json({ success: false, error: "讀取企業列表失敗" });
  }
});

// ===== POST /api/corporate/companies — 建立企業帳戶 =====
router.post("/companies", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const { name, contact_name, contact_email, contact_phone, credit_pool, billing_cycle } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "請輸入企業名稱" });

    const db = getDb();
    db.pragma("foreign_keys = ON");
    const id = uuidv4();
    db.prepare(`
      INSERT INTO corporate_companies (id, name, contact_name, contact_email, contact_phone, credit_pool, credit_used, billing_cycle, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', datetime('now'))
    `).run(id, name, contact_name || "", contact_email || "", contact_phone || "", credit_pool || 0, billing_cycle || "monthly");

    try {
      writeBlock({ entityType: "corporate_company", entityId: id, data: { name, contact_name: contact_name || "", contact_email: contact_email || "", credit_pool: credit_pool || 0, billing_cycle: billing_cycle || "monthly", created_by: req.user.id } });
    } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }
    res.json({ id, message: `✅ 企業「${name}」已建立` });
  } catch (err) {
    console.error("[CORPORATE] Create error:", err);
    res.status(500).json({ success: false, error: "建立企業失敗" });
  }
});

// ===== POST /api/corporate/companies/:id/topup — 加值 Credit Pool =====
router.post("/companies/:id/topup", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const { credits } = req.body;
    if (!credits || credits <= 0) return res.status(400).json({ success: false, error: "請輸入有效數量" });

    const db = getDb();
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ?").get(req.params.id);
    if (!company) { return res.status(404).json({ success: false, error: "企業不存在" }); }

    db.prepare("UPDATE corporate_companies SET credit_pool = credit_pool + ?, updated_at = datetime('now') WHERE id = ?")
      .run(credits, req.params.id);
    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, user_id, details, created_at)
      VALUES (?, 'corporate.topup', 'corporate_company', ?, ?, ?, datetime('now'))
    `).run(uuidv4(), req.params.id, req.user.id, JSON.stringify({ credits_added: credits, new_pool: company.credit_pool + credits }));

    try {
      writeBlock({ entityType: "corporate_credit", entityId: req.params.id, data: { action: "topup", credits_added: credits, previous_pool: company.credit_pool, new_pool: company.credit_pool + credits, performed_by: req.user.id } });
    } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }
    res.json({ message: `✅ 已加值 ${credits} Credits（總餘額：${company.credit_pool + credits}）` });
  } catch (err) {
    console.error("[CORPORATE] Topup error:", err);
    res.status(500).json({ success: false, error: "加值失敗" });
  }
});

// ===== POST /api/corporate/companies/:id/employees — 批量新增員工 =====
router.post("/companies/:id/employees", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const { employees } = req.body; // [{name, email, phone}]
    if (!employees || !Array.isArray(employees) || employees.length === 0)
      return res.status(400).json({ success: false, error: "請提供員工列表" });

    const db = getDb();
    db.pragma("foreign_keys = ON");
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ? AND status = 'active'").get(req.params.id);
    if (!company) { return res.status(404).json({ success: false, error: "企業不存在或已停用" }); }

    const created = [];
    for (const emp of employees) {
      if (!emp.email) continue;
      // Check existing user
      let user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(emp.email);
      if (!user) {
        const userId = uuidv4();
        const bcryptjs = require("bcryptjs");
        const tempPass = "zp" + Math.random().toString(36).substring(2, 10) + "!";
        db.prepare(`
          INSERT INTO users (id, name, email, password_hash, role, credits, created_at)
          VALUES (?, ?, ?, ?, 'user', 0, datetime('now'))
        `).run(userId, emp.name || emp.email.split("@")[0], emp.email, bcryptjs.hashSync(tempPass, 10));
        user = { id: userId, temp_password: tempPass, new: true };
      } else {
        user.new = false;
      }

      // Check if already member
      const existing = db.prepare("SELECT id FROM corporate_members WHERE company_id = ? AND user_id = ?").get(req.params.id, user.id);
      if (!existing) {
        db.prepare("INSERT INTO corporate_members (id, company_id, user_id, status, created_at) VALUES (?, ?, ?, 'active', datetime('now'))")
          .run(uuidv4(), req.params.id, user.id);
      }

      // Blockchain audit for member creation
      try {
        if (!existing) {
          writeBlock({ entityType: "corporate_member", entityId: user.id, data: { action: "added", company_id: req.params.id, email: emp.email, name: emp.name, added_by: req.user.id } });
        }
      } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }

      created.push({ email: emp.email, name: emp.name, user_id: user.id, new_account: user.new, temp_password: user.temp_password });
    }

    res.json({ created: created.length, employees: created });
  } catch (err) {
    console.error("[CORPORATE] Add employees error:", err);
    res.status(500).json({ success: false, error: "新增員工失敗" });
  }
});

// ===== GET /api/corporate/companies/:id — 企業詳情 + 用量報表 =====
router.get("/companies/:id", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const db = getDb();
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ?").get(req.params.id);
    if (!company) { return res.status(404).json({ success: false, error: "企業不存在" }); }

    const employees = db.prepare(`
      SELECT u.id, u.name, u.email, u.role as status, u.credits,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND created_at >= datetime('now', '-30 days')) as bookings_30d,
        cm.created_at as joined_at
      FROM corporate_members cm JOIN users u ON cm.user_id = u.id
      WHERE cm.company_id = ? AND cm.status = 'active'
      ORDER BY u.name
    `).all(req.params.id);

    const usage = db.prepare(`
      SELECT DATE(b.created_at) as date, COUNT(*) as bookings, SUM(COALESCE(b.amount,0)) as revenue
      FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id
      WHERE cm.company_id = ? AND b.status IN ('confirmed', 'attended') AND b.created_at >= datetime('now', '-90 days')
      GROUP BY DATE(b.created_at) ORDER BY date DESC LIMIT 90
    `).all(req.params.id);

    res.json({ company, employees, usage, total_employees: employees.length });
  } catch (err) {
    console.error("[CORPORATE] Detail error:", err);
    res.status(500).json({ success: false, error: "讀取企業詳情失敗" });
  }
});

// ===== PATCH /api/corporate/companies/:id — 更新企業資料 =====
router.patch("/companies/:id", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const fields = ["name", "contact_name", "contact_email", "contact_phone", "billing_cycle", "status"];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: "冇嘢要更新" });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    const db = getDb();
    db.prepare(`UPDATE corporate_companies SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    try {
      const changedFields = {};
      for (const f of fields) { if (req.body[f] !== undefined) changedFields[f] = req.body[f]; }
      writeBlock({ entityType: "corporate_company", entityId: req.params.id, data: { action: "update", changes: changedFields, performed_by: req.user.id } });
    } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }
    res.json({ message: "✅ 已更新" });
  } catch (err) {
    console.error("[CORPORATE] Update error:", err);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

// ===== GET /api/corporate/report — 企業收入報表 =====
router.get("/report", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const db = getDb();
    const report = db.prepare(`
      SELECT c.id, c.name, c.credit_pool, c.credit_used, c.status,
        (SELECT COUNT(*) FROM corporate_members WHERE company_id = c.id AND status = 'active') as employees,
        (SELECT COALESCE(SUM(b.amount), 0) FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id WHERE cm.company_id = c.id AND b.status IN ('confirmed', 'attended') AND b.created_at >= datetime('now', '-30 days')) as revenue_30d,
        (SELECT COALESCE(SUM(b.amount), 0) FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id WHERE cm.company_id = c.id AND b.status IN ('confirmed', 'attended')) as total_revenue
      FROM corporate_companies c ORDER BY total_revenue DESC
    `).all();

    res.json({ report });
  } catch (err) {
    console.error("[CORPORATE] Report error:", err);
    res.status(500).json({ success: false, error: "讀取報表失敗" });
  }
});

// ===== GET /api/corporate/my-company — 員工查詢所屬企業資料 =====
router.get("/my-company", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const company = db.prepare(`
      SELECT cc.id, cc.name as company_name, cc.credit_pool, cc.credit_used,
        (cc.credit_pool - cc.credit_used) as available_credits,
        cc.status,
        COALESCE(cm.monthly_credit_limit, 0) as monthly_credit_limit,
        COALESCE(cm.monthly_credit_used, 0) as monthly_credit_used
      FROM corporate_members cm
      JOIN corporate_companies cc ON cm.company_id = cc.id
      WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'
    `).get(req.user.id);

    if (!company) return res.status(404).json({ success: false, error: "你未加入任何企業" });
    res.json(company);
  } catch (err) {
    console.error("[CORPORATE] my-company error:", err);
    res.status(500).json({ success: false, error: "讀取企業資料失敗" });
  }
});

// ===== PATCH /api/corporate/members/:memberId/limit — 設定員工月度上限 =====
router.patch("/members/:memberId/limit", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const { monthly_credit_limit } = req.body;
    if (monthly_credit_limit === undefined || monthly_credit_limit < 0) {
      return res.status(400).json({ success: false, error: "請輸入有效上限" });
    }
    const db = getDb();
    db.prepare("UPDATE corporate_members SET monthly_credit_limit = ?, updated_at = datetime('now') WHERE id = ?")
      .run(monthly_credit_limit, req.params.memberId);

    try {
      writeBlock({ entityType: "corporate_member", entityId: req.params.memberId, data: { action: "limit_update", monthly_credit_limit, performed_by: req.user.id } });
    } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }
    res.json({ message: "✅ 已更新員工月度上限" });
  } catch (err) {
    console.error("[CORPORATE] Set limit error:", err);
    res.status(500).json({ success: false, error: "更新上限失敗" });
  }
});

// ===== GET /api/corporate/my/hr-dashboard — 企業 HR 儀錶板（員工自助）=====
router.get("/my/hr-dashboard", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    // Try contact_email first
    let company = db.prepare(`
      SELECT id, name, credit_pool, credit_used, contact_name, contact_email, status,
        monthly_allocation, last_reset_at, next_reset_at
      FROM corporate_companies
      WHERE contact_email = ? AND status = 'active'
    `).get(req.user.email);

    if (!company) {
      // Fallback: user is a corporate member
      const member = db.prepare(`
        SELECT cc.* FROM corporate_members cm
        JOIN corporate_companies cc ON cm.company_id = cc.id
        WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'
      `).get(req.user.id);
      if (!member) { return res.status(403).json({ success: false, error: "你不是企業員工" }); }
      company = member;
    }

    // Employee list with usage
    const employees = db.prepare(`
      SELECT u.id, u.name, u.email, u.last_visit,
        COALESCE(cm.monthly_credit_limit, 0) as monthly_limit,
        COALESCE(cm.monthly_credit_used, 0) as monthly_used,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND status IN ('confirmed','attended') AND created_at >= datetime('now', '-30 days')) as bookings_30d,
        cm.created_at as joined_at
      FROM corporate_members cm JOIN users u ON cm.user_id = u.id
      WHERE cm.company_id = ? AND cm.status = 'active'
      ORDER BY u.name
    `).all(company.id);

    // Recent bookings (last 30 days)
    const recentBookings = db.prepare(`
      SELECT b.id, b.booking_reference, b.status, b.created_at, b.payment_type,
        u.name as user_name, u.email as user_email,
        c.title as class_title, c.venue_name, cs.start_time
      FROM corporate_members cm
      JOIN users u ON cm.user_id = u.id
      JOIN bookings b ON cm.user_id = b.user_id
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE cm.company_id = ? AND b.created_at >= datetime('now', '-30 days')
      ORDER BY b.created_at DESC LIMIT 20
    `).all(company.id);

    // Monthly usage stats
    const monthlyUsage = db.prepare(`
      SELECT DATE(b.created_at) as date, COUNT(*) as count, SUM(COALESCE(b.amount,0)) as revenue
      FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id
      WHERE cm.company_id = ? AND b.status IN ('confirmed','attended')
        AND b.created_at >= datetime('now', '-30 days')
      GROUP BY DATE(b.created_at) ORDER BY date
    `).all(company.id);

    res.json({
      company: {
        id: company.id,
        name: company.name,
        credit_pool: company.credit_pool,
        credit_used: company.credit_used,
        available_credits: company.credit_pool - company.credit_used,
        monthly_allocation: company.monthly_allocation,
        last_reset_at: company.last_reset_at,
        next_reset_at: company.next_reset_at
      },
      employees,
      recent_bookings: recentBookings,
      monthly_usage: monthlyUsage,
      total_employees: employees.length,
      total_bookings_30d: recentBookings.length
    });
  } catch (err) {
    console.error("[HR DASHBOARD] Error:", err);
    res.status(500).json({ success: false, error: "讀取儀錶板資料失敗" });
  }
});

// ===== GET /api/corporate/my/employee/:userId — 員工詳細用量 =====
router.get("/my/employee/:userId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    // Verify the requesting user belongs to a company
    const myMembership = db.prepare(`
      SELECT cm.*, cc.name as company_name FROM corporate_members cm
      JOIN corporate_companies cc ON cm.company_id = cc.id
      WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'
    `).get(req.user.id);

    if (!myMembership) { return res.status(403).json({ success: false, error: "你不是企業員工" }); }

    // Target employee must be in the same company
    const targetMember = db.prepare(`
      SELECT cm.* FROM corporate_members cm
      WHERE cm.user_id = ? AND cm.company_id = ? AND cm.status = 'active'
    `).get(req.params.userId, myMembership.company_id);

    if (!targetMember) { return res.status(403).json({ success: false, error: "無權限" }); }

    const user = db.prepare("SELECT id, name, email, credits, created_at, last_visit FROM users WHERE id = ?").get(req.params.userId);
    const bookings = db.prepare(`
      SELECT b.*, c.title as class_title, c.venue_name, cs.start_time
      FROM bookings b JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 50
    `).all(req.params.userId);

    res.json({
      user,
      bookings,
      monthly_limit: targetMember.monthly_credit_limit,
      monthly_used: targetMember.monthly_credit_used
    });
  } catch (err) {
    console.error("[HR EMPLOYEE] Error:", err);
    res.status(500).json({ success: false, error: "讀取員工資料失敗" });
  }
});

// ===== POST /api/corporate/my/invite — HR 自助邀請新員工 =====
router.post("/my/invite", authenticateToken, (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) return res.status(400).json({ success: false, error: "請提供員工電郵及名稱" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Verify the requesting user belongs to a company
    const myCompany = db.prepare(`
      SELECT cc.* FROM corporate_members cm
      JOIN corporate_companies cc ON cm.company_id = cc.id
      WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'
    `).get(req.user.id);

    if (!myCompany) { return res.status(403).json({ success: false, error: "你不是企業員工" }); }

    // Check existing user
    let user = db.prepare("SELECT id, name, email FROM users WHERE email = ?").get(email);
    if (!user) {
      const userId = uuidv4();
      const bcryptjs = require("bcryptjs");
      const tempPass = "zp" + Math.random().toString(36).substring(2, 10) + "!";
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, credits, created_at)
        VALUES (?, ?, ?, ?, 'user', 0, datetime('now'))
      `).run(userId, name, email, bcryptjs.hashSync(tempPass, 10));
      user = { id: userId, temp_password: tempPass, new: true };
    } else {
      user.new = false;
    }

    // Check if already member
    const existing = db.prepare("SELECT id FROM corporate_members WHERE company_id = ? AND user_id = ?")
      .get(myCompany.id, user.id);
    if (existing) { return res.json({ message: "該員工已在公司內" }); }

    db.prepare("INSERT INTO corporate_members (id, company_id, user_id, status, created_at) VALUES (?, ?, ?, 'active', datetime('now'))")
      .run(uuidv4(), myCompany.id, user.id);

    try {
      writeBlock({ entityType: "corporate_member", entityId: user.id, data: { action: "hr_invite", company_id: myCompany.id, company_name: myCompany.name, email, name, invited_by: req.user.id, new_account: !!user.new } });
    } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }
    res.json({
      message: user.new
        ? `✅ ${name} 已加入！臨時密碼：${user.temp_password}（請即修改）`
        : `✅ ${name} 已加入公司！`,
      user: { email, name, new_account: user.new, temp_password: user.temp_password || null }
    });
  } catch (err) {
    console.error("[HR INVITE] Error:", err);
    res.status(500).json({ success: false, error: "邀請失敗" });
  }
});

// ===== GET /api/corporate/stats/:companyId — 企業 Wellness Dashboard 統計 =====
router.get("/stats/:companyId", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ success: false, error: "只限管理員" });
  try {
    const db = getDb();
    const { companyId } = req.params;
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ?").get(companyId);
    if (!company) return res.status(404).json({ success: false, error: "企業不存在" });

    // Total bookings (all time)
    const totalBookings = db.prepare(`
      SELECT COUNT(*) as count FROM corporate_members cm
      JOIN bookings b ON cm.user_id = b.user_id
      WHERE cm.company_id = ? AND b.status IN ('confirmed','attended')
    `).get(companyId).count;

    // Monthly usage (last 12 months)
    const monthlyUsage = db.prepare(`
      SELECT strftime('%Y-%m', b.created_at) as month, COUNT(*) as count
      FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id
      WHERE cm.company_id = ? AND b.status IN ('confirmed','attended')
        AND b.created_at >= datetime('now', '-12 months')
      GROUP BY strftime('%Y-%m', b.created_at) ORDER BY month
    `).all(companyId);

    // Top employees by bookings
    const topEmployees = db.prepare(`
      SELECT u.name, u.email, COUNT(*) as bookings
      FROM corporate_members cm JOIN users u ON cm.user_id = u.id
      JOIN bookings b ON cm.user_id = b.user_id
      WHERE cm.company_id = ? AND b.status IN ('confirmed','attended')
      GROUP BY u.id ORDER BY bookings DESC LIMIT 10
    `).all(companyId);

    // Popular categories
    const popularCategories = db.prepare(`
      SELECT c.category, COUNT(*) as count
      FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id
      JOIN classes c ON b.class_id = c.id
      WHERE cm.company_id = ? AND b.status IN ('confirmed','attended')
      GROUP BY c.category ORDER BY count DESC
    `).all(companyId);

    // Credit utilization
    const creditUtilization = company.credit_pool > 0
      ? Math.min(1, (company.credit_used || 0) / company.credit_pool)
      : 0;

    res.json({
      totalBookings,
      monthlyUsage,
      topEmployees,
      popularCategories,
      creditUtilization
    });
  } catch (err) {
    console.error("[CORPORATE STATS] Error:", err);
    res.status(500).json({ success: false, error: "讀取統計失敗" });
  }
});

module.exports = router;
