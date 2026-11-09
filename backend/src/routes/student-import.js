/**
 * 工單十二 — 教練「學生名單一鍵匯入」＋ WhatsApp 魔法連結迎新
 *  POST /api/coach/students/import-batch
 *  GET  /api/coach/students/invites
 *  GET  /api/student/onboarding/claim?token=...
 *  POST /api/student/onboarding/complete
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { generateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");

const router = express.Router();
const INVITE_DAYS = 30;

function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS student_onboarding_invites (
    id TEXT PRIMARY KEY, coach_id TEXT NOT NULL, student_name TEXT NOT NULL, phone TEXT NOT NULL,
    notes TEXT, initial_pass_quota INTEGER DEFAULT 1, token TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending', claimed_by_user_id TEXT, created_at TEXT DEFAULT (datetime('now')),
    claimed_at TEXT)`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_invites_coach_phone ON student_onboarding_invites(coach_id, phone)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_invites_token ON student_onboarding_invites(token)");
  const cols = db.prepare("PRAGMA table_info(user_passes)").all().map((c) => c.name);
  if (!cols.length) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_passes (
      id TEXT PRIMARY KEY, user_id TEXT, user_phone TEXT, student_name TEXT, total_credits INTEGER DEFAULT 0,
      remaining_credits INTEGER DEFAULT 0, price_paid REAL DEFAULT 0, status TEXT DEFAULT 'active',
      expires_at TEXT, notes TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT)`);
  }
}

const PHONE_RE = /(?:\+?852[\s-]?)?([4-9]\d{3}[\s-]?\d{4})/;
const NOTE_KW = /(膝|痛|手術|血壓|心臟|糖尿|關節|暈|中風|骨質|氣喘|哮喘|舊患|敏感|懷孕)/;

function parseLine(raw) {
  let s = String(raw || "").replace(/\u3000/g, " ").trim();
  if (!s) return null;
  s = s.replace(/^[\s\-•*·]+/, "").replace(/^\d+\s*[.、)）:：]\s*/, "");
  const m = s.match(PHONE_RE);
  if (!m) return { error: true, raw: String(raw).slice(0, 80) };
  const phone = m[1].replace(/\D/g, "");
  let rest = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
  rest = rest.replace(/^[,，;；|:\-]+|[,，;；|:\-]+$/g, "").trim();
  let name = rest, notes = "";
  const parts = rest.split(/[,，;；|]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    name = parts[0];
    notes = parts.slice(1).join("；");
  } else {
    const kw = rest.search(NOTE_KW);
    if (kw > 0) {
      name = rest.slice(0, kw).trim();
      notes = rest.slice(kw).trim();
    }
  }
  name = name.replace(/^[\s\-•*]+|[\s\-•*]+$/g, "").slice(0, 40);
  if (!name) return { error: true, raw: String(raw).slice(0, 80) };
  return { name, phone, notes: String(notes).slice(0, 200) };
}

function parseBatch(rawText) {
  return String(rawText || "")
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean);
}

router.post("/coach/students/import-batch", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const isAdmin = ["super_admin", "platform_manager", "admin"].includes(req.user.role);
    if (!isAdmin && !["coach", "partner_coach"].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "只限教練" });
    }
    const coachId = req.user.id;
    const b = req.body || {};
    const parsed = [];
    if (b.raw_text) parsed.push(...parseBatch(b.raw_text));
    if (Array.isArray(b.items)) {
      for (const it of b.items) {
        const phone = String(it.phone || "").replace(/\D/g, "").replace(/^852/, "");
        const name = String(it.name || "").trim();
        if (!/^[4-9]\d{7}$/.test(phone) || name.length < 1) {
          parsed.push({ error: true, raw: `${name} ${it.phone || ""}`.trim() });
        } else {
          parsed.push({ name: name.slice(0, 40), phone, notes: String(it.notes || "").slice(0, 200), quota: Number(it.pass_quota) || 1 });
        }
      }
    }

    const good = parsed.filter((x) => !x.error);
    const errors = parsed.filter((x) => x.error);
    if (!good.length) return res.status(400).json({ success: false, error: "未能解析任何有效學員（需要姓名＋8 位電話）", errors });

    let created = 0, updated = 0, skipped = 0;
    const invites = [];
    const tx = db.transaction(() => {
      for (const p of good) {
        const quota = Math.max(0, Math.min(20, Number(p.quota || 1)));
        const exist = db
          .prepare("SELECT id, status FROM student_onboarding_invites WHERE coach_id=? AND phone=?")
          .get(coachId, p.phone);
        if (exist) {
          if (exist.status === "claimed") { skipped++; continue; }
          db.prepare("UPDATE student_onboarding_invites SET student_name=?, notes=?, initial_pass_quota=? WHERE id=?")
            .run(p.name, p.notes || "", quota, exist.id);
          updated++;
          invites.push({ id: exist.id, name: p.name, phone: p.phone, token: db.prepare("SELECT token FROM student_onboarding_invites WHERE id=?").get(exist.id).token });
        } else {
          const id = crypto.randomUUID();
          const token = crypto.randomBytes(32).toString("hex");
          db.prepare(
            `INSERT INTO student_onboarding_invites (id, coach_id, student_name, phone, notes, initial_pass_quota, token, status)
             VALUES (?,?,?,?,?,?,?, 'pending')`,
          ).run(id, coachId, p.name, p.phone, p.notes || "", quota, token);
          created++;
          invites.push({ id, name: p.name, phone: p.phone, token });
        }
      }
    });
    tx();

    audit({
      actionType: "coach.students_imported",
      entityType: "coach",
      entityId: coachId,
      userId: coachId,
      newValues: { created, updated, skipped, errors: errors.length },
      description: "匯入線下學生名單",
    });

    res.json({ success: true, created, updated, skipped, failed: errors.length, errors: errors.slice(0, 20), invites });
  } catch (e) {
    console.error("[IMPORT]", e.message);
    res.status(500).json({ success: false, error: "匯入失敗" });
  }
});

