/**
 * ZenPass 禪流 - 教練收入路由
 * 自動計算收入、佣金管理、提現申請
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const {
  authenticateToken,
  requireCoach,
  requireAdmin,
  requirePermission,
} = require("../middleware/auth");

const { sendNotification } = require("../services/notification");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// ===== GET /api/coach/earnings — 收入摘要 =====
router.get("/earnings", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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
      WHERE COALESCE(cs.coach_override_id, c.coach_id) = ? AND cs.start_time >= ?
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

    // 工單十六：本月跨界被動分佣 / 私域補足
    let affiliate = { affiliate_passive_cents: 0, affiliate_students_count: 0, own_student_uplift_cents: 0 };
    try {
      const aff = require("../services/coach-affiliate").monthSummary(
        db,
        req.user.id,
        monthStart.slice(0, 7),
      );
      affiliate = aff;
    } catch (e) {}

    res.json({
      summary: {
        monthly: monthly.total,
        total: total.total,
        pending: pending.total,
        paid: paid.total,
        week_classes: weekClasses.count,
        affiliate_passive: affiliate.affiliate_passive_cents / 100,
        affiliate_passive_cents: affiliate.affiliate_passive_cents,
        affiliate_students_count: affiliate.affiliate_students_count,
        own_student_uplift_cents: affiliate.own_student_uplift_cents,
        total_payout_cents:
          Math.round((monthly.total || 0) * 100) + affiliate.affiliate_passive_cents + affiliate.own_student_uplift_cents,
      },
      monthly_trend: monthlyTrend,
      commission_rate: user ? user.commission_rate : 0.8,
      total_earnings: user ? user.total_earnings : 0,
      pending_payout: user ? user.pending_payout : 0,
    });
  } catch (err) {
    console.error("獲取收入錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取收入資料" });
  }
});

// ===== GET /api/coach/earnings/detail — 收入明細 =====
router.get("/earnings/detail", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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
    res.status(500).json({ success: false, error: "無法獲取收入明細" });
  }
});

// ===== POST /api/coach/earnings/calculate — 自動計算收入 =====
router.post("/earnings/calculate", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Get coach commission rate
    const user = db
      .prepare("SELECT commission_rate FROM users WHERE id = ?")
      .get(req.user.id);
    const commissionRate = user ? user.commission_rate : 0.8;

    // Get all schedules with class info that haven't been calculated yet
    const schedules = db
      .prepare(
        `
      SELECT cs.id as schedule_id, cs.class_id, cs.enrolled_count, cs.start_time,
             c.title as class_title, c.price_hkd, c.coach_id
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id
      WHERE COALESCE(cs.coach_override_id, c.coach_id) = ? AND cs.enrolled_count > 0
        AND COALESCE(pv.is_sandbox,0) = 0
        AND datetime(cs.start_time) < datetime('now')  -- 🔒 2026-10-19：未上堂唔可以預先計收入
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
        // Phase 4.5：多教練分帳 → 只查自己嘅 primary 記錄（避免覆蓋助教）
        const exists = db
          .prepare(
            "SELECT id FROM coach_earnings WHERE schedule_id = ? AND coach_id = ? AND COALESCE(earning_type,'primary') = 'primary'",
          )
          .get(s.schedule_id, s.coach_id);
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

      db.prepare("UPDATE users SET total_earnings = ? WHERE id = ?").run(
        totals.total,
        req.user.id,
      );
      db.prepare(
        "UPDATE users SET pending_payout = COALESCE(wallet_balance, 0) WHERE id = ?",
      ).run(req.user.id);
    });

    transaction();

    // ⛓️ 區塊鏈：記錄收入計算
    if (calculated > 0) {
      try {
        writeBlock({
          entityType: "coach_earning",
          entityId: `batch-${req.user.id}-${Date.now()}`,
          data: {
            coach_id: req.user.id,
            batch_calculated: calculated,
            status: "calculated",
          },
        });
      } catch (bcErr) {
        console.error("⚠️ Blockchain write failed (earnings calculate):", bcErr.message);
      }
    }

    res.json({
      message:
        calculated > 0 ? `已自動計算 ${calculated} 筆收入` : "收入資料已是最新",
      calculated,
    });
  } catch (err) {
    console.error("計算收入錯誤:", err);
    res.status(500).json({ success: false, error: "無法計算收入" });
  }
});

// ===== POST /api/coach/payout-request — 提現申請 =====
router.post("/payout-request", authenticateToken, (req, res) => {
  // 🚫 安全（2026-10-19）：呢條舊 route 冇預留錢包（wallet_balance 唔扣），
  // 亦會將 earning 標 paid（部份金額時更會標多過實付）→ 可重複提款／被拒時憑空退款。
  // 統一路線：POST /api/coach/payouts/request（會 reservePayout）
  return res.status(403).json({
    success: false,
    code: "USE_PAYOUTS_REQUEST",
    error: "請用新版提款申請（/api/coach/payouts/request）。",
  });
  /* eslint-disable no-unreachable */
  try {
    const db = getDb();
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

      return res.status(400).json({ success: false, error: "請輸入有效金額" });
    }

    if (amount < 100) {

      return res.status(400).json({ success: false, error: "最低提現金額為 HK$100" });
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

    // pending_payout 只作 wallet_balance 鏡像
    db.prepare(
      "UPDATE users SET pending_payout = COALESCE(wallet_balance, 0) WHERE id = ?",
    ).run(req.user.id);

    // ⛓️ 區塊鏈：記錄提現申請
    try {
      writeBlock({
        entityType: "coach_earning",
        entityId: payoutId,
        data: {
          coach_id: req.user.id,
          amount,
          fee,
          net_amount: netPayout,
          payout_reference: poRef,
          status: "pending",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (payout request):", bcErr.message);
    }

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
    res.status(500).json({ success: false, error: "提現申請失敗" });
  }
});

// ===== GET /api/coach/payout-history — 提現記錄 =====
router.get("/payout-history", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

    res.json({ payouts });
  } catch (err) {
    console.error("獲取提現記錄錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取提現記錄" });
  }
});

