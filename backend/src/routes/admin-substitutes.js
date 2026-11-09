/**
 * 工單六 — 管理端代堂審批（Admin Substitute Review）
 *  GET  /api/admin/substitutes/pending
 *  POST /api/admin/substitutes/:id/approve
 *  POST /api/admin/substitutes/:id/reject
 *
 * 安全模型：
 *  - 教練只可提交 pending 申請；未經管理員核批，課堂導師維持原教練
 *  - 核准前檢查：代堂教練資質已核實、保險／牌照未過期、場地 PLI（enforce 模式硬性）
 *  - 核准喺單一 SQLite transaction 內寫入 class_schedules.coach_override_id
 *  - 原教練／代堂教練都會收到通知，audit_log 全程留痕
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { dbNotification } = require("../services/notification");

const router = express.Router();

const OPS_ROLES = ["super_admin", "platform_manager", "admin"];

function ensureSchema(db) {
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  if (!cols.includes("coach_override_id")) db.exec("ALTER TABLE class_schedules ADD COLUMN coach_override_id TEXT");
  const rcols = db.prepare("PRAGMA table_info(coach_substitution_requests)").all().map((c) => c.name);
  if (!rcols.includes("review_note")) db.exec("ALTER TABLE coach_substitution_requests ADD COLUMN review_note TEXT");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_subreq_status ON coach_substitution_requests(status, created_at)").run();
  // 場地 PLI 欄位可能未由 admin-crm 建立過（舊 DB）
  try {
    const vcols = db.prepare("PRAGMA table_info(partner_venues)").all().map((c) => c.name);
    const add = (col, ddl) => { if (!vcols.includes(col)) db.exec(`ALTER TABLE partner_venues ADD COLUMN ${ddl}`); };
    add("pli_policy_no", "pli_policy_no TEXT");
    add("pli_expiry", "pli_expiry TEXT");
    add("pli_status", "pli_status TEXT DEFAULT 'unverified'");
    add("is_sandbox", "is_sandbox INTEGER DEFAULT 0");
  } catch (e) {}
}

function gateMode(db) {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key='venue.pli_gate'").get();
    const v = row && String(row.value || "").trim();
    if (["off", "warn", "enforce"].includes(v)) return v;
  } catch (e) {}
  const env = String(process.env.VENUE_PLI_GATE || "warn").toLowerCase();
  return ["off", "warn", "enforce"].includes(env) ? env : "warn";
}

const todayHKT = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

/** 代堂教練 + 場地合規檢查（唔會 throw，回傳 blockers/warnings） */
function checkEligibility(db, targetCoachId, classId) {
  const blockers = [];
  const warnings = [];
  const cred = db
    .prepare("SELECT * FROM coach_credentials WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(targetCoachId);
  if (!cred) blockers.push("代堂教練未提交資質證明");
  else {
    if (cred.status !== "verified") blockers.push("代堂教練資質未核實");
    const today = todayHKT();
    if (cred.insurance_expiry_date && String(cred.insurance_expiry_date).slice(0, 10) < today)
      blockers.push("代堂教練保險已過期（" + String(cred.insurance_expiry_date).slice(0, 10) + "）");
    if (cred.license_expiry && String(cred.license_expiry).slice(0, 10) < today)
      blockers.push("代堂教練牌照已過期（" + String(cred.license_expiry).slice(0, 10) + "）");
  }

  let venue = null;
  try {
    const cls = db.prepare("SELECT partner_venue_id FROM classes WHERE id=?").get(classId);
    if (cls && cls.partner_venue_id) {
      venue = db
        .prepare("SELECT id,name,pli_status,pli_expiry,is_sandbox FROM partner_venues WHERE id=?")
        .get(cls.partner_venue_id);
    }
  } catch (e) {}
  if (venue) {
    if (Number(venue.is_sandbox) === 1) {
      warnings.push(`⚠️ 測試環境豁免 PLI（沙盒場地：${venue.name}）`);
    } else {
      const st = String(venue.pli_status || "unverified");
      const expired = venue.pli_expiry && String(venue.pli_expiry).slice(0, 10) < todayHKT();
      if (st === "expired" || expired) blockers.push(`場地 PLI 已過期（${venue.name}）`);
      else if (st !== "verified" && st !== "exempt") {
        const msg = `場地 PLI 未核實（${venue.name}）`;
        if (gateMode(db) === "enforce") blockers.push(msg);
        else warnings.push(msg);
      }
    }
  } else {
    warnings.push("場地未連結商戶資料，PLI 無法自動核對");
  }
  return { ok: blockers.length === 0, blockers, warnings, credential: cred || null, venue };
}

// ===== 待審批清單 =====
router.get("/substitutes/pending", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const ops = db.prepare("SELECT role FROM users WHERE id=?").get(req.user.id);
    if (!ops || !OPS_ROLES.includes(ops.role)) return res.status(403).json({ success: false, error: "需要營運管理員權限" });

    const rows = db
      .prepare(
        `SELECT r.id, r.session_id, r.from_coach_id, r.target_coach_id, r.reason, r.status, r.created_at,
                s.start_time, s.end_time, s.coach_override_id, s.class_id,
                c.title, c.venue_name,
                f.name AS from_name, t.name AS target_name, t.email AS target_email, t.phone AS target_phone
           FROM coach_substitution_requests r
           JOIN class_schedules s ON s.id=r.session_id
           JOIN classes c ON c.id=s.class_id
           LEFT JOIN users f ON f.id=r.from_coach_id
           LEFT JOIN users t ON t.id=r.target_coach_id
          WHERE r.status='pending'
          ORDER BY s.start_time`,
      )
      .all();
    const items = rows.map((r) => {
      const e = checkEligibility(db, r.target_coach_id, r.class_id);
      return { ...r, eligible: e.ok, blockers: e.blockers, warnings: e.warnings };
    });
    res.json({ success: true, items, gate_mode: gateMode(db) });
  } catch (e) {
    console.error("[SUBREQ] pending:", e.message);
    res.status(500).json({ success: false, error: "讀取代堂申請失敗" });
  }
});

