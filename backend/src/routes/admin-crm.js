/**
 * ZenPass — 管理員 CRM（學員 360°／教練資質）— 2026-10-28
 * 注意：教練自己嘅 CRM 喺 routes/crm.js（/api/crm，有 canAccessStudent 限制），
 *       呢個檔只掛喺 /api/admin，admin-only，唔會影響教練端權限。
 * GET  /api/admin/crm/students?search=&limit=&offset=
 * GET  /api/admin/crm/students/:id
 * PUT  /api/admin/coaches/:id/credentials
 * 2026-10-28
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();

const OPS_ROLES = ["super_admin", "platform_manager", "admin"];
function requireOpsRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "需要登入認證" });
  if (!OPS_ROLES.includes(req.user.role)) return res.status(403).json({ error: "需要營運管理員權限" });
  next();
}

// ===== 👥 學員 360° 檔案（CRM，2026-10-28）=====
// GET /api/admin/ops/crm/students?search=&limit=&offset=
router.get("/crm/students", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const q = String(req.query.search || "").trim().slice(0, 60);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const like = "%" + q + "%";
    const where = q
      ? "WHERE (u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)"
      : "";
    const params = q ? [like, like, like] : [];

    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.created_at, u.role,
                COUNT(b.id) AS bookings,
                SUM(CASE WHEN b.status = 'attended' THEN 1 ELSE 0 END) AS attended,
                SUM(CASE WHEN b.status = 'no_show' THEN 1 ELSE 0 END) AS no_shows,
                SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.amount ELSE 0 END), 0) AS spent,
                COALESCE(SUM(CASE WHEN b.status = 'attended' THEN COALESCE(c.duration, 60) ELSE 0 END), 0) AS mins,
                MIN(CASE WHEN b.id IS NOT NULL THEN COALESCE(cs.start_time, b.created_at) END) AS first_session,
                GROUP_CONCAT(DISTINCT NULLIF(b.child_name, '')) AS children,
                GROUP_CONCAT(DISTINCT COALESCE(c.sport_slug, c.category, '')) AS sports
           FROM users u
           LEFT JOIN bookings b ON b.user_id = u.id
           LEFT JOIN classes c ON c.id = b.class_id
           LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
           ${where}
          GROUP BY u.id
         HAVING COUNT(b.id) > 0
          ORDER BY (first_session IS NULL), first_session DESC, u.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    const certCounts = db.prepare(
      "SELECT user_id, COUNT(*) AS c FROM certificates WHERE COALESCE(revoked,0)=0 GROUP BY user_id",
    ).all();
    const certMap = new Map(certCounts.map((x) => [x.user_id, Number(x.c) || 0]));

    const total = db
      .prepare(
        `SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN bookings b ON b.user_id = u.id ${where}`,
      )
      .get(...params).c;

    const expand = String(req.query.expand || "") === "1";
    let certsByUser = new Map();
    let bksByUser = new Map();
    if (expand && rows.length) {
      const ids = rows.map((r) => r.id);
      const ph = ids.map(() => "?").join(",");
      const certs = db
        .prepare(
          `SELECT user_id, code, cert_type, class_title, level_label, hours, issued_at, overall_grade, student_name
             FROM certificates WHERE COALESCE(revoked,0)=0 AND user_id IN (${ph})
            ORDER BY issued_at DESC`,
        )
        .all(...ids);
      certs.forEach((c) => {
        const arr = certsByUser.get(c.user_id) || [];
        arr.push(c);
        certsByUser.set(c.user_id, arr);
      });
      const bks = db
        .prepare(
          `SELECT b.user_id, b.id, b.booking_reference, b.status, b.payment_status, b.amount, b.child_name,
                  b.created_at, c.title, cs.start_time
             FROM bookings b LEFT JOIN classes c ON c.id=b.class_id
             LEFT JOIN class_schedules cs ON cs.id=b.schedule_id
            WHERE b.user_id IN (${ph})
            ORDER BY COALESCE(cs.start_time, b.created_at) DESC`,
        )
        .all(...ids);
      bks.forEach((b) => {
        const arr = bksByUser.get(b.user_id) || [];
        if (arr.length < 20) arr.push(b);
        bksByUser.set(b.user_id, arr);
      });
    }

    res.json({
      success: true,
      total: Number(total) || 0,
      limit,
      offset,
      students: rows.map((r) => ({
        id: r.id,
        name: r.name || "",
        email: r.email || "",
        phone: r.phone || "",
        joined: r.created_at,
        first_session: r.first_session || "",
        bookings: Number(r.bookings) || 0,
        attended: Number(r.attended) || 0,
        no_shows: Number(r.no_shows) || 0,
        cancelled: Number(r.cancelled) || 0,
        spent: Math.round(Number(r.spent) * 100) / 100,
        hours: Math.round((Number(r.mins) / 60) * 10) / 10,
        certs: certMap.get(r.id) || 0,
        children: (r.children || "").split(",").filter(Boolean),
        sports: (r.sports || "").split(",").filter(Boolean),
        student_name:
          ((r.children || "").split(",").filter(Boolean)[0]) || r.name || "",
        ...(expand
          ? {
              certificates: certsByUser.get(r.id) || [],
              bookings_detail: bksByUser.get(r.id) || [],
            }
          : {}),
      })),
    });
  } catch (err) {
    console.error("[OPS] crm students error:", err.message);
    res.status(500).json({ success: false, error: "讀取學員檔案失敗" });
  }
});

// GET /api/admin/ops/crm/students/:id — 單一學員詳情（證書＋預約）
router.get("/crm/students/:id", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT id, name, email, phone, created_at FROM users WHERE id = ?").get(req.params.id);
    if (!u) return res.status(404).json({ success: false, error: "學員不存在" });

    const bookings = db
      .prepare(
        `SELECT b.id, b.booking_reference, b.status, b.payment_status, b.amount, b.child_name,
                b.created_at, c.title, cs.start_time
           FROM bookings b
           LEFT JOIN classes c ON c.id = b.class_id
           LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
          WHERE b.user_id = ?
          ORDER BY COALESCE(cs.start_time, b.created_at) DESC LIMIT 100`,
      )
      .all(u.id);

    const certs = db
      .prepare(
        `SELECT code, cert_type, class_title, level_label, hours, issued_at, student_name, overall_grade
           FROM certificates WHERE user_id = ? AND COALESCE(revoked,0) = 0
          ORDER BY issued_at DESC LIMIT 100`,
      )
      .all(u.id);

    let students = [];
    let terms = [];
    try {
      const svc = require("../services/certificate-service");
      students = svc.studentSummariesForUser(u.id);
      terms = svc.termProgressForUser(u.id);
    } catch (e) {}

    res.json({ success: true, user: u, bookings, certificates: certs, students, terms });
  } catch (err) {
    console.error("[OPS] crm student detail error:", err.message);
    res.status(500).json({ success: false, error: "讀取學員詳情失敗" });
  }
});

// PUT /api/admin/coaches/:id/credentials — 更新教練資質（牌照／保單到期日、可發證項目）
router.put("/coaches/:id/credentials", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const cred = db
      .prepare("SELECT * FROM coach_credentials WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(req.params.id);
    if (!cred) return res.status(404).json({ success: false, error: "此教練未提交資質" });

    const b = req.body || {};
    const sets = [];
    const vals = [];
    const put = (col, v) => { sets.push(col + " = ?"); vals.push(v == null ? null : String(v).slice(0, 40)); };
    if (b.license_no != null) put("license_no", b.license_no);
    if (b.license_type != null) put("license_type", b.license_type);
    if (b.license_expiry != null) put("license_expiry", b.license_expiry);
    if (b.insurance_expiry_date != null) put("insurance_expiry_date", b.insurance_expiry_date);
    if (b.first_aid_expiry != null) put("first_aid_expiry", b.first_aid_expiry);
    if (b.status != null) {
      const st = String(b.status);
      if (!["verified", "pending", "suspended", "rejected"].includes(st)) {
        return res.status(400).json({ success: false, error: "status 無效" });
      }
      put("status", st);
      if (st === "verified") put("reviewed_at", new Date().toISOString().slice(0, 19).replace("T", " "));
    }
    if (Array.isArray(b.qualified_sports)) {
      const sports = b.qualified_sports.map((x) => String(x).slice(0, 30)).filter(Boolean).slice(0, 30);
      put("qualified_sports", JSON.stringify(sports));
    }
    if (!sets.length) return res.status(400).json({ success: false, error: "沒有可更新欄位" });

    db.prepare(`UPDATE coach_credentials SET ${sets.join(", ")} WHERE id = ?`).run(...vals, cred.id);

    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
         VALUES (?, 'coach.credentials_updated', 'coach_credential', ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(
        crypto.randomUUID(), cred.id, req.user.id,
        JSON.stringify({ license_expiry: cred.license_expiry, insurance_expiry_date: cred.insurance_expiry_date, qualified_sports: cred.qualified_sports }),
        JSON.stringify(b), "管理員更新教練資質",
      );
    } catch (e) {}

    res.json({ success: true, credentials: db.prepare("SELECT * FROM coach_credentials WHERE id = ?").get(cred.id) });
  } catch (err) {
    console.error("[OPS] coach credentials update error:", err.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});


// ===== 🏟️ 場地 PLI（公眾責任保險）錄入與閘門 =====
function ensureVenuePliColumns(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(partner_venues)").all().map((c) => c.name);
    [
      ["business_reg_no", "TEXT"],
      ["pli_policy_no", "TEXT"],
      ["pli_expiry", "TEXT"],
      ["pli_status", "TEXT DEFAULT 'unverified'"],
      ["venue_terms_ack_at", "TEXT"],
    ].forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE partner_venues ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) {}
}

function venuePliGateMode(db) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key='venue.pli_gate'").get();
    if (r && ["warn", "enforce", "off"].includes(String(r.value))) return String(r.value);
  } catch (e) {}
  return String(process.env.VENUE_PLI_GATE || "warn");
}

function venuePliRows(db) {
  ensureVenuePliColumns(db);
  const today = new Date().toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT id, name, district, address, status, business_reg_no, pli_policy_no, pli_expiry, pli_status
         FROM partner_venues
        ORDER BY (status = 'active') DESC, name`,
    )
    .all();
  return rows.map((v) => {
    const status = String(v.pli_status || "unverified");
    const expiry = v.pli_expiry ? String(v.pli_expiry).slice(0, 10) : null;
    const expired = !!(expiry && expiry < today);
    const daysLeft = expiry ? Math.ceil((new Date(expiry + "T00:00:00").getTime() - Date.now()) / 86400000) : null;
    return {
      id: v.id,
      name: v.name,
      district: v.district || "",
      address: v.address || "",
      status: v.status || "",
      business_reg_no: v.business_reg_no || "",
      pli_policy_no: v.pli_policy_no || "",
      pli_expiry: expiry,
      pli_status: status,
      expired,
      days_left: daysLeft,
      ok: status === "exempt" || (status === "verified" && !expired),
    };
  });
}

// GET /api/admin/venues — 場地清單＋PLI 狀態＋閘門模式
router.get("/venues", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const venues = venuePliRows(db);
    const commercial = venues.filter((v) => v.status === "active" && v.pli_status !== "exempt");
    const blocking = commercial.filter((v) => !v.ok);
    res.json({
      success: true,
      gate: venuePliGateMode(db),
      venues,
      summary: {
        total: venues.length,
        active_commercial: commercial.length,
        ok: commercial.length - blocking.length,
        blocking: blocking.length,
        blocking_names: blocking.map((v) => v.name),
        ready_for_enforce: blocking.length === 0,
      },
    });
  } catch (err) {
    console.error("[CRM] venues list error:", err.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

// POST /api/admin/settings/venue-pli-gate — 切換閘門模式（warn / enforce / off）
router.post("/settings/venue-pli-gate", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const mode = String((req.body || {}).mode || "");
    if (!["warn", "enforce", "off"].includes(mode)) {
      return res.status(400).json({ success: false, error: "mode 無效（warn／enforce／off）" });
    }
    if (mode === "enforce") {
      const venues = venuePliRows(db);
      const blocking = venues.filter((v) => v.status === "active" && v.pli_status !== "exempt" && !v.ok);
      if (blocking.length) {
        return res.status(400).json({
          success: false,
          error: `仍有 ${blocking.length} 個使用中場地未核驗或保單已過期，未能切換強制模式`,
          code: "VENUE_PLI_INCOMPLETE",
          blocking: blocking.map((v) => ({ id: v.id, name: v.name, pli_status: v.pli_status, pli_expiry: v.pli_expiry })),
        });
      }
    }
    const prev = venuePliGateMode(db);
    db.prepare(
      `INSERT INTO platform_settings (key, value, description) VALUES ('venue.pli_gate', ?, '場地 PLI 開班閘門模式（warn／enforce／off）')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(mode);
    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
         VALUES (?, 'settings.venue_pli_gate', 'platform_setting', 'venue.pli_gate', ?, ?, ?, ?, datetime('now'))`,
      ).run(
        crypto.randomUUID(), req.user.id,
        JSON.stringify({ mode: prev }), JSON.stringify({ mode }),
        `場地 PLI 閘門：${prev} → ${mode}`,
      );
    } catch (e) {}
    res.json({ success: true, gate: mode });
  } catch (err) {
    console.error("[CRM] venue pli gate error:", err.message);
    res.status(500).json({ success: false, error: "切換失敗" });
  }
});

// PUT /api/admin/venues/:id/pli — 更新場地商業登記及公眾責任保險（PLI）
router.put("/venues/:id/pli", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    ensureVenuePliColumns(db);

    const v = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(req.params.id);
    if (!v) return res.status(404).json({ success: false, error: "場地不存在" });

    const b = req.body || {};
    const status = b.pli_status != null ? String(b.pli_status) : v.pli_status || "unverified";
    if (!["verified", "unverified", "exempt"].includes(status)) {
      return res.status(400).json({ success: false, error: "pli_status 無效（verified／unverified／exempt）" });
    }
    const expiry = b.pli_expiry != null ? String(b.pli_expiry).slice(0, 10) : v.pli_expiry;
    if (status === "verified" && (!expiry || expiry < new Date().toISOString().slice(0, 10))) {
      return res.status(400).json({ success: false, error: "標記為已核驗時，必須提供未過期的保單到期日", code: "PLI_EXPIRY_REQUIRED" });
    }

    db.prepare(
      `UPDATE partner_venues SET business_reg_no = ?, pli_policy_no = ?, pli_expiry = ?, pli_status = ?,
              venue_terms_ack_at = COALESCE(?, venue_terms_ack_at) WHERE id = ?`,
    ).run(
      b.business_reg_no != null ? String(b.business_reg_no).slice(0, 32) : v.business_reg_no,
      b.pli_policy_no != null ? String(b.pli_policy_no).slice(0, 64) : v.pli_policy_no,
      expiry,
      status,
      b.ack_terms === true ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
      v.id,
    );

    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
         VALUES (?, 'venue.pli_updated', 'partner_venue', ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(
        crypto.randomUUID(), v.id, req.user.id,
        JSON.stringify({ pli_status: v.pli_status, pli_expiry: v.pli_expiry }),
        JSON.stringify({ pli_status: status, pli_expiry: expiry }),
        `更新場地 PLI：${v.name || v.id}`,
      );
    } catch (e) {}

    res.json({ success: true, venue_id: v.id, pli_status: status, pli_expiry: expiry });
  } catch (err) {
    console.error("[CRM] venue pli update error:", err.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

module.exports = router;