router.get("/coach/students/invites", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const rows = db
      .prepare("SELECT id, student_name, phone, notes, initial_pass_quota, token, status, created_at, claimed_at FROM student_onboarding_invites WHERE coach_id=? ORDER BY created_at DESC LIMIT 500")
      .all(req.user.id);
    const claimed = rows.filter((r) => r.status === "claimed").length;
    res.json({
      success: true,
      invites: rows,
      stats: { total: rows.length, claimed, pending: rows.length - claimed, rate: rows.length ? Math.round((claimed / rows.length) * 100) : 0 },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.get("/student/onboarding/claim", (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const token = String(req.query.token || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ success: false, error: "連結無效" });
    const inv = db
      .prepare(
        `SELECT i.*, u.name AS coach_name FROM student_onboarding_invites i
           LEFT JOIN users u ON u.id=i.coach_id WHERE i.token=?`,
      )
      .get(token);
    if (!inv) return res.status(404).json({ success: false, error: "找不到邀請" });
    const expired = Date.now() - new Date(inv.created_at.replace(" ", "T") + "Z").getTime() > INVITE_DAYS * 864e5;
    if (inv.status === "pending" && expired) {
      db.prepare("UPDATE student_onboarding_invites SET status='expired' WHERE id=?").run(inv.id);
      inv.status = "expired";
    }
    res.json({
      success: true,
      status: inv.status,
      coach_name: inv.coach_name || "教練",
      student_name: inv.student_name,
      notes: inv.notes || "",
      quota: inv.initial_pass_quota,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/student/onboarding/complete", (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const token = String((req.body && req.body.token) || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ success: false, error: "連結無效" });
    const inv = db.prepare("SELECT * FROM student_onboarding_invites WHERE token=?").get(token);
    if (!inv) return res.status(404).json({ success: false, error: "找不到邀請" });
    if (inv.status === "claimed") return res.status(409).json({ success: false, error: "此邀請已認領" });
    if (inv.status === "expired") return res.status(410).json({ success: false, error: "邀請已過期，請教練重新發送" });

    const quota = Math.max(1, Number(inv.initial_pass_quota || 1));
    let user = db.prepare("SELECT * FROM users WHERE phone=? ORDER BY created_at LIMIT 1").get(inv.phone);
    let isNew = false;

    const tx = db.transaction(() => {
      if (!user) {
        const uid = crypto.randomUUID();
        db.prepare("INSERT INTO users (id,email,name,phone,role,created_at) VALUES (?,?,?,?, 'user', datetime('now'))")
          .run(uid, `legacy.${inv.phone}.${Date.now()}@guest.zenpass.hk`, inv.student_name, inv.phone);
        user = db.prepare("SELECT * FROM users WHERE id=?").get(uid);
        isNew = true;
      }
      const claimed = db
        .prepare("UPDATE student_onboarding_invites SET status='claimed', claimed_by_user_id=?, claimed_at=datetime('now') WHERE id=? AND status='pending'")
        .run(user.id, inv.id);
      if (!claimed.changes) throw new Error("邀請已被認領");

      const passId = crypto.randomUUID();
      const expires = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at,notes,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,0,'active',?,?,?,datetime('now'),datetime('now'))`,
      ).run(passId, user.id, inv.phone, inv.student_name, quota, quota, expires, "迎新體驗卡", inv.coach_id);
      return passId;
    });
    const passId = tx();

    const fresh = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    const authToken = generateToken(fresh);
    audit({
      actionType: "student.onboarding_claimed",
      entityType: "user",
      entityId: user.id,
      userId: user.id,
      newValues: { invite_id: inv.id, coach_id: inv.coach_id, quota, pass_id: passId },
      description: "學員認領迎新手冊",
    });

    res.json({
      success: true,
      user: { id: fresh.id, name: fresh.name, phone: fresh.phone, role: fresh.role },
      token: authToken,
      quota,
      is_new: isNew,
      coach_name: db.prepare("SELECT name FROM users WHERE id=?").get(inv.coach_id)?.name || "教練",
    });
  } catch (e) {
    console.error("[ONBOARD]", e.message);
    res.status(409).json({ success: false, error: e.message || "認領失敗" });
  }
});

module.exports = router;
module.exports.parseLine = parseLine;
module.exports.parseBatch = parseBatch;
