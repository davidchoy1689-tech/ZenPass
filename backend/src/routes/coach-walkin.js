/**
 * 工單十 — 現場補錄學員（Walk-in）
 * POST /api/coach/attendance/walk-in
 *  - 只限該堂教練／代堂教練／管理員
 *  - 單一 transaction：容量檢查 → 找／建學員 → 建 booking（已付）→ 簽到 → enrolled_count+1
 *  - 超額一律 409，唔會半寫入
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const referralRewards = require("../services/referral-rewards");

const router = express.Router();

const cleanPhone = (v) => String(v || "").replace(/[^\d]/g, "").replace(/^852/, "").slice(0, 8);
const cleanName = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 40);

function cols(db, t) {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); } catch (e) { return []; }
}

router.post("/attendance/walk-in", authenticateToken, (req, res) => {
  const db = getDb();
  try {
    const b = req.body || {};
    const sessionId = String(b.session_id || "");
    const name = cleanName(b.student_name);
    const phone = cleanPhone(b.contact_phone);
    const method = b.payment_method === "fps_direct" ? "fps_direct" : "cash";
    const notes = String(b.notes || "").slice(0, 300);

    if (!sessionId) return res.status(400).json({ success: false, error: "缺少班次" });
    if (name.length < 2) return res.status(400).json({ success: false, error: "請輸入學員姓名（最少 2 字）" });
    if (phone.length !== 8) return res.status(400).json({ success: false, error: "請輸入 8 位香港電話" });

    const s = db
      .prepare(
        `SELECT s.id, s.class_id, s.start_time, s.end_time, s.max_participants, s.coach_override_id,
                c.coach_id, c.title, c.price_hkd, c.max_participants AS class_max, c.venue_name
           FROM class_schedules s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      )
      .get(sessionId);
    if (!s) return res.status(404).json({ success: false, error: "找不到班次" });

    const isAdmin = ["super_admin", "platform_manager", "admin"].includes(req.user.role);
    const isTeacher = s.coach_id === req.user.id || s.coach_override_id === req.user.id;
    if (!isAdmin && !isTeacher) return res.status(403).json({ success: false, error: "只限此堂教練" });

    const bcols = cols(db, "bookings");
    if (!bcols.includes("is_walkin")) db.exec("ALTER TABLE bookings ADD COLUMN is_walkin INTEGER DEFAULT 0");
    const acols = cols(db, "attendances");

    const cap = Number(s.max_participants || s.class_max || 0);
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const tx = db.transaction(() => {
      const used = db
        .prepare("SELECT COUNT(*) c FROM bookings WHERE schedule_id=? AND status IN ('confirmed','attended')")
        .get(sessionId).c;
      if (cap > 0 && used >= cap) {
        const e = new Error("本班已達場地人數上限");
        e.statusCode = 409;
        throw e;
      }

      let user = db.prepare("SELECT id, name FROM users WHERE phone=? AND role IN ('user','guest','guest_checkout') ORDER BY created_at LIMIT 1").get(phone);
      if (!user) {
        const uid = "wi-" + crypto.randomUUID();
        db.prepare(
          "INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?,?,?,?, 'user', datetime('now'))",
        ).run(uid, `walkin.${phone}.${Date.now()}@guest.zenpass.hk`, name, phone);
        user = { id: uid, name };
      }

      const bid = crypto.randomUUID();
      const ref = "WI" + Date.now().toString(36).toUpperCase().slice(-6);
      const amount = Number(s.price_hkd || 0);
      const fields = ["id", "booking_reference", "user_id", "class_id", "schedule_id", "status", "payment_type", "payment_status", "amount", "is_walkin"];
      const vals = [bid, ref, user.id, s.class_id, sessionId, "confirmed", "single", "paid", amount, 1];
      if (bcols.includes("payment_method")) { fields.push("payment_method"); vals.push(method); }
      if (bcols.includes("group_size")) { fields.push("group_size"); vals.push(1); }
      if (bcols.includes("attendee_type")) { fields.push("attendee_type"); vals.push("self"); }
      if (bcols.includes("notes")) { fields.push("notes"); vals.push(notes || "現場補錄"); }
      if (bcols.includes("created_at")) { fields.push("created_at"); vals.push(now); }
      db.prepare(`INSERT INTO bookings (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...vals);

      const aid = crypto.randomUUID();
      if (acols.includes("checkin_time")) {
        db.prepare(
          `INSERT INTO attendances (id, session_id, booking_id, student_name, status, checkin_time, updated_by, created_at, updated_at)
           VALUES (?,?,?,?, 'present', ?, ?, ?, ?)`,
        ).run(aid, sessionId, bid, name, now, req.user.id, now, now);
      } else {
        db.prepare(
          "INSERT INTO attendances (id, session_id, booking_id, student_name, status, created_at, updated_at) VALUES (?,?,?,?, 'present', ?, ?)",
        ).run(aid, sessionId, bid, name, now, now);
      }

      db.prepare("UPDATE class_schedules SET enrolled_count = COALESCE(enrolled_count,0) + 1 WHERE id=?").run(sessionId);

      // 推薦獎賞 Hook（現場補錄都算真實出席）
      const referral_reward = referralRewards.onAttendance(db, { userId: user.id, bookingId: bid });
      return { booking_id: bid, booking_reference: ref, remaining: cap > 0 ? cap - used - 1 : null, referral_reward };
    });

    const out = tx();
    audit({
      actionType: "attendance.walk_in",
      entityType: "booking",
      entityId: out.booking_id,
      userId: req.user.id,
      newValues: { session_id: sessionId, name, phone, method, amount: s.price_hkd },
      description: `現場補錄學員（${s.title}）`,
    });
    res.status(201).json({ success: true, ...out, amount: Number(s.price_hkd || 0), payment_method: method });
  } catch (e) {
    if (e.statusCode === 409) return res.status(409).json({ success: false, error: e.message });
    console.error("[WALKIN]", e.message);
    res.status(500).json({ success: false, error: "補錄失敗，請重試" });
  }
});

module.exports = router;
