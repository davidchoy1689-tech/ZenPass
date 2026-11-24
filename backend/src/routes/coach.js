/**
 * ZenPass 禪流 - 教練路由
 * 教練申請、管理課程
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { getSupabase } = require("../services/supabase");
const { sendNotification, dbNotification } = require("../services/notification");
const { notifyNewApplication } = require("../services/lead-notify");

const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// 🖼️ 相片集（idempotent）
function ensurePhotoCols(db) {
  try {
    const cc = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
    if (!cc.includes("photos_gallery")) db.prepare("ALTER TABLE classes ADD COLUMN photos_gallery TEXT").run();
  } catch (e) {}
}

// 🏟️ 場地時段衝突檢查：同一場地重疊（含場主封鎖時段）
function venueConflict(db, partnerVenueId, startTime, endTime, excludeScheduleId) {
  if (!partnerVenueId) return null;
  try {
    if (!hasTable(db, "venue_blackouts")) {
      // 未有表就照查課堂衝突
    } else {
      const bo = db
        .prepare(
          `SELECT * FROM venue_blackouts WHERE venue_id = ? AND datetime(start_time) < datetime(?) AND datetime(end_time) > datetime(?) LIMIT 1`,
        )
        .get(partnerVenueId, endTime, startTime);
      if (bo) return { type: "blackout", reason: bo.reason || "場主已封鎖此時段" };
    }
    const clash = db
      .prepare(
        `SELECT s.id, s.start_time, s.end_time, c.title FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         WHERE c.partner_venue_id = ? AND s.status <> 'cancelled'
           AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?)
           AND (? IS NULL OR s.id <> ?)
         LIMIT 1`,
      )
      .get(partnerVenueId, endTime, startTime, excludeScheduleId || null, excludeScheduleId || null);
    if (clash) return { type: "class", reason: `${clash.title}（${clash.start_time}）`, schedule_id: clash.id };
  } catch (e) {
    console.error("venueConflict error:", e.message);
  }
  return null;
}

// partner_venues 未必存在（舊 DB／測試 DB）→ 動態決定要唔要 JOIN
function hasCol(db, table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col); } catch (e) { return false; }
}
function hasTable(db, name) {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name); } catch (e) { return false; }
}
// 2026-10-25：教練自助開班需要「最低成團人數」（idempotent）
(function ensureCoachClassColumns() {
  try {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
    if (!cols.includes("min_participants")) {
      db.prepare("ALTER TABLE classes ADD COLUMN min_participants INTEGER DEFAULT 1").run();
    }
  } catch (e) {
    console.error("classes.min_participants 遷移失敗:", e.message);
  }
})();


// ===== POST /api/coach/apply-public — 公開教練加盟申請（免登入）=====
// 2026-10-25：教練未加盟就冇帳號，申請表單唔應該要登入
router.post("/apply-public", require("../middleware/public-form-limit").publicFormLimiter(), require("../middleware/idempotency").optionalIdempotency, (req, res) => {
  try {
    const db = getDb();
    db.prepare(
      `CREATE TABLE IF NOT EXISTS coach_leads (
         id TEXT PRIMARY KEY,
         reference TEXT,
         name TEXT NOT NULL,
         phone TEXT NOT NULL,
         email TEXT,
         years_experience TEXT,
         certificates TEXT,
         specialties TEXT,
         bio TEXT,
         regions TEXT,
         headline TEXT,
         languages TEXT,
         note TEXT,
         status TEXT DEFAULT 'new',
         created_at TEXT DEFAULT (datetime('now'))
       )`,
    ).run();

    const name = String(req.body.name || "").trim().slice(0, 60);
    const phone = String(req.body.phone || "").replace(/[^0-9]/g, "").slice(-8);
    const email = String(req.body.email || "").trim().slice(0, 120);
    const specialties = Array.isArray(req.body.specialties) ? req.body.specialties.slice(0, 12).map((s) => String(s).slice(0, 30)) : [];

    if (!name) return res.status(400).json({ success: false, error: "請填姓名" });
    if (phone.length !== 8) return res.status(400).json({ success: false, error: "請填有效 8 位香港電話" });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ success: false, error: "請填有效電郵" });
    }
    if (!specialties.length) return res.status(400).json({ success: false, error: "請揀最少一項教學項目" });
    if (!req.body.consent) return res.status(400).json({ success: false, error: "請勾選同意條款" });

    const id = uuidv4();
    const ref = "CL-" + Date.now().toString().slice(-8);
    db.prepare(
      `INSERT INTO coach_leads
       (id, reference, name, phone, email, years_experience, certificates, specialties, bio, regions, headline, languages, note, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'new')`,
    ).run(
      id, ref, name, phone, email,
      req.body.years_experience ? String(req.body.years_experience).slice(0, 10) : null,
      req.body.certificates ? String(req.body.certificates).slice(0, 500) : null,
      JSON.stringify(specialties),
      req.body.bio ? String(req.body.bio).slice(0, 800) : null,
      req.body.regions ? String(req.body.regions).slice(0, 200) : null,
      req.body.headline ? String(req.body.headline).slice(0, 120) : null,
      Array.isArray(req.body.languages) ? JSON.stringify(req.body.languages.slice(0, 5)) : null,
      req.body.note ? String(req.body.note).slice(0, 500) : null,
    );

    // 即時通知平台（Email / Telegram / Webhook，fire-and-forget）
    try {
      notifyNewApplication("教練", {
        name, phone, email,
        specialties: specialties.join("、"),
        years: req.body.years_experience || "",
        regions: req.body.regions || "",
      }, ref);
    } catch (e) {
      console.error("coach lead notify error:", e.message);
    }

    res.status(201).json({
      success: true,
      reference: ref,
      message: "✅ 已收到你嘅教練申請，我哋會盡快用 WhatsApp 聯絡你",
    });
  } catch (err) {
    console.error("公開教練申請錯誤:", err);
    res.status(500).json({ success: false, error: "提交失敗，請稍後再試" });
  }
});

// ===== GET /api/coach/list — 獲取教練列表 =====
router.get("/list", (req, res) => {
  try {
    const db = getDb();
    const HAS_CC2 = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_credentials'").get();
    const coaches = db.prepare(`
      SELECT u.id, u.name, u.avatar_url as avatar,
        COALESCE(cr.avg_rating, 0) as rating,
        COALESCE(cr.total_students, 0) as students,
        (SELECT COUNT(*) FROM classes c WHERE c.coach_id = u.id AND c.status = 'active') as courses,
        COALESCE((SELECT ca.bio FROM coach_applications ca WHERE ca.user_id = u.id ORDER BY ca.created_at DESC LIMIT 1), '') as bio,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT c3.category) FROM classes c3
          WHERE c3.coach_id = u.id AND c3.status = 'active' AND c3.category IS NOT NULL AND c3.category <> ''), '') as specialties,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT c4.district) FROM classes c4
          WHERE c4.coach_id = u.id AND c4.status = 'active' AND c4.district IS NOT NULL AND c4.district <> ''), '') as districts,
        ${HAS_CC2 ? `(SELECT CASE WHEN cc.status='verified' AND COALESCE(cc.is_starred,0)=1
             AND (cc.license_expiry IS NULL OR cc.license_expiry = '' OR cc.license_expiry >= date('now'))
             THEN 1 ELSE 0 END FROM coach_credentials cc WHERE cc.user_id = u.id)` : "0"} as coach_starred,
        ${HAS_CC2 ? `(SELECT CASE WHEN cc.status='verified' THEN 1 ELSE 0 END FROM coach_credentials cc WHERE cc.user_id = u.id)` : "0"} as coach_verified
      FROM users u
      LEFT JOIN (
        SELECT
          cr.coach_id,
          ROUND(AVG(cr.rating), 1) as avg_rating,
          COUNT(DISTINCT cr.user_id) as total_students
        FROM coach_ratings cr
        GROUP BY cr.coach_id
      ) cr ON cr.coach_id = u.id
      WHERE u.is_coach = 1
        AND COALESCE(u.is_active, 1) = 1
        AND u.email NOT LIKE '%e2e%'
        AND u.email NOT LIKE '%@zenpass.test'
        AND u.email NOT LIKE '%@test.hk'
        AND EXISTS (SELECT 1 FROM classes c2 WHERE c2.coach_id = u.id AND c2.status = 'active')
      ORDER BY COALESCE(cr.avg_rating, 0) DESC
      LIMIT ?
    `).all(parseInt(req.query.limit) || 50);
    // 專長／地區以逗號字串回傳，前端再 split（避免多一次 N+1 查詢）
    const withTags = coaches.map((c) => ({
      ...c,
      specialties: c.specialties ? String(c.specialties).split(",").filter(Boolean) : [],
      districts: c.districts ? String(c.districts).split(",").filter(Boolean) : [],
    }));
    res.json({ success: true, coaches: withTags });
  } catch(e) {
    console.error("Error fetching coaches:", e.message);
    res.json({ success: true, coaches: [] });
  }
});

// ===== POST /api/coach/apply — 提交教練申請 =====
router.post("/apply", authenticateToken, require("../middleware/idempotency").optionalIdempotency, (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      years_experience,
      specialties,
      certificates,
      bio,
      venue_name,
      venue_address,
      venue_photos,
      facilities,
      headline,
      languages,
      avatar_url,
      id_doc_url,
      cert_doc_url,
      insurance_declared,
      insurance_doc_url,
      insurance_expiry,
    } = req.body;

    if (!name || !phone || !email || !venue_address) {
      return res.status(400).json({ success: false, error: "請填寫姓名、電話、電郵和住址" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 檢查是否已有申請
    const existing = db
      .prepare(
        "SELECT id FROM coach_applications WHERE user_id = ? AND status = 'pending'",
      )
      .get(req.user.id);

    if (existing) {

      return res.status(409).json({ success: false, error: "你已經有進行中的申請" });
    }

    const id = uuidv4();
    const specialtiesStr = Array.isArray(specialties)
      ? specialties.join(",")
      : specialties;
    const facilitiesStr = Array.isArray(facilities)
      ? facilities.join(",")
      : facilities;
    const venuePhotosStr = Array.isArray(venue_photos)
      ? venue_photos.join(",")
      : venue_photos;
    const maxCA =
      db
        .prepare(
          "SELECT MAX(CAST(SUBSTR(application_reference, 4) AS INTEGER)) as m FROM coach_applications WHERE application_reference GLOB 'CA-[0-9]*'",
        )
        .get().m || 0;
    const appRef = "CA-" + String(maxCA + 1).padStart(4, "0");

    db.prepare(
      `
      INSERT INTO coach_applications 
        (id, user_id, name, phone, email, years_experience, specialties, 
         certificates, bio, venue_name, venue_address, venue_photos, facilities,
         application_reference, headline, languages, avatar_url, id_doc_url, cert_doc_url,
         insurance_declared, insurance_doc_url, insurance_expiry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      req.user.id,
      name,
      phone,
      email,
      years_experience || null,
      specialtiesStr || null,
      certificates || null,
      bio || null,
      venue_name,
      venue_address,
      venuePhotosStr || null,
      facilitiesStr || null,
      appRef,
      headline || null,
      Array.isArray(languages) ? languages.join(",") : languages || null,
      avatar_url || null,
      id_doc_url || null,
      cert_doc_url || null,
      insurance_declared ? 1 : 0,
      insurance_doc_url || null,
      insurance_expiry || null,
    );

    // 即時通知負責人（唔阻塞回應；未配置管道都唔會出錯）
    notifyNewApplication(
      "教練",
      { name, phone, email, specialties, certificates, bio, venue_name, venue_address, years_experience },
      appRef,
    ).catch((e) => console.error("lead notify failed:", e.message));

    res.status(201).json({
      message: "申請已提交，我哋會喺 24 小時內完成審批",
      application_id: id,
      reference: appRef,
    });
  } catch (err) {
    console.error("教練申請錯誤:", err);
    res.status(500).json({ success: false, error: "提交申請失敗" });
  }
});

// ===== GET /api/coach/application — 查詢申請狀態 =====
router.get("/application", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const application = db
      .prepare(
        `
      SELECT * FROM coach_applications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(req.user.id);

    if (!application) {
      return res.json({ application: null });
    }

    res.json({ application });
  } catch (err) {
    console.error("查詢申請錯誤:", err);
    res.status(500).json({ success: false, error: "無法查詢申請狀態" });
  }
});

// ===== GET /api/coach/my-classes — 我的課程 =====
router.get("/my-classes", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const classes = db
      .prepare(
        `
      SELECT c.*, 
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'confirmed') as upcoming_bookings,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'attended') as total_attended
      FROM classes c
      WHERE c.coach_id = ? AND COALESCE(c.status,'active') <> 'deleted'
      ORDER BY c.created_at DESC
    `,
      )
      .all(req.user.id);

    res.json({ classes });
  } catch (err) {
    console.error("獲取課程錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取課程列表" });
  }
});

// ===== POST /api/coach/schedules — 新增課程時間（支援重複）=====
// ===== 🏟️ 場地 PLI（公眾責任保險）校驗 =====
function ensurePliColumns(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(partner_venues)").all().map((c) => c.name);
    const add = [
      ["business_reg_no", "TEXT"],
      ["pli_policy_no", "TEXT"],
      ["pli_expiry", "TEXT"],
      ["pli_status", "TEXT DEFAULT 'unverified'"],
      ["venue_terms_ack_at", "TEXT"],
    ];
    add.forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE partner_venues ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) {}
}

function pliGateMode(db) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key='venue.pli_gate'").get();
    if (r && ["warn", "enforce", "off"].includes(String(r.value))) return String(r.value);
  } catch (e) {}
  return String(process.env.VENUE_PLI_GATE || "warn");
}

function venuePliCheck(db, venueId, dateStr) {
  ensurePliColumns(db);
  const v = db
    .prepare("SELECT id, name, pli_status, pli_expiry, pli_policy_no FROM partner_venues WHERE id = ?")
    .get(venueId);
  if (!v) return { ok: false, code: "VENUE_NOT_FOUND", reason: "場地不存在" };
  const status = String(v.pli_status || "unverified");
  if (status === "exempt") return { ok: true, exempt: true, venue: v.name };
  const expired = !!(v.pli_expiry && String(v.pli_expiry).slice(0, 10) < String(dateStr || "").slice(0, 10));
  const ok = status === "verified" && !expired;
  return {
    ok,
    venue: v.name,
    status,
    expired,
    policy_no: v.pli_policy_no || "",
    reason: ok
      ? ""
      : status !== "verified"
        ? "該場地尚未核驗有效公眾責任保險 (PLI)"
        : "該場地公眾責任保險已過期",
  };
}

/** 2026-11-17：series 支援（每週重複開班日後可整系列改期） */
function ensureSeriesCols(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
    if (!cols.includes("series_id")) db.exec("ALTER TABLE class_schedules ADD COLUMN series_id TEXT");
    if (!cols.includes("detached_from_series"))
      db.exec("ALTER TABLE class_schedules ADD COLUMN detached_from_series INTEGER DEFAULT 0");
    if (!cols.includes("timezone"))
      db.exec("ALTER TABLE class_schedules ADD COLUMN timezone TEXT DEFAULT 'Asia/Hong_Kong'");
    // 2026-11-17：每個時段可以有自己嘅顯示名稱（唔影響課程本身）
    if (!cols.includes("title"))
      db.exec("ALTER TABLE class_schedules ADD COLUMN title TEXT");
  } catch (e) {}
}
function hkDateParts(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" });
  const o = {};
  for (const x of f.formatToParts(d)) o[x.type] = x.value;
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day) };
}
function utcMidnight(y, m, d) { return Date.UTC(y, m - 1, d); }
const { HK_TZ, parseDbTime, localPartsOf, addDaysISO, isoDayDelta, zonedLocalToUtc } = require("../utils/tz");

