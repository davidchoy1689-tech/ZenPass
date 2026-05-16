/**
 * ZenPass 禪流 - 教練收入路由
 * 自動計算收入、佣金管理、提現申請
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireCoach } = require("../middleware/auth");

const { sendNotification } = require("../services/notification");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/coach/earnings — 收入摘要 =====
router.get("/earnings", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 本月收入
    const now = new Date();
    const monthStart =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-01";
    const monthEnd =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-31";

    const monthly = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total FROM coach_earnings
      WHERE coach_id = ? AND date >= ? AND date <= ? AND status != 'cancelled'
    `,
      )
      .get(req.user.id, monthStart, monthEnd);

    // 全部收入
    const total = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total FROM coach_earnings
      WHERE coach_id = ? AND status != 'cancelled'
    `,
      )
      .get(req.user.id);

    // 待結算
    const pending = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total FROM coach_earnings
      WHERE coach_id = ? AND status = 'pending'
    `,
      )
      .get(req.user.id);

    // 已提現
    const paid = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total FROM coach_earnings
      WHERE coach_id = ? AND status = 'paid'
    `,
      )
      .get(req.user.id);

    // 本週課程數
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const ws = weekStart.toISOString().split("T")[0];

    const weekClasses = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      WHERE c.coach_id = ? AND cs.start_time >= ?
    `,
      )
      .get(req.user.id, ws);

    // 每月收入趨勢 (近6個月)
    const monthlyTrend = db
      .prepare(
        `
      SELECT strftime('%Y-%m', date) as month, SUM(net_amount) as total
      FROM coach_earnings
      WHERE coach_id = ? AND date >= date('now', '-6 months') AND status != 'cancelled'
      GROUP BY month ORDER BY month
    `,
      )
      .all(req.user.id);

    // 用戶資訊 (commission)
    const user = db
      .prepare(
        "SELECT commission_rate, total_earnings, pending_payout FROM users WHERE id = ?",
      )
      .get(req.user.id);

    db.close();

    res.json({
      summary: {
        monthly: monthly.total,
        total: total.total,
        pending: pending.total,
        paid: paid.total,
        week_classes: weekClasses.count,
      },
      monthly_trend: monthlyTrend,
      commission_rate: user ? user.commission_rate : 0.75,
      total_earnings: user ? user.total_earnings : 0,
      pending_payout: user ? user.pending_payout : 0,
    });
  } catch (err) {
    console.error("獲取收入錯誤:", err);
    res.status(500).json({ error: "無法獲取收入資料" });
  }
});

// ===== GET /api/coach/earnings/detail — 收入明細 =====
router.get("/earnings/detail", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const { page = 1, limit = 20, status, start_date, end_date } = req.query;

    let where = "WHERE coach_id = ?";
    const params = [req.user.id];

    if (status) {
      where += " AND status = ?";
      params.push(status);
    }
    if (start_date) {
      where += " AND date >= ?";
      params.push(start_date);
    }
    if (end_date) {
      where += " AND date <= ?";
      params.push(end_date);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const entries = db
      .prepare(
        `
      SELECT * FROM coach_earnings ${where}
      ORDER BY date DESC, created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, parseInt(limit), offset);

    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM coach_earnings ${where}
    `,
      )
      .get(...params);

    db.close();

    res.json({
      entries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
        total_pages: Math.ceil(total.count / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("獲取收入明細錯誤:", err);
    res.status(500).json({ error: "無法獲取收入明細" });
  }
});

// ===== POST /api/coach/earnings/calculate — 自動計算收入 =====
router.post("/earnings/calculate", authenticateToken, async (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Get coach commission rate
    const user = db
      .prepare("SELECT commission_rate FROM users WHERE id = ?")
      .get(req.user.id);
    const commissionRate = user ? user.commission_rate : 0.75;

    // Get all schedules with class info that haven't been calculated yet
    const schedules = db
      .prepare(
        `
      SELECT cs.id as schedule_id, cs.class_id, cs.enrolled_count, cs.start_time,
             c.title as class_title, c.price_hkd, c.coach_id
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      WHERE c.coach_id = ? AND cs.enrolled_count > 0
    `,
      )
      .all(req.user.id);

    const insertEarning = db.prepare(`
      INSERT OR IGNORE INTO coach_earnings 
        (id, coach_id, schedule_id, class_id, class_title, date, enrolled_count, 
         unit_price, gross_amount, commission_rate, net_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    // Also get the class-level enrolled count from attendance
    const existingCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM coach_earnings WHERE coach_id = ?
    `,
      )
      .get(req.user.id);

    let calculated = 0;
    const transaction = db.transaction(() => {
      for (const s of schedules) {
        // Check if already exists
        const exists = db
          .prepare("SELECT id FROM coach_earnings WHERE schedule_id = ?")
          .get(s.schedule_id);
        if (exists) continue;

        const date = s.start_time.split("T")[0];
        const gross = s.enrolled_count * s.price_hkd;
        const net = gross * commissionRate;

        insertEarning.run(
          uuidv4(),
          s.coach_id,
          s.schedule_id,
          s.class_id,
          s.class_title,
          date,
          s.enrolled_count,
          s.price_hkd,
          gross,
          commissionRate,
          net,
        );
        calculated++;
      }

      // Update user totals
      const totals = db
        .prepare(
          `
        SELECT COALESCE(SUM(net_amount), 0) as total, 
               COALESCE(SUM(CASE WHEN status = 'pending' THEN net_amount ELSE 0 END), 0) as pending
        FROM coach_earnings WHERE coach_id = ? AND status != 'cancelled'
      `,
        )
        .get(req.user.id);

      db.prepare(
        "UPDATE users SET total_earnings = ?, pending_payout = ? WHERE id = ?",
      ).run(totals.total, totals.pending, req.user.id);
    });

    transaction();

    db.close();
    res.json({
      message:
        calculated > 0 ? `已自動計算 ${calculated} 筆收入` : "收入資料已是最新",
      calculated,
    });
  } catch (err) {
    console.error("計算收入錯誤:", err);
    res.status(500).json({ error: "無法計算收入" });
  }
});

// ===== POST /api/coach/payout-request — 提現申請 =====
router.post("/payout-request", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const {
      amount,
      payment_method,
      bank_name,
      bank_account,
      bank_code,
      fps_phone,
      payme_phone,
    } = req.body;

    if (!amount || amount <= 0) {
      db.close();
      return res.status(400).json({ error: "請輸入有效金額" });
    }

    if (amount < 100) {
      db.close();
      return res.status(400).json({ error: "最低提現金額為 HK$100" });
    }

    // Check available balance
    const pending = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total FROM coach_earnings
      WHERE coach_id = ? AND status = 'pending'
    `,
      )
      .get(req.user.id);

    if (pending.total < amount) {
      db.close();
      return res.status(400).json({
        error: "可提現餘額不足",
        available: pending.total,
        requested: amount,
      });
    }

    // Select oldest pending earnings to mark for payout
    const earnings = db
      .prepare(
        `
      SELECT id, net_amount FROM coach_earnings
      WHERE coach_id = ? AND status = 'pending'
      ORDER BY date ASC
    `,
      )
      .all(req.user.id);

    const payoutId = uuidv4();
    const poRef =
      "PO-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase();
    const fee = Math.max(0, amount * 0.01); // 1% processing fee
    const netPayout = amount - fee;

    db.prepare(
      `
      INSERT INTO coach_payouts (id, payout_reference, coach_id, amount, fee, net_amount, payment_method,
        bank_name, bank_account, bank_code, fps_phone, payme_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      payoutId,
      poRef,
      req.user.id,
      amount,
      fee,
      netPayout,
      payment_method || "bank",
      bank_name || null,
      bank_account || null,
      bank_code || null,
      fps_phone || null,
      payme_phone || null,
    );

    // Mark earnings as paid
    let remaining = amount;
    for (const e of earnings) {
      if (remaining <= 0) break;
      const toMark = Math.min(e.net_amount, remaining);
      db.prepare(
        "UPDATE coach_earnings SET status = ?, payout_id = ? WHERE id = ?",
      ).run("paid", payoutId, e.id);
      remaining -= toMark;
    }

    // Update user pending_payout
    const newPending = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total FROM coach_earnings
      WHERE coach_id = ? AND status = 'pending'
    `,
      )
      .get(req.user.id);

    db.prepare("UPDATE users SET pending_payout = ? WHERE id = ?").run(
      newPending.total,
      req.user.id,
    );

    db.close();
    res.status(201).json({
      message: "提現申請已提交",
      payout_id: payoutId,
      amount: amount,
      fee: fee,
      net_amount: netPayout,
      status: "pending",
    });
  } catch (err) {
    console.error("提現申請錯誤:", err);
    res.status(500).json({ error: "提現申請失敗" });
  }
});

// ===== GET /api/coach/payout-history — 提現記錄 =====
router.get("/payout-history", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const payouts = db
      .prepare(
        `
      SELECT * FROM coach_payouts
      WHERE coach_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `,
      )
      .all(req.user.id);

    db.close();
    res.json({ payouts });
  } catch (err) {
    console.error("獲取提現記錄錯誤:", err);
    res.status(500).json({ error: "無法獲取提現記錄" });
  }
});

// ===== Admin: GET /api/admin/coach-earnings — 管理員查看所有教練收入 =====
router.get("/admin/all-earnings", authenticateToken, (req, res) => {
  try {
    // Admin check
    const user = new Database(DB_PATH)
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(req.user.id);
    if (!user || user.email !== "david@zenpass.hk") {
      return res.status(403).json({ error: "僅管理員可查看" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const list = db
      .prepare(
        `
      SELECT ce.*, u.name as coach_name, u.email as coach_email
      FROM coach_earnings ce
      JOIN users u ON ce.coach_id = u.id
      ORDER BY ce.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(parseInt(limit), offset);

    const total = db
      .prepare("SELECT COUNT(*) as count FROM coach_earnings")
      .get();

    const summary = db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'pending' THEN net_amount ELSE 0 END), 0) as pending_total,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN net_amount ELSE 0 END), 0) as paid_total,
        COUNT(DISTINCT coach_id) as active_coaches
      FROM coach_earnings WHERE status != 'cancelled'
    `,
      )
      .get();

    db.close();
    res.json({
      list,
      summary,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "無法獲取收入資料" });
  }
});

// ===== Admin: POST /api/coach/payout-process — 管理員處理提現 =====
router.post("/payout-process", authenticateToken, (req, res) => {
  try {
    const { payout_id, action, notes } = req.body;
    if (!payout_id || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "無效的操作" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const payout = db
      .prepare("SELECT * FROM coach_payouts WHERE id = ?")
      .get(payout_id);
    if (!payout || payout.status !== "pending") {
      db.close();
      return res.status(400).json({ error: "提現記錄不存在或已處理" });
    }

    if (action === "approve") {
      db.prepare(
        `UPDATE coach_payouts SET status = 'processing', processed_by = ?, processed_at = datetime('now'), notes = ? WHERE id = ?`,
      ).run(req.user.id, notes || null, payout_id);
    } else {
      // Reject — return earnings to pending
      db.prepare(
        `UPDATE coach_payouts SET status = 'rejected', processed_by = ?, processed_at = datetime('now'), notes = ? WHERE id = ?`,
      ).run(req.user.id, notes || null, payout_id);
      db.prepare(
        `UPDATE coach_earnings SET status = 'pending', payout_id = NULL WHERE payout_id = ?`,
      ).run(payout_id);
    }

    // 🔔 通知教練：提現處理結果
    try {
      sendNotification("coach.payout_processed", {
        recipient: payout.coach_id,
        data: {
          amount: payout.amount,
          status: action === "approve" ? "approved" : "rejected",
          reason:
            notes || (action === "approve" ? "管理員已處理" : "提現申請未獲批"),
          eta: action === "approve" ? "3-5 個工作日" : null,
        },
      });
    } catch (notifErr) {
      console.error("⚠️ 發送提現通知失敗:", notifErr.message);
    }

    db.close();
    res.json({ message: action === "approve" ? "提現已批准" : "提現已駁回" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "處理失敗" });
  }
});

// ===== Private Income (教練私人收入) =====

// POST /api/coach/private-income — 新增私人收入
router.post("/private-income", authenticateToken, (req, res) => {
  try {
    const {
      date,
      description,
      amount,
      category,
      client_name,
      client_phone,
      notes,
    } = req.body;
    if (!date || !description || !amount) {
      return res.status(400).json({ error: "請填寫日期、描述和金額" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const id = uuidv4();
    db.prepare(
      `
      INSERT INTO private_income (id, coach_id, date, description, amount, category, client_name, client_phone, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      req.user.id,
      date,
      description,
      amount,
      category || "其他",
      client_name || null,
      client_phone || null,
      notes || null,
    );

    db.close();
    res.status(201).json({ message: "私人收入已記錄", id });
  } catch (err) {
    console.error("新增私人收入錯誤:", err);
    res.status(500).json({ error: "無法記錄收入" });
  }
});

// GET /api/coach/private-income — 獲取私人收入列表
router.get("/private-income", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const { page = 1, limit = 50, start_date, end_date, category } = req.query;

    let where = "WHERE coach_id = ?";
    const params = [req.user.id];
    if (start_date) {
      where += " AND date >= ?";
      params.push(start_date);
    }
    if (end_date) {
      where += " AND date <= ?";
      params.push(end_date);
    }
    if (category) {
      where += " AND category = ?";
      params.push(category);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const entries = db
      .prepare(
        `SELECT * FROM private_income ${where} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, parseInt(limit), offset);
    const total = db
      .prepare(`SELECT COUNT(*) as count FROM private_income ${where}`)
      .get(...params);
    const totalAmount = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM private_income ${where}`,
      )
      .get(...params);

    db.close();
    res.json({
      entries,
      total_amount: totalAmount.total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
      },
    });
  } catch (err) {
    console.error("獲取私人收入錯誤:", err);
    res.status(500).json({ error: "無法獲取收入列表" });
  }
});

// DELETE /api/coach/private-income/:id — 刪除私人收入
router.delete("/private-income/:id", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const result = db
      .prepare("DELETE FROM private_income WHERE id = ? AND coach_id = ?")
      .run(req.params.id, req.user.id);
    db.close();
    if (result.changes === 0) {
      return res.status(404).json({ error: "記錄不存在" });
    }
    res.json({ message: "已刪除" });
  } catch (err) {
    console.error("刪除私人收入錯誤:", err);
    res.status(500).json({ error: "無法刪除記錄" });
  }
});

// ===== Platform Settlements (Admin: ZenPass → Coach monthly payout) =====

// GET /api/coach/settlements — 獲取月度結算列表 (admin)
router.get("/settlements", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const { year, month, coach_id, status } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    if (year) {
      where += " AND period_year = ?";
      params.push(parseInt(year));
    }
    if (month) {
      where += " AND period_month = ?";
      params.push(parseInt(month));
    }
    if (coach_id) {
      where += " AND coach_id = ?";
      params.push(coach_id);
    }
    if (status) {
      where += " AND status = ?";
      params.push(status);
    }

    const settlements = db
      .prepare(
        `SELECT s.*, u.name as coach_name, u.email as coach_email 
      FROM platform_settlements s
      LEFT JOIN users u ON s.coach_id = u.id
      ${where} ORDER BY s.period_year DESC, s.period_month DESC, s.created_at DESC`,
      )
      .all(...params);

    const summary = db
      .prepare(
        `SELECT 
      COALESCE(SUM(total_revenue), 0) as total_revenue,
      COALESCE(SUM(zenpass_commission), 0) as total_commission,
      COALESCE(SUM(coach_payout), 0) as total_payout,
      COUNT(*) as settlement_count,
      COUNT(DISTINCT coach_id) as coach_count
      FROM platform_settlements ${where}`,
      )
      .get(...params);

    db.close();
    res.json({ settlements, summary });
  } catch (err) {
    console.error("獲取結算錯誤:", err);
    res.status(500).json({ error: "無法獲取結算資料" });
  }
});

// POST /api/coach/settlements/generate — 自動生成月度結算
router.post("/settlements/generate", authenticateToken, (req, res) => {
  try {
    const { year, month } = req.body;
    if (!year || !month) return res.status(400).json({ error: "請提供年月" });

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Get all earnings for the period, grouped by coach
    const monthStart = year + "-" + String(month).padStart(2, "0") + "-01";
    const monthEnd = year + "-" + String(month).padStart(2, "0") + "-31";

    const earnings = db
      .prepare(
        `
      SELECT ce.coach_id, u.name as coach_name,
        SUM(ce.gross_amount) as total_revenue,
        SUM(ce.net_amount) as coach_payout,
        COUNT(*) as class_count,
        SUM(ce.enrolled_count) as student_count
      FROM coach_earnings ce
      JOIN users u ON ce.coach_id = u.id
      WHERE ce.date >= ? AND ce.date <= ? AND ce.status != 'cancelled'
      GROUP BY ce.coach_id
    `,
      )
      .all(monthStart, monthEnd);

    if (earnings.length === 0) {
      db.close();
      return res.json({ message: "該月份暫無收入資料", count: 0 });
    }

    const insertSettlement = db.prepare(`
      INSERT OR REPLACE INTO platform_settlements 
        (id, coach_id, coach_name, period_year, period_month, total_revenue, 
         zenpass_commission, coach_payout, class_count, student_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const { v4: uuidv4 } = require("uuid");
    let count = 0;
    const transaction = db.transaction(() => {
      for (const e of earnings) {
        const commission = e.total_revenue - e.coach_payout;
        insertSettlement.run(
          uuidv4(),
          e.coach_id,
          e.coach_name,
          year,
          month,
          e.total_revenue || 0,
          commission,
          e.coach_payout || 0,
          e.class_count || 0,
          e.student_count || 0,
        );
        count++;
      }
    });
    transaction();

    db.close();
    res.json({ message: `已生成 ${count} 筆結算記錄`, count });
  } catch (err) {
    console.error("生成結算錯誤:", err);
    res.status(500).json({ error: "無法生成結算" });
  }
});

// POST /api/coach/settlements/:id/pay — 標記為已付款
router.post("/settlements/:id/pay", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.prepare(
      `UPDATE platform_settlements SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).run(req.params.id);
    db.close();
    res.json({ message: "已標記為已付款" });
  } catch (err) {
    console.error("付款標記錯誤:", err);
    res.status(500).json({ error: "無法更新狀態" });
  }
});

// ===== Platform Settings (Admin configurable) =====

// GET /api/coach/settings — 獲取所有設定
router.get("/settings", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const settings = db
      .prepare("SELECT * FROM platform_settings ORDER BY key")
      .all();
    db.close();
    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "無法獲取設定" });
  }
});

// GET /api/coach/settings/:key — 獲取單個設定
router.get("/settings/:key", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const setting = db
      .prepare("SELECT * FROM platform_settings WHERE key = ?")
      .get(req.params.key);
    db.close();
    if (!setting) return res.status(404).json({ error: "設定不存在" });
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: "無法獲取設定" });
  }
});

// PUT /api/coach/settings/:key — 更新設定
router.put("/settings/:key", authenticateToken, (req, res) => {
  try {
    const { value, description } = req.body;
    if (value === undefined)
      return res.status(400).json({ error: "請提供 value" });

    const db = new Database(DB_PATH);
    const existing = db
      .prepare("SELECT * FROM platform_settings WHERE key = ?")
      .get(req.params.key);
    if (!existing) {
      db.prepare(
        "INSERT INTO platform_settings (key, value, description) VALUES (?, ?, ?)",
      ).run(req.params.key, String(value), description || null);
    } else {
      db.prepare(
        "UPDATE platform_settings SET value = ?, description = COALESCE(?, description), updated_at = datetime('now') WHERE key = ?",
      ).run(String(value), description || null, req.params.key);
    }
    db.close();
    res.json({
      message: "設定已更新",
      key: req.params.key,
      value: String(value),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "無法更新設定" });
  }
});

// GET /api/coach/settings/effective-rate — 取得當前有效佣金率（前端用）
router.get("/settings/effective-rate", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const rate = db
      .prepare(
        "SELECT value FROM platform_settings WHERE key = 'coach_commission_rate'",
      )
      .get();
    db.close();
    res.json({
      coach_rate: parseFloat(rate ? rate.value : 0.75),
      zenpass_rate: 1 - parseFloat(rate ? rate.value : 0.75),
    });
  } catch (err) {
    res.status(500).json({ error: "無法獲取佣金率" });
  }
});

/**
 * syncCoachEarningsForSchedule - 當 booking confirmed 時自動更新教練收入
 * 公式：net = unit_price × enrolled_count × commission_rate
 */
