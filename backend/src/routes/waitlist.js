/**
 * ZenPass 禪流 — Waitlist（候補）路由
 * 滿座時自動排隊，有位時即時通知
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");

const router = express.Router();

// ===== POST /api/waitlist/join — 加入候補 =====
router.post("/join", authenticateToken, (req, res) => {
  try {
    const { schedule_id } = req.body;
    if (!schedule_id) {
      return res.status(400).json({ error: "缺少時段 ID" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Check schedule exists
    const schedule = db
      .prepare(
        "SELECT * FROM class_schedules WHERE id = ? AND status = 'available'",
      )
      .get(schedule_id);
    if (!schedule) {

      return res.status(404).json({ error: "該時段不存在" });
    }

    // Check if already in waitlist
    const existing = db
      .prepare(
        "SELECT id FROM waitlist WHERE schedule_id = ? AND user_id = ? AND status = 'waiting'",
      )
      .get(schedule_id, req.user.id);
    if (existing) {

      return res
        .status(200)
        .json({ message: "你已在候補名單中", waitlist_id: existing.id });
    }

    // Check if already booked
    const booked = db
      .prepare(
        "SELECT id FROM bookings WHERE schedule_id = ? AND user_id = ? AND status IN ('confirmed','pending_payment','attended')",
      )
      .get(schedule_id, req.user.id);
    if (booked) {

      return res.status(400).json({ error: "你已預約了此課程" });
    }

    // Get position
    const position =
      db
        .prepare(
          "SELECT COUNT(*) as pos FROM waitlist WHERE schedule_id = ? AND status = 'waiting'",
        )
        .get(schedule_id).pos + 1;

    const id = uuidv4();
    db.prepare(
      "INSERT INTO waitlist (id, schedule_id, user_id, status) VALUES (?, ?, ?, 'waiting')",
    ).run(id, schedule_id, req.user.id);

    // Get class info for response
    const classInfo = db
      .prepare(
        "SELECT c.title, c.category FROM classes c JOIN class_schedules cs ON c.id = cs.class_id WHERE cs.id = ?",
      )
      .get(schedule_id);

    res.json({
      success: true,
      message: "✅ 已加入候補名單，第 " + position + " 位",
      waitlist_id: id,
      position: position,
      class_title: classInfo?.title || "",
    });
  } catch (err) {
    console.error("Waitlist join error:", err);
    res.status(500).json({ error: "無法加入候補" });
  }
});

// ===== POST /api/waitlist/leave — 離開候補 =====
router.post("/leave", authenticateToken, (req, res) => {
  try {
    const { schedule_id } = req.body;
    const db = getDb();
    db.prepare(
      "UPDATE waitlist SET status = 'cancelled' WHERE schedule_id = ? AND user_id = ? AND status = 'waiting'",
    ).run(schedule_id, req.user.id);

    res.json({ success: true, message: "✅ 已離開候補名單" });
  } catch (err) {
    res.status(500).json({ error: "無法離開候補" });
  }
});

// ===== GET /api/waitlist/status?schedule_id= — 檢查候補狀態 =====
router.get("/status", authenticateToken, (req, res) => {
  try {
    const { schedule_id } = req.query;
    const db = getDb();
    const entry = db
      .prepare(
        "SELECT * FROM waitlist WHERE schedule_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(schedule_id, req.user.id);
    const total = db
      .prepare(
        "SELECT COUNT(*) as count FROM waitlist WHERE schedule_id = ? AND status = 'waiting'",
      )
      .get(schedule_id).count;

    if (entry) {
      const position =
        db
          .prepare(
            "SELECT COUNT(*) as pos FROM waitlist WHERE schedule_id = ? AND status = 'waiting' AND created_at < ?",
          )
          .get(schedule_id, entry.created_at).pos + 1;
      res.json({ in_waitlist: true, position, total, status: entry.status });
    } else {
      res.json({ in_waitlist: false, total });
    }
  } catch (err) {
    res.status(500).json({ error: "無法獲取候補狀態" });
  }
});

// ===== POST /api/waitlist/notify-next — 通知下一位候補（admin 用，或用 cancel 自動觸發） =====
router.post("/notify-next", authenticateToken, (req, res) => {
  try {
    const { schedule_id } = req.body;
    if (!schedule_id) return res.status(400).json({ error: "缺少時段 ID" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 搵下一位候補
    const next = db
      .prepare(
        "SELECT w.*, u.name as user_name FROM waitlist w JOIN users u ON w.user_id = u.id WHERE w.schedule_id = ? AND w.status = 'waiting' ORDER BY w.created_at ASC LIMIT 1",
      )
      .get(schedule_id);

    if (!next) {

      return res.json({ notified: false, message: "冇候補" });
    }

    // 標記為已通知
    db.prepare(
      "UPDATE waitlist SET status = 'notified', notified_at = datetime('now') WHERE id = ?",
    ).run(next.id);

    // Send notification
    const classTitle =
      db
        .prepare(
          "SELECT c.title FROM classes c JOIN class_schedules cs ON c.id = cs.class_id WHERE cs.id = ?",
        )
        .get(schedule_id)?.title || "";

    sendNotification("waitlist.opened", {
      user_id: next.user_id,
      data: { class_title: classTitle, schedule_id },
    });

    res.json({ notified: true, user: next.user_name, class_title: classTitle });
  } catch (err) {
    console.error("Waitlist notify error:", err);
    res.status(500).json({ error: "通知失敗" });
  }
});

/**
 * 當 booking 取消 / 跌出名額時調用 — 自動通知下一位候補
 */