// 🚦 開班限流（每教練每分鐘 20 次）— 記憶體版，PM2 單進程足夠
const _coachCreateHits = new Map();
function coachRateLimit(coachId) {
  const now = Date.now();
  const row = _coachCreateHits.get(coachId) || { t: now, n: 0 };
  if (now - row.t > 60000) { row.t = now; row.n = 0; }
  row.n += 1;
  _coachCreateHits.set(coachId, row);
  if (_coachCreateHits.size > 5000) {
    for (const [k, v] of _coachCreateHits) if (now - v.t > 300000) _coachCreateHits.delete(k);
  }
  return row.n <= 20;
}

router.post("/schedules", authenticateToken, require("./../middleware/idempotency").optionalIdempotency, (req, res) => {
  if (!coachRateLimit(req.user.id)) {
    return res.status(429).json({ success: false, error: "開班太頻密，請一分鐘後再試", code: "RATE_LIMITED" });
  }
  try {
    const body = req.body || {};
    const { class_id, date: dateIn, duration_min, recurring, recurring_until, max_participants } = body;
    let start_time = body.start_time;
    let end_time = body.end_time;

    if (!class_id) {
      return res.status(400).json({ success: false, error: "請填寫課程、開始時間和結束時間" });
    }

    // ── 時間正規化（2026-11-17：多導師／時區安全）────────────────────
    // 推薦輸入： date:"YYYY-MM-DD" + start_time:"HH:mm"（HK 牆鐘）+ duration_min
    // 兼容舊輸入： start_time/end_time 已帶 Z／offset 嘅 ISO
    const clockIn = String(start_time == null ? "" : start_time).trim();
    const isLocalClock = /^\d{1,2}:\d{2}$/.test(clockIn);
    if (isLocalClock) {
      const dateISO = String(dateIn || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        return res.status(400).json({ success: false, error: "日期格式不正確（YYYY-MM-DD）", code: "INVALID_DATE" });
      }
      const [hh, mm] = clockIn.split(":");
      const hhmm = String(Number(hh)).padStart(2, "0") + ":" + String(Number(mm)).padStart(2, "0");
      if (Number(hh) > 23 || Number(mm) > 59) {
        return res.status(400).json({ success: false, error: "時間格式不正確（HH:MM）", code: "INVALID_TIME" });
      }
      const stD = zonedLocalToUtc(dateISO, hhmm);
      if (!stD) return res.status(400).json({ success: false, error: "時間有誤", code: "INVALID_DATETIME" });
      const dur = Math.min(480, Math.max(15, Number(duration_min) || 90));
      start_time = stD.toISOString();
      end_time = new Date(stD.getTime() + dur * 60000).toISOString();
    } else if (!start_time || !end_time) {
      return res.status(400).json({ success: false, error: "請填寫課程、開始時間和結束時間" });
    } else {
      // 無時區字串 → 當 UTC（同 DB 一致），避免伺服器／瀏覽器 TZ 影響
      const norm = (v) => {
        const raw = String(v);
        const d = /[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? new Date(raw) : new Date(raw.replace(" ", "T") + "Z");
        return isNaN(d) ? null : d;
      };
      const sd = norm(start_time); const ed = norm(end_time);
      if (!sd || !ed) return res.status(400).json({ success: false, error: "時間有誤", code: "INVALID_DATETIME" });
      start_time = sd.toISOString();
      end_time = ed.toISOString();
    }

    const startMsNum = Date.parse(start_time);
    const endMsNum = Date.parse(end_time);
    if (!(endMsNum > startMsNum)) {
      return res.status(400).json({ success: false, error: "結束時間必須晚於開始時間", code: "INVALID_RANGE" });
    }
    // 唔可以開已過去嘅時段（容許 15 分鐘緩衝，方便即場加堂）
    if (startMsNum < Date.now() - 15 * 60000) {
      return res.status(400).json({ success: false, error: "唔可以開已過去嘅時段", code: "IN_PAST" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Verify ownership
    const classData = db
      .prepare("SELECT * FROM classes WHERE id = ? AND coach_id = ?")
      .get(class_id, req.user.id);
    if (!classData) {

      return res.status(403).json({ success: false, error: "你無權限操作此課程" });
    }

    const recurringType = recurring || "none";
    ensureSeriesCols(db);
    const sessionTitle = String((body || {}).title || "").trim().slice(0, 60) || null;
    if (sessionTitle && sessionTitle.length < 2) {
      return res.status(400).json({ success: false, error: "時段名稱最少 2 個字", code: "MISSING_TITLE" });
    }
    const seriesId = ["weekly", "biweekly", "monthly"].includes(recurringType) && recurring_until
      ? "ser_" + uuidv4().replace(/-/g, "").slice(0, 10)
      : null;
    const maxP = max_participants || classData.max_participants;
    const scheduleIds = [];
    const skipped = [];

    // 🛡️ 場地 PLI 閘門（未核驗／過期 → 視乎模式阻擋或警告）
    let pliWarning = null;
    if (classData.partner_venue_id) {
      const chk = venuePliCheck(db, classData.partner_venue_id, start_time);
      if (!chk.ok) {
        const mode = pliGateMode(db);
        if (mode === "enforce") {
          return res.status(400).json({
            success: false,
            error: chk.reason + "，暫不可發布課堂（請管理員更新場地保單）",
            code: "VENUE_PLI_INVALID",
            venue: chk.venue || "",
          });
        }
        if (mode === "warn") pliWarning = chk.reason;
      }
    }

    // 🏟️ 合作場地撞期／封鎖檢查（每一堂都要查）
    const venueClashFor = (stISO, enISO) => {
      if (!classData.partner_venue_id) return null;
      return venueConflict(db, classData.partner_venue_id, stISO, enISO, null);
    };

    // ── 展開要開嘅堂（全部 UTC instant）──
    const planned = [];
    if (recurringType === "none" || !recurring_until) {
      planned.push({ start: start_time, end: end_time });
    } else {
      const untilDate = parseDbTime(recurring_until);
      if (!untilDate) return res.status(400).json({ success: false, error: "結束日期有誤", code: "INVALID_UNTIL" });
      let cs = new Date(start_time);
      let ce = new Date(end_time);
      planned.push({ start: cs.toISOString(), end: ce.toISOString() });
      const stepDays = recurringType === "biweekly" ? 14 : 7;
      while (planned.length < 365) {
        const ns = new Date(cs);
        const ne = new Date(ce);
        if (recurringType === "monthly") {
          ns.setUTCMonth(ns.getUTCMonth() + 1);
          ne.setUTCMonth(ne.getUTCMonth() + 1);
        } else {
          ns.setUTCDate(ns.getUTCDate() + stepDays);
          ne.setUTCDate(ne.getUTCDate() + stepDays);
        }
        if (ns.getTime() > untilDate.getTime()) break;
        planned.push({ start: ns.toISOString(), end: ne.toISOString() });
        cs = ns; ce = ne;
      }
    }

    // ── 同教練撞期檢查（跳過衝突堂並回報）──
    const findCoachClash = (stISO, enISO) =>
      db
        .prepare(
          `SELECT s.id, s.start_time FROM class_schedules s JOIN classes c2 ON c2.id = s.class_id
            WHERE c2.coach_id = ?
              AND s.status NOT IN ('cancelled','completed')
              AND datetime(s.start_time) < datetime(?)
              AND datetime(s.end_time) > datetime(?)
            LIMIT 1`,
        )
        .get(req.user.id, enISO, stISO);

    const kept = [];
    for (const p of planned) {
      const clash = findCoachClash(p.start, p.end);
      if (clash) {
        skipped.push({ start_time: p.start, reason: "COACH_CLASH", clash_with: clash.id, clash_start: clash.start_time });
        continue;
      }
      const vc = venueClashFor(p.start, p.end);
      if (vc) {
        skipped.push({
          start_time: p.start,
          reason: vc.type === "blackout" ? "VENUE_BLACKOUT" : "VENUE_CLASH",
          detail: vc.reason || "",
        });
        continue;
      }
      kept.push(p);
    }
    if (!kept.length) {
      return res.status(409).json({
        success: false,
        error: "時段同你已有課堂撞期，未能建立",
        code: "NO_SLOTS_CREATED",
        skipped,
      });
    }

    // ── 一次過插入（單一 transaction，避免半成功）──
    const insertSchedule = db.prepare(
      `INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants, series_id, title, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const p of kept) {
        const id = uuidv4();
        insertSchedule.run(
          id,
          class_id,
          p.start,
          p.end,
          recurringType,
          maxP,
          kept.length > 1 && !seriesId ? "ser_" + uuidv4().replace(/-/g, "").slice(0, 10) : seriesId,
          sessionTitle,
          HK_TZ,
        );
        scheduleIds.push(id);
      }
    });
    tx();
    const effSeriesId = seriesId || (scheduleIds.length > 1 ? db.prepare("SELECT series_id FROM class_schedules WHERE id=?").get(scheduleIds[0]).series_id : null);

    // ⛓️ 區塊鏈：記錄課堂時間建立
    try {
      for (const sid of scheduleIds) {
        writeBlock({
          entityType: "class_schedule",
          entityId: sid,
          data: {
            class_id,
            start_time,
            end_time,
            recurring: recurringType,
            max_participants: max_participants || classData.max_participants,
            status: "available",
            coach_id: req.user.id,
          },
        });
      }
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (schedule create):", bcErr.message);
    }

    res.status(201).json({
      success: true,
      message: `時間已新增（共 ${scheduleIds.length} 個時段）`,
      schedule_ids: scheduleIds,
      count: scheduleIds.length,
      timezone: HK_TZ,
      series_id: effSeriesId,
      schedules: scheduleIds.map((sid) => {
        const row = db.prepare("SELECT id, title, start_time, end_time, max_participants FROM class_schedules WHERE id = ?").get(sid);
        const lp = localPartsOf(parseDbTime(row.start_time));
        const le = localPartsOf(parseDbTime(row.end_time));
        return {
          id: row.id, title: row.title || classData.title, starts_at: row.start_time, ends_at: row.end_time,
          local_date: lp.date, local_time: lp.time, local_end_time: le.time,
          max_participants: row.max_participants, timezone: HK_TZ,
        };
      }),
      ...(skipped.length ? { skipped } : {}),
      ...(pliWarning ? { pli_warning: pliWarning } : {}),
    });
  } catch (err) {
    console.error("新增時間錯誤:", err);
    res.status(500).json({ success: false, error: "無法新增時間" });
  }
});

// ===== PATCH /api/coach/schedules/:id — 改單一時段名稱／名額 =====
// body: { title: "週末加強班", max_participants: 10 }
//       （title 傳 null／空字串 = 還原跟課程名）
router.patch("/schedules/:id", authenticateToken, require("./../middleware/idempotency").optionalIdempotency, (req, res) => {
  try {
    const db = getDb();
    ensureSeriesCols(db);
    const id = String(req.params.id || "");
    const body = req.body || {};
    const raw = body.title;
    const name = raw === null || raw === undefined ? null : String(raw).trim().slice(0, 60) || null;
    const hasTitle = raw !== undefined;
    const hasCap = body.max_participants !== undefined;
    if (!hasTitle && !hasCap) {
      return res.status(400).json({ success: false, error: "沒有需要更新的資料" });
    }

    const sel = db
      .prepare(
        `SELECT s.id, s.title, s.start_time, s.status, s.max_participants, c.title AS class_title, c.coach_id
           FROM class_schedules s JOIN classes c ON c.id = s.class_id
          WHERE s.id = ?`,
      )
      .get(id);
    if (!sel) return res.status(404).json({ success: false, error: "找不到此班次" });

    const isAdmin = ["super_admin", "platform_manager", "admin"].includes(String(req.user.role || ""));
    if (!isAdmin && String(sel.coach_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: "只可以改自己帶領嘅班次" });
    }

    const sets = [];
    const params = [];
    let newCap = null;
    if (hasTitle) {
      sets.push("title = ?"); params.push(name);
    }
    if (hasCap) {
      if (["cancelled", "completed"].includes(String(sel.status))) {
        return res.status(409).json({ success: false, error: "此班次已取消或已完結，唔可以改名額" });
      }
      const cap = Number(body.max_participants);
      if (!Number.isInteger(cap) || cap < 1 || cap > 200) {
        return res.status(400).json({ success: false, error: "名額要介乎 1–200 人" });
      }
      const booked = Number(
        db.prepare(
          "SELECT COALESCE(SUM(COALESCE(group_size,1)),0) AS c FROM bookings WHERE schedule_id = ? AND status IN ('confirmed','attended')",
        ).get(id).c,
      ) || 0;
      if (cap < booked) {
        return res.status(409).json({ success: false, error: `已有 ${booked} 位學員，名額唔可以少過 ${booked}` });
      }
      sets.push("max_participants = ?"); params.push(cap);
      newCap = cap;
    }

    db.prepare(`UPDATE class_schedules SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    try {
      require("../services/audit").audit({
        actionType: hasCap ? "schedule.updated" : "schedule.renamed",
        entityType: "class_schedule",
        entityId: id,
        userId: req.user.id,
        oldValues: { title: sel.title || null, max_participants: sel.max_participants },
        newValues: { title: hasTitle ? name : sel.title, max_participants: hasCap ? newCap : sel.max_participants },
        description: hasCap
          ? `時段名額：${sel.max_participants || "?"} → ${newCap}（${sel.title || sel.class_title}）`
          : `時段改名：${sel.title || sel.class_title} → ${name || sel.class_title + "（跟課程名）"}`,
      });
    } catch (e) {}

    res.json({
      success: true,
      message: "✅ 已更新時段",
      data: {
        id,
        title: hasTitle ? name || sel.class_title : sel.title || sel.class_title,
        custom_title: hasTitle ? name : sel.title,
        max_participants: hasCap ? newCap : sel.max_participants,
      },
    });
  } catch (err) {
    console.error("coach/schedules PATCH error:", err.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

// ===== GET /api/coach/profile — 獲取教練個人資料（SQLite）=====
router.get("/profile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const u = db
      .prepare(
        `SELECT id, name, email, phone, avatar_url, is_coach, coach_verified, coach_headline, coach_bio,
                coach_tags, coach_languages, coach_years, commission_rate, wallet_balance, pending_payout,
                bank_name, bank_account, public_bio, public_contact_phone, created_at
           FROM users WHERE id = ?`,
      )
      .get(req.user.id);
    if (!u) return res.status(404).json({ success: false, error: "用戶不存在" });
    res.json({ success: true, coach: u });
  } catch (err) {
    console.error("[COACH] profile:", err.message);
    res.status(500).json({ success: false, error: "無法獲取資料" });
  }
});

// ===== POST /api/coach/profile — 舊介面（已棄用，改用 /public-profile）=====
router.post("/profile", authenticateToken, (req, res) => {
  res.status(410).json({
    success: false,
    code: "ENDPOINT_RETIRED",
    error: "此介面已停用，請使用 /api/coach/public-profile",
  });
});

// ===== GET /api/coach/public-profile — 我嘅教練公開資料 =====
router.get("/public-profile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const u = db
      .prepare(
        "SELECT id, name, avatar_url, is_coach, coach_verified, coach_headline, coach_bio, coach_tags, coach_languages, coach_years FROM users WHERE id = ?",
      )
      .get(req.user.id);
    if (!u) return res.status(404).json({ success: false, error: "用戶不存在" });
    res.json({ success: true, data: u });
  } catch (err) {
    console.error("coach/public-profile GET error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取資料" });
  }
});

// ===== POST /api/coach/public-profile — 更新教練公開資料 =====
router.post("/public-profile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT is_coach FROM users WHERE id = ?").get(req.user.id);
    if (!u) return res.status(404).json({ success: false, error: "用戶不存在" });
    if (!u.is_coach) return res.status(403).json({ success: false, error: "只限已批核教練" });

    const { headline, bio, tags, languages, years, avatar_url } = req.body || {};
    const clean = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
    const join = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(",") : clean(v));
    const yrs = years === undefined || years === null || years === "" ? null : Math.max(0, Math.min(70, parseInt(years, 10) || 0));

    db.prepare(
      `UPDATE users SET coach_headline = COALESCE(?, coach_headline),
                        coach_bio = COALESCE(?, coach_bio),
                        coach_tags = COALESCE(?, coach_tags),
                        coach_languages = COALESCE(?, coach_languages),
                        coach_years = COALESCE(?, coach_years),
                        avatar_url = COALESCE(?, avatar_url),
                        updated_at = datetime('now')
       WHERE id = ?`,
    ).run(clean(headline), clean(bio), join(tags), join(languages), yrs, clean(avatar_url), req.user.id);

    res.json({ success: true, message: "✅ 教練資料已更新，會自動顯示於你嘅課程頁" });
  } catch (err) {
    console.error("coach/public-profile POST error:", err.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

// ===== POST /api/coach/classes — 教練自助開班（唔需要商戶）=====
router.post("/classes", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db.prepare("SELECT id, name, is_coach, coach_verified FROM users WHERE id = ?").get(req.user.id);
    if (!me) return res.status(404).json({ success: false, error: "用戶不存在" });
    if (!me.is_coach) return res.status(403).json({ success: false, error: "只限已批核教練開班，請先申請成為教練" });

    const {
      title, category, sport_slug, description, difficulty, duration,
      max_participants, price_hkd, credits_cost, target_audience, image_url,
      venue = {}, schedules,
    } = req.body || {};

    ensurePhotoCols(db);
    const photos = Array.isArray(req.body.photos) ? req.body.photos.slice(0, 5).map((u) => String(u).slice(0, 300)) : [];
    if (!title || !category || !duration) {
      return res.status(400).json({ success: false, error: "請填寫課程標題、類別及時長" });
    }
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({ success: false, error: "請至少新增一個上堂時段" });
    }
    if (schedules.length > 60) return res.status(400).json({ success: false, error: "一次最多 60 個時段" });

    let venueName = String(venue.name || "").trim();
    let venueAddress = String(venue.address || "").trim();
    let partnerVenueId = null;
    let district = "";

    if (venue.partner_venue_id) {
      const v = db
        .prepare("SELECT id, name, address, district FROM partner_venues WHERE id = ? AND status = 'active'")
        .get(venue.partner_venue_id);
      if (!v) return res.status(400).json({ success: false, error: "場地不存在或未開通" });
      partnerVenueId = v.id;
      venueName = v.name;
      venueAddress = v.address || "";
      const { resolveDistrict } = require("../services/district");
      district = resolveDistrict(v.district) || resolveDistrict([v.address, v.name].filter(Boolean).join(" ")) || "";
    } else {
      if (!venueName) return res.status(400).json({ success: false, error: "請選擇場地或填寫場地名稱" });
      const { resolveDistrict } = require("../services/district");
      district = resolveDistrict([venue.district, venueAddress, venueName].filter(Boolean).join(" ")) || "";
    }

    // 時段驗證
    const { v4: uuidv4 } = require("uuid");
    const now = Date.now();
    const maxAhead = now + 1000 * 60 * 60 * 24 * 92; // 約 3 個月
    for (const s of schedules) {
      const st = new Date(s.start_time).getTime();
      const et = new Date(s.end_time).getTime();
      if (!st || !et) return res.status(400).json({ success: false, error: "時段時間格式錯誤" });
      if (et <= st) return res.status(400).json({ success: false, error: "完結時間必須遲過開始時間" });
      if (st < now - 1000 * 60 * 5) return res.status(400).json({ success: false, error: "唔可以開過去嘅時段" });
      if (st > maxAhead) return res.status(400).json({ success: false, error: "只可以開未來 3 個月嘅班" });
    }

    // 🏟️ 合作場地撞期／封鎖檢查
    if (partnerVenueId) {
      for (const s of schedules) {
        const cf = venueConflict(db, partnerVenueId, s.start_time, s.end_time, null);
        if (cf) {
          return res.status(409).json({
            success: false,
            error: cf.type === "blackout" ? `場地此時段唔開放（${cf.reason}）` : `場地撞期：${cf.reason}`,
          });
        }
      }
    }

    const finalPrice = Number(price_hkd) || 0;
    const credits = Number(credits_cost) || Math.max(3, Math.round(finalPrice / 10));
    const classId = uuidv4();

    db.prepare(
      `INSERT INTO classes (id, coach_id, title, description, category, difficulty,
         duration, max_participants, price_hkd, credits_cost, venue_name, venue_address,
         target_audience, image_url, partner_venue_id, partner_id, district, sport_slug,
         status, booking_open, vip_priority_hours, min_participants, photos_gallery, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(
      classId, me.id, title, description || "", category, difficulty || "beginner",
      Number(duration), Number(max_participants) || 15, finalPrice, credits,
      venueName, venueAddress, target_audience || null, (photos[0] || image_url || "/assets/images/default-sport.svg"),
      partnerVenueId, partnerVenueId, district || null, sport_slug || null,
      req.body.vip_priority_hours === 0 ? 0 : 24,
      Math.max(1, Number(req.body.min_participants) || 1),
      photos.length ? JSON.stringify(photos) : null,
    );

    const ids = [];
    for (const s of schedules) {
      const sid = uuidv4();
      db.prepare(
        `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 'available', datetime('now'))`,
      ).run(sid, classId, s.start_time, s.end_time, Number(s.max_participants) || Number(max_participants) || 15);
      ids.push(sid);
    }

    res.status(201).json({
      success: true,
      message: "✅ 已建立班別，待平台開通後會喺探索頁公開",
      data: { id: classId, schedules: ids.length, district: district || null, booking_open: 0 },
    });
  } catch (err) {
    console.error("coach/classes POST error:", err.message);
    res.status(500).json({ success: false, error: "開班失敗：" + err.message });
  }
});

// ===== GET /api/coach/sessions — 我嘅所有時段（可 filter=upcoming|completed|cancelled）=====
router.get("/sessions", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSeriesCols(db);
    const HAS_PV = hasTable(db, "partner_venues") && hasCol(db, "partner_venues", "rental_price_per_hour");
    const filter = String(req.query.filter || "upcoming");
    const rows = db
      .prepare(
        `SELECT s.id, s.start_time, s.end_time, s.status, s.enrolled_count, s.max_participants,
                s.series_id, COALESCE(s.timezone,'Asia/Hong_Kong') AS timezone,
                c.id as class_id, COALESCE(NULLIF(s.title,''), c.title) AS title, c.title AS class_title, c.venue_name, c.venue_address, c.district,
                c.price_hkd, c.min_participants, c.duration, c.booking_open, c.category, c.sport_slug,
                c.partner_venue_id, ${HAS_PV ? "pv.name" : "NULL"} as partner_venue_name, ${HAS_PV ? "pv.rental_price_per_hour" : "NULL"} as rental_price_per_hour, ${HAS_PV ? "pv.phone" : "NULL"} as venue_phone,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status IN ('confirmed','attended')) as booked
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         ${HAS_PV ? "LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id" : ""}
         WHERE c.coach_id = ? AND COALESCE(c.status,'active') <> 'deleted'
         ORDER BY s.start_time DESC
         LIMIT 300`,
      )
      .all(req.user.id);
    const nowMs = Date.now();
    const norm = rows.map((r) => {
      const d = parseDbTime(r.start_time);
      const t = d ? d.getTime() : 0;
      const lp = d ? localPartsOf(d) : { date: null, time: null };
      return {
        ...r,
        end_ms: t + (Number(r.duration) || 60) * 60000,
        start_ms: t,
        booked: Number(r.booked) || 0,
        local_date: lp.date,
        local_time: lp.time,
      };
    });
    let out =
      filter === "completed"
        ? norm.filter((r) => r.status !== "cancelled" && r.end_ms < nowMs)
        : filter === "cancelled"
          ? norm.filter((r) => r.status === "cancelled")
          : norm.filter((r) => r.status !== "cancelled" && r.end_ms >= nowMs);
    // 「即將開班」要由最近排起（原本 SQL 用 DESC，會顯示最遠嘅先）
    if (filter === "upcoming") out = out.slice().sort((a, b) => a.start_ms - b.start_ms);
    if (filter === "completed") out = out.slice().sort((a, b) => b.start_ms - a.start_ms);
    if (filter === "all") out = out.slice().sort((a, b) => a.start_ms - b.start_ms);
    res.json({ success: true, filter, sessions: out });
  } catch (err) {
    console.error("coach/sessions error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取課堂時段" });
  }
});

// ===== POST /api/coach/schedules/:sid/settle — 課堂結束結算（封存對賬）=====
router.post(
  "/schedules/:sid/settle",
  authenticateToken,
  require("../middleware/idempotency").optionalIdempotency,
  (req, res) => {
  try {
    const db = getDb();
    // idempotent 欄位
    const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
    if (!cols.includes("settled_at")) db.prepare("ALTER TABLE class_schedules ADD COLUMN settled_at TEXT").run();
    if (!cols.includes("settle_summary")) db.prepare("ALTER TABLE class_schedules ADD COLUMN settle_summary TEXT").run();

    const row = db
      .prepare(
        `SELECT s.*, c.coach_id, c.title, c.price_hkd FROM class_schedules s
         JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      )
      .get(req.params.sid);
    if (!row) return res.status(404).json({ success: false, error: "時段不存在" });
    if (row.coach_id !== req.user.id) return res.status(403).json({ success: false, error: "你無權結算此班" });
    // 已封存 → 回傳上次結果（天然冪等，唔會重複寫 blockchain／改 settled_at）
    if (row.settled_at) {
      let prev = {};
      try { prev = JSON.parse(row.settle_summary || "{}"); } catch (e) {}
      return res.json({ success: true, message: "✅ 已封存結算（重複提交）", summary: prev, already_settled: true });
    }

    const counts = db
      .prepare(
        `SELECT COUNT(*) total,
                SUM(CASE WHEN status = 'attended' THEN COALESCE(group_size,1) ELSE 0 END) attended_heads,
                SUM(CASE WHEN status IN ('confirmed','attended') THEN COALESCE(group_size,1) ELSE 0 END) enrolled_heads
         FROM bookings WHERE schedule_id = ? AND status IN ('confirmed','attended','no_show')`,
      )
      .get(req.params.sid) || {};
    const user = db.prepare("SELECT commission_rate, name FROM users WHERE id = ?").get(req.user.id) || {};
    const rate = Number(user.commission_rate) || 0.8;
    const price = Number(row.price_hkd) || 0;
    const attendedHeads = Number(req.body.attended_heads != null ? req.body.attended_heads : counts.attended_heads) || 0;
    const enrolledHeads = Number(counts.enrolled_heads) || 0;
    const gross = Math.round(attendedHeads * price * 100) / 100;

    // 🏟️ 場地費：平台合作場地可自動計租金；教練自租場地 → 由教練自行支付（可手動輸入實際租金）
    let venueMode = String(req.body.venue_mode || "").toLowerCase();
    let venueFee = 0;
    let venueName = null;
    let venueAuto = 0;
    if (row.partner_venue_id) {
      const v = db
        .prepare("SELECT name, rental_price_per_hour FROM partner_venues WHERE id = ?")
        .get(row.partner_venue_id);
      if (v) {
        venueName = v.name;
        const hours = (Number(row.duration) || 60) / 60;
        venueAuto = Math.round((Number(v.rental_price_per_hour) || 0) * hours * 100) / 100;
      }
    }
    if (!venueMode) venueMode = row.partner_venue_id ? "partner" : "self";
    if (venueMode === "partner") venueFee = venueAuto;
    else venueFee = Math.max(0, Number(req.body.venue_fee) || 0);

    const platformFee = Math.round(gross * (1 - rate) * 100) / 100;
    const net = Math.max(0, Math.round((gross - venueFee - platformFee) * 100) / 100);

    const summary = {
      settled_at: new Date().toISOString(),
      attended_heads: attendedHeads,
      enrolled_heads: enrolledHeads,
      absent_heads: Math.max(0, enrolledHeads - attendedHeads),
      unit_price: price,
      gross,
      venue_mode: venueMode,
      venue_name: venueName,
      venue_fee: venueFee,
      venue_fee_auto: venueAuto,
      platform_rate: Math.round((1 - rate) * 100) / 100,
      platform_fee: platformFee,
      commission_rate: rate,
      net,
      by: req.user.id,
    };
    db.prepare("UPDATE class_schedules SET settled_at = datetime('now'), settle_summary = ? WHERE id = ?").run(
      JSON.stringify(summary),
      row.id,
    );
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "coach_settlement", entityId: row.id, data: summary });
    } catch (e) {}

    res.json({ success: true, message: "✅ 已封存結算", summary, venue_auto: venueAuto });
  } catch (err) {
    console.error("coach settle error:", err.message);
    res.status(500).json({ success: false, error: "結算失敗" });
  }
  },
);