function syncCoachEarningsForSchedule(scheduleId) {
  const db = new Database(DB_PATH);
  try {
    db.pragma("foreign_keys = ON");

    // Get schedule info + class price + coach commission rate
    const info = db
      .prepare(
        `
      SELECT 
        cs.id as schedule_id, cs.class_id, cs.start_time,
        c.title as class_title, c.price_hkd, c.coach_id,
        u.commission_rate
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      JOIN users u ON c.coach_id = u.id
      WHERE cs.id = ?
    `,
      )
      .get(scheduleId);

    if (!info) return { error: "Schedule not found" };

    // Count confirmed bookings
    const countRow = db
      .prepare(
        `
      SELECT COUNT(*) as cnt FROM bookings 
      WHERE schedule_id = ? AND status IN ('confirmed', 'attended')
    `,
      )
      .get(scheduleId);

    const enrolled = countRow.cnt;
    const gross = info.price_hkd * enrolled;
    const net = Math.round(gross * info.commission_rate * 100) / 100;

    // Upsert coach_earnings
    const existing = db
      .prepare("SELECT id FROM coach_earnings WHERE schedule_id = ?")
      .get(scheduleId);

    if (existing) {
      db.prepare(
        `
        UPDATE coach_earnings SET 
          enrolled_count = ?, gross_amount = ?, net_amount = ?, 
          status = CASE WHEN ? > 0 THEN 'approved' ELSE 'cancelled' END,
          updated_at = datetime('now')
        WHERE schedule_id = ?
      `,
      ).run(enrolled, gross, net, enrolled, scheduleId);
    } else if (enrolled > 0) {
      const { v4: uuidv4 } = require("uuid");
      const date = (info.start_time || "").split("T")[0];
      db.prepare(
        `
        INSERT INTO coach_earnings 
          (id, coach_id, schedule_id, class_id, class_title, date, enrolled_count,
           unit_price, gross_amount, commission_rate, net_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
      `,
      ).run(
        uuidv4(),
        info.coach_id,
        info.schedule_id,
        info.class_id,
        info.class_title,
        date,
        enrolled,
        info.price_hkd,
        gross,
        info.commission_rate,
        net,
      );
    }

    // Update user totals
    const totals = db
      .prepare(
        `
      SELECT COALESCE(SUM(net_amount), 0) as total,
             COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN net_amount ELSE 0 END), 0) as pending
      FROM coach_earnings WHERE coach_id = ? AND status != 'cancelled'
    `,
      )
      .get(info.coach_id);

    db.prepare(
      "UPDATE users SET total_earnings = ?, pending_payout = ? WHERE id = ?",
    ).run(totals.total, totals.pending, info.coach_id);

    return { enrolled, gross, net };
  } catch (err) {
    console.error("syncCoachEarningsForSchedule error:", err.message);
    return { error: err.message };
  } finally {
    db.close();
  }
}

