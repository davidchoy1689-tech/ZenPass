/**
 * admin-emergency.js — 緊急代堂指派（Emergency Substitute）
 *
 *  GET  /api/admin/emergency-sessions?date=YYYY-MM-DD   受影響班次（原教練被熔斷）
 *  GET  /api/admin/emergency-candidates?schedule_id=     合資格代堂教練 + PLI 來源
 *  POST /api/admin/emergency-assign                      { schedule_id, target_coach_id, use_umbrella, reason }
 *  GET  /api/admin/emergency-insurance-logs?schedule_id= 保險覆蓋憑證
 *
 * 雙軌 PLI：
 *  1) 代堂教練個人保單（coach_credentials.insurance_expiry_date >= 今日）
 *  2) 平台綜合責任保險（platform_settings pli.umbrella_*）→ 寫 schedule_insurance_logs
 *
 * 原子事務：更新 class_schedules.coach_override_id ＋ 保險憑證 ＋ 審計
 * 拆帳：COALESCE(coach_override_id, class.coach_id) → 代堂教練收 80%；
 *       原教練自有學生 20% 補足在 frozen_stolen 期間由 buildMonthlyBreakdown 標記託管、不發放。
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { dbNotification } = require("../services/notification");

const router = express.Router();
router.use(authenticateToken, requireAdmin);

const OPS_ROLES = ["super_admin", "platform_manager", "admin"];
const DEFAULT_UMBRELLA = {
  insurer: "Zurich Insurance",
  policy_no: "ZP-PLI-2026-EMERGENCY",
  coverage_hkd: 10000000,
};

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_insurance_logs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      class_id TEXT,
      venue TEXT,
      original_coach_id TEXT,
      substitute_coach_id TEXT,
      policy_type TEXT NOT NULL,
      insurer TEXT,
      policy_no TEXT,
      coverage_hkd INTEGER,
      source TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sched_ins ON schedule_insurance_logs(schedule_id, datetime(created_at) DESC);
  `);
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  if (!cols.includes("coach_override_id")) db.exec("ALTER TABLE class_schedules ADD COLUMN coach_override_id TEXT");
}

function setting(db, key, fallback) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key=?").get(key);
    return r && r.value != null && String(r.value) !== "" ? String(r.value) : fallback;
  } catch (e) {
    return fallback;
  }
}

function umbrellaConfig(db) {
  return {
    enabled: setting(db, "pli.umbrella_enabled", "1") !== "0",
    insurer: setting(db, "pli.umbrella_insurer", DEFAULT_UMBRELLA.insurer),
    policy_no: setting(db, "pli.umbrella_policy_no", DEFAULT_UMBRELLA.policy_no),
    coverage_hkd: Number(setting(db, "pli.umbrella_coverage_hkd", String(DEFAULT_UMBRELLA.coverage_hkd))) || DEFAULT_UMBRELLA.coverage_hkd,
  };
}

const todayHKT = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const isOps = (u) => OPS_ROLES.includes(String((u && u.role) || ""));

function latestCred(db, coachId) {
  return db
    .prepare("SELECT * FROM coach_credentials WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(coachId);
}

function personalPliValid(cred) {
  if (!cred) return false;
  const exp = String(cred.insurance_expiry_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(exp) && exp >= todayHKT();
}

/** 受影響班次：原教練已被熔斷（frozen_stolen 或 is_active=0） */
function affectedSessions(db, date) {
  ensureSchema(db);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayHKT();
  const rows = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, s.enrolled_count, s.max_participants,
              s.coach_override_id,
              c.title, c.district, c.venue_name, c.coach_id AS original_coach_id,
              u.name AS original_coach_name, u.payout_status, u.is_active,
              sub.name AS substitute_name
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         JOIN users u ON u.id = c.coach_id
         LEFT JOIN users sub ON sub.id = s.coach_override_id
        WHERE date(s.start_time, '+8 hours') = ?
          AND COALESCE(s.status,'') <> 'cancelled'
          AND (u.payout_status = 'frozen_stolen' OR COALESCE(u.is_active,1) = 0)
        ORDER BY s.start_time`,
    )
    .all(day);
  return { date: day, sessions: rows };
}

/** 重疊：同一位代堂教練在同一時段已有班（含 override） */
function hasOverlap(db, coachId, start, end, exceptScheduleId) {
  const r = db
    .prepare(
      `SELECT COUNT(*) c FROM class_schedules s JOIN classes c ON c.id = s.class_id
        WHERE COALESCE(s.coach_override_id, c.coach_id) = ?
          AND s.id <> ? AND COALESCE(s.status,'') <> 'cancelled'
          AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?)`,
    )
    .get(coachId, exceptScheduleId || "", end, start);
  return Number(r.c) > 0;
}

function districtMatch(db, coachId, district) {
  if (!district) return false;
  try {
    const u = db.prepare("SELECT service_districts FROM users WHERE id=?").get(coachId);
    if (u && u.service_districts && String(u.service_districts).includes(district)) return true;
  } catch (e) {}
  try {
    const r = db
      .prepare(
        `SELECT COUNT(*) c FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE COALESCE(s.coach_override_id,c.coach_id)=? AND c.district=? AND datetime(s.start_time) >= datetime('now','-90 days')`,
      )
      .get(coachId, district);
    return Number(r.c) > 0;
  } catch (e) {
    return false;
  }
}

function candidates(db, scheduleId) {
  ensureSchema(db);
  const s = db
    .prepare(
      `SELECT s.id, s.start_time, s.end_time, s.coach_override_id,
              c.id AS class_id, c.title, c.district, c.venue_name, c.coach_id AS original_coach_id,
              u.payout_status, u.is_active
         FROM class_schedules s JOIN classes c ON c.id=s.class_id JOIN users u ON u.id=c.coach_id
        WHERE s.id=?`,
    )
    .get(scheduleId);
  if (!s) return { error: "NOT_FOUND" };
  if (!(s.payout_status === "frozen_stolen" || Number(s.is_active) === 0)) return { error: "COACH_NOT_LOCKED" };
  if (s.coach_override_id) return { error: "ALREADY_ASSIGNED" };

  const umb = umbrellaConfig(db);
  const coaches = db
    .prepare(
      `SELECT id, name, phone, rating, service_districts, role, is_coach, is_active, payout_status
         FROM users
        WHERE (role='coach' OR COALESCE(is_coach,0)=1) AND COALESCE(is_active,1)=1
          AND COALESCE(payout_status,'active') <> 'frozen_stolen' AND id <> ?`,
    )
    .all(s.original_coach_id);

  const out = [];
  for (const c of coaches) {
    const cred = latestCred(db, c.id);
    const blockers = [];
    if (!cred) blockers.push("未提交資質證明");
    else {
      if (cred.status !== "verified") blockers.push("資質未核實");
      const sports = String(cred.qualified_sports || "").trim();
      if (!sports || sports === "[]") blockers.push("未填寫合資格項目");
      if (cred.license_expiry && String(cred.license_expiry).slice(0, 10) < todayHKT()) blockers.push("牌照已過期");
    }
    if (hasOverlap(db, c.id, s.start_time, s.end_time, s.id)) blockers.push("同時段已有班（衝堂）");
    const personal = personalPliValid(cred);
    const pliSource = personal ? "personal" : umb.enabled ? "umbrella" : null;
    if (!pliSource) blockers.push("個人 PLI 過期且平台底網未啟用");
    const dm = districtMatch(db, c.id, s.district);
    out.push({
      id: c.id,
      name: c.name,
      phone_masked: String(c.phone || "").replace(/^(\d{4}).*/, "$1****"),
      rating: Number(c.rating) || 0,
      district_match: dm,
      qualified_sports: (() => {
        try {
          return JSON.parse(cred && cred.qualified_sports ? cred.qualified_sports : "[]");
        } catch (e) {
          return [];
        }
      })(),
      license_type: (cred && cred.license_type) || "",
      insurance_expiry: (cred && cred.insurance_expiry_date) || null,
      pli_source: pliSource,
      pli_label:
        pliSource === "personal"
          ? `個人保單有效（至 ${String(cred.insurance_expiry_date).slice(0, 10)}）`
          : pliSource === "umbrella"
            ? `平台綜合責任保險（${umb.insurer} · HK$${umb.coverage_hkd.toLocaleString("en-HK")}）`
            : "無保險覆蓋",
      eligible: blockers.length === 0,
      blockers,
    });
  }
  out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.district_match) - Number(a.district_match) || (b.pli_source === "personal") - (a.pli_source === "personal") || b.rating - a.rating);
  return { session: s, umbrella: umb, candidates: out };
}

function assign(db, { scheduleId, targetCoachId, useUmbrella, adminId, reason }) {
  ensureSchema(db);
  const s = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.enrolled_count, s.coach_override_id,
              c.title, c.district, c.venue_name, c.coach_id AS original_coach_id,
              u.name AS original_name, u.payout_status, u.is_active
         FROM class_schedules s JOIN classes c ON c.id=s.class_id JOIN users u ON u.id=c.coach_id
        WHERE s.id=?`,
    )
    .get(scheduleId);
  if (!s) return { ok: false, code: "NOT_FOUND" };
  if (!(s.payout_status === "frozen_stolen" || Number(s.is_active) === 0)) return { ok: false, code: "COACH_NOT_LOCKED" };
  if (s.coach_override_id) return { ok: false, code: "ALREADY_ASSIGNED" };

  const t = db.prepare("SELECT id, name, phone, role, is_coach, is_active, payout_status FROM users WHERE id=?").get(targetCoachId);
  if (!t || (!(t.role === "coach" || Number(t.is_coach) === 1))) return { ok: false, code: "INVALID_COACH" };
  if (Number(t.is_active) === 0 || t.payout_status === "frozen_stolen") return { ok: false, code: "COACH_LOCKED" };
  if (hasOverlap(db, t.id, s.start_time, s.end_time, s.id)) return { ok: false, code: "OVERLAP" };

  const cred = latestCred(db, t.id);
  if (!cred) return { ok: false, code: "NO_CREDENTIAL" };
  if (cred.status !== "verified") return { ok: false, code: "CREDENTIAL_NOT_VERIFIED" };
  const umb = umbrellaConfig(db);
  const personal = personalPliValid(cred);
  let source = personal ? "personal" : null;
  if (!source && useUmbrella && umb.enabled) source = "umbrella";
  if (!source) return { ok: false, code: "PLI_REQUIRED", umbrella: umb };

  const logId = require("crypto").randomUUID();
  db.transaction(() => {
    db.prepare("UPDATE class_schedules SET coach_override_id=? WHERE id=?").run(t.id, s.id);
    db.prepare(
      `INSERT INTO schedule_insurance_logs
         (id, schedule_id, class_id, venue, original_coach_id, substitute_coach_id,
          policy_type, insurer, policy_no, coverage_hkd, source, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      logId,
      s.id,
      s.class_id,
      s.venue_name || "",
      s.original_coach_id,
      t.id,
      source === "umbrella" ? "platform_umbrella_pli" : "coach_personal_pli",
      source === "umbrella" ? umb.insurer : "教練個人保單",
      source === "umbrella" ? umb.policy_no : String(cred.insurance_policy_url || cred.license_no || "PERSONAL-PLI"),
      source === "umbrella" ? umb.coverage_hkd : null,
      source,
      adminId,
    );
    try {
      audit({
        actionType: "coach.emergency_substitute_assigned",
        entityType: "schedule",
        entityId: s.id,
        userId: adminId,
        oldValues: { coach_override_id: null },
        newValues: {
          coach_override_id: t.id,
          original_coach_id: s.original_coach_id,
          pli_source: source,
          insurance_log_id: logId,
          reason: String(reason || "").trim(),
        },
        description: `緊急代堂：${s.original_name} → ${t.name}（${source === "umbrella" ? "平台底網" : "個人 PLI"}）`,
      });
    } catch (e) {}
  })();

  // 通知（事務外）
  try {
    dbNotification(t.id, "schedule", "⚡ 緊急代堂指派", `你已被指派代堂：${s.title} · ${whenLabel(s.start_time)} · ${s.venue_name || ""}。點名冊已開通。`, { schedule_id: s.id });
  } catch (e) {}
  try {
    const students = db
      .prepare("SELECT DISTINCT user_id FROM bookings WHERE schedule_id=? AND payment_status='paid' AND status IN ('confirmed','attended')")
      .all(s.id);
    for (const st of students) {
      dbNotification(
        st.user_id,
        "schedule",
        "【ZenPass 課堂通知】",
        `今日 ${timeLabel(s.start_time)} 於 ${s.venue_name || s.district || ""} 的《${s.title}》，將由資深教練 ${t.name} 代堂。課程內容及進度手冊不受影響，祝您運動愉快！`,
        { schedule_id: s.id },
      );
    }
  } catch (e) {}

  return {
    ok: true,
    schedule_id: s.id,
    substitute: { id: t.id, name: t.name },
    pli_source: source,
    insurance_log_id: logId,
    coverage_hkd: source === "umbrella" ? umb.coverage_hkd : null,
  };
}

function timeLabel(v) {
  const d = new Date(String(v || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return String(v || "");
  return d.toLocaleTimeString("zh-HK", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false });
}
function whenLabel(v) {
  const d = new Date(String(v || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return String(v || "");
  return d.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

router.get("/emergency-sessions", (req, res) => {
  try {
    res.json({ success: true, data: affectedSessions(getDb(), req.query.date) });
  } catch (e) {
    console.error("[EMGSUB] sessions:", e.message);
    res.status(500).json({ success: false, error: "讀取受影響班次失敗" });
  }
});

router.get("/emergency-candidates", (req, res) => {
  try {
    const out = candidates(getDb(), req.query.schedule_id);
    if (out.error) return res.status(400).json({ success: false, code: out.error, error: "無法列出代堂教練" });
    res.json({ success: true, data: out });
  } catch (e) {
    console.error("[EMGSUB] candidates:", e.message);
    res.status(500).json({ success: false, error: "讀取代堂教練失敗" });
  }
});

router.post("/emergency-assign", (req, res) => {
  try {
    if (!isOps(req.user)) return res.status(403).json({ success: false, error: "權限不足" });
    const b = req.body || {};
    const reason = String(b.reason || "").trim();
    if (reason.length < 4) return res.status(400).json({ success: false, code: "REASON_REQUIRED", error: "請填寫指派原因（最少 4 字）" });
    const out = assign(getDb(), {
      scheduleId: b.schedule_id || b.scheduleId,
      targetCoachId: b.target_coach_id || b.targetCoachId,
      useUmbrella: b.use_umbrella === true || b.use_umbrella === 1 || b.use_umbrella === "true",
      adminId: req.user.id,
      reason,
    });
    if (!out.ok) {
      const msgs = {
        NOT_FOUND: "找不到班次",
        COACH_NOT_LOCKED: "原教練未被熔斷，請用一般代堂流程",
        ALREADY_ASSIGNED: "此班已有代堂教練",
        INVALID_COACH: "所選用戶不是教練",
        COACH_LOCKED: "所選教練帳號已被停用",
        OVERLAP: "代堂教練同時段已有班",
        NO_CREDENTIAL: "代堂教練未提交資質",
        CREDENTIAL_NOT_VERIFIED: "代堂教練資質未核實",
        PLI_REQUIRED: "需要個人 PLI 或啟用平台綜合責任保險",
      };
      return res.status(409).json({ success: false, code: out.code, error: msgs[out.code] || "指派失敗", umbrella: out.umbrella });
    }
    res.json({ success: true, ...out, message: "已指派代堂，點名冊與手冊權限即時轉移" });
  } catch (e) {
    console.error("[EMGSUB] assign:", e.message);
    res.status(500).json({ success: false, error: "指派失敗" });
  }
});

router.get("/emergency-insurance-logs", (req, res) => {
  try {
    ensureSchema(getDb());
    const sid = String(req.query.schedule_id || "");
    const rows = sid
      ? getDb().prepare("SELECT * FROM schedule_insurance_logs WHERE schedule_id=? ORDER BY datetime(created_at) DESC").all(sid)
      : getDb().prepare("SELECT * FROM schedule_insurance_logs ORDER BY datetime(created_at) DESC LIMIT 100").all();
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[EMGSUB] logs:", e.message);
    res.status(500).json({ success: false, error: "讀取保險紀錄失敗" });
  }
});

module.exports = router;
module.exports.affectedSessions = affectedSessions;
module.exports.candidates = candidates;
module.exports.assign = assign;
module.exports.ensureSchema = ensureSchema;