// ===== GET /api/coach/classes/:id/sessions — 我嘅班別時段 =====
router.get("/classes/:id/sessions", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const cls = db.prepare("SELECT id, title, coach_id, booking_open, min_participants, max_participants, duration FROM classes WHERE id = ?").get(req.params.id);
    if (!cls) return res.status(404).json({ success: false, error: "課程不存在" });
    if (cls.coach_id !== req.user.id) return res.status(403).json({ success: false, error: "你無權限睇此課程" });
    const rows = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status IN ('confirmed','attended')) as booked
         FROM class_schedules s WHERE s.class_id = ? ORDER BY s.start_time ASC`,
      )
      .all(cls.id);
    res.json({ success: true, class: cls, sessions: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取時段失敗" });
  }
});

// ===== POST /api/coach/schedules/:sid/cancel — 取消未有人報名嘅時段 =====
router.post("/schedules/:sid/cancel", authenticateToken, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    const s = db
      .prepare(
        `SELECT s.*, c.coach_id, c.title FROM class_schedules s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      )
      .get(req.params.sid);
    if (!s) return res.status(404).json({ success: false, error: "時段不存在" });
    if (String(s.coach_override_id || s.coach_id) !== req.user.id) {
      return res.status(403).json({ success: false, error: "你無權限操作此班" });
    }
    require("../services/booking-service").ensureRefundColumns(db);
    const bookings = db
      .prepare(
        `SELECT * FROM bookings WHERE schedule_id=? AND status IN ('confirmed','pending_payment')`,
      )
      .all(s.id);
    const attended = db
      .prepare("SELECT COUNT(*) c FROM bookings WHERE schedule_id=? AND status='attended'")
      .get(s.id).c;
    if (attended > 0) {
      return res.status(400).json({ success: false, error: "此班已有出席紀錄，不能取消，請聯絡平台" });
    }

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    let refunded = 0;
    const affected = [];
    for (const b of bookings) {
      db.prepare(
        `UPDATE bookings
            SET status='cancelled', cancel_reason='coach_emergency_cancel', cancelled_at=datetime('now'),
                cancelled_by_user_id=?, attendance_status='cancelled_by_coach'
          WHERE id=? AND status IN ('confirmed','pending_payment')`,
      ).run(req.user.id, b.id);
      db.prepare(
        "UPDATE class_schedules SET enrolled_count=MAX(0,COALESCE(enrolled_count,0)-?) WHERE id=?",
      ).run(Number(b.group_size) || 1, s.id);
      if (b.payment_type === "pass" && b.pass_id) {
        try {
          const okRefund = require("../services/passes").restoreInTx(db, { passId: b.pass_id, bookingId: b.id });
          if (okRefund) refunded++;
        } catch (e) {
          console.error("[COACH CANCEL] pass restore:", e.message);
        }
      }
      if (b.slot_id) {
        try { db.prepare("UPDATE coach_availability_slots SET status='cancelled' WHERE id=?").run(b.slot_id); } catch (e) {}
      }
      affected.push({ booking_id: b.id, user_id: b.user_id, pass_id: b.pass_id || null });
    }
    db.prepare("UPDATE class_schedules SET status='cancelled', booking_open=0 WHERE id=?").run(s.id);
    db.exec("COMMIT");
    inTx = false;

    try {
      require("../services/audit").audit({
        actionType: "coach.schedule_emergency_cancelled",
        entityType: "class_schedule",
        entityId: s.id,
        userId: req.user.id,
        newValues: { title: s.title, affected: affected.length, pass_refunded: refunded },
        description: "教練緊急取消班次",
      });
    } catch (e) {}
    try {
      const { sendNotification } = require("../services/notification");
      for (const a of affected) {
        sendNotification("booking.cancelled", {
          recipient: a.user_id,
          data: { booking_id: a.booking_id, message: "教練因急事取消課堂，已為你取消預約；如使用 Pass，1 堂已退回。" },
        });
      }
    } catch (e) {}
    try {
      const { autoNotifyOnCancel } = require("./waitlist");
      autoNotifyOnCancel(s.id);
    } catch (e) {}

    res.json({
      success: true,
      message: bookings.length ? `已取消班次，${affected.length} 位學員受影響，${refunded} 堂已退回` : "已取消該時段",
      affected: affected.length,
      pass_refunded: refunded,
    });
  } catch (err) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (e) {} }
    console.error("[COACH CANCEL]", err.message);
    res.status(500).json({ success: false, error: "取消失敗" });
  }
});

