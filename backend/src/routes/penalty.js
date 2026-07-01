/**
 * ZenPass 禪流 - 缺席/罰款處理（ClassPass 模式）
 *
 * 規則：
 * ✅ 正常取消（> 12 小時前）→ 全退 Credits
 * 🟡 遲取消（2-12 小時前）→ 唔退 Credits（蝕該堂）
 * ❌ 遲取消（< 2 小時前）→ 阻住不可取消
 * ❌ No-show → 蝕該堂 Credits + 罰 2 Credits
 * 
 * 試玩 / 免 Credit 預約 → 戶口必須有足夠 Credits 先 book 得
 * 任何 booking 都需要用戶同意扣款規則
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");
const { trackBookingChange } = require("../services/audit");

const router = express.Router();

// ===== Helper: 讀取罰款設定 =====
function getPenaltyConfig() {
  const db = getDb();
  const penaltyCredits = db
    .prepare("SELECT value FROM pricing_config WHERE key = 'no_show_penalty_credits'")
    .get();
  const graceMinutes = db
    .prepare("SELECT value FROM pricing_config WHERE key = 'no_show_grace_minutes'")
    .get();

  return {
    noShowPenalty: parseInt(penaltyCredits?.value || "2", 10),
    graceMinutes: parseInt(graceMinutes?.value || "30", 10),
  };
}

// ===== Helper: 扣罰款 + 記錄 =====
function applyPenalty(userId, bookingId, penaltyCredits, reason, type = 'no_show') {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  try {
    // === Grace Period: 首次免罰 ===
    const prevPenalties = db.prepare(
      "SELECT COUNT(*) as c FROM penalty_logs WHERE user_id = ? AND status = 'applied'"
    ).get(userId);
    const isFirstOffense = prevPenalties ? prevPenalties.c === 0 : true;
    const graceEnabled = db.prepare(
      "SELECT value FROM pricing_config WHERE key = 'grace_period_enabled'"
    ).get();
    if (isFirstOffense && (graceEnabled?.value === '1' || !graceEnabled)) {
      // 首次違規：記錄但唔扣 Credits
      console.log(`[PENALTY] Grace period: user=${userId}, waived ${penaltyCredits}cr for ${type}`);
      const penaltyId = uuidv4();
      db.prepare(
        "INSERT INTO penalty_logs (id, booking_id, user_id, type, class_cost, penalty_credits, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, 'waived', ?, datetime('now'))"
      ).run(penaltyId, bookingId, userId, type, 0, penaltyCredits,
        `首次違規豁免：${reason}`);
      db.prepare(
        "INSERT INTO audit_log (id, action, entity_type, entity_id, user_id, details, created_at) VALUES (?, 'penalty.waived', 'booking', ?, ?, ?, datetime('now'))"
      ).run(uuidv4(), bookingId, userId, JSON.stringify({ penaltyCredits, reason, waived: true, type }));

      return { waived: true, penaltyId };
    }

    const result = db
      .prepare("UPDATE users SET credits = MAX(0, credits - ?) WHERE id = ?")
      .run(penaltyCredits, userId);
    if (result.changes === 0) {
      console.error(`[PENALTY] Cannot deduct: user=${userId}, credits=${penaltyCredits}`);

      return { waived: false, applied: false };
    }
    const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
    const newCredits = user ? user.credits : 0;
    const txId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, payment_method, status, description, created_at)
      VALUES (?, ?, 'penalty', ?, 'HKD', 'credits', 'completed', ?, datetime('now'))
    `).run(txId, userId, -penaltyCredits, reason);

    // === 50/50 分拆：罰款收入 50%→平台, 50%→教練 ===
    try {
      const booking = db.prepare(
        "SELECT b.class_id, cs.id as schedule_id FROM bookings b JOIN class_schedules cs ON b.schedule_id = cs.id WHERE b.id = ?"
      ).get(bookingId);
      if (booking) {
        const coach = db.prepare(
          "SELECT c.user_id FROM classes cl JOIN coaches c ON cl.coach_id = c.id WHERE cl.id = ?"
        ).get(booking.class_id);
        if (coach) {
          const penaltyHalf = Math.floor(penaltyCredits / 2);
          if (penaltyHalf > 0) {
            // 給教練 50%
            db.prepare("UPDATE users SET credits = COALESCE(credits,0) + ? WHERE id = ?")
              .run(penaltyHalf, coach.user_id);
            db.prepare(
              "INSERT INTO coach_earnings (id, coach_id, amount, type, source, description, created_at) VALUES (?, ?, ?, 'penalty_split', 'penalty', ?, datetime('now'))"
            ).run(uuidv4(), coach.user_id, penaltyHalf,
              `罰款分拆 50%：${reason}`);
            console.log(`[PENALTY] Split ${penaltyHalf}cr to coach ${coach.user_id}`);
          }
        }
      }
    } catch(splitErr) {
      console.error('[PENALTY] Split error:', splitErr.message);
    }

    // 記錄到 penalty_logs
    try {
      const bc = db.prepare("SELECT credits_cost FROM bookings b JOIN classes c ON b.class_id = c.id WHERE b.id = ?").get(bookingId);
      db.prepare(
        'INSERT INTO penalty_logs (id, booking_id, user_id, type, class_cost, penalty_credits, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, \'applied\', ?, datetime(\'now\'))'
      ).run(uuidv4(), bookingId, userId, type, bc?.credits_cost || 0, penaltyCredits, reason);
    } catch(e) { console.error('[PENALTY] log error:', e.message); }
    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, user_id, details, created_at)
      VALUES (?, ?, 'booking', ?, ?, ?, datetime('now'))
    `).run(uuidv4(), 'penalty.apply', bookingId, userId, JSON.stringify({ penaltyCredits, reason, newCredits, bookingId }));

    return { waived: false, applied: true, penaltyCredits };
  } catch (err) {
    console.error("[PENALTY] applyPenalty error:", err);

    return false;
  }
}

// ===== 1. POST /api/penalty/process-no-shows — 自動處理缺席 =====
router.post("/process-no-shows", (req, res) => {
  try {
    const config = getPenaltyConfig();
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const cutoffTime = new Date(Date.now() - config.graceMinutes * 60 * 1000).toISOString();

    const expiredBookings = db
      .prepare(`
        SELECT b.id, b.user_id, b.schedule_id, b.class_id, b.payment_type,
               cs.start_time, cs.end_time,
               c.title as class_title, c.credits_cost
        FROM bookings b
        JOIN class_schedules cs ON b.schedule_id = cs.id
        JOIN classes c ON b.class_id = c.id
        WHERE b.status = 'confirmed'
          AND cs.end_time < ?
        ORDER BY cs.start_time
      `).all(cutoffTime);

    if (expiredBookings.length === 0) {

      return res.json({ processed: 0, message: "冇需要處理嘅缺席" });
    }

    const processed = [];
    for (const booking of expiredBookings) {
      const current = db.prepare("SELECT status FROM bookings WHERE id = ?").get(booking.id);
      if (!current || current.status !== "confirmed") continue;

      // 1. 標記 no_show
      db.prepare("UPDATE bookings SET status = 'no_show' WHERE id = ?").run(booking.id);

      // 2. 釋放名額
      db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?")
        .run(booking.schedule_id);

      // 3. 扣罰款（class cost is already deducted at booking）
      // No-show penalty = 2 credits extra (像 ClassPass 的 $15)
      const classCost = booking.credits_cost || 12;
      const penaltyTotal = config.noShowPenalty; // 2cr extra penalty
      
      const penaltyResult = applyPenalty(
        booking.user_id,
        booking.id,
        penaltyTotal,
        `缺席罰款附加費：${booking.class_title}（${booking.start_time}）— 已蝕 ${classCost} Credits + 罰 ${penaltyTotal} Credits`,
        'no_show'
      );

      if (penaltyResult && (penaltyResult.applied || penaltyResult.waived)) {
        const isWaived = penaltyResult.waived;
        // 4. 通知用戶
        try {
          const notifyType = isWaived ? 'no_show_waived' : 'no_show_penalty';
          const notifyTitle = isWaived ? '⚠️ 缺席通知（首次豁免）' : '⚠️ 缺席罰款通知';
          const notifyMsg = isWaived
            ? `「${booking.class_title}」你已缺席。由於係首次違規，今次豁免罰款。下次缺席會扣 ${penaltyTotal} Credits。`
            : `「${booking.class_title}」你已缺席。該次預約嘅 ${classCost} Credits 已扣除，另加 ${penaltyTotal} Credits 缺席罰款。`;
          sendNotification(booking.user_id, notifyType, notifyTitle, notifyMsg,
            { booking_id: booking.id, class_cost: classCost, penalty: isWaived ? 0 : penaltyTotal });
        } catch (e) {}

        try {
          trackBookingChange(booking.id, "system", "confirmed", isWaived ? 'no_show_waived' : 'no_show', req);
        } catch (e) {}

        console.log(`[PENALTY] No-show: user=${booking.user_id} booking=${booking.id} cost=${classCost} penalty=${isWaived ? 'WAIVED' : penaltyTotal}`);
      }

      processed.push({
        booking_id: booking.id,
        user_id: booking.user_id,
        class_title: booking.class_title,
        class_cost: classCost,
        penalty_deducted: penaltyTotal,
      });
    }

    res.json({
      processed: processed.length,
      details: processed,
      penalty_credits_per_occurrence: config.noShowPenalty,
      grace_minutes: config.graceMinutes,
    });
  } catch (err) {
    console.error("[PENALTY] process-no-shows error:", err);
    res.status(500).json({ success: false, error: "處理缺席失敗", details: err.message });
  }
});

// ===== 2. POST /api/penalty/settings — 更新罰款設定（Admin only）=====
router.post("/settings", authenticateToken, (req, res) => {
  try {
    const user = getDb().prepare("SELECT role FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, error: "只限管理員" });
    }
    const { no_show_penalty_credits, no_show_grace_minutes } = req.body;
    const db = getDb();
    if (no_show_penalty_credits !== undefined) {
      db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = 'no_show_penalty_credits'")
        .run(String(no_show_penalty_credits));
    }
    if (no_show_grace_minutes !== undefined) {
      db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = 'no_show_grace_minutes'")
        .run(String(no_show_grace_minutes));
    }

    res.json({ message: "罰款設定已更新", settings: getPenaltyConfig() });
  } catch (err) {
    console.error("[PENALTY] settings error:", err);
    res.status(500).json({ success: false, error: "更新設定失敗" });
  }
});

// ===== 3. GET /api/penalty/settings — 讀取罰款設定 =====
router.get("/settings", (req, res) => {
  res.json(getPenaltyConfig());
});

// ===== 4. GET /api/penalty/stats — 罰款統計（Admin only）=====
router.get("/stats", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.role !== "admin") {

      return res.status(403).json({ success: false, error: "只限管理員" });
    }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_no_shows,
        COUNT(DISTINCT user_id) as unique_users,
        (SELECT COUNT(*) FROM bookings WHERE status = 'no_show' AND created_at >= datetime('now', '-30 days')) as last_30_days,
        (SELECT COUNT(*) FROM bookings WHERE status = 'no_show' AND created_at >= datetime('now', '-7 days')) as last_7_days
      FROM bookings WHERE status = 'no_show'
    `).get();

    const topNoShowUsers = db.prepare(`
      SELECT u.id, u.name, u.email, COUNT(*) as no_show_count
      FROM bookings b JOIN users u ON b.user_id = u.id
      WHERE b.status = 'no_show'
      GROUP BY b.user_id ORDER BY no_show_count DESC LIMIT 10
    `).all();

    // 最近 30 日取消統計
    const recentCancels = db.prepare(`
      SELECT COUNT(*) as cancelled_2_12hr FROM bookings
      WHERE status = 'cancelled'
        AND created_at >= datetime('now', '-30 days')
    `).get();

    const penalty = getPenaltyConfig();

    res.json({
      stats: {
        total_no_shows: stats.total_no_shows,
        unique_users: stats.unique_users,
        last_30_days: stats.last_30_days,
        last_7_days: stats.last_7_days,
        estimated_penalty_credits: stats.total_no_shows * penalty.noShowPenalty,
      },
      top_users: topNoShowUsers,
      last_30_days_cancellations: recentCancels?.cancelled_2_12hr || 0,
      penalty_config: penalty,
    });
  } catch (err) {
    console.error("[PENALTY] stats error:", err);
    res.status(500).json({ success: false, error: "讀取統計失敗" });
  }
});

// ===== 5. POST /api/penalty/late-cancel/:bookingId — 遲取消（2-12hr，罰款 = 蝕該堂 Credits）=====
router.post("/late-cancel/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const booking = db.prepare(`
      SELECT b.*, cs.start_time, c.title as class_title, c.credits_cost
      FROM bookings b
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN classes c ON b.class_id = c.id
      WHERE b.id = ? AND b.user_id = ? AND b.status = 'confirmed'
    `).get(req.params.bookingId, req.user.id);

    if (!booking) {

      return res.status(404).json({ success: false, error: "預約不存在或已取消" });
    }

    const now = new Date();
    const classTime = new Date(booking.start_time);
    const hoursUntilClass = (classTime - now) / (1000 * 60 * 60);

    // < 2 小時 → 阻住
    if (hoursUntilClass < 2) {

      return res.status(400).json({ success: false, error: "開課前 2 小時內無法取消預約" });
    }

    // 2-12 小時：蝕該堂 Credits（不另扣罰款），因為 credits 已於 booking 時扣咗
    // 唔退 = 蝕咗
    const classCost = booking.credits_cost || 12;

    // 1. 取消 booking（唔退 credits）
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);

    // 2. 釋放名額
    db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?")
      .run(booking.schedule_id);

    // 3. 檢查候補名單
    try {
      const { autoNotifyOnCancel } = require("./waitlist");
      autoNotifyOnCancel(booking.schedule_id);
    } catch (e) {}

    // 4. Audit
    try {
      trackBookingChange(booking.id, req.user.id, "confirmed", "cancelled", req);
    } catch (e) {}

    // 5. 通知
    try {
      sendNotification(req.user.id, "late_cancel_penalty", "⚠️ 遲取消通知",
        `「${booking.class_title}」已取消。由於取消時間距離開課不足 12 小時，已使用的 ${classCost} Credits 將唔會退還（等同遲取消罰款）。`,
        { booking_id: booking.id, class_cost: classCost }
      );
    } catch (e) {}

    res.json({
      message: `已取消預約。由於距離開課不足 12 小時，${classCost} Credits 唔會退還。`,
      class_cost_forfeited: classCost,
    });
  } catch (err) {
    console.error("[PENALTY] late-cancel error:", err);
    res.status(500).json({ success: false, error: "遲取消失敗" });
  }
});

// ===== 6. POST /api/penalty/process-specific/:bookingId — 手動標記 no-show（Admin/Coach）=====
router.post("/process-specific/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT role, is_coach FROM users WHERE id = ?").get(req.user.id);
    if (!user || (user.role !== "admin" && !user.is_coach)) {

      return res.status(403).json({ success: false, error: "只限管理員/教練" });
    }

    const booking = db.prepare(
      "SELECT b.*, c.title, c.credits_cost FROM bookings b JOIN classes c ON b.class_id = c.id WHERE b.id = ? AND b.status = 'confirmed'"
    ).get(req.params.bookingId);

    if (!booking) {

      return res.status(404).json({ success: false, error: "預約不存在或已處理" });
    }

    const config = getPenaltyConfig();
    const classCost = booking.credits_cost || 12;

    db.prepare("UPDATE bookings SET status = 'no_show' WHERE id = ?").run(booking.id);
    db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?")
      .run(booking.schedule_id);

    applyPenalty(booking.user_id, booking.id, config.noShowPenalty,
      `缺席罰款附加費（管理員手動）：${booking.title}`);

    try {
      sendNotification(booking.user_id, "no_show_penalty", "⚠️ 缺席罰款通知",
        `「${booking.title}」你已被標記為缺席。已使用的 ${classCost} Credits + ${config.noShowPenalty} Credits 罰款。`,
        { booking_id: booking.id, penalty: config.noShowPenalty }
      );
    } catch (e) {}

    try {
      trackBookingChange(booking.id, req.user.id, "confirmed", "no_show", req);
    } catch (e) {}

    res.json({
      message: `已標記缺席。蝕 ${classCost} Credits + 罰 ${config.noShowPenalty} Credits`,
      class_cost_forfeited: classCost,
      penalty_deducted: config.noShowPenalty,
    });
  } catch (err) {
    console.error("[PENALTY] process-specific error:", err);
    res.status(500).json({ success: false, error: "標記缺席失敗" });
  }
});

module.exports = router;