// ===== Stripe Connect for Coach Payouts =====
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

// POST /api/coach/payouts/create-account-link — 教練連結 Stripe 帳戶
router.post("/payouts/create-account-link", authenticateToken, async (req, res) => {
  try {
    if (!STRIPE_SECRET || STRIPE_SECRET.startsWith("sk_test_51TTH5l")) {
      return res.status(200).json({
        url: null,
        note: "Stripe Connect not configured. Contact admin to set STRIPE_SECRET_KEY.",
      });
    }
    const stripe = require("stripe")(STRIPE_SECRET);
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT stripe_account_id FROM users WHERE id = ?").get(req.user.id);
    db.close();
    
    let accountId = user?.stripe_account_id;
    if (!accountId) {
      // Create Stripe Connect Express account
      const account = await stripe.accounts.create({
        type: "express",
        country: "HK",
        email: req.user.email,
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;
      const db2 = new Database(DB_PATH);
      db2.prepare("UPDATE users SET stripe_account_id = ? WHERE id = ?").run(accountId, req.user.id);
      db2.close();
    }
    
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${req.protocol}://${req.get("host")}/coach-dashboard.html`,
      return_url: `${req.protocol}://${req.get("host")}/coach-dashboard.html?stripe=connected`,
      type: "account_onboarding",
    });
    
    res.json({ url: link.url });
  } catch (err) {
    console.error("Stripe Connect error:", err.message);
    res.status(500).json({ error: "無法建立 Stripe 連結" });
  }
});

