/**
 * 工單十九 — 現場補錄（Walk-in）強化
 *  POST /api/coach/attendance/walk-in   （舊路徑）
 *  POST /api/coach/schedules/:sid/walkin（新路徑）
 *  GET  /api/coach/students/lookup?phone= （現場辨識）
 *
 *  - 單一 transaction：容量／重複檢查 → 找或建學員 → 扣 Pass 或現場收款
 *    → 建 booking → Present → enrolled+1 → 推薦獎賞 → 手冊
 *  - 超額：冇 allow_overbook 回 409 CLASS_FULL（前端可確認後重送）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const referralRewards = require("../services/referral-rewards");
const coachAffiliate = require("../services/coach-affiliate");
const passes = require("../services/passes");

const router = express.Router();

const cleanPhone = (v) => String(v || "").replace(/[^\d]/g, "").replace(/^852/, "").slice(0, 8);
const cleanName = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 40);

function cols(db, t) {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); } catch (e) { return []; }
}

function loadSchedule(db, sessionId) {
  return db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.max_participants, s.coach_override_id,
              c.coach_id, c.title, c.price_hkd, c.max_participants AS class_max, c.venue_name
         FROM class_schedules s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
    )
    .get(sessionId);
}

function mayTeach(s, user) {
  const isAdmin = ["super_admin", "platform_manager", "admin"].includes(user.role);
  return isAdmin || s.coach_id === user.id || s.coach_override_id === user.id;
}

/** 現場辨識：電話 → 姓名／剩餘 Pass／舊患／是否自有學生 */
router.get("/students/lookup", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const phone = cleanPhone(req.query.phone || req.query.q);
    if (phone.length !== 8) return res.status(400).json({ success: false, error: "請輸入 8 位電話" });

    let sessionId = String(req.query.session_id || "");
    let s = null;
    if (sessionId) {
      s = loadSchedule(db, sessionId);
      if (!s) return res.status(404).json({ success: false, error: "找不到班次" });
      if (!mayTeach(s, req.user)) return res.status(403).json({ success: false, error: "只限此堂教練" });
    }

    const user = db
      .prepare("SELECT id, name, phone FROM users WHERE phone=? ORDER BY created_at LIMIT 1")
      .get(phone);
    if (!user) return res.json({ success: true, exists: false, phone, name: "", passes: [], pass_remaining: 0 });

    const list = passes.listActiveForUser(db, { id: user.id, phone });
    const total = list.reduce((sum, p) => sum + (Number(p.remaining_credits) || 0), 0);
    let health = "";
    let isOwn = false;
    let originCoachId = null;
    if (s) {
      const actualCoachId = s.coach_override_id || s.coach_id;
      const row = db
        .prepare("SELECT origin_coach_id FROM student_coach_affiliations WHERE student_user_id=? AND status='active'")
        .get(user.id);
      originCoachId = row ? row.origin_coach_id : null;
      isOwn = !!originCoachId && originCoachId === actualCoachId;
      try {
        const inv = db
          .prepare(
            "SELECT notes FROM student_onboarding_invites WHERE phone=? AND coach_id=? AND COALESCE(notes,'')<>'' ORDER BY datetime(created_at) DESC LIMIT 1",
          )
          .get(phone, actualCoachId);
        health = inv ? inv.notes : "";
      } catch (e) {}
    }
    let bk = null;
    try {
      bk = db
        .prepare("SELECT medical_notes FROM bookings WHERE user_id=? AND COALESCE(medical_notes,'')<>'' ORDER BY created_at DESC LIMIT 1")
        .get(user.id);
    } catch (e) {
      bk = null;
    }
    res.json({
      success: true,
      exists: true,
      user_id: user.id,
      name: user.name,
      phone,
      passes: list.map((p) => ({ id: p.id, remaining: p.remaining_credits, expires_at: p.expires_at })),
      pass_remaining: total,
      health_notes: health || (bk && bk.medical_notes) || "",
      is_own_student: isOwn,
      origin_coach_id: originCoachId,
    });
  } catch (e) {
    console.error("[WALKIN] lookup:", e.message);
    res.status(500).json({ success: false, error: "查詢失敗" });
  }
});