// ===== GET /api/coach/my-rating — 我嘅教練評分（階段 1：只自己睇）=====
router.get("/my-rating", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const { coachComposite, coachAggregate } = require("../services/mutual-review");
    const comp = coachComposite(req.user.id);
    const agg = coachAggregate(req.user.id);
    const summary = {
      score: comp.student_rating !== null && comp.student_rating !== undefined ? comp.student_rating : 0,
      raw_avg: agg.student.raw_avg,
      count: agg.student_count,
    };

    const dist = db
      .prepare(
        `SELECT rating, COUNT(*) c FROM mutual_reviews
         WHERE target_type='coach' AND target_id=? AND rater_role='student'
         GROUP BY rating ORDER BY rating DESC`,
      )
      .all(req.user.id);

    const recent = db
      .prepare(
        `SELECT rating, comment, created_at FROM mutual_reviews
         WHERE target_type='coach' AND target_id=? AND rater_role='student' AND comment <> ''
         ORDER BY created_at DESC LIMIT 10`,
      )
      .all(req.user.id)
      .map((r) => ({ ...r, student: "匿名學員" }));

    res.json({
      success: true,
      data: {
        ...summary,
        composite_score: comp.score,
        student_rating: comp.student_rating,
        venue_rating: comp.venue_rating,
        venue_rating_count: comp.venue_count,
        distribution: dist,
        recent,
        note:
          summary.count < 10
            ? "累積 10 個真實評價後，評分才會公開顯示於課程頁。"
            : "評分已達公開門檻。",
      },
    });
  } catch (err) {
    console.error("coach/my-rating error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取評分" });
  }
});

