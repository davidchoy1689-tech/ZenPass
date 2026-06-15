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
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== Helper: Admin check =====
function isAdmin(userId) {
  const db = new Database(DB_PATH);
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  db.close();
  return u && u.role === "admin";
}

// ===== GET /api/corporate/companies — 企業列表（Admin）=====
router.get("/companies", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const db = new Database(DB_PATH);
    const companies = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM corporate_members cm JOIN users u ON cm.user_id = u.id WHERE cm.company_id = c.id AND u.id IS NOT NULL) as active_employees,
        (SELECT COALESCE(SUM(b.amount), 0) FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id WHERE cm.company_id = c.id AND b.status IN ('confirmed', 'attended')) as total_spent
      FROM corporate_companies c ORDER BY c.created_at DESC
    `).all();
    db.close();
    res.json({ companies });
  } catch (err) {
    console.error("[CORPORATE] List error:", err);
    res.status(500).json({ error: "讀取企業列表失敗" });
  }
});

// ===== POST /api/corporate/companies — 建立企業帳戶 =====
router.post("/companies", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const { name, contact_name, contact_email, contact_phone, credit_pool, billing_cycle } = req.body;
    if (!name) return res.status(400).json({ error: "請輸入企業名稱" });

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    const id = uuidv4();
    db.prepare(`
      INSERT INTO corporate_companies (id, name, contact_name, contact_email, contact_phone, credit_pool, credit_used, billing_cycle, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', datetime('now'))
    `).run(id, name, contact_name || "", contact_email || "", contact_phone || "", credit_pool || 0, billing_cycle || "monthly");
    db.close();
    res.json({ id, message: `✅ 企業「${name}」已建立` });
  } catch (err) {
    console.error("[CORPORATE] Create error:", err);
    res.status(500).json({ error: "建立企業失敗" });
  }
});

// ===== POST /api/corporate/companies/:id/topup — 加值 Credit Pool =====
router.post("/companies/:id/topup", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const { credits } = req.body;
    if (!credits || credits <= 0) return res.status(400).json({ error: "請輸入有效數量" });

    const db = new Database(DB_PATH);
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ?").get(req.params.id);
    if (!company) { db.close(); return res.status(404).json({ error: "企業不存在" }); }

    db.prepare("UPDATE corporate_companies SET credit_pool = credit_pool + ?, updated_at = datetime('now') WHERE id = ?")
      .run(credits, req.params.id);
    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, user_id, details, created_at)
      VALUES (?, 'corporate.topup', 'corporate_company', ?, ?, ?, datetime('now'))
    `).run(uuidv4(), req.params.id, req.user.id, JSON.stringify({ credits_added: credits, new_pool: company.credit_pool + credits }));

    db.close();
    res.json({ message: `✅ 已加值 ${credits} Credits（總餘額：${company.credit_pool + credits}）` });
  } catch (err) {
    console.error("[CORPORATE] Topup error:", err);
    res.status(500).json({ error: "加值失敗" });
  }
});

// ===== POST /api/corporate/companies/:id/employees — 批量新增員工 =====
router.post("/companies/:id/employees", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const { employees } = req.body; // [{name, email, phone}]
    if (!employees || !Array.isArray(employees) || employees.length === 0)
      return res.status(400).json({ error: "請提供員工列表" });

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ? AND status = 'active'").get(req.params.id);
    if (!company) { db.close(); return res.status(404).json({ error: "企業不存在或已停用" }); }

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
          INSERT INTO users (id, name, email, password_hash, role, status, credits, created_at)
          VALUES (?, ?, ?, ?, 'user', 'active', 0, datetime('now'))
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

      created.push({ email: emp.email, name: emp.name, user_id: user.id, new_account: user.new, temp_password: user.temp_password });
    }

    db.close();
    res.json({ created: created.length, employees: created });
  } catch (err) {
    console.error("[CORPORATE] Add employees error:", err);
    res.status(500).json({ error: "新增員工失敗" });
  }
});

// ===== GET /api/corporate/companies/:id — 企業詳情 + 用量報表 =====
router.get("/companies/:id", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const db = new Database(DB_PATH);
    const company = db.prepare("SELECT * FROM corporate_companies WHERE id = ?").get(req.params.id);
    if (!company) { db.close(); return res.status(404).json({ error: "企業不存在" }); }

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

    db.close();
    res.json({ company, employees, usage, total_employees: employees.length });
  } catch (err) {
    console.error("[CORPORATE] Detail error:", err);
    res.status(500).json({ error: "讀取企業詳情失敗" });
  }
});

