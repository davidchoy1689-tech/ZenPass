/**
 * ZenPass — 同行者資料（多人報名 / 三人同行）
 * - 一張 booking 有 group_size 個位，slot 1 = 主要聯絡人（自動以帳戶姓名填）
 * - 其餘 slot 可以由預約人補填，或分享 /group.html?code=XXXX 俾同行朋友自己填
 * 2026-10-25 新增
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");

const router = express.Router();

function ensureTable(db) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS booking_participants (
       id TEXT PRIMARY KEY,
       booking_id TEXT NOT NULL,
       slot INTEGER NOT NULL,
       name TEXT,
       is_child INTEGER DEFAULT 0,
       phone TEXT,
       filled_at TEXT,
       created_at TEXT DEFAULT (datetime('now')),
       UNIQUE(booking_id, slot)
     )`,
  ).run();
}

function bookingByCode(db, code) {
  if (!code) return null;
  return db
    .prepare(
      `SELECT b.*, c.title, c.category, cs.start_time, cs.end_time
       FROM bookings b
       JOIN classes c ON c.id = b.class_id
       LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
       WHERE b.group_invite_code = ?`,
    )
    .get(String(code));
}

function listFor(db, booking) {
  const size = Math.max(1, Number(booking.group_size) || 1);
  const rows = db
    .prepare("SELECT slot, name, is_child, phone, filled_at FROM booking_participants WHERE booking_id = ?")
    .all(booking.id);
  const bySlot = {};
  rows.forEach((r) => (bySlot[r.slot] = r));
  const owner = db.prepare("SELECT name FROM users WHERE id = ?").get(booking.user_id);
  const out = [];
  for (let i = 1; i <= size; i++) {
    const r = bySlot[i];
    out.push({
      slot: i,
      name: r ? r.name : i === 1 ? owner?.name || "" : null,
      is_child: r ? Number(r.is_child) === 1 : false,
      filled: !!(r && r.name) || (i === 1 && !!owner?.name),
    });
  }
  return { group_size: size, participants: out };
}

// ===== 預約人／教練／管理員：睇同行者 =====
router.get("/bookings/:id/participants", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const booking = db
      .prepare(
        `SELECT b.*, c.coach_id FROM bookings b JOIN classes c ON c.id = b.class_id WHERE b.id = ?`,
      )
      .get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });
    const isOwner = booking.user_id === req.user.id;
    const isCoach = booking.coach_id === req.user.id;
    if (!isOwner && !isCoach && !hasMinimumRole(req.user.role, "admin")) {
      return res.status(403).json({ success: false, error: "無權查看此預約" });
    }
    res.json(Object.assign({ success: true, booking_id: booking.id }, listFor(db, booking)));
  } catch (err) {
    console.error("participants get error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取同行者資料" });
  }
});

// ===== 預約人：一次過補填 =====
router.post("/bookings/:id/participants", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });
    if (booking.user_id !== req.user.id && !hasMinimumRole(req.user.role, "admin")) {
      return res.status(403).json({ success: false, error: "無權修改此預約" });
    }
    const size = Math.max(1, Number(booking.group_size) || 1);
    const arr = Array.isArray(req.body.participants) ? req.body.participants : [];
    const up = db.prepare(
      `INSERT INTO booking_participants (id, booking_id, slot, name, is_child, phone, filled_at)
       VALUES (?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(booking_id, slot) DO UPDATE SET
         name = excluded.name, is_child = excluded.is_child, phone = excluded.phone, filled_at = datetime('now')`,
    );
    let saved = 0;
    const tx = db.transaction(() => {
      for (const p of arr) {
        const slot = Number(p.slot);
        if (!(slot >= 1 && slot <= size)) continue;
        const name = String(p.name || "").trim().slice(0, 40);
        if (!name) continue;
        up.run(crypto.randomUUID(), booking.id, slot, name, p.is_child ? 1 : 0, p.phone ? String(p.phone).slice(0, 20) : null);
        saved++;
      }
    });
    tx();
    res.json({ success: true, saved, message: `已儲存 ${saved} 位同行者資料` });
  } catch (err) {
    console.error("participants post error:", err.message);
    res.status(500).json({ success: false, error: "無法儲存同行者資料" });
  }
});

// ===== 公開：用分享碼（group_invite_code）填自己資料 =====
router.get("/group/:code", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const booking = bookingByCode(db, req.params.code);
    if (!booking) return res.status(404).json({ success: false, error: "邀請碼無效或已過期" });
    res.json(
      Object.assign(
        {
          success: true,
          code: req.params.code,
          title: booking.title,
          start_time: booking.start_time,
          end_time: booking.end_time,
          booking_reference: booking.booking_reference,
        },
        listFor(db, booking),
      ),
    );
  } catch (err) {
    res.status(500).json({ success: false, error: "無法讀取邀請資料" });
  }
});

router.post("/group/:code/fill", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const booking = bookingByCode(db, req.params.code);
    if (!booking) return res.status(404).json({ success: false, error: "邀請碼無效或已過期" });
    const size = Math.max(1, Number(booking.group_size) || 1);
    let slot = Number(req.body.slot);
    const name = String(req.body.name || "").trim().slice(0, 40);
    if (!name) return res.status(400).json({ success: false, error: "請輸入姓名" });
    if (!(slot >= 1 && slot <= size)) {
      // 未指定 → 搵第一個未填嘅位（跳過 slot 1 主要聯絡人）
      const { participants } = listFor(db, booking);
      const free = participants.find((p) => p.slot > 1 && !p.filled);
      if (!free) return res.status(400).json({ success: false, error: "名額已填滿" });
      slot = free.slot;
    }
    db.prepare(
      `INSERT INTO booking_participants (id, booking_id, slot, name, is_child, phone, filled_at)
       VALUES (?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(booking_id, slot) DO UPDATE SET
         name = excluded.name, is_child = excluded.is_child, phone = excluded.phone, filled_at = datetime('now')`,
    ).run(crypto.randomUUID(), booking.id, slot, name, req.body.is_child ? 1 : 0, req.body.phone ? String(req.body.phone).slice(0, 20) : null);
    res.json({ success: true, slot, message: `已登記「${name}」為第 ${slot} 位參加者` });
  } catch (err) {
    console.error("group fill error:", err.message);
    res.status(500).json({ success: false, error: "無法登記，請稍後再試" });
  }
});

module.exports = router;