// ===== POST /api/coach/refer — 推薦新教練 =====
router.post("/refer", authenticateToken, (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email)
      return res.status(400).json({ success: false, error: "請填寫教練姓名和電郵" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Log the referral
    db.prepare(
      `
      INSERT INTO referral_codes (id, user_id, code)
      VALUES (?, ?, ?)
    `,
    ).run(
      uuidv4(),
      req.user.id,
      "COACH-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
    );

    // Notify admins（原本用 user_id，永遠發唔出）
    try {
      const admins = db
        .prepare("SELECT id FROM users WHERE role IN ('admin','super_admin','platform_manager')")
        .all();
      for (const a of admins) {
        sendNotification("coach.referral", {
          recipient: a.id,
          data: {
            name,
            email,
            phone,
            referred_by: req.user.name || req.user.email || req.user.id,
          },
        });
      }
    } catch (e) {
      console.error("⚠️ coach referral notify failed:", e.message);
    }

    res.json({ success: true, message: "✅ 推薦已提交！管理員會聯絡 " + name });
  } catch (err) {
    console.error("Coach refer error:", err.message);
    res.status(500).json({ success: false, error: "推薦失敗" });
  }
});

// ===== 📜 教練獨立合約人協議（ca-v1-2026-10）=====
const { COACH_AGREEMENT_V1 } = require("../config/coach-agreement");