// ===== Admin: GET /api/admin/coach-earnings — 管理員查看所有教練收入 =====
router.get("/admin/all-earnings", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
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
    res.status(500).json({ success: false, error: "無法獲取收入資料" });
  }
});

// ===== Admin: POST /api/coach/payout-process — 管理員處理提現 =====
router.post("/payout-process", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { payout_id, action, notes } = req.body;
    if (!payout_id || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, error: "無效的操作" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    const payout = db
      .prepare("SELECT * FROM coach_payouts WHERE id = ?")
      .get(payout_id);
    if (!payout || payout.status !== "pending") {

      return res.status(400).json({ success: false, error: "提現記錄不存在或已處理" });
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
      // 退回已預留金額
      try {
        const { creditWallet } = require("../services/wallet-service");
        creditWallet({
          userId: payout.coach_id,
          amount: Number(payout.amount) || 0,
          type: "refund",
          description: "提款被拒，金額已退回錢包",
          sourceType: "payout",
          sourceId: payout_id,
        });
      } catch (e) {
        console.error("⚠️ payout refund failed:", e.message);
      }
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

    res.json({ message: action === "approve" ? "提現已批准" : "提現已駁回" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "處理失敗" });
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
      return res.status(400).json({ success: false, error: "請填寫日期、描述和金額" });
    }

    const db = getDb();
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

    // ⛓️ 區塊鏈：記錄私人收入
    try {
      writeBlock({
        entityType: "private_income",
        entityId: id,
        data: {
          income_id: id,
          coach_id: req.user.id,
          date,
          description,
          amount,
          category: category || "其他",
          client_name: client_name || null,
          client_phone: client_phone || null,
          notes: notes || null,
          type: "income",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (private income):", bcErr.message);
    }

    res.status(201).json({ message: "私人收入已記錄", id });
  } catch (err) {
    console.error("新增私人收入錯誤:", err);
    res.status(500).json({ success: false, error: "無法記錄收入" });
  }
});

// GET /api/coach/private-income — 獲取私人收入列表
router.get("/private-income", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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
    res.status(500).json({ success: false, error: "無法獲取收入列表" });
  }
});

// DELETE /api/coach/private-income/:id — 刪除私人收入
router.delete("/private-income/:id", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM private_income WHERE id = ? AND coach_id = ?")
      .run(req.params.id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: "記錄不存在" });
    }
    res.json({ message: "已刪除" });
  } catch (err) {
    console.error("刪除私人收入錯誤:", err);
    res.status(500).json({ success: false, error: "無法刪除記錄" });
  }
});

// ===== Platform Settlements (Admin: ZenPass → Coach monthly payout) =====

// GET /api/coach/settlements — 獲取月度結算列表 (admin / 財務)
// 🔒 2026-10-24：原本任何登入用戶都可以讀晒所有教練嘅收入／佣金／出糧
router.get(
  "/settlements",
  authenticateToken,
  requirePermission("finance.payout.view"),
  (req, res) => {
  try {
    const db = getDb();
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

    res.json({ settlements, summary });
  } catch (err) {
    console.error("獲取結算錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取結算資料" });
  }
  },
);

// POST /api/coach/settlements/generate — 自動生成月度結算
// 🔒 2026-10-24：原本任何登入用戶都可以為所有教練生成結算
router.post(
  "/settlements/generate",
  authenticateToken,
  requirePermission("finance.payout.process"),
  (req, res) => {
  try {
    const { year, month } = req.body;
    if (!year || !month) return res.status(400).json({ success: false, error: "請提供年月" });

    const db = getDb();
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

    res.json({ message: `已生成 ${count} 筆結算記錄`, count });
  } catch (err) {
    console.error("生成結算錯誤:", err);
    res.status(500).json({ success: false, error: "無法生成結算" });
  }
  },
);

