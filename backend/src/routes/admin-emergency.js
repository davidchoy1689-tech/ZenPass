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
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { audit } = require("../services/audit");

const router = express.Router();
router.use(authenticateToken, requireAdmin);

const OPS_ROLES = ["super_admin", "platform_manager", "admin"];
const DEFAULT_UMBRELLA = {
  insurer: "Zurich Insurance",
  policy_no: "ZP-PLI-2026-EMERGENCY",
  coverage_hkd: 10000000,
};

const execFileAsync = promisify(execFile);

function ensureIncidentSchema(db) {
  ensureSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_incidents (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      student_user_id TEXT,
      student_name TEXT NOT NULL,
      student_phone TEXT,
      guardian_name TEXT,
      guardian_phone TEXT,
      incident_time DATETIME NOT NULL,
      description TEXT NOT NULL,
      action_taken TEXT,
      severity TEXT,
      reported_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_inc_sched ON schedule_incidents(schedule_id, datetime(created_at) DESC);

    CREATE TABLE IF NOT EXISTS pli_claim_exports (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      incident_id TEXT,
      reference_no TEXT NOT NULL,
      format TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      generated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pli_exp ON pli_claim_exports(schedule_id, datetime(created_at) DESC);
  `);
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function hkDateTime(v) {
  const d = new Date(String(v || "").replace(" ", "T") + (String(v || "").includes("Z") ? "" : "Z"));
  if (isNaN(d)) return String(v || "");
  return d.toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function bookingCol(db, name, fallback = "NULL") {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    return cols.includes(name) ? `b.${name}` : fallback;
  } catch (e) {
    return fallback;
  }
}

function attendCol(db, name, fallback = "NULL") {
  try {
    const cols = db.prepare("PRAGMA table_info(attendances)").all().map((c) => c.name);
    return cols.includes(name) ? `a.${name}` : fallback;
  } catch (e) {
    return fallback;
  }
}

function rosterFor(db, scheduleId) {
  const rows = db
    .prepare(
      `SELECT b.id AS booking_id, b.user_id,
              ${bookingCol(db, "attendee_type", "'adult'")} AS attendee_type,
              ${bookingCol(db, "child_name")} AS child_name,
              ${bookingCol(db, "medical_notes")} AS medical_notes,
              ${bookingCol(db, "guardian_name")} AS guardian_name,
              ${bookingCol(db, "guardian_hkid4")} AS guardian_hkid4,
              ${bookingCol(db, "parent_name")} AS parent_name,
              ${bookingCol(db, "parent_phone")} AS parent_phone,
              u.name, u.phone, u.emergency_name, u.emergency_phone, u.health_declared, u.terms_accepted_at,
              a.status AS attendance_status, ${attendCol(db, "checkin_time", attendCol(db, "checked_in_at"))} AS checkin_time
         FROM bookings b JOIN users u ON u.id=b.user_id
         LEFT JOIN attendances a ON a.booking_id=b.id
        WHERE b.schedule_id=? AND b.status IN ('confirmed','attended','no_show')
        ORDER BY u.name`,
    )
    .all(scheduleId);
  return rows.map((r) => ({
    booking_id: r.booking_id,
    user_id: r.user_id,
    student_name: r.attendee_type === "child" ? r.child_name || r.name : r.name,
    phone_masked: r.phone ? String(r.phone).replace(/^(\d{4})\d{4}$/, "$1****") : "",
    emergency_name: r.emergency_name || r.guardian_name || "",
    emergency_phone_masked: String(r.emergency_phone || r.parent_phone || "").replace(/^(\d{4})\d{4}$/, "$1****"),
    hkid_masked: r.guardian_hkid4 ? `****${String(r.guardian_hkid4).slice(-4)}` : "",
    health_notes: r.medical_notes || (r.health_declared ? String(r.health_declared).slice(0, 500) : ""),
    attendance_status: r.attendance_status || (r.attendee_type ? "" : ""),
    checkin_time: r.checkin_time || null,
    terms_accepted_at: r.terms_accepted_at || null,
  }));
}

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
  if (!cols.includes("substitute_reason")) db.exec("ALTER TABLE class_schedules ADD COLUMN substitute_reason TEXT");
  if (!cols.includes("substitute_assigned_at")) db.exec("ALTER TABLE class_schedules ADD COLUMN substitute_assigned_at DATETIME");
  if (!cols.includes("substitute_assigned_by")) db.exec("ALTER TABLE class_schedules ADD COLUMN substitute_assigned_by TEXT");

  // 規格對齊欄位（舊表 idempotent 補欄＋回填）
  const icols = db.prepare("PRAGMA table_info(schedule_insurance_logs)").all().map((c) => c.name);
  const addI = (name, ddl) => {
    if (!icols.includes(name)) db.exec(`ALTER TABLE schedule_insurance_logs ADD COLUMN ${ddl}`);
  };
  addI("assigned_coach_id", "assigned_coach_id TEXT");
  addI("coverage_source", "coverage_source TEXT");
  addI("insurer_name", "insurer_name TEXT");
  addI("policy_number", "policy_number TEXT");
  addI("coverage_amount_cents", "coverage_amount_cents INTEGER");
  addI("policy_expiry_date", "policy_expiry_date DATE");
  addI("is_emergency_override", "is_emergency_override INTEGER DEFAULT 0");
  addI("verified_by_admin_id", "verified_by_admin_id TEXT");
  try {
    db.exec(`
      UPDATE schedule_insurance_logs
         SET assigned_coach_id = COALESCE(assigned_coach_id, substitute_coach_id),
             coverage_source = COALESCE(coverage_source, policy_type),
             insurer_name = COALESCE(insurer_name, insurer),
             policy_number = COALESCE(policy_number, policy_no),
             coverage_amount_cents = COALESCE(coverage_amount_cents, coverage_hkd * 100),
             is_emergency_override = COALESCE(is_emergency_override, CASE WHEN policy_type='platform_umbrella_pli' THEN 1 ELSE 0 END),
             verified_by_admin_id = COALESCE(verified_by_admin_id, created_by)
       WHERE assigned_coach_id IS NULL OR coverage_source IS NULL
    `);
    db.exec(`
      UPDATE schedule_insurance_logs
         SET policy_expiry_date = COALESCE(
               policy_expiry_date,
               (SELECT cc.insurance_expiry_date FROM coach_credentials cc
                 WHERE cc.user_id = schedule_insurance_logs.assigned_coach_id
                 ORDER BY cc.created_at DESC, cc.rowid DESC LIMIT 1),
               CASE WHEN coverage_source='platform_umbrella_pli' THEN '2027-12-31' ELSE date('now') END)
       WHERE policy_expiry_date IS NULL
    `);
  } catch (e) {}
  try {
    const ccols = db.prepare("PRAGMA table_info(coach_credentials)").all().map((c) => c.name);
    if (!ccols.includes("insurance_policy_no")) db.exec("ALTER TABLE coach_credentials ADD COLUMN insurance_policy_no TEXT");
  } catch (e) {}
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
function affectedSessions(db, date, all = false) {
  ensureIncidentSchema(db);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayHKT();
  const lockedFilter = all ? "" : "AND (u.payout_status = 'frozen_stolen' OR COALESCE(u.is_active,1) = 0)";
  const rows = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, s.enrolled_count, s.max_participants,
              s.coach_override_id,
              c.title, c.district, c.venue_name, c.coach_id AS original_coach_id,
              u.name AS original_coach_name, u.payout_status, u.is_active,
              sub.name AS substitute_name,
              (SELECT COUNT(*) FROM schedule_incidents si WHERE si.schedule_id=s.id) AS incident_count,
              (SELECT si.id FROM schedule_incidents si WHERE si.schedule_id=s.id ORDER BY datetime(si.incident_time) DESC LIMIT 1) AS latest_incident_id,
              (SELECT 1 FROM schedule_insurance_logs l WHERE l.schedule_id=s.id LIMIT 1) AS has_insurance
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         JOIN users u ON u.id = c.coach_id
         LEFT JOIN users sub ON sub.id = s.coach_override_id
        WHERE date(s.start_time, '+8 hours') = ?
          AND COALESCE(s.status,'') <> 'cancelled'
          ${lockedFilter}
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

function assign(db, { scheduleId, targetCoachId, useUmbrella, forcePlatformPli, adminId, reason }) {
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
  const force = !!(useUmbrella || forcePlatformPli);
  let source = personal && !forcePlatformPli ? "personal" : null;
  if (!source && force && umb.enabled) source = "umbrella";
  if (!source) return { ok: false, code: "PLI_REQUIRED", umbrella: umb };

  const logId = require("crypto").randomUUID();
  const policyExpiry =
    source === "umbrella" ? setting(db, "pli.umbrella_expiry", "2027-12-31") : String(cred.insurance_expiry_date || "").slice(0, 10);
  db.transaction(() => {
    db.prepare(
      `UPDATE class_schedules
          SET coach_override_id=?, substitute_reason=?, substitute_assigned_at=datetime('now'), substitute_assigned_by=?
        WHERE id=?`,
    ).run(t.id, String(reason || "").trim(), adminId, s.id);
    db.prepare(
      `INSERT INTO schedule_insurance_logs
         (id, schedule_id, class_id, venue, original_coach_id, substitute_coach_id,
          policy_type, insurer, policy_no, coverage_hkd, source, created_by,
          assigned_coach_id, coverage_source, insurer_name, policy_number,
          coverage_amount_cents, policy_expiry_date, is_emergency_override, verified_by_admin_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      logId,
      s.id,
      s.class_id,
      s.venue_name || "",
      s.original_coach_id,
      t.id,
      source === "umbrella" ? "platform_umbrella_pli" : "coach_personal_pli",
      source === "umbrella" ? umb.insurer : "教練個人保單",
      source === "umbrella" ? umb.policy_no : String(cred.insurance_policy_no || cred.license_no || cred.insurance_policy_url || "PERSONAL-PLI"),
      source === "umbrella" ? umb.coverage_hkd : null,
      source,
      adminId,
      t.id,
      source === "umbrella" ? "platform_umbrella_pli" : "coach_personal_pli",
      source === "umbrella" ? umb.insurer : "教練個人保單",
      source === "umbrella" ? umb.policy_no : String(cred.insurance_policy_url || cred.license_no || "PERSONAL-PLI"),
      source === "umbrella" ? umb.coverage_hkd * 100 : 1000000000,
      policyExpiry || todayHKT(),
      source === "umbrella" ? 1 : 0,
      adminId,
    );
    // 未結算收入改歸實際執教教練（已 paid 的不動）
    try {
      db.prepare(
        "UPDATE coach_earnings SET coach_id=?, updated_at=datetime('now') WHERE schedule_id=? AND status IN ('pending','approved')",
      ).run(t.id, s.id);
    } catch (e) {}
    try {
      audit({
        actionType: "schedule.assign_substitute",
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

  // 通知（事務外，非阻塞）：SMS ＋ WhatsApp ＋ 站內
  try {
    const notify = require("../services/notification-service");
    notify
      .sendSmsAndWhatsApp({
        userId: t.id,
        phone: t.phone,
        title: "⚡ 緊急代堂指派",
        message: `【ZenPass 代堂指派】${t.name} 教練您好，您已被指派接手《${s.title}》，上課時間：${whenLabel(s.start_time)}，地點：${s.venue_name || s.district || ""}。請即時登入後台查閱點名冊與學員舊患手冊：https://zenpass.hk/v2/coach-roster.html`,
        meta: { schedule_id: s.id },
      })
      .then((r) => {
        try {
          audit({
            actionType: "schedule.substitute_notified",
            entityType: "schedule",
            entityId: s.id,
            userId: adminId,
            newValues: { coach_id: t.id, channels: r },
            description: "緊急代堂通知發送狀態",
          });
        } catch (e) {}
      })
      .catch(() => {});
    const students = db
      .prepare("SELECT DISTINCT b.user_id, u.phone FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.schedule_id=? AND b.payment_status='paid' AND b.status IN ('confirmed','attended')")
      .all(s.id);
    const cert = cred.license_type ? `（持有${cred.license_type}）` : "";
    for (const st of students) {
      notify
        .sendSmsAndWhatsApp({
          userId: st.user_id,
          phone: st.phone,
          title: "【ZenPass 課堂通知】",
          message: `【ZenPass 課堂通知】今日 ${timeLabel(s.start_time)} 於 ${s.venue_name || s.district || ""} 的《${s.title}》，將由資深教練 ${t.name}${cert} 代堂。課程內容及進度手冊不受影響，祝您運動愉快！`,
          meta: { schedule_id: s.id },
        })
        .catch(() => {});
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

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(v[k]))
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function buildDossier(db, scheduleId, incidentId, admin) {
  ensureIncidentSchema(db);
  const s = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.enrolled_count, s.max_participants,
              s.coach_override_id, s.substitute_reason, s.substitute_assigned_at, s.substitute_assigned_by,
              c.title, c.district, c.venue_name AS class_venue_name,
              c.coach_id AS original_coach_id, uo.name AS original_coach_name,
              COALESCE(s.coach_override_id, c.coach_id) AS actual_coach_id,
              ua.name AS actual_coach_name, ua.phone AS actual_coach_phone,
              sub.name AS substitute_name
         FROM class_schedules s
         JOIN classes c ON c.id=s.class_id
         JOIN users uo ON uo.id=c.coach_id
         JOIN users ua ON ua.id=COALESCE(s.coach_override_id, c.coach_id)
         LEFT JOIN users sub ON sub.id=s.coach_override_id
        WHERE s.id=?`,
    )
    .get(scheduleId);
  if (!s) return { error: "NOT_FOUND" };

  const insurance = db
    .prepare(
      `SELECT * FROM schedule_insurance_logs WHERE schedule_id=? ORDER BY datetime(created_at) DESC LIMIT 1`,
    )
    .get(scheduleId);
  if (!insurance) return { error: "NO_INSURANCE_LOG" };

  const incident = incidentId
    ? db.prepare("SELECT * FROM schedule_incidents WHERE id=? AND schedule_id=?").get(incidentId, scheduleId)
    : db
        .prepare("SELECT * FROM schedule_incidents WHERE schedule_id=? ORDER BY datetime(incident_time) DESC, datetime(created_at) DESC LIMIT 1")
        .get(scheduleId);
  if (!incident) return { error: "NO_INCIDENT" };

  const cred = db
    .prepare("SELECT license_type, license_no, license_expiry, insurance_policy_no, insurance_expiry_date FROM coach_credentials WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 1")
    .get(s.actual_coach_id);
  const roster = rosterFor(db, scheduleId);
  const attendance = db
    .prepare("SELECT COUNT(*) c FROM attendances a JOIN bookings b ON b.id=a.booking_id WHERE b.schedule_id=? AND a.status IN ('present','late')")
    .get(scheduleId).c;
  const refDate = String(incident.incident_time || "").slice(0, 10).replace(/-/g, "") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const reference = `ZP-CLM-${refDate}-${String(scheduleId).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}`;

  const payload = {
    reference_no: reference,
    generated_at: new Date().toISOString(),
    generated_by: { id: admin.id, name: admin.name || admin.email || admin.id },
    schedule: {
      schedule_id: s.id,
      class_id: s.class_id,
      course_title: s.title,
      venue: s.class_venue_name || "",
      district: s.district || "",
      start_time: s.start_time,
      end_time: s.end_time,
      enrolled_count: Number(s.enrolled_count) || 0,
      max_participants: Number(s.max_participants) || 0,
      substitute_reason: s.substitute_reason || "",
      substitute_assigned_at: s.substitute_assigned_at || null,
      substitute_assigned_by: s.substitute_assigned_by || null,
    },
    coaches: {
      original: { id: s.original_coach_id, name: s.original_coach_name, status_note: "因安全風控停權／代堂" },
      actual: {
        id: s.actual_coach_id,
        name: s.actual_coach_name,
        phone_masked: String(s.actual_coach_phone || "").replace(/^(\d{4})\d{4}$/, "$1****"),
        license_type: (cred && cred.license_type) || "",
        license_no_masked: cred && cred.license_no ? `****${String(cred.license_no).slice(-4)}` : "",
        license_expiry: (cred && cred.license_expiry) || null,
        is_substitute: !!s.coach_override_id,
      },
    },
    insurance: {
      insurance_log_id: insurance.id,
      coverage_source: insurance.coverage_source || insurance.policy_type,
      insurer_name: insurance.insurer_name || insurance.insurer,
      policy_number: insurance.policy_number || insurance.policy_no,
      coverage_amount_cents: Number(insurance.coverage_amount_cents) || Number(insurance.coverage_hkd || 0) * 100,
      policy_expiry_date: insurance.policy_expiry_date,
      is_emergency_override: Number(insurance.is_emergency_override) || 0,
      logged_at: insurance.created_at,
      verified_by_admin_id: insurance.verified_by_admin_id || insurance.created_by,
    },
    incident: {
      id: incident.id,
      student_name: incident.student_name,
      student_phone_masked: String(incident.student_phone || "").replace(/^(\d{4})\d{4}$/, "$1****"),
      guardian_name: incident.guardian_name || "",
      guardian_phone_masked: String(incident.guardian_phone || "").replace(/^(\d{4})\d{4}$/, "$1****"),
      incident_time: incident.incident_time,
      description: incident.description,
      action_taken: incident.action_taken || "",
      severity: incident.severity || "",
      reported_by: incident.reported_by || "",
      created_at: incident.created_at,
    },
    roster,
    attendance_summary: { present: Number(attendance) || 0, booked: roster.length },
  };
  return { payload, insurance, incident, schedule: s, roster };
}

function dossierHtml(d, sha) {
  const p = d.payload;
  const rosterRows = p.roster
    .map(
      (r) => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.phone_masked)}</td><td>${esc(r.hkid_masked)}</td>
      <td>${esc(r.emergency_name)} / ${esc(r.emergency_phone_masked)}</td><td>${esc(r.health_notes || "—")}</td>
      <td>${esc(r.attendance_status || "—")}</td></tr>`,
    )
    .join("");
  const coverage = (p.insurance.coverage_amount_cents / 100).toLocaleString("en-HK", { minimumFractionDigits: 2 });
  return `<!DOCTYPE html><html lang="zh-HK"><head><meta charset="utf-8">
  <style>
    @page { size: A4; margin: 14mm 13mm; }
    body { font-family: "WenQuanYi Micro Hei", "Noto Sans CJK HK", sans-serif; color:#111; font-size:10.5pt; line-height:1.55; }
    h1 { font-size:17pt; text-align:center; margin:0 0 2mm; letter-spacing:.5px; }
    .sub { text-align:center; color:#555; font-size:9pt; margin-bottom:6mm; }
    h2 { font-size:11.5pt; background:#eef2f7; border-left:4px solid #1e3a8a; padding:2mm 3mm; margin:5mm 0 2mm; }
    table { width:100%; border-collapse:collapse; font-size:9.3pt; }
    th, td { border:1px solid #cbd5e1; padding:1.6mm 2mm; vertical-align:top; text-align:left; }
    th { background:#f1f5f9; }
    .kv td:first-child { width:34%; color:#334155; background:#fafafa; font-weight:bold; }
    .warn { border:1px solid #f59e0b; background:#fffbeb; padding:2mm 3mm; font-size:9pt; }
    .hash { font-family:monospace; font-size:7.4pt; word-break:break-all; background:#f8fafc; border:1px dashed #94a3b8; padding:2mm; }
    .foot { margin-top:6mm; font-size:8pt; color:#475569; border-top:1px solid #cbd5e1; padding-top:2mm; }
    .sign { margin-top:8mm; display:flex; justify-content:space-between; font-size:9pt; }
    .sign div { width:45%; border-top:1px solid #333; padding-top:1.5mm; text-align:center; }
  </style></head><body>
  <h1>ZENPASS HEALTHCARE LIMITED<br>公共責任保險 (PLI) 課堂事故報告書</h1>
  <div class="sub">Claim Dossier Reference: <b>${esc(p.reference_no)}</b> · 生成時間 ${esc(hkDateTime(p.generated_at))} HKT</div>

  <h2>第一區：事故基本資料 (Incident Overview)</h2>
  <table class="kv">
    <tr><td>班次編號</td><td>${esc(p.schedule.schedule_id)}</td></tr>
    <tr><td>課程名稱</td><td>${esc(p.schedule.course_title)}</td></tr>
    <tr><td>上課地點</td><td>${esc(p.schedule.venue)} · ${esc(p.schedule.district)}</td></tr>
    <tr><td>事故時間</td><td>${esc(hkDateTime(p.incident.incident_time))} HKT</td></tr>
    <tr><td>涉事學員</td><td>${esc(p.incident.student_name)} · 聯絡電話 ${esc(p.incident.student_phone_masked)}</td></tr>
    <tr><td>家長／監護人</td><td>${esc(p.incident.guardian_name || "—")} · ${esc(p.incident.guardian_phone_masked || "—")}</td></tr>
  </table>

  <h2>第二區：執教教練資質與 PLI 保單覆蓋證明 (Insurance Evidence)</h2>
  <table class="kv">
    <tr><td>原排更教練</td><td>${esc(p.coaches.original.name)}（${esc(p.coaches.original.id)}）</td></tr>
    <tr><td>實際執教教練</td><td>${esc(p.coaches.actual.name)}（${esc(p.coaches.actual.id)}）${p.coaches.actual.is_substitute ? " · 合法指派代堂" : ""}</td></tr>
    <tr><td>執教資質</td><td>${esc(p.coaches.actual.license_type || "—")} ${p.coaches.actual.license_no_masked ? "（證書號 " + esc(p.coaches.actual.license_no_masked) + "）" : ""}</td></tr>
    <tr><td>承保來源</td><td>${esc(p.insurance.coverage_source)}${p.insurance.is_emergency_override ? "（緊急代堂平台底網）" : "（教練個人保單）"}</td></tr>
    <tr><td>承保機構</td><td>${esc(p.insurance.insurer_name)}</td></tr>
    <tr><td>保單編號</td><td>${esc(p.insurance.policy_number)}</td></tr>
    <tr><td>責任保額</td><td>HK$ ${esc(coverage)}</td></tr>
    <tr><td>保單效期</td><td>至 ${esc(p.insurance.policy_expiry_date)}</td></tr>
    <tr><td>保險備案日誌</td><td>${esc(p.insurance.insurance_log_id)} · 建立於 ${esc(hkDateTime(p.insurance.logged_at))} HKT</td></tr>
    <tr><td>時間戳驗證</td><td>${new Date(String(p.insurance.logged_at).replace(" ", "T") + "Z") < new Date(String(p.incident.incident_time).replace(" ", "T") + "Z") ? "✅ 保險覆蓋建立時間早於事故發生時間" : "⚠️ 請人工核對時序"}</td></tr>
  </table>

  <h2>第三區：現場點名與舊患聲明記錄 (Roster &amp; Health Waiver)</h2>
  <p>全班人數：報名 ${p.attendance_summary.booked} 人 · 實到 ${p.attendance_summary.present} 人</p>
  <table>
    <thead><tr><th>學員</th><th>電話</th><th>HKID</th><th>緊急聯絡</th><th>舊患／健康備註</th><th>點名</th></tr></thead>
    <tbody>${rosterRows || '<tr><td colspan="6">無點名紀錄</td></tr>'}</tbody>
  </table>

  <h2>第四區：事故經過與現場處置紀錄 (Incident Narrative)</h2>
  <table class="kv">
    <tr><td>事發經過</td><td>${esc(p.incident.description)}</td></tr>
    <tr><td>現場處置</td><td>${esc(p.incident.action_taken || "—")}</td></tr>
    <tr><td>嚴重程度</td><td>${esc(p.incident.severity || "—")}</td></tr>
    <tr><td>通報人</td><td>${esc(p.incident.reported_by || "—")}</td></tr>
  </table>

  <h2>第五區：審計日誌與法定存證 (Digital Hash &amp; Audit Trail)</h2>
  <table class="kv">
    <tr><td>報告生成人員</td><td>${esc(p.generated_by.name)}（${esc(p.generated_by.id)}）</td></tr>
    <tr><td>事故紀錄建立時間</td><td>${esc(hkDateTime(p.incident.created_at))} HKT</td></tr>
  </table>
  <p style="font-size:9pt;margin:3mm 0 1mm">系統數位指紋 (SHA-256)：</p>
  <div class="hash">${esc(sha)}</div>
  <div class="warn" style="margin-top:4mm">聲明：本報告數據直接提取自系統底層日誌（class_schedules / schedule_insurance_logs / schedule_incidents / bookings / attendances），一經產生不可撤銷與竄改。任何欄位改動都會令上述 SHA-256 雜湊對不上。</div>
  <div class="sign"><div>營運負責人簽署</div><div>日期</div></div>
  <div class="foot">ZenPass · 香港康樂及體育有限公司 · 本文件由系統自動生成，僅供保險理賠及法定備案用途。</div>
  </body></html>`;
}

function dossierCsv(d, sha) {
  const p = d.payload;
  const rows = [
    ["ZENPASS PLI 課堂事故報告書"],
    ["Claim Dossier Reference", p.reference_no],
    ["生成時間 (HKT)", hkDateTime(p.generated_at)],
    [],
    ["第一區：事故基本資料"],
    ["班次編號", p.schedule.schedule_id],
    ["課程名稱", p.schedule.course_title],
    ["地點", `${p.schedule.venue} · ${p.schedule.district}`],
    ["事故時間", hkDateTime(p.incident.incident_time)],
    ["學員", p.incident.student_name],
    ["學員電話", p.incident.student_phone_masked],
    ["監護人", p.incident.guardian_name],
    ["監護人電話", p.incident.guardian_phone_masked],
    [],
    ["第二區：保險證據"],
    ["原教練", p.coaches.original.name],
    ["實際教練", p.coaches.actual.name],
    ["資質", p.coaches.actual.license_type],
    ["承保來源", p.insurance.coverage_source],
    ["保險公司", p.insurance.insurer_name],
    ["保單號碼", p.insurance.policy_number],
    ["保額 (HK$)", (p.insurance.coverage_amount_cents / 100).toFixed(2)],
    ["保單到期日", p.insurance.policy_expiry_date],
    ["備案日誌 ID", p.insurance.insurance_log_id],
    ["備案時間", hkDateTime(p.insurance.logged_at)],
    [],
    ["第三區：點名與健康"],
    ["學員", "電話", "HKID", "緊急聯絡", "舊患／健康備註", "點名"],
    ...p.roster.map((r) => [r.student_name, r.phone_masked, r.hkid_masked, `${r.emergency_name} ${r.emergency_phone_masked}`, r.health_notes, r.attendance_status]),
    [],
    ["第四區：事故經過"],
    ["經過", p.incident.description],
    ["現場處置", p.incident.action_taken],
    ["嚴重程度", p.incident.severity],
    [],
    ["第五區：存證"],
    ["生成人", `${p.generated_by.name} (${p.generated_by.id})`],
    ["SHA-256", sha],
  ];
  const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  return "\uFEFF" + rows.map((r) => (r.length ? r.map(cell).join(",") : "")).join("\r\n");
}

async function renderPdf(html, outPath) {
  const tmpHtml = outPath.replace(/\.pdf$/, ".html");
  fs.writeFileSync(tmpHtml, html, "utf8");
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const bin = candidates.find((p) => {
    try { return fs.existsSync(p); } catch (e) { return false; }
  });
  if (!bin) {
    try { fs.unlinkSync(tmpHtml); } catch (e) {}
    throw new Error("CHROME_NOT_AVAILABLE");
  }
  try {
    await execFileAsync(
      bin,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-pdf-header-footer",
        `--print-to-pdf=${outPath}`,
        `file://${tmpHtml}`,
      ],
      { timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
    );
    return fs.readFileSync(outPath);
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
  }
}
function whenLabel(v) {
  const d = new Date(String(v || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return String(v || "");
  return d.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

router.get("/emergency-sessions", (req, res) => {
  try {
    const all = req.query.all === "1" || req.query.all === "true";
    res.json({ success: true, data: affectedSessions(getDb(), req.query.date, all) });
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

// ===== 事故登記 =====
function toUtcStamp(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString().replace("T", " ").slice(0, 19);
  }
  const base = s.replace(" ", "T");
  const d = new Date(/T\d{2}:\d{2}$/.test(base) ? base + ":00+08:00" : base + "+08:00");
  return isNaN(d) ? null : d.toISOString().replace("T", " ").slice(0, 19);
}

router.get("/schedules/:id/roster", (req, res) => {
  try {
    ensureIncidentSchema(getDb());
    res.json({ success: true, data: rosterFor(getDb(), req.params.id) });
  } catch (e) {
    console.error("[EMGSUB] roster:", e.message);
    res.status(500).json({ success: false, error: "讀取點名冊失敗" });
  }
});

router.post("/schedules/:id/incidents", (req, res) => {
  try {
    if (!isOps(req.user)) return res.status(403).json({ success: false, error: "權限不足" });
    const db = getDb();
    ensureIncidentSchema(db);
    const b = req.body || {};
    const scheduleId = req.params.id;
    const s = db.prepare("SELECT id FROM class_schedules WHERE id=?").get(scheduleId);
    if (!s) return res.status(404).json({ success: false, error: "找不到該課堂班次" });
    const description = String(b.description || "").trim();
    if (description.length < 10) return res.status(400).json({ success: false, code: "DESCRIPTION_REQUIRED", error: "請填寫事故經過（最少 10 字）" });
    const incidentTime = toUtcStamp(b.incident_time || b.occurred_at);
    if (!incidentTime) return res.status(400).json({ success: false, code: "TIME_REQUIRED", error: "請填寫事故時間" });

    let student = {
      user_id: b.student_user_id || null,
      name: String(b.student_name || "").trim(),
      phone: String(b.student_phone || "").replace(/\D/g, ""),
      guardian_name: String(b.guardian_name || "").trim(),
      guardian_phone: String(b.guardian_phone || "").replace(/\D/g, ""),
    };
    if (student.user_id) {
      const row = db
        .prepare(
          `SELECT b.user_id,
                  ${bookingCol(db, "attendee_type", "'adult'")} AS attendee_type,
                  ${bookingCol(db, "child_name")} AS child_name,
                  ${bookingCol(db, "guardian_name")} AS guardian_name,
                  ${bookingCol(db, "parent_phone")} AS parent_phone,
                  u.name, u.phone
             FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.schedule_id=? AND b.user_id=? LIMIT 1`,
        )
        .get(scheduleId, student.user_id);
      if (row) {
        student.name = row.attendee_type === "child" ? row.child_name || row.name : row.name;
        student.phone = student.phone || row.phone || "";
        student.guardian_name = student.guardian_name || row.guardian_name || "";
        student.guardian_phone = student.guardian_phone || row.parent_phone || "";
      }
    }
    if (!student.name) return res.status(400).json({ success: false, code: "STUDENT_REQUIRED", error: "請選擇或填寫受傷學員姓名" });

    const id = "inc_" + crypto.randomBytes(8).toString("hex");
    db.transaction(() => {
      db.prepare(
        `INSERT INTO schedule_incidents
           (id, schedule_id, student_user_id, student_name, student_phone, guardian_name, guardian_phone,
            incident_time, description, action_taken, severity, reported_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        scheduleId,
        student.user_id,
        student.name,
        student.phone || null,
        student.guardian_name || null,
        student.guardian_phone || null,
        incidentTime,
        description,
        String(b.action_taken || "").trim() || null,
        String(b.severity || "").trim() || null,
        req.user.id,
      );
      try {
        audit({
          actionType: "pli.incident_reported",
          entityType: "schedule",
          entityId: scheduleId,
          userId: req.user.id,
          newValues: { incident_id: id, student_name: student.name, incident_time: incidentTime, severity: b.severity || null },
          description: "登記課堂意外事故",
        });
      } catch (e) {}
    })();
    res.status(201).json({ success: true, data: { incident_id: id } });
  } catch (e) {
    console.error("[EMGSUB] incident:", e.message);
    res.status(500).json({ success: false, error: "登記事故失敗" });
  }
});

router.get("/schedules/:id/incidents", (req, res) => {
  try {
    ensureIncidentSchema(getDb());
    const rows = getDb()
      .prepare("SELECT * FROM schedule_incidents WHERE schedule_id=? ORDER BY datetime(incident_time) DESC")
      .all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[EMGSUB] incidents:", e.message);
    res.status(500).json({ success: false, error: "讀取事故紀錄失敗" });
  }
});

// ===== PLI 索償報告匯出 =====
router.get("/schedules/:id/export-pli-incident", async (req, res) => {
  try {
    const db = getDb();
    const d = buildDossier(db, req.params.id, req.query.incident_id || null, req.user);
    if (d.error === "NOT_FOUND") return res.status(404).json({ success: false, error: "找不到該課堂班次" });
    if (d.error === "NO_INSURANCE_LOG") return res.status(409).json({ success: false, code: "NO_INSURANCE_LOG", error: "此班未有 PLI 保險備案，請先完成代堂指派／保險核實" });
    if (d.error === "NO_INCIDENT") return res.status(409).json({ success: false, code: "NO_INCIDENT", error: "此班未登記事故" });

    const sha = crypto.createHash("sha256").update(stableStringify(d.payload)).digest("hex");
    const format = ["pdf", "csv", "json"].includes(String(req.query.format || "").toLowerCase())
      ? String(req.query.format).toLowerCase()
      : "pdf";
    const exportId = "exp_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO pli_claim_exports (id, schedule_id, incident_id, reference_no, format, sha256, payload_json, generated_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(exportId, d.schedule.id, d.incident.id, d.payload.reference_no, format, sha, stableStringify(d.payload), req.user.id);
    try {
      audit({
        actionType: "pli.incident_report_exported",
        entityType: "schedule",
        entityId: d.schedule.id,
        userId: req.user.id,
        newValues: { incident_id: d.incident.id, export_id: exportId, format, hash: sha },
        description: "匯出 PLI 事故索償報告包",
      });
    } catch (e) {}

    const base = `ZP-CLM-${String(d.incident.incident_time).slice(0, 10).replace(/-/g, "")}-${String(d.schedule.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}`;
    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.json"`);
      return res.send(
        JSON.stringify({ success: true, data: { report: d.payload, digital_signature: sha, export_id: exportId, exported_at: new Date().toISOString() } }, null, 2),
      );
    }
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
      return res.send(dossierCsv(d, sha));
    }
    const out = path.join(os.tmpdir(), `zp-pli-${crypto.randomBytes(6).toString("hex")}.pdf`);
    const pdf = await renderPdf(dossierHtml(d, sha), out);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error("[EMGSUB] export:", e.message);
    res.status(500).json({ success: false, error: "生成索償報告失敗" });
  }
});

// 規格端點：POST /api/admin/schedules/:id/assign-substitute
router.post("/schedules/:id/assign-substitute", (req, res) => {
  try {
    if (!isOps(req.user)) return res.status(403).json({ success: false, error: "權限不足" });
    const b = req.body || {};
    const targetCoachId = b.substitute_coach_id || b.target_coach_id;
    if (!targetCoachId) return res.status(400).json({ success: false, error: "請提供代堂教練 ID (substitute_coach_id)" });
    const reason = String(b.reason || "緊急代堂指派").trim();
    if (reason.length < 4) return res.status(400).json({ success: false, code: "REASON_REQUIRED", error: "請填寫指派原因（最少 4 字）" });
    const out = assign(getDb(), {
      scheduleId: req.params.id,
      targetCoachId,
      forcePlatformPli: b.force_platform_pli === true || b.force_platform_pli === 1 || b.force_platform_pli === "true",
      useUmbrella: b.force_platform_pli === true || b.force_platform_pli === 1,
      adminId: req.user.id,
      reason,
    });
    if (!out.ok) {
      const msgs = {
        NOT_FOUND: "找不到該課堂班次",
        COACH_NOT_LOCKED: "原教練未被熔斷，請用一般代堂流程",
        ALREADY_ASSIGNED: "此班已有代堂教練",
        INVALID_COACH: "代堂教練不存在",
        COACH_LOCKED: "代堂教練帳號處於非啟用狀態",
        OVERLAP: "代堂教練同時段已有班",
        NO_CREDENTIAL: "代堂教練未提交資質",
        CREDENTIAL_NOT_VERIFIED: "代堂教練資質未核實",
        PLI_REQUIRED: "需要個人 PLI 或啟用平台綜合責任保險",
      };
      return res.status(409).json({ success: false, code: out.code, error: msgs[out.code] || "指派失敗", umbrella: out.umbrella });
    }
    res.json({
      success: true,
      message: "代堂指派成功，PLI 保險已完成覆蓋並記錄。",
      data: {
        schedule_id: out.schedule_id,
        substitute_coach_id: out.substitute.id,
        substitute_coach_name: out.substitute.name,
        insurance_log_id: out.insurance_log_id,
        pli_coverage_source: out.pli_source === "umbrella" ? "platform_umbrella_pli" : "coach_personal_pli",
        is_emergency_override: out.pli_source === "umbrella",
      },
    });
  } catch (e) {
    console.error("[EMGSUB] assign-substitute:", e.message);
    res.status(500).json({ success: false, error: "指派失敗" });
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
module.exports.ensureIncidentSchema = ensureIncidentSchema;
module.exports.buildDossier = buildDossier;
module.exports.dossierCsv = dossierCsv;
module.exports.dossierHtml = dossierHtml;
module.exports.renderPdf = renderPdf;