function ensureAgreementColumns(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(coach_credentials)").all().map((c) => c.name);
    [["agreement_version", "TEXT"], ["agreement_ack_at", "TEXT"]].forEach(([n, t]) => {
      if (!cols.includes(n)) db.prepare(`ALTER TABLE coach_credentials ADD COLUMN ${n} ${t}`).run();
    });
  } catch (e) {}
}

// 公開：協議全文（教練工作台／註冊流程顯示）
router.get("/agreement", (req, res) => {
  res.json({ success: true, agreement: COACH_AGREEMENT_V1 });
});

// 教練：查詢自己嘅簽署狀態
router.get("/agreement/status", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureAgreementColumns(db);
    const row = db
      .prepare("SELECT agreement_version, agreement_ack_at FROM coach_credentials WHERE user_id = ? ORDER BY COALESCE(reviewed_at, created_at) DESC LIMIT 1")
      .get(req.user.id);
    const accepted = !!(row && row.agreement_version === COACH_AGREEMENT_V1.version);
    res.json({ success: true, required_version: COACH_AGREEMENT_V1.version, accepted, ack_at: row ? row.agreement_ack_at : null });
  } catch (err) {
    res.status(500).json({ success: false, error: "查詢失敗" });
  }
});

// 教練：確認接受（記錄版本＋時間戳）
router.post("/agreement/accept", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureAgreementColumns(db);
    if ((req.body || {}).agreed !== true) {
      return res.status(400).json({ success: false, error: "請先勾選確認", code: "AGREEMENT_NOT_ACCEPTED" });
    }
    let row = db
      .prepare("SELECT id FROM coach_credentials WHERE user_id = ? ORDER BY COALESCE(reviewed_at, created_at) DESC LIMIT 1")
      .get(req.user.id);
    if (!row) {
      const id = uuidv4();
      db.prepare(
        "INSERT INTO coach_credentials (id, user_id, status, created_at) VALUES (?, ?, 'pending', datetime('now'))",
      ).run(id, req.user.id);
      row = { id };
    }
    db.prepare(
      "UPDATE coach_credentials SET agreement_version = ?, agreement_ack_at = datetime('now') WHERE id = ?",
    ).run(COACH_AGREEMENT_V1.version, row.id);

    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
         VALUES (?, 'coach.agreement_accepted', 'coach_credential', ?, ?, ?, ?, datetime('now'))`,
      ).run(
        uuidv4(), row.id, req.user.id,
        JSON.stringify({ version: COACH_AGREEMENT_V1.version, ip: req.ip || null }),
        `教練簽署獨立合約人協議 ${COACH_AGREEMENT_V1.version}`,
      );
    } catch (e) {}

    res.json({ success: true, version: COACH_AGREEMENT_V1.version, message: "✅ 已記錄協議簽署" });
  } catch (err) {
    console.error("[AGREEMENT] accept error:", err.message);
    res.status(500).json({ success: false, error: "簽署失敗" });
  }
});

// ===== 🚨 現場意外即時備案（Incident Log，2026-10-28）=====
// 法律價值：事故後 10 分鐘內的第一手紀錄，可對抗「事後誇大傷勢」指控
function ensureIncidentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_logs (
      id TEXT PRIMARY KEY,
      booking_id TEXT,
      schedule_id TEXT,
      coach_id TEXT,
      student_name TEXT,
      body_part TEXT,
      treatment TEXT,
      notes TEXT,
      occurred_at TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_incident_created ON incident_logs(created_at);
  `);
}

router.post("/incidents", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureIncidentSchema(db);
    const b = req.body || {};
    const me = db.prepare("SELECT role, name FROM users WHERE id = ?").get(req.user.id) || {};
    const isAdmin = ["admin", "super_admin", "platform_manager"].includes(me.role);
    const isCoach = Number(me.is_coach) === 1 || me.role === "coach";
    if (!isAdmin && !isCoach) return res.status(403).json({ success: false, error: "只限教練記錄" });

    const studentName = String(b.student_name || "").trim().slice(0, 40);
    const bodyPart = String(b.body_part || "").trim().slice(0, 40);
    const treatment = String(b.treatment || "").trim().slice(0, 200);
    if (!studentName) return res.status(400).json({ success: false, error: "請填寫學員姓名", code: "NAME_REQUIRED" });
    if (!bodyPart) return res.status(400).json({ success: false, error: "請填寫受傷部位", code: "BODY_PART_REQUIRED" });
    if (treatment.length < 2) return res.status(400).json({ success: false, error: "請簡述現場處理方式", code: "TREATMENT_REQUIRED" });

    const id = uuidv4();
    db.prepare(
      `INSERT INTO incident_logs (id, booking_id, schedule_id, coach_id, student_name, body_part, treatment, notes, occurred_at, ip_address)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      b.booking_id ? String(b.booking_id) : null,
      b.schedule_id ? String(b.schedule_id) : null,
      req.user.id,
      studentName,
      bodyPart,
      treatment,
      String(b.notes || "").slice(0, 500) || null,
      b.occurred_at ? String(b.occurred_at).slice(0, 19) : new Date().toISOString().slice(0, 19).replace("T", " "),
      req.ip || null,
    );

    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
         VALUES (?, 'incident.logged', 'incident', ?, ?, ?, ?, datetime('now'))`,
      ).run(uuidv4(), id, req.user.id, JSON.stringify({ student: studentName, body_part: bodyPart }), `現場意外備案：${studentName} / ${bodyPart}`);
    } catch (e) {}

    // 即時通知管理員（意外唔可以無人知）
    try {
      require("../services/notify-admins").notifyAdmins("incident.reported", {
        student: studentName, body_part: bodyPart, treatment, coach: me.name || "",
      });
    } catch (e) {}

    res.json({ success: true, id, message: "✅ 已記錄現場意外備案（時間已封存）" });
  } catch (err) {
    console.error("[INCIDENT] create error:", err.message);
    res.status(500).json({ success: false, error: "記錄失敗" });
  }
});