function loadRequest(db, id) {
  return db
    .prepare(
      `SELECT r.*, s.start_time, s.end_time, s.class_id, s.coach_override_id, c.title, c.venue_name, c.coach_id AS class_coach_id
         FROM coach_substitution_requests r
         JOIN class_schedules s ON s.id=r.session_id
         JOIN classes c ON c.id=s.class_id
        WHERE r.id=?`,
    )
    .get(id);
}

router.post("/substitutes/:id/approve", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const ops = db.prepare("SELECT role FROM users WHERE id=?").get(req.user.id);
    if (!ops || !OPS_ROLES.includes(ops.role)) return res.status(403).json({ success: false, error: "需要營運管理員權限" });

    const r = loadRequest(db, req.params.id);
    if (!r) return res.status(404).json({ success: false, error: "找不到代堂申請" });
    if (r.status !== "pending") return res.status(409).json({ success: false, error: "此申請已處理（" + r.status + "）" });

    const e = checkEligibility(db, r.target_coach_id, r.class_id);
    if (!e.ok) return res.status(409).json({ success: false, error: e.blockers.join("；"), blockers: e.blockers });

    const tx = db.transaction(() => {
      const upd = db
        .prepare("UPDATE class_schedules SET coach_override_id=? WHERE id=?")
        .run(r.target_coach_id, r.session_id);
      if (!upd.changes) throw new Error("班次更新失敗");
      const st = db
        .prepare(
          "UPDATE coach_substitution_requests SET status='approved', reviewed_at=datetime('now'), reviewed_by=?, review_note=? WHERE id=? AND status='pending'",
        )
        .run(req.user.id, String((req.body && req.body.note) || "").slice(0, 300), r.id);
      if (!st.changes) throw new Error("申請狀態已被其他人更新");
    });
    tx();

    audit({
      actionType: "coach.substitute_approved",
      entityType: "class_schedule",
      entityId: r.session_id,
      userId: req.user.id,
      oldValues: { coach_id: r.class_coach_id, override: r.coach_override_id || null },
      newValues: { coach_override_id: r.target_coach_id, request_id: r.id, warnings: e.warnings },
      description: `核准代堂（${r.title}）`,
    });
    if (e.warnings.some((w) => w.includes("豁免 PLI"))) {
      audit({
        actionType: "pli_warning_bypassed",
        entityType: "class_schedule",
        entityId: r.session_id,
        userId: req.user.id,
        newValues: { request_id: r.id, venue: e.venue && e.venue.name, is_sandbox: 1 },
        description: `沙盒場地豁免 PLI 核准代堂（${r.title}）`,
      });
    }
    try {
      dbNotification(
        r.target_coach_id,
        "coach.substitute_approved",
        "✅ 代堂已核准",
        `${r.title} · ${String(r.start_time).replace("T", " ").slice(0, 16)} — 你已正式接手此堂。`,
        { link: "coach-schedule.html" },
      );
      dbNotification(
        r.from_coach_id,
        "coach.substitute_approved",
        "✅ 代堂已交託",
        `${r.title} 已由管理員核准交託代堂，你唔需要再到場。`,
        { link: "coach-schedule.html" },
      );
    } catch (err) {}

    res.json({
      success: true,
      status: "approved",
      warnings: e.warnings,
      warning: e.warnings.find((w) => w.includes("豁免 PLI")) || null,
      session_id: r.session_id,
    });
  } catch (err) {
    console.error("[SUBREQ] approve:", err.message);
    res.status(409).json({ success: false, error: err.message });
  }
});

router.post("/substitutes/:id/reject", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const ops = db.prepare("SELECT role FROM users WHERE id=?").get(req.user.id);
    if (!ops || !OPS_ROLES.includes(ops.role)) return res.status(403).json({ success: false, error: "需要營運管理員權限" });

    const reason = String((req.body && req.body.reason) || "").trim();
    if (reason.length < 2) return res.status(400).json({ success: false, error: "請填寫駁回原因（最少 2 字）" });
    const r = loadRequest(db, req.params.id);
    if (!r) return res.status(404).json({ success: false, error: "找不到代堂申請" });
    if (r.status !== "pending") return res.status(409).json({ success: false, error: "此申請已處理（" + r.status + "）" });

    db.prepare(
      "UPDATE coach_substitution_requests SET status='rejected', reviewed_at=datetime('now'), reviewed_by=?, review_note=? WHERE id=? AND status='pending'",
    ).run(req.user.id, reason.slice(0, 300), r.id);

    audit({
      actionType: "coach.substitute_rejected",
      entityType: "class_schedule",
      entityId: r.session_id,
      userId: req.user.id,
      newValues: { request_id: r.id, reason },
      description: `駁回代堂（${r.title}）`,
    });
    try {
      dbNotification(
        r.from_coach_id,
        "coach.substitute_rejected",
        "❌ 代堂申請被駁回",
        `${r.title} — 原因：${reason}`,
        { link: "coach-schedule.html" },
      );
    } catch (err) {}

    res.json({ success: true, status: "rejected" });
  } catch (err) {
    console.error("[SUBREQ] reject:", err.message);
    res.status(500).json({ success: false, error: "駁回失敗" });
  }
});

module.exports = router;
module.exports.checkEligibility = checkEligibility;
