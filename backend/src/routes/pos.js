/**
 * ZenPass - 多場地 + POS 路由
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireCoach } = require("../middleware/auth");
const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/locations — 場地列表 =====
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const locations = db
      .prepare(
        "SELECT * FROM locations WHERE coach_id = ? ORDER BY is_primary DESC, created_at ASC",
      )
      .all(req.user.id);
    db.close();
    res.json({ locations });
  } catch (err) {
    res.status(500).json({ error: "無法取得場地列表" });
  }
});

// ===== POST /api/locations — 新增場地 =====
router.post("/", authenticateToken, (req, res) => {
  try {
    const { name, address, phone, is_primary } = req.body;
    if (!name) return res.status(400).json({ error: "請填寫場地名稱" });
    const db = new Database(DB_PATH);
    const id = uuidv4();
    db.prepare(
      `INSERT INTO locations (id, coach_id, name, address, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      name,
      address || null,
      phone || null,
      is_primary ? 1 : 0,
    );
    if (is_primary) {
      db.prepare(
        "UPDATE locations SET is_primary = 0 WHERE coach_id = ? AND id != ?",
      ).run(req.user.id, id);
    }
    db.close();
    res.status(201).json({ message: "場地已建立", location_id: id });
  } catch (err) {
    res.status(500).json({ error: "無法建立場地" });
  }
});

// ===== DELETE /api/locations/:id — 刪除場地 =====
router.delete("/:id", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.prepare("DELETE FROM locations WHERE id = ? AND coach_id = ?").run(
      req.params.id,
      req.user.id,
    );
    db.close();
    res.json({ message: "已刪除" });
  } catch (err) {
    res.status(500).json({ error: "刪除失敗" });
  }
});

// ===== POST /api/pos/sale — 記錄銷售 =====
router.post("/sale", authenticateToken, (req, res) => {
  try {
    const {
      type,
      item_name,
      quantity,
      unit_price,
      payment_method,
      customer_name,
      customer_phone,
      location_id,
    } = req.body;
    if (!item_name || !unit_price)
      return res.status(400).json({ error: "請填寫項目名稱和價錢" });
    const db = new Database(DB_PATH);
    const id = uuidv4();
    const total = (quantity || 1) * unit_price;
    db.prepare(
      `INSERT INTO sales (id, coach_id, location_id, type, item_name, quantity, unit_price, total_amount, payment_method, customer_name, customer_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      location_id || null,
      type || "other",
      item_name,
      quantity || 1,
      unit_price,
      total,
      payment_method || null,
      customer_name || null,
      customer_phone || null,
    );
    // Also add to total_spent if customer exists
    if (customer_phone) {
      const user = db
        .prepare("SELECT id FROM users WHERE phone = ?")
        .get(customer_phone);
      if (user) {
        db.prepare(
          "UPDATE users SET total_spent = COALESCE(total_spent,0) + ? WHERE id = ?",
        ).run(total, user.id);
      }
    }
    db.close();
    res
      .status(201)
      .json({ message: "✅ 銷售已記錄", sale_id: id, total_amount: total });
  } catch (err) {
    console.error("POS error:", err);
    res.status(500).json({ error: "記錄銷售失敗" });
  }
});

// ===== GET /api/pos/sales — 銷售記錄 =====
router.get("/sales", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const sales = db
      .prepare(
        "SELECT s.*, l.name as location_name FROM sales s LEFT JOIN locations l ON s.location_id = l.id WHERE s.coach_id = ? ORDER BY s.created_at DESC LIMIT 100",
      )
      .all(req.user.id);
    const total = db
      .prepare("SELECT SUM(total_amount) as t FROM sales WHERE coach_id = ?")
      .get(req.user.id);
    db.close();
    res.json({ sales, total_revenue: total?.t || 0 });
  } catch (err) {
    res.status(500).json({ error: "無法取得銷售記錄" });
  }
});

module.exports = router;