function autoNotifyOnCancel(schedule_id) {
  try {
    const db = getDb();
    const next = db
      .prepare(
        "SELECT w.*, u.name as user_name FROM waitlist w JOIN users u ON w.user_id = u.id WHERE w.schedule_id = ? AND w.status = 'waiting' ORDER BY w.created_at ASC LIMIT 1",
      )
      .get(schedule_id);

    if (!next) {

      return;
    }

    db.prepare(
      "UPDATE waitlist SET status = 'notified', notified_at = datetime('now') WHERE id = ?",
    ).run(next.id);

    // Get class info for notification
    let classTitle = "";
    let classDate = "";
    let classTime = "";
    try {
      const db = getDb();
      const schedInfo = schedDb.prepare(
        "SELECT c.title, cs.start_time FROM classes c JOIN class_schedules cs ON c.id = cs.class_id WHERE cs.id = ?"
      ).get(schedule_id);

      if (schedInfo) {
        classTitle = schedInfo.title || "";
        const dt = new Date(schedInfo.start_time);
        classDate = dt.toISOString().split("T")[0];
        classTime = dt.toTimeString().split(" ")[0].substring(0, 5);
      }
    } catch (e) {}

    sendNotification("waitlist.opened", {
      user_id: next.user_id,
      data: { schedule_id, class_title: classTitle },
    });

    // Send waitlist.promoted notification to the user
    try {
      sendNotification("waitlist.promoted", {
        recipient: next.user_id,
        data: {
          class_title: classTitle,
          date: classDate,
          time: classTime,
        }
      });
    } catch (e) {}

    console.log(
      "🔔 Waitlist notified:",
      next.user_name,
      "for schedule",
      schedule_id,
    );
  } catch (err) {
    console.error("autoNotifyOnCancel error:", err.message);
  }
}

// ===== App Waitlist =====

// POST /api/waitlist/app — 加入 App 等候名單
router.post("/app", function (req, res) {
  try {
    var email = (req.body && req.body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "請輸入有效電郵" });
    }
    var db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS app_waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, source TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");
    try {
      db.prepare("INSERT INTO app_waitlist (email, source) VALUES (?, 'app_page')").run(email);

      res.json({ message: "已加入等候名單！App 推出時會第一時間通知你 🎉" });
    } catch (e) {

      if (e.message && e.message.includes("UNIQUE")) {
        res.json({ message: "你已經喺等候名單上 📱" });
      } else {
        res.status(500).json({ error: "加入失敗" });
      }
    }
  } catch (err) {
    console.error("[APP WAITLIST] Error:", err);
    res.status(500).json({ error: "加入失敗" });
  }
});

// GET /api/waitlist/app/count — 等候人數
router.get("/app/count", function (req, res) {
  try {
    var db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS app_waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, source TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");
    var row = db.prepare("SELECT COUNT(*) as count FROM app_waitlist").get();

    res.json({ count: row.count });
  } catch (err) {
    console.error("[APP WAITLIST COUNT] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.autoNotifyOnCancel = autoNotifyOnCancel;