// POST /api/coach/payouts/request — 申請提款
router.post("/payouts/request", authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 50) {
      return res.status(400).json({ error: "最低提款金額為 HK$50" });
    }
    
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT pending_payout, stripe_account_id FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.pending_payout < amount) {
      db.close();
      return res.status(400).json({ error: "可提款金額不足" });
    }
    
    // Deduct pending payout
    db.prepare("UPDATE users SET pending_payout = pending_payout - ? WHERE id = ?").run(amount, req.user.id);
    db.prepare("INSERT INTO coach_payouts (id, coach_id, amount, status) VALUES (?, ?, ?, 'pending')").run(uuidv4(), req.user.id, amount);
    db.close();
    
    // Notify admin
    sendNotification("payout.requested", {
      coach_id: req.user.id,
      amount: amount,
    });
    
    res.json({ message: "✅ 提款申請已提交，待 Admin 確認" });
  } catch (err) {
    console.error("Payout request error:", err.message);
    res.status(500).json({ error: "提款申請失敗" });
  }
});

// GET /api/coach/payouts/history — 提款記錄
router.get("/payouts/history", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const payouts = db.prepare(
      "SELECT * FROM coach_payouts WHERE coach_id = ? ORDER BY created_at DESC LIMIT 20"
    ).all(req.user.id);
    db.close();
    res.json({ payouts });
  } catch (err) {
    res.status(500).json({ error: "無法獲取提款記錄" });
  }
});

module.exports = router;
module.exports.syncCoachEarningsForSchedule = syncCoachEarningsForSchedule;