function handleWalkIn(req, res) {
  const db = getDb();
  try {
    const b = req.body || {};
    const sessionId = String(b.session_id || req.params.sid || "");
    let name = cleanName(b.student_name || b.name);
    const phone = cleanPhone(b.contact_phone || b.phone);
    const rawMethod = String(b.payment_method || "").toLowerCase();
    const notes = String(b.notes || "").slice(0, 300);
    const allowOverbook = b.allow_overbook === true || b.allowOverbook === true;

    if (!sessionId) return res.status(400).json({ success: false, error: "缺少班次" });
    if (phone.length !== 8) return res.status(400).json({ success: false, error: "請輸入 8 位香港電話" });

    const s = loadSchedule(db, sessionId);
    if (!s) return res.status(404).json({ success: false, error: "找不到班次" });
    if (!mayTeach(s, req.user)) return res.status(403).json({ success: false, error: "只限此堂教練" });

    passes.ensureSchema(db);
    let hbReady = false;
    try {
      require("./handbook-p1").ensureHandbookSchema(db);
      hbReady = true;
    } catch (e) {}
    try { coachAffiliate.ensureSchema(db); } catch (e) {}

    const bcols = cols(db, "bookings");
    if (!bcols.includes("is_walkin")) { db.exec("ALTER TABLE bookings ADD COLUMN is_walkin INTEGER DEFAULT 0"); bcols.push("is_walkin"); }
    if (!bcols.includes("collected_by")) { db.exec("ALTER TABLE bookings ADD COLUMN collected_by TEXT"); bcols.push("collected_by"); }
    const acols = cols(db, "attendances");

    const cap = Number(s.max_participants || s.class_max || 0);
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const actualCoachId = s.coach_override_id || s.coach_id;

    const tx = db.transaction(() => {
      const user = db
        .prepare("SELECT id, name FROM users WHERE phone=? ORDER BY created_at LIMIT 1")
        .get(phone);
      if (!user && name.length < 2) {
        const e = new Error("請輸入學員姓名（最少 2 字）");
        e.statusCode = 400;
        throw e;
      }

      const used = db
        .prepare("SELECT COUNT(*) c FROM bookings WHERE schedule_id=? AND status IN ('confirmed','attended')")
        .get(sessionId).c;
      if (cap > 0 && used >= cap && !allowOverbook) {
        const e = new Error("課堂已滿額，是否超額補錄？");
        e.statusCode = 409;
        e.code = "CLASS_FULL";
        e.meta = { cap, used };
        throw e;
      }

      let u = user;
      if (!u) {
        const uid = "wi-" + crypto.randomUUID();
        db.prepare(
          "INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?,?,?,?, 'user', datetime('now'))",
        ).run(uid, `walkin.${phone}.${Date.now()}@guest.zenpass.hk`, name, phone);
        u = { id: uid, name };
      }
      if (!name) name = u.name || "學員";

      // 重複補錄（同一人同一班）
      const dup = db
        .prepare("SELECT id, booking_reference FROM bookings WHERE schedule_id=? AND user_id=? AND status IN ('confirmed','attended') LIMIT 1")
        .get(sessionId, u.id);
      if (dup) {
        const e = new Error("此學員已在本班名單");
        e.statusCode = 409;
        e.code = "ALREADY_BOOKED";
        throw e;
      }

      const usable = passes.listActiveForUser(db, { id: u.id, phone })[0] || null;
      let method = rawMethod;
      if (!method) method = usable ? "pass" : "cash";
      if (method === "fps_direct") method = "fps";
      if (!["pass", "cash", "fps"].includes(method)) method = "cash";
      if (method === "pass" && !usable) method = "cash";

      const amount =
        method === "pass" ? 0 : Number(b.amount) > 0 ? Number(b.amount) : Number(s.price_hkd || 0);

      const bid = crypto.randomUUID();
      const ref = "WI" + Date.now().toString(36).toUpperCase().slice(-6);
      const dbMethod = method === "pass" ? "user_pass" : method === "fps" ? "walkin_fps" : "walkin_cash";
      const collectedBy = method === "pass" ? "platform" : "coach";
      const fields = ["id", "booking_reference", "user_id", "class_id", "schedule_id", "status", "payment_type", "payment_status", "amount", "is_walkin"];
      const vals = [bid, ref, u.id, s.class_id, sessionId, "confirmed", method === "pass" ? "pass" : "single", "paid", amount, 1];
      if (bcols.includes("payment_method")) { fields.push("payment_method"); vals.push(dbMethod); }
      if (bcols.includes("collected_by")) { fields.push("collected_by"); vals.push(collectedBy); }
      if (bcols.includes("amount_cents")) { fields.push("amount_cents"); vals.push(Math.round(amount * 100)); }
      if (bcols.includes("group_size")) { fields.push("group_size"); vals.push(1); }
      if (bcols.includes("attendee_type")) { fields.push("attendee_type"); vals.push("self"); }
      if (bcols.includes("notes")) { fields.push("notes"); vals.push(notes || "現場補錄"); }
      if (bcols.includes("pass_id")) { fields.push("pass_id"); vals.push(method === "pass" ? usable.id : null); }
      if (bcols.includes("created_at")) { fields.push("created_at"); vals.push(now); }
      db.prepare(`INSERT INTO bookings (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...vals);

      if (method === "pass") {
        passes.redeemInTx(db, { passId: usable.id, bookingId: bid, userId: u.id });
      }

      const aid = crypto.randomUUID();
      if (acols.includes("checkin_time")) {
        db.prepare(
          `INSERT INTO attendances (id, session_id, booking_id, student_name, status, checkin_time, notes, updated_by, created_at, updated_at)
           VALUES (?,?,?,?, 'present', ?, ?, ?, ?, ?)`,
        ).run(aid, sessionId, bid, name, now, notes, req.user.id, now, now);
      } else {
        db.prepare(
          "INSERT INTO attendances (id, session_id, booking_id, student_name, status, notes, created_at, updated_at) VALUES (?,?,?,?, 'present', ?, ?, ?)",
        ).run(aid, sessionId, bid, name, notes, now, now);
      }

      db.prepare("UPDATE class_schedules SET enrolled_count = COALESCE(enrolled_count,0) + 1 WHERE id=?").run(sessionId);

      // 手冊：出席＋有備註 → 即時一則
      if (hbReady && notes.trim().length >= 2) {
        const tags = [];
        if (/膝|關節|手術/.test(notes)) tags.push("關節活動度");
        if (/血壓|心臟|氣管|氣喘/.test(notes)) tags.push("身體狀況");
        if (/動作|完成度|姿勢/.test(notes)) tags.push("動作完成度");
        const logDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" });
        db.prepare(
          `INSERT INTO student_handbooks
             (id, student_id, student_name, booking_id, session_id, coach_id, log_date, tags_json, comment, allow_reply)
           VALUES (?,?,?,?,?,?,?,?,?,1)`,
        ).run(crypto.randomUUID(), u.id, name, bid, sessionId, actualCoachId, logDate, JSON.stringify(tags), notes.slice(0, 500));
      }

      const referral_reward = referralRewards.onAttendance(db, { userId: u.id, bookingId: bid });
      const pass_after = method === "pass" ? Number(usable.remaining_credits) - 1 : null;

      return {
        booking_id: bid,
        booking_reference: ref,
        user_id: u.id,
        student_name: name,
        remaining: cap > 0 ? cap - used - 1 : null,
        referral_reward,
        pass_remaining: pass_after,
        amount,
        payment_method: method,
        overbooked: cap > 0 && used >= cap,
      };
    });

    const out = tx();

    // 收益鎖定：同步底薪 + 自有補足／跨界 5%（冪等）
    try { require("./coach-earnings").syncCoachEarningsForSchedule(sessionId); } catch (e) {}
    try { coachAffiliate.settleSchedule(sessionId); } catch (e) {}

    audit({
      actionType: "attendance.walk_in",
      entityType: "booking",
      entityId: out.booking_id,
      userId: req.user.id,
      newValues: {
        session_id: sessionId,
        name,
        phone_masked: phone.slice(0, 4) + "****",
        method: out.payment_method || rawMethod || "auto",
        amount: out.amount || 0,
        collected_by: out.payment_method === "pass" ? "platform" : "coach",
      },
      description: `現場補錄學員（${s.title}）`,
    });
    res.status(201).json({
      success: true,
      ...out,
    });
  } catch (e) {
    if (e.statusCode === 409 || e.statusCode === 400) {
      return res.status(e.statusCode).json({ success: false, code: e.code || null, error: e.message, ...(e.meta || {}) });
    }
    console.error("[WALKIN]", e.message);
    res.status(500).json({ success: false, error: "補錄失敗，請重試" });
  }
}

router.post("/attendance/walk-in", authenticateToken, handleWalkIn);
router.post("/schedules/:sid/walkin", authenticateToken, handleWalkIn);
router.post("/schedules/:sid/walk-in", authenticateToken, handleWalkIn);

module.exports = router;
