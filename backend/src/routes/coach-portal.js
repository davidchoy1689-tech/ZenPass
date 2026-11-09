/**
 * 教練行動工作台 API（現有 ZenPass 架構）
 *  POST /api/coach/attendance/batch-check — 一次過點名 + SHA-256 存證
 *  POST /api/coach/handbook                 — 課後成長手冊（相片＋評語）
 *  GET  /api/coach/handbook?schedule_id=    — 教練查看已提交手冊
 *
 * 只使用現有 SQLite / audit_log / blockchain_blocks，唔會另起 PostgreSQL。
 */
const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { writeBlock } = require("../services/blockchain-audit");
const { dbNotification } = require("../services/notification");

const router = express.Router();
router.use(authenticateToken);

function isAdmin(user) {
  return user && hasMinimumRole(user.role, "admin");
}

function ownSchedule(db, user, scheduleId) {
  const row = db
    .prepare(
      `SELECT cs.*, c.title, c.coach_id, c.venue_name
       FROM class_schedules cs JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = ?`,
    )
    .get(scheduleId);
  if (!row) return null;
  if (!isAdmin(user) && row.coach_id !== user.id) return null;
  return row;
}

function ensureHandbookTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_handbooks (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      student_id TEXT,
      comment TEXT NOT NULL,
      photos TEXT DEFAULT '[]',
      sha256 TEXT NOT NULL,
      block_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_handbook_booking ON coach_handbooks(booking_id);
    CREATE INDEX IF NOT EXISTS idx_handbook_schedule ON coach_handbooks(schedule_id);
  `);
}

// ===== 一次過點名 =====
router.post("/attendance/batch-check", (req, res) => {
  try {
    const db = getDb();
    const { schedule_id, items } = req.body || {};
    const sched = ownSchedule(db, req.user, schedule_id);
    if (!sched) return res.status(404).json({ success: false, error: "找不到班次或無權限" });

    let targets;
    if (Array.isArray(items) && items.length) {
      targets = items
        .filter((x) => x && /^[0-9a-f-]{36}$/i.test(String(x.booking_id)))
        .map((x) => ({ booking_id: x.booking_id, status: x.status === "no_show" ? "no_show" : "attended" }));
    } else {
      targets = null; // 全部已確認＋已付款
    }

    const now = new Date().toISOString();
    let updated = [];
    const run = db.transaction(() => {
      let rows;
      if (targets) {
        const get = db.prepare("SELECT * FROM bookings WHERE id = ? AND schedule_id = ?");
        rows = targets.map((t) => ({ t, b: get.get(t.booking_id, schedule_id) })).filter((x) => x.b);
      } else {
        rows = db
          .prepare(
            "SELECT * FROM bookings WHERE schedule_id = ? AND status = 'confirmed' AND payment_status = 'paid'",
          )
          .all(schedule_id)
          .map((b) => ({ t: { booking_id: b.id, status: "attended" }, b }));
      }
      for (const { t, b } of rows) {
        if (b.status === "cancelled") continue;
        if (t.status === "no_show") {
          if (b.status === "attended") continue;
          db.prepare(
            "UPDATE bookings SET status='no_show', cancel_reason='coach_batch_no_show' WHERE id=?",
          ).run(b.id);
        } else {
          if (b.status === "attended") continue;
          if (b.payment_status !== "paid") continue;
          db.prepare(
            "UPDATE bookings SET status='attended', checked_in_at=datetime('now'), checkin_method='batch' WHERE id=?",
          ).run(b.id);
        }
        updated.push({ id: b.id, ref: b.booking_reference, status: t.status });
      }
    });
    run();

    // SHA-256 存證：整批 digest 上鏈
    const digest = crypto
      .createHash("sha256")
      .update(JSON.stringify({ schedule_id, at: now, items: updated }))
      .digest("hex");
    const block = writeBlock({
      entityType: "attendance_batch",
      entityId: schedule_id,
      data: { schedule_id, coach_id: req.user.id, at: now, count: updated.length, digest },
    });

    audit({
      actionType: "attendance.batch_check",
      entityType: "class_schedule",
      entityId: schedule_id,
      userId: req.user.id,
      newValues: { count: updated.length, digest, block_hash: block.hash || null },
      description: `教練批量點名 ${updated.length} 人（${sched.title}）`,
    });

    // 通知學員（唔阻塞回應）
    for (const u of updated) {
      try {
        const b = db.prepare("SELECT user_id FROM bookings WHERE id=?").get(u.id);
        if (b && b.user_id) {
          dbNotification(
            b.user_id,
            "attendance",
            u.status === "attended" ? "✅ 出席已記錄" : "缺席已記錄",
            `${sched.title} 嘅出席狀態已由教練更新。`,
            { booking_id: u.id },
          );
        }
      } catch (e) {}
    }

    res.json({
      success: true,
      updated: updated.length,
      items: updated,
      digest,
      block_hash: block.hash || null,
    });
  } catch (err) {
    console.error("[COACH-PORTAL] batch-check:", err.message);
    res.status(500).json({ success: false, error: "批量點名失敗" });
  }
});

// ===== 課後手冊 =====
router.post("/handbook", express.json({ limit: "8mb" }), (req, res) => {
  try {
    const db = getDb();
    ensureHandbookTable(db);
    const { schedule_id, booking_id, comment, photos } = req.body || {};
    const sched = ownSchedule(db, req.user, schedule_id);
    if (!sched) return res.status(404).json({ success: false, error: "找不到班次或無權限" });
    const b = db.prepare("SELECT * FROM bookings WHERE id=? AND schedule_id=?").get(booking_id, schedule_id);
    if (!b) return res.status(404).json({ success: false, error: "學員不在此班" });

    const text = String(comment || "").trim();
    if (text.length < 2) return res.status(400).json({ success: false, error: "評語太短" });
    if (text.length > 800) return res.status(400).json({ success: false, error: "評語上限 800 字" });

    const list = Array.isArray(photos) ? photos.slice(0, 3) : [];
    for (const p of list) {
      const s = String(p || "");
      if (/^https?:\/\//i.test(s)) continue;
      if (!/^data:image\/(jpeg|png|webp);base64,/i.test(s)) {
        return res.status(400).json({ success: false, error: "相片格式只限 JPEG／PNG／WebP" });
      }
      if (s.length > 1.6 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: "相片過大（每張上限約 1.2MB）" });
      }
    }

    const payload = JSON.stringify({ schedule_id, booking_id, comment: text, photos: list, coach_id: req.user.id });
    const hash = crypto.createHash("sha256").update(payload).digest("hex");
    const existing = db.prepare("SELECT id FROM coach_handbooks WHERE booking_id=?").get(booking_id);
    const id = existing ? existing.id : uuidv4();

    if (existing) {
      db.prepare(
        `UPDATE coach_handbooks SET comment=?, photos=?, sha256=?, updated_at=datetime('now') WHERE id=?`,
      ).run(text, JSON.stringify(list), hash, id);
    } else {
      db.prepare(
        `INSERT INTO coach_handbooks (id, coach_id, schedule_id, booking_id, student_id, comment, photos, sha256)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(id, req.user.id, schedule_id, booking_id, b.user_id, text, JSON.stringify(list), hash);
    }

    const block = writeBlock({
      entityType: "handbook",
      entityId: id,
      data: { booking_id, student_id: b.user_id, comment: text, photos: list.length, sha256: hash },
    });
    if (block && block.block_id) {
      db.prepare("UPDATE coach_handbooks SET block_id=? WHERE id=?").run(block.block_id, id);
    }

    audit({
      actionType: "handbook.published",
      entityType: "booking",
      entityId: booking_id,
      userId: req.user.id,
      newValues: { handbook_id: id, sha256: hash, photos: list.length },
      description: `課後手冊已發佈（${sched.title}）`,
    });

    try {
      dbNotification(
        b.user_id,
        "handbook",
        "📖 教練課後評語",
        `${sched.title} 嘅課後成長手冊已經更新，入去睇下教練嘅評語同相片。`,
        { booking_id, handbook_id: id },
      );
    } catch (e) {}

    res.status(existing ? 200 : 201).json({
      success: true,
      handbook_id: id,
      sha256: hash,
      block_hash: block.hash || null,
      updated: !!existing,
    });
  } catch (err) {
    console.error("[COACH-PORTAL] handbook:", err.message);
    res.status(500).json({ success: false, error: "手冊發佈失敗" });
  }
});

router.get("/handbook", (req, res) => {
  try {
    const db = getDb();
    ensureHandbookTable(db);
    const sched = ownSchedule(db, req.user, req.query.schedule_id);
    if (!sched) return res.status(404).json({ success: false, error: "找不到班次或無權限" });
    const rows = db
      .prepare(
        `SELECT h.*, u.name AS student_name
         FROM coach_handbooks h LEFT JOIN users u ON u.id = h.student_id
         WHERE h.schedule_id=? ORDER BY h.updated_at DESC`,
      )
      .all(req.query.schedule_id);
    res.json({ success: true, handbooks: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