// ===== PATCH /api/corporate/companies/:id — 更新企業資料 =====
router.patch("/companies/:id", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const fields = ["name", "contact_name", "contact_email", "contact_phone", "billing_cycle", "status"];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (updates.length === 0) return res.status(400).json({ error: "冇嘢要更新" });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    const db = new Database(DB_PATH);
    db.prepare(`UPDATE corporate_companies SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    db.close();
    res.json({ message: "✅ 已更新" });
  } catch (err) {
    console.error("[CORPORATE] Update error:", err);
    res.status(500).json({ error: "更新失敗" });
  }
});

// ===== GET /api/corporate/report — 企業收入報表 =====
router.get("/report", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const db = new Database(DB_PATH);
    const report = db.prepare(`
      SELECT c.id, c.name, c.credit_pool, c.credit_used, c.status,
        (SELECT COUNT(*) FROM corporate_members WHERE company_id = c.id AND status = 'active') as employees,
        (SELECT COALESCE(SUM(b.amount), 0) FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id WHERE cm.company_id = c.id AND b.status IN ('confirmed', 'attended') AND b.created_at >= datetime('now', '-30 days')) as revenue_30d,
        (SELECT COALESCE(SUM(b.amount), 0) FROM corporate_members cm JOIN bookings b ON cm.user_id = b.user_id WHERE cm.company_id = c.id AND b.status IN ('confirmed', 'attended')) as total_revenue
      FROM corporate_companies c ORDER BY total_revenue DESC
    `).all();
    db.close();
    res.json({ report });
  } catch (err) {
    console.error("[CORPORATE] Report error:", err);
    res.status(500).json({ error: "讀取報表失敗" });
  }
});



// ===== GET /api/corporate/my-company — 員工查詢所屬企業資料 =====
router.get("/my-company", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
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
    db.close();
    if (!company) return res.status(404).json({ error: "你未加入任何企業" });
    res.json(company);
  } catch (err) {
    console.error("[CORPORATE] my-company error:", err);
    res.status(500).json({ error: "讀取企業資料失敗" });
  }
});

// ===== PATCH /api/corporate/members/:memberId/limit — 設定員工月度上限 =====
router.patch("/members/:memberId/limit", authenticateToken, (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "只限管理員" });
  try {
    const { monthly_credit_limit } = req.body;
    if (monthly_credit_limit === undefined || monthly_credit_limit < 0) {
      return res.status(400).json({ error: "請輸入有效上限" });
    }
    const db = new Database(DB_PATH);
    db.prepare("UPDATE corporate_members SET monthly_credit_limit = ?, updated_at = datetime('now') WHERE id = ?")
      .run(monthly_credit_limit, req.params.memberId);
    db.close();
    res.json({ message: "✅ 已更新員工月度上限" });
  } catch (err) {
    console.error("[CORPORATE] Set limit error:", err);
    res.status(500).json({ error: "更新上限失敗" });
  }
});

// ===== GET /api/corporate/my/hr-dashboard — 企業 HR 儀錶板（員工自助）=====
router.get("/my/hr-dashboard", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
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
      if (!member) { db.close(); return res.status(403).json({ error: "你不是企業員工" }); }
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

    db.close();

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
    res.status(500).json({ error: "讀取儀錶板資料失敗" });
  }
});

// ===== GET /api/corporate/my/employee/:userId — 員工詳細用量 =====
router.get("/my/employee/:userId", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    // Verify the requesting user belongs to a company
    const myMembership = db.prepare(`
      SELECT cm.*, cc.name as company_name FROM corporate_members cm
      JOIN corporate_companies cc ON cm.company_id = cc.id
      WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'
    `).get(req.user.id);

    if (!myMembership) { db.close(); return res.status(403).json({ error: "你不是企業員工" }); }

    // Target employee must be in the same company
    const targetMember = db.prepare(`
      SELECT cm.* FROM corporate_members cm
      WHERE cm.user_id = ? AND cm.company_id = ? AND cm.status = 'active'
    `).get(req.params.userId, myMembership.company_id);

    if (!targetMember) { db.close(); return res.status(403).json({ error: "無權限" }); }

    const user = db.prepare("SELECT id, name, email, credits, created_at, last_visit FROM users WHERE id = ?").get(req.params.userId);
    const bookings = db.prepare(`
      SELECT b.*, c.title as class_title, c.venue_name, cs.start_time
      FROM bookings b JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 50
    `).all(req.params.userId);

    db.close();
    res.json({
      user,
      bookings,
      monthly_limit: targetMember.monthly_credit_limit,
      monthly_used: targetMember.monthly_credit_used
    });
  } catch (err) {
    console.error("[HR EMPLOYEE] Error:", err);
    res.status(500).json({ error: "讀取員工資料失敗" });
  }
});

// ===== POST /api/corporate/my/invite — HR 自助邀請新員工 =====
router.post("/my/invite", authenticateToken, (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) return res.status(400).json({ error: "請提供員工電郵及名稱" });

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Verify the requesting user belongs to a company
    const myCompany = db.prepare(`
      SELECT cc.* FROM corporate_members cm
      JOIN corporate_companies cc ON cm.company_id = cc.id
      WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'
    `).get(req.user.id);

    if (!myCompany) { db.close(); return res.status(403).json({ error: "你不是企業員工" }); }

    // Check existing user
    let user = db.prepare("SELECT id, name, email FROM users WHERE email = ?").get(email);
    if (!user) {
      const userId = uuidv4();
      const bcryptjs = require("bcryptjs");
      const tempPass = "zp" + Math.random().toString(36).substring(2, 10) + "!";
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, status, credits, created_at)
        VALUES (?, ?, ?, ?, 'user', 'active', 0, datetime('now'))
      `).run(userId, name, email, bcryptjs.hashSync(tempPass, 10));
      user = { id: userId, temp_password: tempPass, new: true };
    } else {
      user.new = false;
    }

    // Check if already member
    const existing = db.prepare("SELECT id FROM corporate_members WHERE company_id = ? AND user_id = ?")
      .get(myCompany.id, user.id);
    if (existing) { db.close(); return res.json({ message: "該員工已在公司內" }); }

    db.prepare("INSERT INTO corporate_members (id, company_id, user_id, status, created_at) VALUES (?, ?, ?, 'active', datetime('now'))")
      .run(uuidv4(), myCompany.id, user.id);

    db.close();
    res.json({
      message: user.new
        ? `✅ ${name} 已加入！臨時密碼：${user.temp_password}（請即修改）`
        : `✅ ${name} 已加入公司！`,
      user: { email, name, new_account: user.new }
    });
  } catch (err) {
    console.error("[HR INVITE] Error:", err);
    res.status(500).json({ error: "邀請失敗" });
  }
});

module.exports = router;