// POST /api/coach/settlements/:id/pay — 標記為已付款
// 🔒 2026-10-24：原本任何登入用戶都可以將結算標記為「已付款」（無 audit、無權限）
router.post(
  "/settlements/:id/pay",
  authenticateToken,
  requirePermission("finance.payout.process"),
  (req, res) => {
    try {
      const db = getDb();
      const before = db
        .prepare("SELECT * FROM platform_settlements WHERE id = ?")
        .get(req.params.id);
      if (!before) {
        return res.status(404).json({ success: false, error: "結算記錄不存在" });
      }
      if (before.status === "paid") {
        return res.json({ message: "已標記為已付款", idempotent: true });
      }

      db.prepare(
        `UPDATE platform_settlements SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      ).run(req.params.id);

      try {
        require("../services/audit").audit({
          actionType: "SETTLEMENT_PAID",
          entityType: "platform_settlement",
          entityId: req.params.id,
          userId: req.user.id,
          oldValues: { status: before.status, coach_payout: before.coach_payout },
          newValues: { status: "paid" },
          description: "標記月度結算為已付款",
          ipAddress: req.ip,
        });
      } catch (e) {}

      res.json({ message: "已標記為已付款" });
    } catch (err) {
      console.error("付款標記錯誤:", err);
      res.status(500).json({ success: false, error: "無法更新狀態" });
    }
  },
);

// ===== Platform Settings (Admin configurable) =====

// GET /api/coach/settings — 獲取所有設定
router.get("/settings", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const settings = db
      .prepare("SELECT * FROM platform_settings ORDER BY key")
      .all();

    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "無法獲取設定" });
  }
});

// GET /api/coach/settings/effective-rate — 取得當前有效佣金率（前端用）
router.get("/settings/effective-rate", (req, res) => {
  try {
    const db = getDb();
    const rate = db
      .prepare(
        "SELECT value FROM platform_settings WHERE key = 'coach_commission_rate'",
      )
      .get();

    res.json({
      coach_rate: Math.round(parseFloat(rate ? rate.value : 0.8) * 100) / 100,
      zenpass_rate: Math.round((1 - parseFloat(rate ? rate.value : 0.8)) * 100) / 100,
    });

// GET /api/coach/settings/:key — 獲取單個設定
router.get("/settings/:key", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const setting = db
      .prepare("SELECT * FROM platform_settings WHERE key = ?")
      .get(req.params.key);

    if (!setting) return res.status(404).json({ success: false, error: "設定不存在" });
    res.json(setting);
  } catch (err) {
    res.status(500).json({ success: false, error: "無法獲取設定" });
  }
});

// PUT /api/coach/settings/:key — 更新設定
router.put("/settings/:key", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { value, description } = req.body;
    if (value === undefined)
      return res.status(400).json({ success: false, error: "請提供 value" });

    const db = getDb();
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

    res.json({
      message: "設定已更新",
      key: req.params.key,
      value: String(value),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "無法更新設定" });
  }
});


  } catch (err) {
    res.status(500).json({ success: false, error: "無法獲取佣金率" });
  }
});

/**
 * syncCoachEarningsForSchedule - 當 booking confirmed 時自動更新教練收入
 * 公式：net = unit_price × enrolled_count × commission_rate
 */
function syncCoachEarningsForSchedule(scheduleId) {
  const db = getDb();
  try { require("./merchant").ensureSchema(db); } catch (e) {}
  try { require("./checkin").ensureSchema(db); } catch (e) {}
  // Phase 4.5：確保 earning_type 欄位 + 複合唯一索引存在（多教練分帳）
  try { require("../services/pass-deduction").ensureSchema(db); } catch (e) {}
  try {
    db.pragma("foreign_keys = ON");

    // Get schedule info + class price + coach commission rate
    const info = db
      .prepare(
        `
      SELECT 
        cs.id as schedule_id, cs.class_id, cs.start_time, cs.studio_id,
        c.title as class_title, c.price_hkd, c.coach_id,
        COALESCE(cs.coach_override_id, c.coach_id) as actual_coach_id,
        u.commission_rate
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      JOIN users u ON u.id = COALESCE(cs.coach_override_id, c.coach_id)
      WHERE cs.id = ?
    `,
      )
      .get(scheduleId);

    if (!info) return { error: "Schedule not found" };
    if (info.studio_id) return { skipped: "STUDIO_PENDING_ATTENDANCE", studio_id: info.studio_id };

    // Count confirmed bookings
    // 🛡️ Phase 4.4：no_show 席位照計（教練保底 — 學員爽約不扣導師帶班費）
    const countRow = db
      .prepare(
        `
      SELECT COUNT(*) as cnt FROM bookings 
      WHERE schedule_id = ? AND status IN ('confirmed', 'attended', 'no_show')
    `,
      )
      .get(scheduleId);

    const enrolled = countRow.cnt;
    const gross = info.price_hkd * enrolled;
    const net = Math.round(gross * info.commission_rate * 100) / 100;

    // Upsert coach_earnings
    // Upsert coach_earnings — return the earning id
    // Phase 4.5：複合鍵 (schedule_id, coach_id, earning_type)，避免多教練互相覆蓋
    const existing = db
      .prepare(
        "SELECT id FROM coach_earnings WHERE schedule_id = ? AND coach_id = ? AND COALESCE(earning_type,'primary') = 'primary'",
      )
      .get(scheduleId, info.actual_coach_id);

    let earningId = existing ? existing.id : null;

    if (existing) {
      db.prepare(
        `
        UPDATE coach_earnings SET 
          enrolled_count = ?, gross_amount = ?, net_amount = ?, 
          status = CASE WHEN ? > 0 THEN 'approved' ELSE 'cancelled' END,
          updated_at = datetime('now')
        WHERE schedule_id = ? AND coach_id = ? AND COALESCE(earning_type,'primary') = 'primary'
      `,
      ).run(enrolled, gross, net, enrolled, scheduleId, info.actual_coach_id);
      earningId = existing.id;
    } else if (enrolled > 0) {
      const { v4: uuidv4 } = require("uuid");
      earningId = uuidv4();
      const date = (info.start_time || "").split("T")[0];
      db.prepare(
        `
        INSERT INTO coach_earnings 
          (id, coach_id, schedule_id, class_id, class_title, date, enrolled_count,
           unit_price, gross_amount, commission_rate, net_amount, status, earning_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'primary')
      `,
      ).run(
        earningId,
        info.actual_coach_id,
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
      .get(info.actual_coach_id);

    db.prepare("UPDATE users SET total_earnings = ? WHERE id = ?").run(
      totals.total,
      info.actual_coach_id,
    );
    db.prepare(
      "UPDATE users SET pending_payout = COALESCE(wallet_balance, 0) WHERE id = ?",
    ).run(info.actual_coach_id);

    // Auto-credit wallet if enrolled > 0 and earning was created/updated
    // ⛓️ 區塊鏈：記錄教練收入變更
    try {
      writeBlock({
        entityType: "coach_earning",
        entityId: earningId || scheduleId,
        data: {
          coach_id: info.actual_coach_id,
          schedule_id: info.schedule_id,
          class_title: info.class_title,
          enrolled_count: enrolled,
          gross_amount: gross,
          net_amount: net,
          commission_rate: info.commission_rate,
          status: enrolled > 0 ? "approved" : "cancelled",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (earnings sync):", bcErr.message);
    }

    if (enrolled > 0 && earningId) {
      try {
        const walletService = require("../services/wallet-service");
        const classTime = (info.start_time || "").split("T");
        const desc = `${info.class_title} ${classTime[1] ? classTime[1].slice(0, 5) : ""} - ${classTime[0] || info.start_time}`;
        walletService.creditCoachEarning({
          coachId: info.actual_coach_id,
          scheduleId: info.schedule_id,
          coachEarningId: earningId,
          netAmount: net,
          description: desc,
          bookingId: null,
        });
      } catch (walletErr) {
        console.error(
          "[EARNINGS] Auto-credit wallet failed:",
          walletErr.message,
        );
      }
    }

    // 工單十六：私域 100% 補足 + 跨界 5% 被動回佣（冪等）
    try {
      require("../services/coach-affiliate").settleSchedule(scheduleId);
    } catch (affErr) {
      console.error("[AFFILIATE] settle failed:", affErr.message);
    }

    return { enrolled, gross, net, earningId };
  } catch (err) {
    console.error("syncCoachEarningsForSchedule error:", err.message);
    return { error: err.message };
  } finally {

  }
}

// ===== Stripe Connect for Coach Payouts =====
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

// POST /api/coach/payouts/create-account-link — 教練連結 Stripe 帳戶
router.post(
  "/payouts/create-account-link",
  authenticateToken,
  async (req, res) => {
    try {
      if (!STRIPE_SECRET || STRIPE_SECRET.startsWith("sk_test_51TTH5l")) {
        return res.status(200).json({
          url: null,
          note: "Stripe Connect not configured. Contact admin to set STRIPE_SECRET_KEY.",
        });
      }
      const stripe = require("stripe")(STRIPE_SECRET);
      const db = getDb();
      const user = db
        .prepare("SELECT stripe_account_id FROM users WHERE id = ?")
        .get(req.user.id);

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
        const db = getDb();
        db
          .prepare("UPDATE users SET stripe_account_id = ? WHERE id = ?")
          .run(accountId, req.user.id);

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
      res.status(500).json({ success: false, error: "無法建立 Stripe 連結" });
    }
  },
);

// POST /api/coach/payouts/request — 申請提款
router.post("/payouts/request", authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 50) {
      return res.status(400).json({ success: false, error: "最低提款金額為 HK$50" });
    }

    const db = getDb();
    const user = db
      .prepare(
        "SELECT wallet_balance, pending_payout, stripe_account_id, name, email FROM users WHERE id = ?",
      )
      .get(req.user.id);
    if (!user || (user.wallet_balance || 0) < amount) {
      return res.status(400).json({ success: false, error: "可提款金額不足" });
    }

    // 單一餘額：即時預留（wallet_balance 同 pending_payout 一齊扣）
    const { reservePayout } = require("../services/wallet-service");
    const reserved = reservePayout(req.user.id, Number(amount), "教練提款申請");
    if (!reserved.success) {
      return res.status(400).json({ success: false, error: reserved.error || "預留金額失敗" });
    }

    const payoutId = uuidv4();
    const poRef =
      "PO-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase();
    db.prepare(
      "INSERT INTO coach_payouts (id, payout_reference, coach_id, amount, status) VALUES (?, ?, ?, ?, 'pending')",
    ).run(payoutId, poRef, req.user.id, amount);

    // Notify admins（原本漏了 recipient，通知永遠冇發）
    try {
      const admins = db
        .prepare("SELECT id FROM users WHERE role IN ('admin','super_admin','platform_manager')")
        .all();
      for (const a of admins) {
        sendNotification("payout.requested", {
          recipient: a.id,
          data: { coach_name: (user && (user.name || user.email)) || req.user.id, amount },
        });
      }
    } catch (e) {
      console.error("⚠️ payout notify failed:", e.message);
    }

    res.json({ message: "✅ 提款申請已提交，待 Admin 確認" });
  } catch (err) {
    console.error("Payout request error:", err.message);
    res.status(500).json({ success: false, error: "提款申請失敗" });
  }
});

// GET /api/coach/payouts/history — 提款記錄
router.get("/payouts/history", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const payouts = db
      .prepare(
        "SELECT * FROM coach_payouts WHERE coach_id = ? ORDER BY created_at DESC LIMIT 20",
      )
      .all(req.user.id);

    res.json({ payouts });
  } catch (err) {
    res.status(500).json({ success: false, error: "無法獲取提款記錄" });
  }
});

// ===== P1 工單四：月結 summary + CSV =====
function monthWindow(month) {
  const m = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : new Date().toISOString().slice(0, 7);
  return { month: m };
}

function maskStudentName(n) {
  const s = String(n || "").trim();
  if (!s) return "學員";
  if (s.length <= 1) return s + "*";
  if (s.length === 2) return s[0] + "*";
  return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
}

function buildMonthlyBreakdown(db, coachId, month) {
  const affiliateSvc = require("../services/coach-affiliate");
  try { require("./checkin").ensureSchema(db); } catch (e) {}
  const includeSandbox = process.env.EARNINGS_INCLUDE_SANDBOX === "1" ? 1 : 0;
  try {
    affiliateSvc.ensureSchema(db);
  } catch (e) {}
  const nextPayout = (() => {
    const [y, m] = String(month).split("-").map(Number);
    const py = m === 12 ? y + 1 : y;
    const pm = m === 12 ? 1 : m + 1;
    const d = new Date(Date.UTC(py, pm - 1, 5));
    if (d.getUTCDay() === 6) d.setUTCDate(7);
    else if (d.getUTCDay() === 0) d.setUTCDate(6);
    const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getUTCDay()];
    const iso = d.toISOString().slice(0, 10);
    const label = `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, "0")}月${String(d.getUTCDate()).padStart(2, "0")}日（週${wd}）`;
    return { date: iso, label };
  })();
  const scheds = db
    .prepare(
      `SELECT s.id, s.start_time, s.end_time, s.coach_override_id, c.title, c.venue_name, c.price_hkd
         FROM class_schedules s JOIN classes c ON c.id=s.class_id
         LEFT JOIN partner_venues pv ON pv.id=c.partner_venue_id
        WHERE COALESCE(s.coach_override_id, c.coach_id)=? AND substr(s.start_time,1,7)=? AND COALESCE(s.status,'')<>'cancelled'
          AND (COALESCE(pv.is_sandbox,0)=0 OR ?=1)
          AND (?=1 OR (s.id NOT LIKE 'prodtest-%' AND COALESCE(c.class_reference,'') NOT LIKE 'VERIFIED_TEST%'))
        ORDER BY s.start_time`,
    )
    .all(coachId, month, includeSandbox, includeSandbox);
  const u = db.prepare("SELECT commission_rate FROM users WHERE id=?").get(coachId);
  const rate = u && Number(u.commission_rate) > 0 ? Number(u.commission_rate) : 0.8;
  const countStmt = db.prepare(
    `SELECT COUNT(*) c FROM bookings b LEFT JOIN attendances a ON a.booking_id=b.id
      WHERE b.schedule_id=? AND b.payment_status='paid'
        AND COALESCE(b.fraud_audit_status,'clean') NOT LIKE 'flagged%'
        AND (a.status IN ('present','absent_unexcused','late')
             OR (a.status IS NULL AND b.status IN ('attended','no_show')))`,
  );
  const ceStmt = db.prepare("SELECT status, net_amount FROM coach_earnings WHERE schedule_id=?");
  let totalCents = 0, sessions = 0, students = 0, paidCents = 0, totalMinutes = 0;
  let directCents = 0, upliftCents = 0, ownStudents = 0;
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const hasWalkin = bcols.includes("is_walkin");
  const payStmt = db.prepare(
    `SELECT b.id, b.user_id, b.amount, b.payment_method, b.payment_type,
            ${hasWalkin ? "COALESCE(b.is_walkin,0)" : "0"} AS is_walkin,
            u.name, u.phone, f.origin_coach_id
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN student_coach_affiliations f ON f.student_user_id = b.user_id AND f.status='active'
       LEFT JOIN attendances a ON a.booking_id = b.id
      WHERE b.schedule_id = ? AND b.payment_status='paid'
        AND COALESCE(b.fraud_audit_status,'clean') NOT LIKE 'flagged%'
        AND b.status IN ('confirmed','attended')
        AND (a.status IN ('present','late') OR (a.status IS NULL AND b.status='attended'))
      ORDER BY datetime(b.created_at)`,
  );
  const paymentRows = [];
  let cashCollectedCents = 0, cashCount = 0, fpsCount = 0;
  const hktDate = (t) => {
    const d = new Date(String(t || "").replace(" ", "T"));
    return isNaN(d) ? String(t || "").slice(0, 10) : d.toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" });
  };
  const rows = scheds.map((s) => {
    const attended = Number(countStmt.get(s.id).c) || 0;
    const unitCents = Math.round(Number(s.price_hkd || 0) * 100);
    const payoutCents = Math.round(unitCents * rate) * attended;
    const ownCount = Number(affiliateSvc.ownStudentAttended(db, s.id, coachId)) || 0;
    const ownUplift = Math.round(unitCents * Math.max(0, 1 - rate)) * ownCount;
    const sessionCents = payoutCents + ownUplift;
    const ce = ceStmt.get(s.id);
    const status = ce && ce.status === "paid" ? "paid" : "pending";
    const mins = Math.max(0, Math.round((new Date(String(s.end_time).replace(" ", "T")) - new Date(String(s.start_time).replace(" ", "T"))) / 60000)) || 0;
    if (attended > 0) {
      directCents += payoutCents;
      upliftCents += ownUplift;
      totalCents += sessionCents;
      students += attended;
      ownStudents += ownCount;
      sessions += 1;
      totalMinutes += mins;
      if (status === "paid") paidCents += Math.round(Number(ce.net_amount || 0) * 100) || payoutCents;
    }
    for (const b of payStmt.all(s.id)) {
      const method = String(b.payment_method || (b.payment_type === "pass" ? "user_pass" : "online"));
      const walkin = Number(b.is_walkin) === 1 || method === "walkin_cash" || method === "walkin_fps" || method === "cash" || method === "fps";
      const isPass = method === "user_pass" || b.payment_type === "pass";
      const collected = walkin && !isPass ? Math.round(Number(b.amount || 0) * 100) : 0;
      const own = !!b.origin_coach_id && b.origin_coach_id === coachId;
      const coachCents = own ? unitCents : Math.round(unitCents * rate);
      if (collected > 0) cashCollectedCents += collected;
      if (walkin && !isPass) {
        if (method === "walkin_fps" || method === "fps") fpsCount += 1;
        else cashCount += 1;
      }
      paymentRows.push({
        session_id: s.id,
        date: hktDate(s.start_time),
        student_name: maskStudentName(b.name),
        student_phone_masked: b.phone ? String(b.phone).slice(0, 4) + "****" : "",
        booking_type: walkin ? "現場Walk-in" : "預約報名",
        payment_channel: isPass ? "線上Pass扣堂" : method === "walkin_fps" || method === "fps" ? "個人FPS(現場)" : walkin ? "現金(Cash)" : "線上支付",
        gross_cents: walkin && !isPass ? collected : unitCents,
        split_mode: own ? "自有學生100%" : "平台學生" + Math.round(rate * 100) + "%",
        coach_cents: coachCents,
        collected_cents: collected,
        pending_cents: coachCents - collected,
      });
    }
    return {
      session_id: s.id,
      receipt_no: "ZP-" + String(s.id).slice(0, 8).toUpperCase(),
      date: hktDate(s.start_time),
      course_title: s.title,
      venue: s.venue_name || "",
      attended_count: attended,
      own_student_count: ownCount,
      platform_student_count: Math.max(0, attended - ownCount),
      own_student_uplift: ownUplift / 100,
      saved_platform_fee: ownUplift / 100,
      duration_minutes: mins,
      session_payout: sessionCents / 100,
      status,
    };
  });

  // 代堂班次：原教練保留自有學生 20% 補足；frozen_stolen 期間標記託管、不發放
  let heldUpliftCents = 0, heldStudents = 0;
  try {
    const coachRow = db.prepare("SELECT payout_status FROM users WHERE id=?").get(coachId);
    const overridden = db
      .prepare(
        `SELECT s.id, s.start_time, c.price_hkd
           FROM class_schedules s JOIN classes c ON c.id=s.class_id
           LEFT JOIN partner_venues pv ON pv.id=c.partner_venue_id
          WHERE c.coach_id=? AND s.coach_override_id IS NOT NULL AND s.coach_override_id<>?
            AND substr(s.start_time,1,7)=? AND COALESCE(s.status,'')<>'cancelled'
            AND (COALESCE(pv.is_sandbox,0)=0 OR ?=1)`,
      )
      .all(coachId, coachId, month, includeSandbox);
    for (const s of overridden) {
      const ownAttended = Number(affiliateSvc.ownStudentAttended(db, s.id, coachId)) || 0;
      if (!ownAttended) continue;
      const unitCents = Math.round(Number(s.price_hkd || 0) * 100);
      const amt = Math.round(unitCents * Math.max(0, 1 - rate)) * ownAttended;
      if (!amt) continue;
      if (coachRow && coachRow.payout_status === "frozen_stolen") {
        heldUpliftCents += amt;
        heldStudents += ownAttended;
      } else {
        upliftCents += amt;
        totalCents += amt;
      }
    }
  } catch (e) {}

  let aff = { affiliate_passive_cents: 0, affiliate_students_count: 0, affiliate_recent: [] };
  try {
    aff = affiliateSvc.monthSummary(db, coachId, month);
  } catch (e) {}
  totalCents += Number(aff.affiliate_passive_cents) || 0;

  // Phase 5.2 — 輔具帶貨分佣（與帶班收益同一月結 FPS）
  let productCommissionCents = 0;
  let productCommissionCount = 0;
  try {
    require("../services/marketplace").ensureSchema(db);
    const pc = db.prepare(
      `SELECT COALESCE(SUM(COALESCE(net_amount_cents, ROUND(net_amount*100))),0) c, COUNT(*) n
         FROM coach_earnings
        WHERE coach_id=? AND earning_type='affiliate_product_commission'
          AND COALESCE(payout_month, substr(date,1,7))=?`,
    ).get(coachId, month);
    productCommissionCents = Number(pc.c) || 0;
    productCommissionCount = Number(pc.n) || 0;
    totalCents += productCommissionCents;
  } catch (e) {}
  const netPayoutCents = totalCents - cashCollectedCents;
  paidCents = Math.min(paidCents, totalCents);
  return {
    month,
    coach_id: coachId,
    total_earned: totalCents / 100,
    direct_teaching_cents: directCents,
    own_student_uplift_cents: upliftCents,
    own_student_count: ownStudents,
    affiliate_passive_cents: Number(aff.affiliate_passive_cents) || 0,
    affiliate_passive: (Number(aff.affiliate_passive_cents) || 0) / 100,
    product_commission_cents: productCommissionCents,
    product_commission_count: productCommissionCount,
    affiliate_students_count: Number(aff.affiliate_students_count) || 0,
    affiliate_recent: aff.affiliate_recent || [],
    payout_summary: {
      total_payout_cents: totalCents,
      teaching_earnings_cents: directCents,
      own_student_uplift_cents: upliftCents,
      held_uplift_cents: heldUpliftCents,
      affiliate_passive_cents: Number(aff.affiliate_passive_cents) || 0,
      product_commission_cents: productCommissionCents,
      cash_collected_cents: cashCollectedCents,
      net_payout_cents: netPayoutCents,
      currency: "HKD",
    },
    cash_collected_cents: cashCollectedCents,
    held_uplift_cents: heldUpliftCents,
    held_uplift_students: heldStudents,
    cash_collected: cashCollectedCents / 100,
    cash_count: cashCount,
    fps_count: fpsCount,
    net_payout_cents: netPayoutCents,
    net_payout: netPayoutCents / 100,
    payment_breakdown: paymentRows,
    kpis: {
      total_sessions: sessions,
      total_students_served: students,
      own_students_served: ownStudents,
      affiliate_active_students: Number(aff.affiliate_students_count) || 0,
    },
    affiliate_payouts_breakdown: (aff.affiliate_recent || []).map((a) => ({
      payout_id: a.id,
      booking_id: a.booking_id,
      student_display_name: a.student_name,
      student_phone_masked: a.student_phone_masked,
      target_course_title: a.course_title,
      actual_coach_name: a.actual_coach_name,
      order_amount_cents: a.order_amount_cents,
      commission_rate: a.commission_rate,
      commission_amount_cents: a.commission_cents,
      status: a.status,
      cleared_at: a.cleared_at,
    })),
    total_payout_cents: totalCents,
    total_sessions: sessions,
    total_attended_students: students,
    total_hours: Math.round((totalMinutes / 60) * 10) / 10,
    next_payout_date: nextPayout.date,
    next_payout_label: nextPayout.label,
    payout_rule: "每月 5 號 FPS 出糧；遇週六／日順延至下一個工作天",
    pending_payout: (totalCents - paidCents) / 100,
    paid_payout: paidCents / 100,
    commission_rate: rate,
    sessions_breakdown: rows,
  };
}

router.get("/earnings/summary", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const { month } = monthWindow(req.query.month);
    res.json({ success: true, ...buildMonthlyBreakdown(db, req.user.id, month) });
  } catch (e) {
    console.error("[EARNINGS] summary:", e.message);
    res.status(500).json({ success: false, error: "讀取收入失敗" });
  }
});

// ===== GET /api/coach/earnings/payouts — FPS 出糧紀錄 =====
router.get("/earnings/payouts", authenticateToken, (req, res) => {
  try {
    const payouts = require("../services/payout-disbursements").listForCoach(req.user.id);
    res.json({ success: true, data: payouts });
  } catch (e) {
    console.error("[EARNINGS] payouts:", e.message);
    res.status(500).json({ success: false, error: "讀取出糧紀錄失敗" });
  }
});

// ===== FPS 收款帳戶設定（工單二十一）=====
function payoutSettingsSvc() {
  return require("../services/payout-settings");
}
function isCoachish(user) {
  return ["coach", "partner_coach", "super_admin", "platform_manager", "admin"].includes(user && user.role);
}

router.get("/payout-settings", authenticateToken, (req, res) => {
  try {
    if (!isCoachish(req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const svc = payoutSettingsSvc();
    res.json({
      success: true,
      settings: svc.getSettings(getDb(), req.user.id),
      banks: svc.BANKS,
      freeze_window: svc.inFreezeWindow(),
      payout_status: require("../services/risk-control").payoutState(getDb(), req.user.id),
    });
  } catch (e) {
    console.error("[PAYOUT-SETTINGS] get:", e.message);
    res.status(500).json({ success: false, error: "讀取收款設定失敗" });
  }
});

router.post("/payout-settings/otp", authenticateToken, async (req, res) => {
  try {
    if (!isCoachish(req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const out = await payoutSettingsSvc().sendOtp(getDb(), req.user.id, { ip: req.ip || "" });
    if (!out.ok) return res.status(out.status || 400).json({ success: false, error: out.error, retry_after: out.retry_after });
    res.json({
      success: true,
      otp_session_id: out.otp_session_id,
      phone_masked: out.phone_masked,
      channel: out.channel,
      dev_code: out.code,
      expires_in: 300,
      resend_in: 60,
    });
  } catch (e) {
    console.error("[PAYOUT-SETTINGS] otp:", e.message);
    res.status(500).json({ success: false, error: "發送驗證碼失敗" });
  }
});

router.put("/payout-settings", authenticateToken, (req, res) => {
  try {
    if (!isCoachish(req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const country = String(req.headers["cf-ipcountry"] || req.headers["x-country"] || "").toUpperCase();
    if (country && country !== "HK") {
      const risk = require("../services/risk-control").trigger(getDb(), {
        coachId: req.user.id,
        reason: "unusual_ip",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        notes: `非香港 IP：${country}`,
        meta: {
          country,
          channel: "coach-payout-settings",
          attempted: {
            fps_type: String((req.body || {}).fps_type || ""),
            bank_code: String((req.body || {}).bank_code || ""),
          },
        },
      });
      return res.status(403).json({
        success: false,
        code: "RISK_REVIEW",
        ticket_id: risk.ticket && risk.ticket.id,
        error: "偵測到非香港網絡，收款資料更改已暫緩，請聯絡客服核實。",
      });
    }
    const out = payoutSettingsSvc().validateAndUpdate(getDb(), req.user.id, req.body || {}, { ip: req.ip || "" });
    if (!out.ok) return res.status(out.status || 400).json({ success: false, code: out.code, ticket_id: out.ticket_id, error: out.error });
    res.json({ success: true, settings: out.settings });
  } catch (e) {
    console.error("[PAYOUT-SETTINGS] put:", e.message);
    res.status(500).json({ success: false, error: "更新收款設定失敗" });
  }
});

/** RFC 4180：一律加雙引號，內部 " → "" */
function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}
function csvRow(arr) {
  return arr.map(csvEscape).join(",");
}
function csvTime(v) {
  const s = String(v || "");
  if (!s) return "";
  return s.includes("T") ? s.replace("T", " ").slice(0, 16) : s.slice(0, 16);
}
function hkMoney(cents) {
  return "HK$ " + (Number(cents || 0) / 100).toFixed(2);
}

/**
 * 教練月結 CSV（複合對數單）
 *  - UTF-8 BOM 開頭（Excel Windows 中文不亂碼）
 *  - 每區段欄數固定，RFC 4180 全欄位加引號
 *  - 區段之間以空白行 + 標題列分隔
 */
function buildEarningsCsv(db, coachId, month) {
  const data = buildMonthlyBreakdown(db, coachId, month);
  const coach = db.prepare("SELECT name FROM users WHERE id = ?").get(coachId) || {};
  const BOM = "\uFEFF";
  const lines = [];
  const affCents = Number(data.affiliate_passive_cents) || 0;
  const teachingCents = Math.max(0, (Number(data.total_payout_cents) || 0) - affCents);

  // 區塊 1：抬頭與總結算
  lines.push(csvRow([`=== ZenPass 教練收益月結單 (${month}) ===`]));
  lines.push(csvRow(["教練姓名", coach.name || "", "教練編號", coachId]));
  lines.push(
    csvRow([
      "本月總計應付",
      hkMoney(data.total_payout_cents),
      "執教課堂應付",
      hkMoney(teachingCents),
      "跨界分佣應付",
      hkMoney(affCents),
    ]),
  );
  lines.push(
    csvRow([
      "現場已收取款項",
      hkMoney(data.cash_collected_cents),
      "最終 FPS 入數金額",
      hkMoney(data.net_payout_cents),
    ]),
  );
  let disb = null;
  try {
    disb = require("../services/payout-disbursements").getForMonth(db, coachId, month);
  } catch (e) {}
  if (disb) {
    lines.push(
      csvRow([
        "FPS 交易參考編號",
        disb.bank_reference_no || "",
        "發放狀態",
        disb.status || "",
        "發放日期",
        csvTime(disb.disbursed_at),
      ]),
    );
  }
  lines.push("");

  // 區塊 2：執教課堂明細（7 欄）
  lines.push(csvRow(["— 執教課堂明細 —"]));
  lines.push(csvRow(["堂次編號", "開課日期", "課程名稱", "出席人數", "自有學生數", "拆帳模式", "實收金額 (HKD)"]));
  let sessionRows = 0;
  for (const r of data.sessions_breakdown || []) {
    if (!r.attended_count) continue;
    const attended = Number(r.attended_count) || 0;
    const own = Number(r.own_student_count) || 0;
    const mode =
      attended > 0 && own >= attended
        ? "自有學生100%"
        : own > 0
          ? "混合(100%/80%)"
          : Math.round(Number(data.commission_rate || 0.8) * 100) + "%";
    lines.push(
      csvRow([
        r.receipt_no,
        r.date,
        r.course_title,
        attended,
        own,
        mode,
        Number(r.session_payout).toFixed(2),
      ]),
    );
    sessionRows += 1;
  }
  if (!sessionRows) lines.push(csvRow(["本月未有已出席班次"]));
  lines.push(
    csvRow([
      "合計",
      "",
      "",
      Number(data.total_attended_students) || 0,
      Number(data.own_student_count) || 0,
      "",
      Number(data.total_earned || 0).toFixed(2),
    ]),
  );
  lines.push("");

  // 區塊 2b：支付渠道明細（10 欄，現金/FPS 沖抵）
  const payRows = data.payment_breakdown || [];
  if (payRows.length) {
    lines.push(csvRow(["— 執教課堂與支付渠道明細 —"]));
    lines.push(
      csvRow([
        "堂次ID",
        "日期",
        "學員",
        "報讀方式",
        "支付渠道",
        "實收總額(HKD)",
        "拆帳模式",
        "教練應得(HKD)",
        "現場已收(HKD)",
        "待發款項(HKD)",
      ]),
    );
    for (const p of payRows) {
      lines.push(
        csvRow([
          p.session_id,
          p.date,
          `${p.student_name} (${p.student_phone_masked || ""})`,
          p.booking_type,
          p.payment_channel,
          (p.gross_cents / 100).toFixed(2),
          p.split_mode,
          (p.coach_cents / 100).toFixed(2),
          (p.collected_cents / 100).toFixed(2),
          (p.pending_cents / 100).toFixed(2),
        ]),
      );
    }
    lines.push(
      csvRow([
        "小計",
        "",
        "",
        "",
        "",
        "",
        "",
        (payRows.reduce((s, p) => s + p.coach_cents, 0) / 100).toFixed(2),
        (payRows.reduce((s, p) => s + p.collected_cents, 0) / 100).toFixed(2),
        (payRows.reduce((s, p) => s + p.pending_cents, 0) / 100).toFixed(2),
      ]),
    );
    lines.push("");
  }

  // 區塊 3：跨界 5% 明細（8 欄）
  lines.push(csvRow(["— 跨界 5% 被動分佣明細 (學生跨班消費) —"]));
  lines.push(
    csvRow([
      "分佣單號",
      "入帳時間",
      "學員識別",
      "報讀課程",
      "帶班導師",
      "消費金額 (HKD)",
      "回佣比例",
      "入帳佣金 (HKD)",
    ]),
  );
  const affRows = data.affiliate_recent || [];
  for (const a of affRows) {
    lines.push(
      csvRow([
        a.id,
        csvTime(a.cleared_at || a.created_at),
        `${a.student_name} (${a.student_phone_masked || ""})`,
        a.course_title,
        a.actual_coach_name,
        Number(a.order_amount).toFixed(2),
        Math.round((Number(a.commission_rate) || 0.05) * 100) + "%",
        Number(a.commission).toFixed(2),
      ]),
    );
  }
  if (!affRows.length) lines.push(csvRow(["本月未有跨界分佣"]));
  lines.push(csvRow(["小計", "", "", "", "", "", "", Number(data.affiliate_passive || 0).toFixed(2)]));

  return BOM + lines.join("\r\n") + "\r\n";
}

router.get("/earnings/export-csv", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const { month } = monthWindow(req.query.month);
    const csv = buildEarningsCsv(db, req.user.id, month);
    if (typeof res.removeHeader === "function") res.removeHeader("Cache-Control");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ZenPass_Monthly_Earnings_${month}_${req.user.id}.csv"`,
    );
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).send(csv);
  } catch (e) {
    console.error("[EARNINGS] csv:", e.message);
    res.status(500).json({ success: false, error: "匯出失敗" });
  }
});

module.exports = router;
module.exports.syncCoachEarningsForSchedule = syncCoachEarningsForSchedule;
module.exports.buildMonthlyBreakdown = buildMonthlyBreakdown;
module.exports.buildEarningsCsv = buildEarningsCsv;
