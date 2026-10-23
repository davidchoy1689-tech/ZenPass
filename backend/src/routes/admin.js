/**
 * ZenPass 禪流 — 管理員路由 (精簡版)
 * Business logic 已移至 services/admin-service.js
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin, requirePermission } = require("../middleware/auth");
const { queryAudit } = require("../services/audit");
const adminService = require("../services/admin-service");

const router = express.Router();

// ===== POST /api/admin/run-migrations — 一鍵套用 DB migration（update-db.js，冪等）=====
router.post("/run-migrations", authenticateToken, requireAdmin, (req, res) => {
  try {
    const updateDatabase = require("../config/update-db");
    updateDatabase();
    const db = getDb();
    const clsCols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
    res.json({
      success: true,
      message: "migration 已執行",
      classes_has_sport_slug: clsCols.includes("sport_slug"),
    });
  } catch (err) {
    console.error("run-migrations error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/admin/lead-notify-config — 睇加盟通知設定 =====
router.get("/lead-notify-config", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { config } = require("../services/lead-notify");
    const db = getDb();
    db.prepare(
      "CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
    ).run();
    const rows = db
      .prepare("SELECT key, value, updated_at FROM platform_settings WHERE key IN ('lead.webhook_url','lead.admin_email')")
      .all();
    res.json({ success: true, channels: config(), settings: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/admin/lead-notify-config — 設定加盟通知（存 DB，唔使改 server .env）=====
router.post("/lead-notify-config", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    db.prepare(
      "CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
    ).run();
    const pairs = [
      ["lead.webhook_url", req.body && req.body.webhook_url, "加盟申請 Webhook（Google Sheet / Formspree）"],
      ["lead.admin_email", req.body && req.body.admin_email, "加盟申請通知 Email"],
      ["lead.whatsapp_key", req.body && req.body.whatsapp_key, "CallMeBot API key（WhatsApp 通知）"],
      ["lead.whatsapp_to", req.body && req.body.whatsapp_to, "收 WhatsApp 通知嘅電話（連國碼）"],
    ];
    let updated = 0;
    for (const [key, value, desc] of pairs) {
      if (value === undefined) continue;
      const existing = db.prepare("SELECT key FROM platform_settings WHERE key = ?").get(key);
      if (!existing) {
        db.prepare("INSERT INTO platform_settings (key, value, description) VALUES (?, ?, ?)").run(
          key, String(value || ""), desc,
        );
      } else {
        db.prepare(
          "UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
        ).run(String(value || ""), key);
      }
      updated++;
    }
    const { config } = require("../services/lead-notify");
    res.json({ success: true, updated, channels: config() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/admin/test-lead-notify — 測試加盟通知管道（唔會寫入任何申請紀錄）=====
router.post("/test-lead-notify", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { notifyNewApplication } = require("../services/lead-notify");
    const stamp = new Date().toISOString();
    const channels = await notifyNewApplication(
      "教練",
      {
        name: "【系統測試】加盟通知檢查",
        phone: (req.body && req.body.phone) || "0000 0000",
        email: (req.body && req.body.email) || "test@zenpass.hk",
        specialties: ["測試"],
        venue_address: "測試地址（可忽略）",
        bio: `呢條係通知管道測試，時間：${stamp}。收到即代表通知正常。`,
      },
      "TEST-" + Date.now().toString().slice(-6),
    );
    res.json({ success: true, tested: true, at: stamp, ...channels });
  } catch (err) {
    console.error("test-lead-notify error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/admin/pending-payments =====
router.get("/pending-payments", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listPendingPayments();
    res.json(result);
  } catch (err) {
    console.error("取待確認付款錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得待確認付款" });
  }
});

// ===== POST /api/admin/approve-payment =====
router.post("/approve-payment", authenticateToken, requirePermission("finance.payment.confirm"), (req, res) => {
  try {
    const result = adminService.approvePayment(req.body.booking_id, req.user.id, req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("確認付款錯誤:", err);
    res.status(500).json({ success: false, error: "確認付款失敗" });
  }
});

// ===== POST /api/admin/reject-payment =====
router.post("/reject-payment", authenticateToken, requirePermission("finance.payment.reject"), (req, res) => {
  try {
    const result = adminService.rejectPayment(req.body.booking_id, req.body.reason, req.user.id, req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("拒絕付款錯誤:", err);
    res.status(500).json({ success: false, error: "拒絕付款失敗" });
  }
});

// ===== 退款待轉賬（FPS／PayMe）=====
router.get("/refunds", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const status = req.query.status || "pending";
    const rows = db
      .prepare(
        `SELECT r.*, b.booking_reference, b.payment_method AS booking_method,
                u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
                c.title AS class_title, cs.start_time
         FROM refund_logs r
         JOIN bookings b ON r.booking_id = b.id
         JOIN users u ON r.user_id = u.id
         LEFT JOIN classes c ON b.class_id = c.id
         LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
         WHERE r.status = ?
         ORDER BY r.created_at ASC LIMIT 200`,
      )
      .all(status);
    res.json({ success: true, refunds: rows });
  } catch (err) {
    console.error("[ADMIN] refunds list error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取退款清單" });
  }
});

router.post("/refunds/:id/complete", authenticateToken, requirePermission("finance.refund.complete"), (req, res) => {
  try {
    const { transfer_reference, note } = req.body || {};
    const out = require("../services/refund").completeRefund(req.params.id, req.user.id, {
      transferReference: transfer_reference,
      note,
    });
    if (!out.success) return res.status(400).json({ success: false, error: out.error });
    res.json({ success: true, message: "✅ 已確認轉賬，退款完成", ...out });
  } catch (err) {
    console.error("[ADMIN] refund complete error:", err.message);
    res.status(500).json({ success: false, error: "確認退款失敗" });
  }
});

// ===== GET /api/admin/stats =====
router.get("/stats", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getDashboardStats();
    res.json(result);
  } catch (err) {
    console.error("取統計錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得統計資料" });
  }
});

// ===== GET /api/admin/bookings =====
router.get("/bookings", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listAllBookings(req.query);
    res.json(result);
  } catch (err) {
    console.error("取預約記錄錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得預約記錄" });
  }
});

// ===== GET /api/admin/users =====
router.get("/users", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listAllUsers();
    res.json(result);
  } catch (err) {
    console.error("取用戶列表錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得用戶列表" });
  }
});

// ===== GET /api/admin/users/:id/credits — Credits 流水（審計用）=====
// ===== POST /api/admin/users/:id/revoke-sessions — 強制該用戶重新登入 =====
router.post("/users/:id/revoke-sessions", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });
    db.prepare("UPDATE users SET token_version = COALESCE(token_version,0) + 1, updated_at = datetime('now') WHERE id = ?")
      .run(user.id);
    try {
      require("../services/blockchain-audit").writeBlock({
        entityType: "user_session",
        entityId: user.id,
        data: { action: "revoke_sessions", by: req.user.id },
      });
    } catch (e) {}
    res.json({ success: true, message: `已強制 ${user.email} 重新登入` });
  } catch (err) {
    console.error("[ADMIN] revoke sessions error:", err.message);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

router.get("/users/:id/credits", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, name, email, credits FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });
    const { listCreditTransactions } = require("../services/credit-ledger");
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const transactions = listCreditTransactions(db, user.id, { limit, offset, type: req.query.type || null });
    res.json({ success: true, user, transactions, limit, offset });
  } catch (err) {
    console.error("[ADMIN] user credits error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取 Credits 紀錄" });
  }
});

// ===== 會員等級：管理員手動設定 / 回復自動 =====
router.patch("/users/:id/loyalty-tier", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { setUserTierManually } = require("../services/loyalty");
    const { tier, reason } = req.body || {};
    const out = setUserTierManually(req.params.id, tier, {
      adminId: req.user.id,
      reason: reason || "",
    });
    res.json({ success: true, message: `已設定為 ${out.tier_info.icon} ${out.tier_info.name}（不再自動調整）`, data: out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message || "設定失敗" });
  }
});

router.post("/users/:id/points", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { adjustPoints } = require("../services/points");
    const { points, reason } = req.body || {};
    const out = adjustPoints(req.params.id, points, {
      adminId: req.user.id,
      reason,
    });
    res.json({
      success: true,
      message: `已調整 ${out.delta > 0 ? "+" : ""}${out.delta} 分（餘額 ${out.balance}）`,
      data: out,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message || "調整失敗" });
  }
});

router.delete("/users/:id/loyalty-tier", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { resetUserTierToAuto } = require("../services/loyalty");
    const out = resetUserTierToAuto(req.params.id, req.user.id);
    res.json({ success: true, message: `已回復自動計算（現為 ${out.tier_info.icon} ${out.tier_info.name}）`, data: out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message || "回復失敗" });
  }
});

// ===== GET /api/admin/classes =====
router.get("/classes", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listAllClasses();
    res.json(result);
  } catch (err) {
    console.error("取課程列表錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得課程列表" });
  }
});

// ===== GET /api/admin/db/:table & /api/admin/db =====
router.get("/db/:table", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { getSupabase } = require("../services/supabase");
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });

    const { table } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const { data, error } = await supabase.from(table).select("*").limit(limit);
    if (error) throw error;
    const { count, error: countErr } = await supabase.from(table).select("*", { count: "exact", head: true });

    res.json({ data: data || [], count: count || 0, error: countErr?.message || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔧 2026-10-24：原本查 Supabase（該 project 根本冇呢啲表 → 一直 500），
// 而且真正嘅生產數據喺本地 SQLite。改為列出 SQLite 表 + 筆數（read-only，唔會查大表）。
router.get("/db", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = require("../services/database").getDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    const result = [];
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
        result.push({ table: t, count: row ? row.c : 0 });
      } catch (e) {
        result.push({ table: t, count: -1, error: e.message });
      }
    }

    res.json({ success: true, engine: "sqlite", table_count: result.length, tables: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/admin/process-payouts =====
router.post("/process-payouts", authenticateToken, requirePermission("finance.payout.process"), (req, res) => {
  try {
    const result = adminService.processCoachPayouts(req.user.id, req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("批量出糧錯誤:", err);
    res.status(500).json({ success: false, error: "出糧處理失敗" });
  }
});

// ===== GET /api/admin/payouts =====
router.get("/payouts", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listPayouts(req.query);
    res.json(result);
  } catch (err) {
    console.error("取 payout 記錄錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取出糧記錄" });
  }
});

// ===== Coach applications =====
router.get("/coach-applications", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listCoachApplications(req.query.status);
    res.json(result);
  } catch (err) {
    console.error("取教練申請錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取教練申請" });
  }
});

// ===== POST /api/admin/classes/:id/status — 下架／上架單一課程 =====
router.post("/classes/:id/status", authenticateToken, requireAdmin, (req, res) => {
  try {
    const status = String((req.body || {}).status || "");
    if (!["active", "inactive", "deleted"].includes(status)) {
      return res.status(400).json({ success: false, error: "status 只可以係 active / inactive / deleted" });
    }
    const db = getDb();
    const c = db.prepare("SELECT id, title, status FROM classes WHERE id = ?").get(req.params.id);
    if (!c) return res.status(404).json({ success: false, error: "課程不存在" });
    db.prepare("UPDATE classes SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, c.id);
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "class_status",
        entityId: c.id,
        data: { from: c.status, to: status, admin_user: req.user.id },
      });
    } catch (e) {}
    res.json({ success: true, message: `已設為 ${status}`, data: { id: c.id, status } });
  } catch (err) {
    console.error("admin/classes/:id/status error:", err.message);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

// ===== POST /api/admin/close-demo-classes — 下架 demo 課程（保留真實可預約課程）=====
router.post("/close-demo-classes", authenticateToken, requireAdmin, (req, res) => {
  try {
    if ((req.body || {}).confirm !== "CLOSE_DEMO_CLASSES") {
      return res.status(400).json({ success: false, error: "需要 confirm: CLOSE_DEMO_CLASSES" });
    }
    const db = getDb();
    const before = db.prepare("SELECT COUNT(*) c FROM classes WHERE status = 'active'").get().c;
    const keep = db.prepare("SELECT COUNT(*) c FROM classes WHERE status = 'active' AND booking_open = 1").get().c;
    // 只下架「未開放預約」嘅 demo 課程；真實可預約課程不動
    const r = db
      .prepare("UPDATE classes SET status = 'inactive', updated_at = datetime('now') WHERE status = 'active' AND COALESCE(booking_open,0) = 0")
      .run();
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "admin_action",
        entityId: "close-demo-classes-" + Date.now(),
        data: { admin_user: req.user.id, action: "close_demo_classes", closed: r.changes, kept: keep },
      });
    } catch (e) {}
    console.log(`🧹 下架 demo 課程 ${r.changes} 個（保留 ${keep} 個真實）by`, req.user.email);
    res.json({ success: true, message: `已下架 ${r.changes} 個 demo 課程`, closed: r.changes, kept_bookable: keep, active_before: before });
  } catch (err) {
    console.error("close-demo-classes error:", err.message);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

// ===== 積分兌換：待履行清單 =====
router.get("/redemptions/pending", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.id, r.user_id, r.reward_name, r.points_spent, r.reward_value, r.status,
                r.created_at, r.fulfilled_at, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
         FROM points_redemptions r JOIN users u ON r.user_id = u.id
         WHERE r.reward_value = 'pending_fulfilment' AND r.fulfilled_at IS NULL
         ORDER BY r.created_at ASC`,
      )
      .all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("admin/redemptions/pending error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

// ===== 積分兌換：標記已履行 =====
router.post("/redemptions/:id/fulfil", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const r = db
      .prepare(
        "UPDATE points_redemptions SET fulfilled_at = datetime('now'), fulfilled_by = ?, status = 'used' WHERE id = ? AND fulfilled_at IS NULL",
      )
      .run(req.user.id, req.params.id);
    if (!r.changes) return res.status(409).json({ success: false, error: "此兌換已履行或不存在" });
    res.json({ success: true, message: "已標記為已履行" });
  } catch (err) {
    console.error("admin/redemptions/fulfil error:", err.message);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

// ===== 積分到期：預覽 / 手動執行 =====
router.get("/points-expiry/preview", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { listExpiring } = require("../services/points-expiry");
    res.json({ success: true, data: listExpiring() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/points-expiry/run", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { expireInactivePoints } = require("../services/points-expiry");
    const out = expireInactivePoints({ dryRun: !!(req.body && req.body.dry_run) });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/admin/reset-review-data — 清空 demo 評分（需要 confirm）=====
router.post("/reset-review-data", authenticateToken, requireAdmin, (req, res) => {
  try {
    if ((req.body || {}).confirm !== "CLEAR_DEMO_REVIEWS") {
      return res.status(400).json({ success: false, error: "需要 confirm: CLEAR_DEMO_REVIEWS" });
    }
    const db = getDb();
    const counts = {};
    for (const t of ["mutual_reviews", "coach_ratings", "reviews"]) {
      try {
        const before = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
        db.prepare(`DELETE FROM ${t}`).run();
        counts[t] = before;
      } catch (e) {
        counts[t] = "n/a";
      }
    }
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "admin_action",
        entityId: "reset-review-data-" + Date.now(),
        data: { admin_user: req.user.id, action: "reset_review_data", counts },
      });
    } catch (e) {}
    console.log("🧹 清空 demo 評分:", counts, "by", req.user.email);
    res.json({ success: true, message: "已清空 demo 評分", counts });
  } catch (err) {
    console.error("reset-review-data error:", err.message);
    res.status(500).json({ success: false, error: "清空失敗" });
  }
});

// ===== GET /api/admin/coach-ratings — 教練評分總覽（內部）=====
router.get("/coach-ratings", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { coachComposite } = require("../services/mutual-review");
    const db = getDb();
    const coaches = db
      .prepare("SELECT id, name, coach_headline FROM users WHERE is_coach = 1 ORDER BY name")
      .all()
      .map((u) => {
        const c = coachComposite(u.id);
        return { ...u, score: c.score, count: c.student_count, student_rating: c.student_rating, venue_rating: c.venue_rating };
      })
      .sort((a, b) => a.score - b.score);
    res.json({ success: true, data: coaches });
  } catch (err) {
    console.error("admin/coach-ratings error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

router.post("/coach-approve", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.approveCoach(req.body.application_id, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("審批教練錯誤:", err);
    res.status(500).json({ success: false, error: "審批失敗" });
  }
});

router.post("/coach-reject", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.rejectCoach(req.body.application_id, req.body.reason, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("拒絕教練錯誤:", err);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

// ===== GET /api/admin/course-detail/:id =====
router.get("/course-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getCourseDetail(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取課程詳情錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取課程詳情" });
  }
});

// ===== GET /api/admin/user-detail/:id =====
router.get("/user-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getUserDetail(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取用戶詳情錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取用戶詳情" });
  }
});

// ===== GET /api/admin/coach-detail/:id =====
router.get("/coach-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getCoachDetail(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取教練詳情錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取教練詳情" });
  }
});

// ===== POST /api/admin/assign-coach =====
router.post("/assign-coach", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.assignCoach(req.body.class_id, req.body.coach_id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("指派教練錯誤:", err);
    res.status(500).json({ success: false, error: "指派教練失敗" });
  }
});

// ===== POST /api/admin/notify-course-spots =====
router.post("/notify-course-spots", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.notifyCourseSpots(req.body.class_id, req.body.message);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("通知課程空位錯誤:", err);
    res.status(500).json({ success: false, error: "通知失敗" });
  }
});

// ===== PUT /api/admin/update-course/:id =====
router.put("/update-course/:id", authenticateToken, requirePermission("ops.class.write"), (req, res) => {
  try {
    const result = adminService.updateCourse(req.params.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("更新課程錯誤:", err);
    res.status(500).json({ success: false, error: "更新課程失敗" });
  }
});

// ===== POST /api/admin/generate-description =====
// AI 描述生成 - 範本系統（保留喺 route 因為係 UI helper）
const DESCRIPTION_TEMPLATES = {
  瑜伽: {
    keywords: {
      空中: ["%s 利用空中瑜伽吊床（Hammock）進行懸吊練習，透過反重力動作幫助脊柱減壓、改善血液循環。由導師從基本掛布動作教起，適合想挑戰新事物嘅學員。","%s 喺空中吊床上進行各種瑜伽動作，利用地心引力進行深度伸展同核心鍛鍊。課程由經驗導師指導，確保安全同正確姿勢。"],
      熱: ["%s 喺溫暖嘅課室中進行瑜伽練習，幫助肌肉更容易放鬆伸展。課堂包含流暢嘅體位法串聯，適合想排毒出汗、提升柔軟度嘅學員。"],
      "哈達|Hatha": ["%s 以傳統哈達瑜伽為基礎，每個動作停留幾個呼吸，專注於正確對位同身體覺察。課堂節奏較慢，適合想深入了解瑜伽基礎嘅學員。"],
      "Flow|流": ["%s 以流暢嘅動作串聯（Vinyasa）為主，將呼吸與動作同步，喺動態練習中提升肌力、柔韌度同心肺功能。"],
      "陰|Yin|深|深層": ["%s 以長時間停留的被動伸展為主，針對深層結締組織進行放鬆。課堂節奏緩慢，配合靜態保持，幫助釋放身體深層嘅緊張。"],
      "冥想|Meditation": ["%s 結合格位法練習與冥想引導，喺動與靜之間尋找平衡。課堂包含呼吸練習、體位法同靜坐環節，幫助身心整合。"],
      "初學|基礎|入門|Beginner": ["%s 專為瑜伽初學者設計，由基本體位法（Asana）開始教起，逐步建立正確姿勢同呼吸習慣。小班教學，確保每位學員得到足夠指導。"],
      "孕|產前|Prenatal": ["%s 專為孕期婦女設計，透過安全嘅瑜伽動作幫助舒緩懷孕期間嘅身體不適，強化骨盆底肌，為生產做好準備。"],
    },
    default: ["%s 透過瑜伽體位法、呼吸練習與放鬆技巧，幫助學員提升身體柔軟度、增強核心力量，同時舒緩壓力，讓身心達到平衡。","%s 由經驗導師帶領，透過流暢嘅動作串聯與靜態伸展，改善身體靈活性同姿勢，帶給你身心舒暢嘅體驗。","%s 融合傳統瑜伽練習與現代運動概念，幫助你喺安全嘅環境中探索身體嘅潛能，提升柔韌度與肌力。","%s 課堂包含呼吸協調、體位法練習同深層放鬆，適合任何程度嘅學員參加。由導師循序漸進引導，讓身體慢慢打開。","%s 透過有系統嘅瑜伽練習，逐步提升身體覺察力同控制能力。每堂課都會因應學員狀況調整內容，確保安全有效。","%s 提供一個寧靜嘅空間讓你暫時遠離日常煩囂，專注於身體同呼吸。適合任何想透過瑜伽放鬆身心嘅人士。"],
  },
  健身: {
    keywords: {
      "HIIT|高強度|間歇|燃脂": ["%s 以高強度間歇訓練（HIIT）為核心，短時間內進行高強度動作配合短暫休息，有效提升代謝率同燃脂效果。","%s 透過短時間高強度訓練，讓身體喺運動後持續燃燒卡路里。適合想用最短時間達到最佳效果嘅學員。"],
      "TRX|懸吊": ["%s 利用 TRX 懸吊系統，以自身體重進行多平面訓練，重點鍛鍊核心穩定性同全身肌力。"],
      "跑步|Run|Running": ["%s 由專業跑步教練帶領，學習正確跑姿、呼吸節奏同訓練方法，適合想提升跑步表現或開始跑步嘅學員。"],
      "CrossFit|Crossfit|綜合體能": ["%s 結合多種功能性動作，喺高效嘅訓練中全面提升肌力、爆發力、耐力同心肺功能。課堂氣氛積極，適合喜歡挑戰嘅學員。"],
      "街頭|Street|Calisthenics|徒手": ["%s 以自身體重進行街頭健身訓練，包括掌上壓、引體上升等經典動作，由教練從基本動作教起，逐步提升難度。"],
      "拳擊|Boxing|搏擊": ["%s 透過基本拳擊動作同組合訓練，有效提升心肺功能、手眼協調同全身協調性。由專業教練從基本拳法教起。"],
      "初學|入門|基礎|Beginner|新手": ["%s 專為健身初學者設計，從基本動作模式（深蹲、推拉、核心穩定）開始教起，建立安全有效嘅訓練基礎。"],
    },
    default: ["%s 透過不同訓練模式，幫助學員提升肌力、耐力同心肺功能。課堂由專業教練帶領，適合想改善體能同建立運動習慣嘅人士。","%s 結合多種訓練方式，包括肌力訓練、心肺訓練同核心鍛鍊，全面提升體能水平。每堂課都會因應學員程度調整強度。","%s 專為想提升體能嘅學員設計，透過系統化訓練提升肌力、爆發力同耐力。無論你係初學者定有經驗，都能搵到適合嘅挑戰。","%s 由教練根據學員能力設計訓練內容，確保每位學員都喺安全嘅環境中逐步進步。適合想持續鍛鍊嘅人士。","%s 課堂包含動態熱身、主訓練同靜態伸展，完整嘅訓練流程幫助學員有效提升體能同時預防受傷。","%s 透過團體訓練嘅互動氣氛，讓運動變得更有趣。教練會從旁指導動作，確保正確姿勢，適合任何程度學員。"],
  },
  default: {
    keywords: {},
    default: ["%s 由專業教練帶領，透過系統化教學幫助學員掌握基本技巧與知識。課程適合任何程度嘅參加者。","%s 專為對運動有興趣嘅人士設計，由教練循序漸進指導，讓學員喺安全嘅環境中學習同進步。","%s 透過實際練習與專業指導，幫助學員了解基本技巧與要領。課堂注重正確姿勢同安全。","%s 由經驗導師設計課程內容，按學員程度調整教學進度。適合想建立運動習慣嘅你。","%s 喺輕鬆嘅課堂氣氛中學習，由教練從旁指導矯正。無論你嘅目標係乜，我哋都會幫你一步步達成。"],
  },
};

router.post("/generate-description", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, category, difficulty, venue_name } = req.body;
    if (!title) return res.status(400).json({ success: false, error: "請提供課程名稱" });

    let catData = DESCRIPTION_TEMPLATES.default;
    if (category) {
      for (const [key, val] of Object.entries(DESCRIPTION_TEMPLATES)) {
        const keys = key.split("|");
        if (keys.some((k) => category.includes(k.trim()))) {
          catData = val;
          break;
        }
      }
    }

    let matchedTemplates = null;
    for (const [keyword, templates] of Object.entries(catData.keywords)) {
      const words = keyword.split("|");
      if (words.some((w) => title.toLowerCase().includes(w.toLowerCase().trim()))) {
        matchedTemplates = templates;
        break;
      }
    }

    const primaryPool = matchedTemplates || catData.default;
    let pool = primaryPool;
    if (primaryPool.length < 3 && catData.default) {
      pool = primaryPool.concat(catData.default);
    }

    let seed = 0;
    for (let chi = 0; chi < title.length; chi++) seed += title.charCodeAt(chi);

    const descriptions = [];
    const usedIndices = [];
    for (let gi = 0; gi < 3 && gi < pool.length; gi++) {
      let idx = (seed + gi * 7 + gi * gi) % pool.length;
      let attempts = 0;
      while (usedIndices.indexOf(idx) !== -1 && attempts < pool.length) {
        idx = (idx + 1) % pool.length;
        attempts++;
      }
      usedIndices.push(idx);
      let desc = pool[idx].replace("%s", title);
      if (venue_name) desc += " 📍 " + venue_name;
      if (difficulty === "beginner") desc = "【初學者友善】" + desc;
      else if (difficulty === "intermediate") desc = "【中級強度】" + desc;
      else if (difficulty === "advanced") desc = "【高階挑戰】" + desc;
      descriptions.push(desc);
    }

    res.json({ descriptions, generated: true });
  } catch (err) {
    console.error("生成描述錯誤:", err);
    res.status(500).json({ success: false, error: "生成描述失敗" });
  }
});

// ===== GET /api/admin/audit-log =====
router.get("/audit-log", authenticateToken, requireAdmin, (req, res) => {
  try {
    const entries = queryAudit({
      limit: parseInt(req.query.limit) || 200,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ entries });
  } catch (err) {
    console.error("[ADMIN] audit-log error:", err.message);
    res.status(500).json({ success: false, error: "load audit log failed" });
  }
});

// ===== GET /api/admin/revenue-dashboard =====
router.get("/revenue-dashboard", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getRevenueDashboard();
    res.json(result);
  } catch (err) {
    console.error("[REVENUE DASHBOARD] Error:", err.message);
    res.status(500).json({ success: false, error: "讀取收入 Dashboard 失敗" });
  }
});

// ===== POST /api/admin/merge-guest — 合併訪客帳號（人手核實身份後）=====
router.post("/merge-guest", authenticateToken, requirePermission("users.merge"), (req, res) => {
  try {
    const db = getDb();
    const norm = (x) => String(x || "").replace(/[^\d]/g, "").replace(/^852/, "").replace(/^0/, "");
    let guestId = String((req.body || {}).guest_user_id || "").trim();
    const phone = norm((req.body || {}).phone);
    const targetId = String((req.body || {}).target_user_id || "").trim();
    if (!targetId) return res.status(400).json({ success: false, error: "缺少 target_user_id" });

    if (!guestId && phone) {
      const g = db
        .prepare("SELECT id FROM users WHERE lead_source = 'guest_checkout' AND phone IS NOT NULL")
        .all()
        .find((u) => norm(u.phone) === phone);
      if (g) guestId = g.id;
    }
    if (!guestId) return res.status(404).json({ success: false, error: "搵唔到訪客帳號" });
    if (guestId === targetId) return res.status(400).json({ success: false, error: "同一帳號唔可以合併" });

    const guest = db.prepare("SELECT id, name, phone, lead_source FROM users WHERE id = ?").get(guestId);
    const target = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(targetId);
    if (!guest || !target) return res.status(404).json({ success: false, error: "帳號不存在" });
    if (guest.lead_source !== "guest_checkout") {
      return res.status(400).json({ success: false, error: "只可以合併『免註冊』訪客帳號" });
    }

    let moved = 0;
    const tx = db.transaction(() => {
      moved = db.prepare("UPDATE bookings SET user_id = ? WHERE user_id = ?").run(targetId, guestId).changes;
      // 交易／退款紀錄一齊轉（保持 audit 連續）
      for (const t of ["transactions", "refund_logs", "wallet_transactions", "notifications"]) {
        try { db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(targetId, guestId); } catch (e) {}
      }
      try { db.prepare("UPDATE guest_sessions SET user_id = ? WHERE user_id = ?").run(targetId, guestId); } catch (e) {}
      // 舊訪客帳號標記為已合併（保留 row 作審計）
      db.prepare("UPDATE users SET lead_source = 'merged_guest', notes = COALESCE(notes,'') || ? WHERE id = ?")
        .run(`\n[merged into ${targetId}]`, guestId);
      db.prepare(
        "INSERT INTO account_merges (id, guest_user_id, target_user_id, moved_bookings, merged_by, note) VALUES (?,?,?,?,?,?)",
      ).run(uuidv4(), guestId, targetId, moved, req.user.id, "admin merge");
    });
    tx();

    try {
      require("../services/audit").audit({
        actionType: "ACCOUNT_MERGE",
        entityType: "user",
        entityId: targetId,
        userId: req.user.id,
        oldValues: { guest_user_id: guestId, guest_name: guest.name, guest_phone: guest.phone },
        newValues: { target_user_id: targetId, moved_bookings: moved },
        description: "合併訪客帳號",
        ipAddress: req.ip,
      });
    } catch (e) {}

    return res.json({ success: true, moved_bookings: moved, guest_user_id: guestId, target_user_id: targetId });
  } catch (err) {
    console.error("[ADMIN] merge-guest error:", err.message);
    return res.status(500).json({ success: false, error: "合併失敗" });
  }
});

// ===== GET /api/admin/guest-merges — 列出可合併嘅訪客帳號 =====
router.get("/guest-merges", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const norm = (x) => String(x || "").replace(/[^\d]/g, "").replace(/^852/, "").replace(/^0/, "");
    const rows = db
      .prepare("SELECT id, name, email, phone, lead_source, created_at FROM users WHERE phone IS NOT NULL AND phone != ''")
      .all();
    const guests = rows.filter((u) => u.lead_source === "guest_checkout");
    const out = [];
    for (const g of guests) {
      const p = norm(g.phone);
      if (p.length !== 8) continue;
      const target = rows.find((u) => u.id !== g.id && u.lead_source !== "guest_checkout" && norm(u.phone) === p);
      if (!target) continue;
      const cnt = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?").get(g.id).n;
      out.push({ guest: g, target, bookings: cnt });
    }
    return res.json({ success: true, merges: out });
  } catch (err) {
    return res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

// ===== POST /api/admin/attend-booking — 代客人標記出席（訪客／無 App 客人）=====
router.post("/attend-booking", authenticateToken, requirePermission("ops.booking.write"), (req, res) => {
  try {
    const db = getDb();
    const bookingId = String((req.body || {}).booking_id || "").trim();
    if (!bookingId) return res.status(400).json({ success: false, error: "缺少 booking_id" });

    const b = db.prepare("SELECT id, status, user_id, schedule_id FROM bookings WHERE id = ?").get(bookingId);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });
    if (!["confirmed", "attended"].includes(b.status)) {
      return res.status(400).json({ success: false, error: "只可以標記已確認嘅預約" });
    }
    const before = b.status;
    db.prepare("UPDATE bookings SET status = 'attended', checked_in_at = COALESCE(checked_in_at, datetime('now')), checkin_method = 'admin' WHERE id = ?")
      .run(bookingId);

    try {
      require("../services/audit").audit({
        actionType: "ADMIN_ATTEND",
        entityType: "booking",
        entityId: bookingId,
        userId: req.user.id,
        oldValues: { status: before },
        newValues: { status: "attended" },
        description: "管理員代標記出席",
        ipAddress: req.ip,
      });
    } catch (e) {}

    try {
      const { syncCoachEarningsForSchedule } = require("./coach-earnings");
      syncCoachEarningsForSchedule(b.schedule_id);
    } catch (e) {}

    return res.json({ success: true, booking_id: bookingId, status: "attended" });
  } catch (err) {
    console.error("[ADMIN] attend-booking error:", err.message);
    return res.status(500).json({ success: false, error: "標記失敗" });
  }
});

// ===== 課程時段管理（2026-10-24）=====
// 公開網站顯示嘅時段必須可以由後台管理，否則「後台 ↔ 網站」斷鏈。

// GET /api/admin/classes/:id/schedules
router.get("/classes/:id/schedules", authenticateToken, requirePermission("ops.class.view"), (req, res) => {
  try {
    const db = getDb();
    const cls = db.prepare("SELECT id, title, max_participants FROM classes WHERE id = ?").get(req.params.id);
    if (!cls) return res.status(404).json({ success: false, error: "課程不存在" });
    const rows = db
      .prepare(
        `SELECT id, start_time, end_time, max_participants, enrolled_count, status, notes
         FROM class_schedules WHERE class_id = ? ORDER BY start_time ASC`,
      )
      .all(req.params.id);
    return res.json({ success: true, class: cls, schedules: rows });
  } catch (err) {
    console.error("[ADMIN] list schedules error:", err.message);
    return res.status(500).json({ success: false, error: "讀取時段失敗" });
  }
});

// POST /api/admin/classes/:id/schedules
router.post("/classes/:id/schedules", authenticateToken, requirePermission("ops.class.write"), (req, res) => {
  try {
    const db = getDb();
    const cls = db.prepare("SELECT id, title, max_participants FROM classes WHERE id = ?").get(req.params.id);
    if (!cls) return res.status(404).json({ success: false, error: "課程不存在" });

    const { start_time, end_time, max_participants, notes } = req.body || {};
    const st = new Date(start_time);
    const en = new Date(end_time);
    if (isNaN(st) || isNaN(en)) return res.status(400).json({ success: false, error: "時間格式不正確" });
    if (en <= st) return res.status(400).json({ success: false, error: "結束時間必須遲過開始時間" });
    if (st.getTime() < Date.now()) return res.status(400).json({ success: false, error: "唔可以新增過去嘅時段" });
    const cap = Number(max_participants || cls.max_participants || 12);
    if (!(cap > 0)) return res.status(400).json({ success: false, error: "人數上限必須大於 0" });

    const dup = db
      .prepare("SELECT id FROM class_schedules WHERE class_id = ? AND start_time = ?")
      .get(cls.id, st.toISOString());
    if (dup) return res.status(409).json({ success: false, error: "同一時間已經有呢個時段" });

    const id = uuidv4();
    db.prepare(
      `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status, notes)
       VALUES (?, ?, ?, ?, ?, 0, 'available', ?)`,
    ).run(id, cls.id, st.toISOString(), en.toISOString(), cap, notes || null);

    try {
      require("../services/audit").audit({
        actionType: "SCHEDULE_CREATE",
        entityType: "class_schedule",
        entityId: id,
        userId: req.user.id,
        newValues: { class_id: cls.id, start_time: st.toISOString(), end_time: en.toISOString(), max_participants: cap },
        description: "新增課堂時段",
        ipAddress: req.ip,
      });
    } catch (e) {}

    return res.json({ success: true, id });
  } catch (err) {
    console.error("[ADMIN] create schedule error:", err.message);
    return res.status(500).json({ success: false, error: "新增時段失敗" });
  }
});

// POST /api/admin/schedules/:sid/cancel — 取消時段（有報名會全數退款）
router.post("/schedules/:sid/cancel", authenticateToken, requirePermission("ops.class.write"), (req, res) => {
  try {
    const db = getDb();
    const sid = req.params.sid;
    const reason = String((req.body || {}).reason || "課堂取消").slice(0, 200);
    const sch = db.prepare("SELECT * FROM class_schedules WHERE id = ?").get(sid);
    if (!sch) return res.status(404).json({ success: false, error: "時段不存在" });
    if (sch.status === "cancelled") return res.json({ success: true, message: "時段已經取消" });

    const active = db
      .prepare("SELECT * FROM bookings WHERE schedule_id = ? AND status IN ('confirmed','pending_payment')")
      .all(sid);

    let refunded = 0;
    for (const b of active) {
      db.prepare(
        "UPDATE bookings SET status = 'cancelled', cancel_reason = ?, payment_status = CASE WHEN payment_status = 'paid' THEN payment_status ELSE 'cancelled' END WHERE id = ?",
      ).run(`課程取消：${reason}`, b.id);

      if (b.payment_status === "paid" && Number(b.amount) > 0) {
        try {
          const out = require("../services/refund").processRefund({
            bookingId: b.id,
            amount: Number(b.amount),
            reason: `課程取消全額退款：${reason}`,
            initiatedBy: req.user.id,
            approvedBy: req.user.id,
            method: b.payment_method || "fps",
          });
          if (out && out.success) refunded++;
        } catch (e) {
          console.error("[ADMIN] schedule cancel refund error:", e.message);
        }
      }
      try {
        require("../services/notification").sendNotification("booking.cancelled", {
          recipient: b.user_id,
          data: {
            booking_reference: b.booking_reference,
            class_title: "",
            date: String(sch.start_time || "").slice(0, 10),
            reason,
          },
        });
      } catch (e) {}
    }

    db.prepare("UPDATE class_schedules SET status = 'cancelled', enrolled_count = 0 WHERE id = ?").run(sid);

    try {
      require("../services/audit").audit({
        actionType: "SCHEDULE_CANCEL",
        entityType: "class_schedule",
        entityId: sid,
        userId: req.user.id,
        oldValues: { status: sch.status, enrolled_count: sch.enrolled_count },
        newValues: { status: "cancelled", affected_bookings: active.length, refunded },
        description: `取消時段：${reason}`,
        ipAddress: req.ip,
      });
    } catch (e) {}

    return res.json({ success: true, affected: active.length, refunded, message: `已取消，處理 ${active.length} 筆預約（${refunded} 筆退款）` });
  } catch (err) {
    console.error("[ADMIN] cancel schedule error:", err.message);
    return res.status(500).json({ success: false, error: "取消時段失敗" });
  }
});

// ===== POST /api/admin/users/:id/role — 修改角色（需 users.role.write）=====
router.post("/users/:id/role", authenticateToken, requirePermission("users.role.write"), (req, res) => {
  try {
    const { ROLE_HIERARCHY } = require("../middleware/auth");
    const db = getDb();
    const targetRole = String((req.body || {}).role || "");
    const targetId = req.params.id;
    if (!ROLE_HIERARCHY.hasOwnProperty(targetRole)) {
      return res.status(400).json({ success: false, error: "無效角色" });
    }
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, error: "唔可以改自己嘅角色（防止鎖死）" });
    }
    const target = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(targetId);
    if (!target) return res.status(404).json({ success: false, error: "用戶不存在" });

    const myLevel = ROLE_HIERARCHY[req.user.role];
    const theirLevel = ROLE_HIERARCHY[target.role];
    const newLevel = ROLE_HIERARCHY[targetRole];
    if (newLevel <= myLevel) {
      return res.status(403).json({ success: false, error: "唔可以設定同等或更高權限嘅角色" });
    }
    if (theirLevel <= myLevel) {
      return res.status(403).json({ success: false, error: "唔可以修改同等或更高權限嘅帳號" });
    }

    db.prepare("UPDATE users SET role = ?, token_version = COALESCE(token_version,0) + 1, updated_at = datetime('now') WHERE id = ?")
      .run(targetRole, targetId);

    try {
      require("../services/audit").audit({
        actionType: "ROLE_CHANGE",
        entityType: "user",
        entityId: targetId,
        userId: req.user.id,
        oldValues: { role: target.role },
        newValues: { role: targetRole },
        description: `角色變更：${target.role} → ${targetRole}`,
        ipAddress: req.ip,
      });
    } catch (e) {}
    try {
      require("../services/blockchain-audit").writeBlock({
        entityType: "user_role",
        entityId: targetId,
        data: { from: target.role, to: targetRole, by: req.user.id },
      });
    } catch (e) {}

    return res.json({ success: true, role: targetRole, message: `已改為 ${targetRole}（該用戶需重新登入）` });
  } catch (err) {
    console.error("[ADMIN] role change error:", err.message);
    return res.status(500).json({ success: false, error: "修改角色失敗" });
  }
});

// ===== GET /api/admin/permissions — 權限矩陣（參考用）=====
router.get("/permissions", authenticateToken, requirePermission("users.role.write"), (req, res) => {
  const { ROLE_PERMISSIONS, PERMISSIONS } = require("../config/permissions");
  return res.json({ success: true, roles: ROLE_PERMISSIONS, permissions: PERMISSIONS });
});

module.exports = router;
