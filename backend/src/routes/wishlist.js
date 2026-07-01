/**
 * ZenPass 禪流 — Wishlist（收藏課程）路由
 * 用戶可以收藏感興趣嘅課程，方便之後預約
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// ===== 確保 wishlist table 存在 =====
function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', '+8 hours')),
      UNIQUE(user_id, class_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_wishlist_user_class ON wishlist(user_id, class_id)");
  } catch (e) { /* ignore if already exist */ }
}

// Run on module load
ensureTable();

// ===== GET /api/wishlist — 睇用戶嘅 wishlist =====
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const wishlist = db
      .prepare(
        `SELECT w.id, w.class_id, w.created_at,
                c.title, c.category, c.difficulty, c.duration, c.price_hkd,
                c.image_url, c.venue_name, c.coach_id,
                u.name as coach_name
         FROM wishlist w
         JOIN classes c ON w.class_id = c.id
         LEFT JOIN users u ON c.coach_id = u.id
         WHERE w.user_id = ?
         ORDER BY w.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ wishlist, count: wishlist.length });
  } catch (err) {
    console.error("[WISHLIST] GET error:", err.message);
    res.status(500).json({ success: false, error: "無法獲取收藏列表" });
  }
});

// ===== GET /api/wishlist/count — 返回用戶 wishlist 數量（俾 navbar badge）=====
router.get("/count", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM wishlist WHERE user_id = ?")
      .get(req.user.id);
    res.json({ count: row.count });
  } catch (err) {
    console.error("[WISHLIST] COUNT error:", err.message);
    res.status(500).json({ success: false, error: "無法獲取收藏數量" });
  }
});

// ===== GET /api/wishlist/check/:classId — check 某課程係咪 already wishlisted =====
router.get("/check/:classId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT id, created_at FROM wishlist WHERE user_id = ? AND class_id = ?")
      .get(req.user.id, req.params.classId);
    res.json({ wishlisted: !!row, created_at: row?.created_at || null });
  } catch (err) {
    console.error("[WISHLIST] CHECK error:", err.message);
    res.status(500).json({ success: false, error: "無法檢查收藏狀態" });
  }
});

// ===== POST /api/wishlist/:classId — 加入 wishlist =====
router.post("/:classId", authenticateToken, (req, res) => {
  try {
    const { classId } = req.params;
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Verify class exists
    const classExists = db
      .prepare("SELECT id, title FROM classes WHERE id = ? AND status = 'active'")
      .get(classId);
    if (!classExists) {
      return res.status(404).json({ success: false, error: "課程不存在或已下架" });
    }

    // Check if already wishlisted
    const existing = db
      .prepare("SELECT id FROM wishlist WHERE user_id = ? AND class_id = ?")
      .get(req.user.id, classId);
    if (existing) {
      return res.json({ success: true, message: "已喺收藏列表", wishlisted: true });
    }

    // Insert
    db.prepare("INSERT INTO wishlist (user_id, class_id) VALUES (?, ?)").run(
      req.user.id,
      classId,
    );

    res.json({ success: true, message: "✅ 已加入收藏", wishlisted: true });
  } catch (err) {
    console.error("[WISHLIST] POST error:", err.message);
    // Handle unique constraint
    if (err.message && err.message.includes("UNIQUE")) {
      return res.json({ success: true, message: "已喺收藏列表", wishlisted: true });
    }
    res.status(500).json({ success: false, error: "無法加入收藏" });
  }
});

// ===== DELETE /api/wishlist/:classId — 移除 wishlist =====
router.delete("/:classId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM wishlist WHERE user_id = ? AND class_id = ?")
      .run(req.user.id, req.params.classId);

    if (result.changes === 0) {
      return res.json({ success: true, message: "已唔喺收藏列表", wishlisted: false });
    }
    res.json({ success: true, message: "✅ 已移除收藏", wishlisted: false });
  } catch (err) {
    console.error("[WISHLIST] DELETE error:", err.message);
    res.status(500).json({ success: false, error: "無法移除收藏" });
  }
});

module.exports = router;
