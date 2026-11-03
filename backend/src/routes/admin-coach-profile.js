/**
 * 後台：教練公開檔案編輯（2026-11-04）
 *  - GET   /api/admin/coach-profiles
 *  - PATCH /api/admin/coach-profiles/:id
 * 權限：ops.coach.write；所有改動寫 audit_log。
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const svc = require("../services/coach-profile");

const router = express.Router();

const ALLOWED_TYPES = Object.keys(svc.SERVICE_LABELS);
const ALLOWED_AUD = Object.keys(svc.AUDIENCE_LABELS);

function rowsToJson(v) {
  const list = svc.parseJsonList(v);
  return Object.fromEntries(list.map((x) => [x, true]));
}

router.get("/", authenticateToken, requirePermission("ops.coach.write"), (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT u.id,u.name,u.email,u.coach_slug,u.coach_verified,u.coach_headline,
                u.public_bio,u.service_types,u.target_audiences,u.service_districts,
                u.public_contact_phone,u.public_contact_hidden,u.is_active,
                (SELECT status FROM coach_credentials c WHERE c.user_id=u.id
                  ORDER BY CASE WHEN status='verified' THEN 0 ELSE 1 END, datetime(created_at) DESC LIMIT 1) AS cred_status
           FROM users u
          WHERE u.is_coach = 1 OR u.role = 'coach'
          ORDER BY u.coach_verified DESC, u.name`,
      )
      .all()
      .map((r) => ({
        ...r,
        verified: Number(r.coach_verified) === 1 || r.cred_status === "verified",
        service_types: svc.parseJsonList(r.service_types),
        target_audiences: svc.parseJsonList(r.target_audiences),
        service_districts: svc.parseJsonList(r.service_districts),
      }));
    res.json({ success: true, coaches: rows, options: { service_types: svc.SERVICE_LABELS, target_audiences: svc.AUDIENCE_LABELS } });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.patch("/:id", authenticateToken, requirePermission("ops.coach.write"), (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!u) return res.status(404).json({ success: false, error: "教練不存在" });

    const body = req.body || {};
    const updates = [];
    const params = [];
    const changed = {};

    if (body.coach_slug !== undefined && body.coach_slug !== null) {
      const slug = String(body.coach_slug).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
        return res.status(400).json({ success: false, error: "slug 只准英文字母、數字及連字號（3–64 字）" });
      }
      const clash = db.prepare("SELECT id FROM users WHERE coach_slug = ? AND id != ?").get(slug, u.id);
      if (clash) return res.status(409).json({ success: false, error: "slug 已被使用" });
      if (u.coach_slug && u.coach_slug !== slug) {
        db.prepare(
          "INSERT INTO coach_slug_redirects (from_slug,to_slug) VALUES (?,?) ON CONFLICT(from_slug) DO UPDATE SET to_slug=excluded.to_slug",
        ).run(u.coach_slug, slug);
        changed.old_slug = u.coach_slug;
      }
      updates.push("coach_slug = ?");
      params.push(slug);
      changed.coach_slug = slug;
    }

    const textFields = ["coach_headline", "public_bio", "public_contact_phone"];
    textFields.forEach((f) => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(body[f] === null ? null : String(body[f]).slice(0, 2000));
        changed[f] = body[f];
      }
    });

    if (body.public_contact_hidden !== undefined) {
      updates.push("public_contact_hidden = ?");
      params.push(body.public_contact_hidden ? 1 : 0);
      changed.public_contact_hidden = body.public_contact_hidden ? 1 : 0;
    }

    if (body.service_types !== undefined) {
      const list = (Array.isArray(body.service_types) ? body.service_types : []).filter((x) => ALLOWED_TYPES.includes(x));
      const highRisk = list.filter((x) => svc.HIGH_RISK_TYPES.includes(x));
      updates.push("service_types = ?", "service_types_pending = ?");
      params.push(JSON.stringify(list), JSON.stringify(highRisk));
      changed.service_types = list;
      changed.service_types_pending = highRisk;
    }

    if (body.target_audiences !== undefined) {
      const list = (Array.isArray(body.target_audiences) ? body.target_audiences : []).filter((x) => ALLOWED_AUD.includes(x));
      updates.push("target_audiences = ?");
      params.push(JSON.stringify(list));
      changed.target_audiences = list;
    }

    if (body.service_districts !== undefined) {
      const list = (Array.isArray(body.service_districts) ? body.service_districts : [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 18);
      updates.push("service_districts = ?");
      params.push(JSON.stringify(list));
      changed.service_districts = list;
    }

    if (!updates.length) return res.status(400).json({ success: false, error: "沒有需要更新的資料" });

    updates.push("updated_at = datetime('now')");
    params.push(u.id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    try {
      db.prepare(
        `INSERT INTO audit_log (id,action_type,entity_type,entity_id,user_id,old_values,new_values,description,created_at)
         VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
      ).run(
        crypto.randomUUID(),
        "coach.profile_updated",
        "user",
        u.id,
        req.user.id,
        JSON.stringify({
          coach_slug: u.coach_slug,
          coach_headline: u.coach_headline,
          service_types: u.service_types,
        }),
        JSON.stringify(changed),
        `更新教練公開檔案：${u.name || u.id}`,
      );
    } catch (e) {
      console.error("audit coach.profile_updated failed:", e.message);
    }

    res.json({ success: true, profile: { id: u.id, slug: changed.coach_slug || u.coach_slug } });
  } catch (e) {
    console.error("PATCH coach profile error:", e.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

module.exports = router;