// ===== POST /coach/sessions/:id/reschedule — 改期（單堂 / 系列） =====
// body: { date:'YYYY-MM-DD', start_time?:'HH:MM', scope?:'one'|'following'|'all',
//         keep_time_of_day?:bool, force?:bool }
// scope 只喺該堂有 series_id 時有意義；'following' = anchor 及之後未完成嘅同系列堂
router.post("/sessions/:id/reschedule", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSeriesCols(db);
    const id = String(req.params.id || "");
    const body = req.body || {};
    const date = String(body.date || "").trim();
    const timeIn = String(body.start_time || "").trim();
    const scope = ["one", "following", "all"].includes(String(body.scope || "")) ? String(body.scope) : "one";
    const keepTime = body.keep_time_of_day !== false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "日期格式不正確（YYYY-MM-DD）" });
    }
    if (timeIn && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeIn)) {
      return res.status(400).json({ success: false, error: "時間格式不正確（HH:MM）" });
    }

    const sel = db
      .prepare(
        `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, s.max_participants, s.series_id,
                c.title, c.coach_id, COALESCE(s.coach_override_id, c.coach_id) AS actual_coach
           FROM class_schedules s JOIN classes c ON c.id = s.class_id
          WHERE s.id = ?`,
      )
      .get(id);
    if (!sel) return res.status(404).json({ success: false, error: "找不到此班次" });

    const isAdmin = ["super_admin", "platform_manager", "admin"].includes(String(req.user.role || ""));
    if (!isAdmin && String(sel.actual_coach) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: "只可以改自己帶領嘅班次" });
    }
    if (["cancelled", "completed"].includes(String(sel.status))) {
      return res.status(409).json({ success: false, error: "此班次已取消或已完結，唔可以改期" });
    }

    const toDate = (v) => {
      const raw = String(v || "");
      const d = /[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? new Date(raw) : new Date(raw.replace(" ", "T") + "Z");
      return isNaN(d) ? null : d;
    };
    const oldStart = toDate(sel.start_time);
    const oldEnd = toDate(sel.end_time);
    if (!oldStart || !oldEnd) return res.status(500).json({ success: false, error: "原有時間資料有誤" });

    const durMs = Math.max(15 * 60000, oldEnd.getTime() - oldStart.getTime());
    const hktClock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(oldStart);
    const hhmm = timeIn || hktClock;

    const startMs = Date.parse(`${date}T${hhmm}:00+08:00`);
    if (isNaN(startMs)) return res.status(400).json({ success: false, error: "日期／時間無法解讀" });
    if (startMs <= Date.now()) {
      return res.status(400).json({ success: false, error: "唔可以改去過去時間", code: "PAST_DATE" });
    }
    const newAnchorStart = new Date(startMs);
    const newAnchorEnd = new Date(startMs + durMs);
    const deltaMs = newAnchorStart.getTime() - oldStart.getTime();

    const countBooked = (sid) =>
      db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE schedule_id = ? AND status = 'confirmed'").get(sid).c;

    const findClash = (excludeIds, sISO, eISO) => {
      const ph = excludeIds.map(() => "?").join(",") || "''";
      return db
        .prepare(
          `SELECT s.id, s.start_time FROM class_schedules s JOIN classes c ON c.id = s.class_id
            WHERE COALESCE(s.coach_override_id, c.coach_id) = ?
              AND s.status NOT IN ('cancelled','completed')
              AND s.id NOT IN (${ph})
              AND datetime(s.start_time) < datetime(?)
              AND datetime(s.end_time) > datetime(?)
            LIMIT 1`,
        )
        .get(sel.actual_coach, ...excludeIds, eISO, sISO);
    };

    const isSeries = !!sel.series_id && scope !== "one";
    const moved = [];   // { id, before:{start,end}, after:{start,end}, booked }
    const skipped = [];

    if (!isSeries) {
      // ── 單堂 ──
      const booked = countBooked(id);
      if (booked > 0 && startMs - Date.now() < 24 * 3600e3 && body.force !== true) {
        return res.status(409).json({
          success: false,
          error: "距離新時間不足 24 小時，仍有已確認學生。請確認通知學生後再試（force=true）。",
          code: "NEED_FORCE", booked,
        });
      }
      const clash = findClash([id], newAnchorStart.toISOString(), newAnchorEnd.toISOString());
      if (clash) {
        return res.status(409).json({
          success: false, code: "TIME_CLASH", schedule_id: clash.id,
          error: `同你另一個班次撞期（${String(clash.start_time).slice(0, 16)}）`,
        });
      }
      moved.push({
        id, before: { start_time: sel.start_time, end_time: sel.end_time },
        after: { start_time: newAnchorStart.toISOString(), end_time: newAnchorEnd.toISOString() },
        booked,
      });
      const detach = sel.series_id ? 1 : 0;
      db.prepare(
        "UPDATE class_schedules SET start_time=?, end_time=?, detached_from_series=? WHERE id=?",
      ).run(newAnchorStart.toISOString(), newAnchorEnd.toISOString(), detach, id);
    } else {
      // ── 系列：following / all（以 HK 本地日曆日差平移，避免 UTC 邊界漂移）──
      const tzAnchor = String(sel.timezone || HK_TZ);
      if (tzAnchor !== HK_TZ) {
        return res.status(409).json({ success: false, code: "TZ_UNSUPPORTED", error: "此系列時區未支援（暫時只支援 Asia/Hong_Kong）" });
      }

      const siblings = db
        .prepare(
          `SELECT id, start_time, end_time, COALESCE(timezone,'Asia/Hong_Kong') AS timezone
             FROM class_schedules
            WHERE series_id = ? AND id <> ? AND status NOT IN ('cancelled','completed')
              AND COALESCE(detached_from_series,0) = 0`,
        )
        .all(sel.series_id, id);

      // 系列內時區必須一致，否則只准單堂處理
      const zones = new Set([tzAnchor, ...siblings.map((r) => String(r.timezone || HK_TZ))]);
      if (zones.size > 1) {
        return res.status(409).json({
          success: false, code: "TZ_MIXED",
          error: "系列內時區不一致（" + [...zones].join(" / ") + "），請逐堂改期（scope=one）。",
        });
      }

      const anchorLocal = localPartsOf(oldStart);
      const deltaDays = isoDayDelta(anchorLocal.date, date);
      const anchorMs = oldStart.getTime();

      const targets = siblings.filter((r) => {
        const t = parseDbTime(r.start_time);
        if (!t) return false;
        if (scope === "following") return t.getTime() >= anchorMs;
        return t.getTime() >= Date.now() - 3600000; // all：跳過已過去嘅
      });

      const plan = [{ id, oldS: oldStart, oldE: oldEnd, tz: tzAnchor }];
      for (const r of targets) {
        const tS = parseDbTime(r.start_time), tE = parseDbTime(r.end_time);
        if (!tS || !tE) { skipped.push(r.id); continue; }
        plan.push({ id: r.id, oldS: tS, oldE: tE, tz: String(r.timezone || tzAnchor) });
      }

      const movingSet = new Set(plan.map((p) => p.id));
      for (const p of plan) {
        let ns, ne;
        if (p.id === id) {
          ns = newAnchorStart; // 目標日 + 指定／原鐘數
          ne = newAnchorEnd;
        } else {
          const sLocal = localPartsOf(p.oldS);
          const clock = keepTime ? sLocal.time : hhmm;
          const newDateISO = addDaysISO(sLocal.date, deltaDays);
          ns = zonedLocalToUtc(newDateISO, clock, p.tz);
          if (!ns) { skipped.push(p.id); continue; }
          ne = new Date(ns.getTime() + (p.oldE.getTime() - p.oldS.getTime()));
        }
        if (ns.getTime() <= Date.now()) { skipped.push(p.id); continue; }
        const clash = findClash([...movingSet], ns.toISOString(), ne.toISOString());
        if (clash) { skipped.push(p.id); continue; }
        moved.push({
          id: p.id,
          before: { start_time: p.oldS.toISOString(), end_time: p.oldE.toISOString() },
          after: { start_time: ns.toISOString(), end_time: ne.toISOString() },
          booked: countBooked(p.id),
        });
      }

      if (!moved.length) {
        return res.status(409).json({ success: false, error: "所有時段都無法改期（撞期或已過去）", code: "ALL_SKIPPED", skipped_ids: skipped });
      }

      const bookedTotal = moved.reduce((a, m) => a + m.booked, 0);
      if (bookedTotal > 0 && startMs - Date.now() < 24 * 3600e3 && body.force !== true) {
        return res.status(409).json({
          success: false, code: "NEED_FORCE", booked: bookedTotal,
          error: `系列中有 ${bookedTotal} 位已確認學生，而新時間不足 24 小時。確認後再試（force=true）。`,
          would_update: moved.length,
        });
      }

      const tx = db.transaction(() => {
        for (const m of moved) {
          db.prepare("UPDATE class_schedules SET start_time=?, end_time=? WHERE id=?").run(
            m.after.start_time, m.after.end_time, m.id,
          );
        }
      });
      tx();
      var _tzInfo = { timezone: tzAnchor, day_delta: deltaDays };
    }

    // audit（一次記齊）
    try {
      require("../services/audit").audit({
        actionType: "schedule.rescheduled",
        entityType: "class_schedule",
        entityId: id,
        userId: req.user.id,
        oldValues: { start_time: sel.start_time, end_time: sel.end_time, series_id: sel.series_id || null },
        newValues: {
          scope, series_id: sel.series_id || null,
          updated: moved.map((m) => ({ id: m.id, start_time: m.after.start_time })),
          skipped, force: body.force === true,
        },
        description: `教練改期（${scope}）：${sel.title} ${String(sel.start_time).slice(0, 16)} → ${newAnchorStart.toISOString().slice(0, 16)}${moved.length > 1 ? `（共 ${moved.length} 堂）` : ""}`,
      });
    } catch (e) {}

    // 通知受影響學生
    try {
      const quorum = require("../services/quorum-worker");
      for (const m of moved) {
        const n = m.booked;
        if (!n) continue;
        const rows = db
          .prepare(
            `SELECT b.id, b.user_id, u.phone FROM bookings b LEFT JOIN users u ON u.id=b.user_id
              WHERE b.schedule_id=? AND b.status='confirmed'`,
          )
          .all(m.id);
        const fmt = new Intl.DateTimeFormat("zh-HK", {
          timeZone: "Asia/Hong_Kong", month: "numeric", day: "numeric",
          weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date(m.after.start_time));
        for (const r of rows) {
          const text = `【ZenPass 課堂改期通知】\n《${sel.title}》已改為 ${fmt}。\n如有問題請回覆此訊息。`;
          quorum.enqueue(db, {
            scheduleId: m.id, bookingId: r.id, userId: r.user_id, phone: r.phone,
            type: "session_rescheduled", message: text,
          });
          try { dbNotification(r.user_id, "booking.rescheduled", "🔁 課堂改期", text, { schedule_id: m.id }); } catch (e) {}
        }
      }
    } catch (e) {
      console.error("[RESCHEDULE] notify failed:", e.message);
    }

    const bookedSum = moved.reduce((a, m) => a + m.booked, 0);
    const anchorLocalOut = localPartsOf(newAnchorStart);
    res.json({
      success: true,
      ok: true,
      scope,
      series_id: sel.series_id || null,
      updated_ids: moved.map((m) => m.id),
      skipped_ids: skipped,
      booked: bookedSum,
      timezone: (typeof _tzInfo !== "undefined" && _tzInfo) ? _tzInfo.timezone : String(sel.timezone || HK_TZ),
      day_delta: (typeof _tzInfo !== "undefined" && _tzInfo) ? _tzInfo.day_delta : 0,
      local_date: anchorLocalOut.date,
      local_time: anchorLocalOut.time,
      start_time: newAnchorStart.toISOString(),
      end_time: newAnchorEnd.toISOString(),
      message: moved.length > 1
        ? `已改 ${moved.length} 堂${skipped.length ? `，${skipped.length} 堂跳過` : ""}`
        : (bookedSum ? `已改期，並已通知 ${bookedSum} 位學生` : "已改期"),
    });
  } catch (err) {
    console.error("[RESCHEDULE]", err.message);
    res.status(500).json({ success: false, error: "改期失敗，請稍後再試" });
  }
});

