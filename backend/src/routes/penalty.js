/**
 * ZenPass 禪流 - 缺席/罰款處理
 *
 * 功能：
 * 1. 自動標記 no-show（class 完結後寬限期過，confirmed 未 attend → no_show）
 * 2. 罰款扣 Credits（no_show_penalty_credits）
 * 3. 遲取消（<2hr）可允許，但要罰款
 * 4. 管理員查閱 no-show 統計
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");
const { trackBookingChange } = require("../services/audit");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== Helper: 讀取罰款設定 =====
function getPenaltyConfig() {
  const db = new Database(DB_PATH);
  const noShowPenalty = db
    .prepare("SELECT value FROM pricing_config WHERE key = 'no_show_penalty_credits'")
    .get();
  const lateCancelPenalty = db
    .prepare("SELECT value FROM pricing_config WHERE key = 'late_cancel_penalty_credits'")
    .get();
  const graceMinutes = db
    .prepare("SELECT value FROM pricing_config WHERE key = 'no_show_grace_minutes'")
    .get();
  db.close();
  return {
    noShowPenalty: parseInt(noShowPenalty?.value || "2", 10),
    lateCancelPenalty: parseInt(lateCancelPenalty?.value || "2", 10),
    graceMinutes: parseInt(graceMinutes?.value || "30", 10),
  };
}

// ===== Helper: 扣罰款 + 記錄 =====
function applyPenalty(userId, bookingId, penaltyCredits, reason) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    // 原子扣 credit
    const result = db
      .prepare("UPDATE users SET credits = MAX(0, credits - ?) WHERE id = ?")
      .run(penaltyCredits, userId);

    if (result.changes === 0) {
      console.error(`[PENALTY] 無法扣罰款: user=${userId}, credits=${penaltyCredits}`);
      db.close();
      return false;
    }

    // 讀取最新 credit 結餘
    const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
    const newCredits = user ? user.credits : 0;

    // 記錄 transaction
    const txId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, payment_method, status, description, created_at)
      VALUES (?, ?, 'credits_topup', ?, 'HKD', 'credits', 'completed', ?, datetime('now'))
    `).run(txId, userId, -penaltyCredits, reason);

    // 記錄 audit
    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, user_id, details, created_at)
      VALUES (?, ?, 'booking', ?, ?, ?, datetime('now'))
    `).run(uuidv4(), 'penalty.apply', bookingId, userId, JSON.stringify({
      penaltyCredits,
      reason,
      newCredits,
      bookingId,
    }));

    db.close();
    return true;
  } catch (err) {
    console.error("[PENALTY] applyPenalty error:", err);
    db.close();
    return false;
  }
}

// ===== 1. POST /api/penalty/process-no-shows — 自動處理缺席 =====
// 標記已過期 confirmed booking 為 no_show + 扣罰款
router.post("/process-no-shows", (req, res) => {
  try {
    const config = getPenaltyConfig();
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 找出所有已過 class 時間 + 寬限期、仍為 confirmed 的 booking
    const cutoffTime = new Date(
      Date.now() - config.graceMinutes * 60 * 1000
    ).toISOString();

    // 只用 start_time 判斷（唔需要 end_time），因為 class 開始唔出席就係 no-show
    const expiredBookings = db
      .prepare(
        `
        SELECT b.id, b.user_id, b.schedule_id, b.class_id,
               cs.start_time, cs.end_time,
               c.title as class_title
        FROM bookings b
        JOIN class_schedules cs ON b.schedule_id = cs.id
        JOIN classes c ON b.class_id = c.id
        WHERE b.status = 'confirmed'
          AND cs.end_time < ?
        ORDER BY cs.start_time
      `
      )
      .all(cutoffTime);

    if (expiredBookings.length === 0) {
      db.close();
      return res.json({
        processed: 0,
        message: "冇需要處理嘅缺席",
      });
    }

    const results = [];
    const processed = [];

    for (const booking of expiredBookings) {
      // 再確認一次冇被 concurrent process 改咗 status
      const current = db
        .prepare("SELECT status FROM bookings WHERE id = ?")
        .get(booking.id);
      if (!current || current.status !== "confirmed") continue;

      // 1. 標記 no_show
      db.prepare("UPDATE bookings SET status = 'no_show' WHERE id = ?").run(booking.id);

      // 2. 釋放名額
      db.prepare(
        "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?"
      ).run(booking.schedule_id);

      // 3. 扣罰款
      const penaltyApplied = applyPenalty(
        booking.user_id,
        booking.id,
        config.noShowPenalty,
        `缺席罰款：${booking.class_title}（${booking.start_time}）`
      );

      // 4. 通知用戶
      const userName = db
        .prepare("SELECT name FROM users WHERE id = ?")
        .get(booking.user_id);
      const userNameStr = userName ? userName.name : "用戶";

      try {
        sendNotification(
          booking.user_id,
          "no_show_penalty",
          "⚠️ 缺席罰款通知",
          `「${booking.class_title}」你已缺席，已扣除 ${config.noShowPenalty} Credits 作為罰款。`,
          { booking_id: booking.id, penalty: config.noShowPenalty }
        );
      } catch (notifErr) {
        console.error(
          `[PENALTY] Notification failed for ${booking.user_id}:`,
          notifErr.message
        );
      }

      // 5. Audit
      try {
        trackBookingChange(booking.id, "system", "confirmed", "no_show", req);
      } catch (auditErr) {
        console.error("⚠️ Audit record failed:", auditErr.message);
      }

      console.log(
        `[PENALTY] No-show: user=${booking.user_id} booking=${booking.id} penalty=${config.noShowPenalty}`
      );

      processed.push({
        booking_id: booking.id,
        user_id: booking.user_id,
        class_title: booking.class_title,
        start_time: booking.start_time,
        penalty_deducted: config.noShowPenalty,
      });
    }

    db.close();

    res.json({
      processed: processed.length,
      details: processed,
      config: {
        no_show_penalty_credits: config.noShowPenalty,
        grace_minutes: config.graceMinutes,
      },
    });
  } catch (err) {
    console.error("[PENALTY] process-no-shows error:", err);
    res.status(500).json({ error: "處理缺席失敗", details: err.message });
  }
});

// ===== 2. POST /api/penalty/settings — 更新罰款設定（Admin only）=====
router.post("/settings", authenticateToken, (req, res) => {
  try {
    const user = new Database(DB_PATH)
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "只限管理員" });
    }

    const { no_show_penalty_credits, late_cancel_penalty_credits, no_show_grace_minutes } = req.body;
    const db = new Database(DB_PATH);

    if (no_show_penalty_credits !== undefined) {
      db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = 'no_show_penalty_credits'")
        .run(String(no_show_penalty_credits));
    }
    if (late_cancel_penalty_credits !== undefined) {
      db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = 'late_cancel_penalty_credits'")
        .run(String(late_cancel_penalty_credits));
    }
    if (no_show_grace_minutes !== undefined) {
      db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = 'no_show_grace_minutes'")
        .run(String(no_show_grace_minutes));
    }

    db.close();
    res.json({ message: "罰款設定已更新", settings: getPenaltyConfig() });
  } catch (err) {
    console.error("[PENALTY] settings error:", err);
    res.status(500).json({ error: "更新設定失敗" });
  }
});

// ===== 3. GET /api/penalty/settings — 讀取罰款設定 =====
router.get("/settings", (req, res) => {
  res.json(getPenaltyConfig());
});

// ===== 4. GET /api/penalty/stats — 罰款統計（Admin only）=====
router.get("/stats", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.role !== "admin") {
      db.close();
      return res.status(403).json({ error: "只限管理員" });
    }

    // 最近 30 日 no-show 統計
    const stats = db
      .prepare(
        `
        SELECT
          COUNT(*) as total_no_shows,
          COUNT(DISTINCT user_id) as unique_users,
          (SELECT COUNT(*) FROM bookings WHERE status = 'no_show' AND created_at >= datetime('now', '-30 days')) as last_30_days,
          (SELECT COUNT(*) FROM bookings WHERE status = 'no_show' AND created_at >= datetime('now', '-7 days')) as last_7_days
        FROM bookings
        WHERE status = 'no_show'
      `
      )
      .get();

    // 最多缺曠嘅用戶 Top 10
    const topNoShowUsers = db
      .prepare(
        `
        SELECT u.id, u.name, u.email,
               COUNT(*) as no_show_count,
               SUM(CASE WHEN b.created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as recent_no_shows
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        WHERE b.status = 'no_show'
        GROUP BY b.user_id
        ORDER BY no_show_count DESC
        LIMIT 10
      `
      )
      .all();

    // 罰款總額（估算）
    const penaltyTotal = db
      .prepare(
        "SELECT COUNT(*) as total FROM bookings WHERE status = 'no_show'"
      )
      .get();

    db.close();

    res.json({
      stats: {
        total_no_shows: stats.total_no_shows,
        unique_users: stats.unique_users,
        last_30_days: stats.last_30_days,
        last_7_days: stats.last_7_days,
        estimated_penalty_credits: penaltyTotal.total * getPenaltyConfig().noShowPenalty,
      },
      top_users: topNoShowUsers,
      penalty_credits_per_occurrence: getPenaltyConfig().noShowPenalty,
    });
  } catch (err) {
    console.error("[PENALTY] stats error:", err);
    res.status(500).json({ error: "讀取統計失敗" });
  }
});

// ===== 5. POST /api/penalty/late-cancel/:bookingId — 遲取消（罰款但要准）=====
router.post("/late-cancel/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const booking = db
      .prepare(
        `
        SELECT b.*, cs.start_time, c.title as class_title
        FROM bookings b
        JOIN class_schedules cs ON b.schedule_id = cs.id
        JOIN classes c ON b.class_id = c.id
        WHERE b.id = ? AND b.user_id = ? AND b.status = 'confirmed'
      `
      )
      .get(req.params.bookingId, req.user.id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在或已取消" });
    }

    const config = getPenaltyConfig();

    // 檢查信用卡夠唔夠俾罰款
    const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.credits < config.lateCancelPenalty) {
      db.close();
      return res.status(400).json({
        error: `Credits 不足，遲取消需 ${config.lateCancelPenalty} Credits 罰款。你目前有 ${user?.credits || 0} Credits。`,
        required_credits: config.lateCancelPenalty,
        current_credits: user?.credits || 0,
      });
    }

    // 1. 扣罰款
    const penaltyApplied = applyPenalty(
      req.user.id,
      booking.id,
      config.lateCancelPenalty,
      `遲取消罰款：${booking.class_title}（${booking.start_time}）`
    );

    if (!penaltyApplied) {
      db.close();
      return res.status(500).json({ error: "扣罰款失敗" });
    }

    // 2. 取消 booking
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);

    // 3. 釋放名額
    db.prepare(
      "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?"
    ).run(booking.schedule_id);

    // 4. 檢查候補名單
    try {
      const { autoNotifyOnCancel } = require("./waitlist");
      autoNotifyOnCancel(booking.schedule_id);
    } catch (e) {
      console.error("autoNotifyOnCancel error:", e.message);
    }

    // 5. Audit
    try {
      trackBookingChange(booking.id, req.user.id, "confirmed", "cancelled", req);
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    // 6. 通知
    try {
      sendNotification(
        req.user.id,
        "late_cancel_penalty",
        "⚠️ 遲取消通知",
        `「${booking.class_title}」已取消，已扣除 ${config.lateCancelPenalty} Credits 作為遲取消罰款。`,
        { booking_id: booking.id, penalty: config.lateCancelPenalty }
      );
    } catch (notifErr) {}

    db.close();

    res.json({
      message: `已取消預約，扣除 ${config.lateCancelPenalty} Credits 罰款`,
      penalty_deducted: config.lateCancelPenalty,
      remaining_credits: Math.max(0, (user.credits || 0) - config.lateCancelPenalty),
    });
  } catch (err) {
    console.error("[PENALTY] late-cancel error:", err);
    res.status(500).json({ error: "遲取消失敗" });
  }
});

// ===== 6. POST /api/penalty/process-specific/:bookingId — 手動標記某個 booking 為 no-show（Admin/Coach）=====
router.post("/process-specific/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT role, is_coach FROM users WHERE id = ?").get(req.user.id);
    if (!user || (user.role !== "admin" && !user.is_coach)) {
      db.close();
      return res.status(403).json({ error: "只限管理員/教練" });
    }

    const booking = db
      .prepare(
        "SELECT b.*, c.title FROM bookings b JOIN classes c ON b.class_id = c.id WHERE b.id = ? AND b.status = 'confirmed'"
      )
      .get(req.params.bookingId);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在或已處理" });
    }

    const config = getPenaltyConfig();

    // 1. 標記 no_show
    db.prepare("UPDATE bookings SET status = 'no_show' WHERE id = ?").run(booking.id);

    // 2. 釋放名額
    db.prepare(
      "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?"
    ).run(booking.schedule_id);

    // 3. 扣罰款
    const penaltyApplied = applyPenalty(
      booking.user_id,
      booking.id,
      config.noShowPenalty,
      `缺席罰款（管理員手動）：${booking.title}`
    );

    // 4. 通知
    try {
      sendNotification(
        booking.user_id,
        "no_show_penalty",
        "⚠️ 缺席罰款通知",
        `「${booking.title}」你已被標記為缺席，已扣除 ${config.noShowPenalty} Credits 作為罰款。`,
        { booking_id: booking.id, penalty: config.noShowPenalty }
      );
    } catch (notifErr) {}

    // 5. Audit
    try {
      trackBookingChange(booking.id, req.user.id, "confirmed", "no_show", req);
    } catch (auditErr) {}

    db.close();

    res.json({
      message: `已標記缺席，扣除 ${config.noShowPenalty} Credits`,
      penalty_deducted: config.noShowPenalty,
      user_id: booking.user_id,
      class_title: booking.title,
    });
  } catch (err) {
    console.error("[PENALTY] process-specific error:", err);
    res.status(500).json({ error: "標記缺席失敗" });
  }
});

module.exports = router;
