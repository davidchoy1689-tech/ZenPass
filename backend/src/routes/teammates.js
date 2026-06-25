/**
 * ZenPass 禪流 — 用戶同伴管理路由
 *
 * 功能：管理用戶嘅同伴列表（類似朋友清單）
 * 供預約時選擇「帶埋邊個一齊嚟」
 */

const express = require("express");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/me/teammates — 取得我的同伴列表 =====
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const teammates = db
      .prepare(
        "SELECT id, name, phone, email, notes, created_at FROM user_teammates WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(req.user.id);
    db.close();
    res.json({ teammates });
  } catch (err) {
    console.error("獲取同伴列表錯誤:", err.message);
    res.status(500).json({ error: "獲取同伴列表失敗" });
  }
});

// ===== POST /api/me/teammates — 新增同伴 =====
router.post("/", authenticateToken, (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "請輸入同伴姓名" });
    }

    const db = new Database(DB_PATH);

    // 檢查重複（同 user 同 name + 同 phone）
    const existing = db
      .prepare(
        "SELECT id FROM user_teammates WHERE user_id = ? AND name = ? AND (phone = ? OR (phone IS NULL AND ? IS NULL))",
      )
      .get(req.user.id, name.trim(), phone || null, phone || null);

    if (existing) {
      db.close();
      return res.status(409).json({ error: "同伴已存在" });
    }

    const result = db
      .prepare(
        "INSERT INTO user_teammates (user_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)",
      )
      .run(req.user.id, name.trim(), phone || null, email || null, notes || "");

    const teammate = db
      .prepare("SELECT id, name, phone, email, notes, created_at FROM user_teammates WHERE id = ?")
      .get(result.lastInsertRowid);

    db.close();
    res.status(201).json({ teammate });
  } catch (err) {
    console.error("新增同伴錯誤:", err.message);
    res.status(500).json({ error: "新增同伴失敗" });
  }
});

// ===== DELETE /api/me/teammates/:id — 刪除同伴 =====
router.delete("/:id", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const result = db
      .prepare("DELETE FROM user_teammates WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user.id);

    if (result.changes === 0) {
      db.close();
      return res.status(404).json({ error: "找不到該同伴" });
    }

    db.close();
    res.json({ message: "✅ 已刪除同伴" });
  } catch (err) {
    console.error("刪除同伴錯誤:", err.message);
    res.status(500).json({ error: "刪除同伴失敗" });
  }
});

// ===== PUT /api/me/teammates/:id — 更新同伴 =====
router.put("/:id", authenticateToken, (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const db = new Database(DB_PATH);

    const existing = db
      .prepare("SELECT id FROM user_teammates WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);

    if (!existing) {
      db.close();
      return res.status(404).json({ error: "找不到該同伴" });
    }

    db.prepare(
      "UPDATE user_teammates SET name = COALESCE(?, name), phone = COALESCE(?, phone), email = COALESCE(?, email), notes = COALESCE(?, notes) WHERE id = ? AND user_id = ?",
    ).run(name || null, phone || null, email || null, notes || null, req.params.id, req.user.id);

    const teammate = db
      .prepare("SELECT id, name, phone, email, notes, created_at FROM user_teammates WHERE id = ?")
      .get(req.params.id);

    db.close();
    res.json({ teammate });
  } catch (err) {
    console.error("更新同伴錯誤:", err.message);
    res.status(500).json({ error: "更新同伴失敗" });
  }
});

module.exports = router;