module.exports = router;

// ===== GET /api/coach/class-students — 查看課程學生名單 =====
// ===== GET /api/coach/upcoming — 教練即將開課（含已報名人數）=====
router.get("/upcoming", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT cs.id, cs.start_time, cs.end_time, cs.enrolled_count, cs.max_participants, cs.status,
                c.id AS class_id, c.title, c.venue_name, c.price_hkd
         FROM class_schedules cs
         JOIN classes c ON c.id = cs.class_id
         WHERE c.coach_id = ? AND c.status = 'active'
           AND datetime(cs.start_time) >= datetime('now')
           AND COALESCE(cs.status,'available') = 'available'
         ORDER BY cs.start_time ASC
         LIMIT 8`,
      )
      .all(req.user.id);
    res.json({ success: true, schedules: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/class-students", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    // 舊 DB／測試 DB 未必有呢啲欄，缺欄時用預設值（避免 500）
    const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    const ucols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    const PVOK = hasTable(db, "partner_venues") && hasCol(db, "partner_venues", "rental_price_per_hour");
    const BC = (col, dflt) => (bcols.includes(col) ? `b.${col}` : dflt);
    const UC = (col, dflt) => (ucols.includes(col) ? `u.${col}` : dflt);
    const { schedule_id } = req.query;

    // Verify coach owns this schedule's class
    const schedule = db
      .prepare("SELECT class_id, coach_override_id FROM class_schedules WHERE id = ?")
      .get(schedule_id);
    if (!schedule) {

      return res.status(404).json({ success: false, error: "時段不存在" });
    }

    const classInfo = db
      .prepare("SELECT coach_id FROM classes WHERE id = ?")
      .get(schedule.class_id);
    if (!classInfo) {

      return res.status(404).json({ success: false, error: "課程不存在" });
    }

    // 權限：只有該班教練或管理員可以查看學生名單
    const me = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    const { hasMinimumRole } = require("../middleware/auth");
    const isAdmin = me && hasMinimumRole(me.role, "admin");
    const isSubstitute = schedule.coach_override_id && schedule.coach_override_id === req.user.id;
    if (!isAdmin && classInfo.coach_id !== req.user.id && !isSubstitute) {
      return res
        .status(403)
        .json({ success: false, error: "無權限查看此課程嘅學生名單" });
    }

    // Get students
    const students = db
      .prepare(
        `
      SELECT b.id, b.user_id, u.name, u.email, u.phone, b.status as booking_status,
             ${BC("payment_status", "NULL")} AS payment_status,
             b.created_at as booking_date,
             ${BC("checked_in_at", "NULL")} AS checked_in_at,
             ${BC("group_size", "1")} AS group_size,
             ${BC("attendee_type", "'self'")} AS attendee_type,
             ${BC("child_name", "NULL")} AS child_name,
             ${BC("child_age", "NULL")} AS child_age,
             ${BC("emergency_phone", "NULL")} AS emergency_phone,
             ${BC("medical_notes", "NULL")} AS medical_notes,
             ${BC("guardian_name", "NULL")} AS guardian_name,
             ${UC("emergency_name", "NULL")} AS emergency_name,
             ${UC("emergency_phone", "NULL")} AS emergency_phone,
             ${UC("health_declared", "0")} AS health_declared
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE b.schedule_id = ? AND b.class_id = ?
      ORDER BY b.created_at DESC
    `,
      )
      .all(schedule_id, schedule.class_id);

    // Get schedule info
    const schedInfo = db
      .prepare(
        `
      SELECT cs.id, cs.start_time, cs.end_time, cs.enrolled_count, cs.max_participants,
             c.title, c.venue_name, c.venue_address, c.price_hkd, c.min_participants, c.duration,
             c.partner_venue_id, ${PVOK ? "pv.name" : "NULL"} AS partner_venue_name,
             ${PVOK ? "pv.rental_price_per_hour" : "NULL"} AS rental_price_per_hour
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      ${PVOK ? "LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id" : ""}
      WHERE cs.id = ?
    `,
      )
      .get(schedule_id);

    // 🎫 每位學員嘅 4 位核銷碼（同入場憑證一致）
    try {
      const { checkinCodeFor } = require("../services/booking-service");
      students.forEach((st) => { st.checkin_code = checkinCodeFor(st); });
    } catch (e) {}

    // 🔒 私隱：教練只睇到自己私域學生嘅全名／電話；公域學員 → 姓氏 + 電話後 4 位
    let outStudents = students;
    if (!isAdmin) {
      try {
        const privacy = require("../services/student-privacy");
        outStudents = students.map((st) => privacy.maskStudent(db, req.user.id, st));
      } catch (e) { console.error("[COACH] privacy:", e.message); }
    }
    res.json({ schedule: schedInfo, students: outStudents, total: outStudents.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/coach/venues — 可加入嘅商戶 + 我嘅狀態 =====
router.get("/venues", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const venues = db
      .prepare(
        "SELECT id, name, category, district, logo_url FROM partner_venues WHERE status = 'active' ORDER BY name",
      )
      .all();
    const mine = db
      .prepare("SELECT id, partner_id, status FROM partner_members WHERE user_id = ?")
      .all(req.user.id);
    const map = {};
    for (const m of mine) map[m.partner_id] = m;
    const out = venues.map((v) => ({
      ...v,
      my_status: (map[v.id] && map[v.id].status) || null,
      member_id: (map[v.id] && map[v.id].id) || null,
    }));
    res.json({ venues: out });
  } catch (err) {
    console.error("coach venues error:", err);
    res.status(500).json({ success: false, error: "無法取得商戶列表" });
  }
});

// ===== POST /api/coach/join-venue — 教練申請加入商戶 =====
router.post("/join-venue", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db
      .prepare("SELECT is_coach, coach_verified, role, name FROM users WHERE id = ?")
      .get(req.user.id);
    const okCoach =
      me &&
      (me.is_coach ||
        me.coach_verified ||
        me.role === "coach" ||
        me.role === "admin" ||
        me.role === "super_admin");
    if (!okCoach) {
      return res.status(403).json({ success: false, error: "只有教練可以申請加入商戶" });
    }
    const partnerId = String(req.body.partner_id || "");
    const venue = db
      .prepare(
        "SELECT id, name, owner_id, user_id FROM partner_venues WHERE id = ? AND status = 'active'",
      )
      .get(partnerId);
    if (!venue) {
      return res.status(404).json({ success: false, error: "商戶不存在或未開通" });
    }
    const existing = db
      .prepare("SELECT id, status FROM partner_members WHERE user_id = ? AND partner_id = ?")
      .get(req.user.id, venue.id);
    if (existing) {
      if (existing.status === "active") {
        return res.status(400).json({ success: false, error: "你已經加入咗呢個商戶" });
      }
      if (existing.status === "pending") {
        return res.status(400).json({ success: false, error: "你嘅申請待審批中" });
      }
      db.prepare(
        "UPDATE partner_members SET status = 'pending', updated_at = datetime('now') WHERE id = ?",
      ).run(existing.id);
    } else {
      db.prepare(
        `INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, 'coach', 'pending', datetime('now'), datetime('now'))`,
      ).run(uuidv4(), req.user.id, venue.id);
    }
    try {
      const ownerId = venue.owner_id || venue.user_id;
      if (ownerId) {
        dbNotification(
          ownerId,
          "partner.coach_request",
          "🧑‍🏫 新教練申請加入",
          `${me.name || "教練"} 申請加入「${venue.name}」`,
          { partner_id: venue.id },
        );
      }
    } catch (e) {}
    res.json({ ok: true, message: "已提交申請，待商戶審批" });
  } catch (err) {
    console.error("join-venue error:", err);
    res.status(500).json({ success: false, error: "申請失敗" });
  }
});
