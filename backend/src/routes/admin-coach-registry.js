/**
 * ZenPass — 教練名冊（Coach Registry）資料庫管理
 * 2026-11-22
 *
 *  - GET   /api/admin/coach-registry            名冊列表（搜尋／篩選；含資質、收款、班數）
 *  - GET   /api/admin/coach-registry/export.csv 匯出 CSV（會計／出糧用）
 *  - POST  /api/admin/coach-registry            手動登記教練（未經公開申請）
 *  - PATCH /api/admin/coach-registry/:id        更新名冊資料（聯絡／分成／收款／資質到期）
 *  - POST  /api/admin/coach-registry/:id/reset-password  重設臨時密碼
 *
 * 權限：
 *  - 讀取：super_admin / platform_manager / admin / auditor（客服 platform_staff 不可見 FPS／銀行）
 *  - 寫入：ops.coach.write（super_admin / platform_manager）
 * 所有改動寫 audit_log；建立帳號另寫 blockchain_audit。
 */
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const { audit } = require("../services/audit");
const payoutSettings = require("../services/payout-settings");

const router = express.Router();

const VIEW_ROLES = ["super_admin", "platform_manager", "admin", "auditor"];
const FPS_TYPES = ["mobile", "fps_id", "email"];

function requireRegistryView(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: "需要登入認證" });
  if (!VIEW_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: "需要營運管理員或核數權限" });
  }
  next();
}

/** 舊 DB 兼容：名冊用到的欄位一律 idempotent 補齊 */
function ensureCols(db) {
  const have = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  [
    ["is_coach", "INTEGER DEFAULT 0"],
    ["coach_verified", "INTEGER DEFAULT 0"],
    ["coach_slug", "TEXT"],
    ["coach_years", "INTEGER"],
    ["coach_tags", "TEXT"],
    ["notes", "TEXT"],
    ["commission_rate", "REAL"],
    ["total_earnings", "REAL DEFAULT 0"],
    ["pending_payout", "REAL DEFAULT 0"],
    ["wallet_balance", "REAL DEFAULT 0"],
    ["is_active", "INTEGER DEFAULT 1"],
    ["token_version", "INTEGER DEFAULT 0"],
  ].forEach(([n, t]) => {
    if (!have.includes(n)) db.prepare(`ALTER TABLE users ADD COLUMN ${n} ${t}`).run();
  });
  // 舊 DB／測試 DB 可能未有班次層教練欄（生產已有）
  try {
    const sc = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
    [["coach_id", "TEXT"], ["coach_override_id", "TEXT"]].forEach(([n, t]) => {
      if (!sc.includes(n)) db.prepare(`ALTER TABLE class_schedules ADD COLUMN ${n} ${t}`).run();
    });
  } catch (e) {}
  try {
    require("./coach-credentials").ensureTable ? require("./coach-credentials").ensureTable(db) : null;
  } catch (e) {
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, license_type TEXT, license_no TEXT,
        license_expiry TEXT, first_aid_type TEXT, first_aid_expiry TEXT, doc_url TEXT,
        certificate_url TEXT, insurance_policy_url TEXT, insurance_expiry_date TEXT,
        is_starred INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', reviewer_id TEXT,
        review_note TEXT, reviewed_at TEXT, created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id))`);
    } catch (e2) {}
  }
  try { payoutSettings.ensureSchema(db); } catch (e) {}
}

function globalRate(db) {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'coach_commission_rate'").get();
    const r = Number(row && row.value);
    return r > 0 && r <= 1 ? r : 0.8;
  } catch (e) {
    return 0.8;
  }
}

function hkToday() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const target = Date.parse(d + "T00:00:00+08:00");
  const today = Date.parse(hkToday() + "T00:00:00+08:00");
  if (!Number.isFinite(target)) return null;
  return Math.round((target - today) / 864e5);
}

function parseSports(v) {
  try {
    const x = JSON.parse(v || "[]");
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
}

function normalizePhone(v) {
  let p = String(v === null || v === undefined ? "" : v).replace(/\D/g, "");
  if (p.startsWith("852") && p.length >= 11) p = p.slice(-8);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

function genTempPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyz";
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const num = "23456789";
  const sym = "!@#$%&*?";
  const pick = (s) => s[crypto.randomInt(0, s.length)];
  let p = pick(ABC) + pick(abc) + pick(num) + pick(sym);
  const all = abc + ABC + num + sym;
  while (p.length < 14) p += pick(all);
  return p;
}

function writeAudit(req, actionType, entityId, oldValues, newValues, description) {
  try {
    audit({
      actionType,
      entityType: "coach",
      entityId,
      userId: req.user.id,
      oldValues: oldValues || null,
      newValues: newValues || null,
      description,
      ipAddress: req.ip,
    });
  } catch (e) {}
  try {
    require("../services/blockchain-audit").writeBlock({
      entityType: "coach_registry",
      entityId,
      data: { action: actionType, by: req.user.id, newValues: newValues || null },
    });
  } catch (e) {}
}

function maskAccount(v) {
  const s = String(v || "");
  if (s.length <= 4) return s ? "••••" + s : "";
  return "••••" + s.slice(-4);
}

function loadCoaches(db) {
  const gRate = globalRate(db);
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.coach_slug, u.coach_verified, u.is_active,
              u.commission_rate, u.coach_years, u.coach_tags, u.notes, u.created_at,
              u.total_earnings, u.pending_payout, u.wallet_balance, u.role, u.is_coach,
              c.id AS cred_id, c.license_type, c.license_no, c.license_expiry,
              c.first_aid_type, c.first_aid_expiry, c.insurance_expiry_date,
              c.certificate_url, c.insurance_policy_url, c.status AS cred_status,
              c.is_starred, c.qualified_sports,
              p.fps_type, p.fps_proxy_value, p.bank_code, p.bank_account_no,
              p.account_holder_name, p.is_verified AS payout_verified,
              (SELECT COUNT(*) FROM classes cl WHERE cl.coach_id = u.id) AS classes_total,
              (SELECT COUNT(*) FROM class_schedules cs
                 LEFT JOIN classes cl2 ON cl2.id = cs.class_id
                WHERE COALESCE(cs.coach_override_id, cs.coach_id, cl2.coach_id) = u.id
                  AND datetime(cs.start_time) >= datetime('now')) AS upcoming_sessions,
              (SELECT COUNT(DISTINCT b.user_id) FROM bookings b
                 JOIN class_schedules cs2 ON cs2.id = b.schedule_id
                 JOIN classes cl3 ON cl3.id = cs2.class_id
                WHERE COALESCE(cs2.coach_override_id, cs2.coach_id, cl3.coach_id) = u.id
                  AND b.status NOT IN ('cancelled')) AS students_total
         FROM users u
         LEFT JOIN coach_credentials c ON c.user_id = u.id
         LEFT JOIN coach_payout_settings p ON p.coach_id = u.id
        WHERE u.is_coach = 1 OR u.role = 'coach'
        ORDER BY COALESCE(u.is_active,1) DESC, u.coach_verified DESC, u.name COLLATE NOCASE`,
    )
    .all();

  return rows.map((r) => {
    const lic = r.license_expiry ? daysUntil(r.license_expiry) : null;
    const ins = r.insurance_expiry_date ? daysUntil(r.insurance_expiry_date) : null;
    const aid = r.first_aid_expiry ? daysUntil(r.first_aid_expiry) : null;
    const allDays = [lic, ins, aid].filter((x) => x !== null && x !== undefined);
    const expired = allDays.some((x) => x < 0);
    const expiring = !expired && allDays.some((x) => x >= 0 && x <= 30);
    const verified = Number(r.coach_verified) === 1 || r.cred_status === "verified";
    const payoutComplete = !!(r.fps_type && r.fps_proxy_value && r.bank_code && r.account_holder_name);
    const hasCred = !!(r.license_type || r.cred_id);
    const rate = r.commission_rate !== null && r.commission_rate !== undefined && Number(r.commission_rate) > 0 ? Number(r.commission_rate) : gRate;
    const checks = [
      !!normalizePhone(r.phone),
      hasCred,
      !!(r.license_expiry && r.insurance_expiry_date),
      payoutComplete,
      verified,
    ];
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone || "",
      coach_slug: r.coach_slug || "",
      role: r.role,
      verified,
      coach_verified: Number(r.coach_verified) === 1 ? 1 : 0,
      cred_status: r.cred_status || null,
      is_starred: Number(r.is_starred) === 1,
      active: r.is_active === null || r.is_active === undefined ? true : Number(r.is_active) === 1,
      commission_rate: rate,
      commission_percent: Math.round(rate * 100),
      commission_is_global: !(r.commission_rate !== null && r.commission_rate !== undefined && Number(r.commission_rate) > 0),
      coach_years: r.coach_years === null || r.coach_years === undefined ? null : Number(r.coach_years),
      coach_tags: r.coach_tags || "",
      notes: r.notes || "",
      created_at: r.created_at,
      earnings: {
        total: Number(r.total_earnings) || 0,
        pending: Number(r.pending_payout) || 0,
        wallet: Number(r.wallet_balance) || 0,
      },
      counts: {
        classes: Number(r.classes_total) || 0,
        upcoming: Number(r.upcoming_sessions) || 0,
        students: Number(r.students_total) || 0,
      },
      credentials: {
        license_type: r.license_type || "",
        license_no: r.license_no || "",
        license_expiry: r.license_expiry || "",
        first_aid_type: r.first_aid_type || "",
        first_aid_expiry: r.first_aid_expiry || "",
        insurance_expiry: r.insurance_expiry_date || "",
        certificate_url: r.certificate_url || "",
        insurance_policy_url: r.insurance_policy_url || "",
        qualified_sports: parseSports(r.qualified_sports),
      },
      payout: {
        fps_type: r.fps_type || "",
        fps_proxy_value: r.fps_proxy_value || "",
        bank_code: r.bank_code || "",
        bank_account_no: r.bank_account_no || "",
        bank_account_masked: maskAccount(r.bank_account_no),
        account_holder_name: r.account_holder_name || "",
        verified: Number(r.payout_verified) === 1,
        complete: payoutComplete,
      },
      expiry: { license_days: lic, insurance_days: ins, first_aid_days: aid, expired, expiring },
      completeness: checks.filter(Boolean).length,
      completeness_total: checks.length,
    };
  });
}

function applyFilters(list, query) {
  let out = list;
  const q = String((query && query.q) || "").trim().toLowerCase();
  if (q) {
    out = out.filter((c) =>
      [c.name, c.email, c.phone, c.coach_slug].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }
  const status = String((query && query.status) || "all");
  if (status === "verified") out = out.filter((c) => c.verified);
  else if (status === "pending") out = out.filter((c) => !c.verified);
  else if (status === "inactive") out = out.filter((c) => !c.active);
  else if (status === "incomplete") out = out.filter((c) => c.completeness < c.completeness_total);
  const expiry = String((query && query.expiry) || "all");
  if (expiry === "expiring") out = out.filter((c) => c.expiry.expiring);
  else if (expiry === "expired") out = out.filter((c) => c.expiry.expired);
  return out;
}

// ===== GET 名冊 =====
router.get("/", authenticateToken, requireRegistryView, (req, res) => {
  try {
    const db = getDb();
    ensureCols(db);
    const all = loadCoaches(db);
    const list = applyFilters(all, req.query || {});
    res.json({
      success: true,
      coaches: list,
      summary: {
        total: all.length,
        verified: all.filter((c) => c.verified).length,
        pending: all.filter((c) => !c.verified).length,
        expiring: all.filter((c) => c.expiry.expiring).length,
        expired: all.filter((c) => c.expiry.expired).length,
        inactive: all.filter((c) => !c.active).length,
        incomplete: all.filter((c) => c.completeness < c.completeness_total).length,
      },
      global_commission_percent: Math.round(globalRate(db) * 100),
      options: { fps_types: FPS_TYPES },
    });
  } catch (e) {
    console.error("[coach-registry] list error:", e.message);
    res.status(500).json({ success: false, error: "讀取名冊失敗" });
  }
});

// ===== GET CSV =====
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

router.get("/export.csv", authenticateToken, requireRegistryView, (req, res) => {
  try {
    const db = getDb();
    ensureCols(db);
    const list = applyFilters(loadCoaches(db), req.query || {});
    const head = [
      "姓名", "電話", "電郵", "狀態", "已核實", "教練分成%", "牌照", "牌照到期",
      "急救", "急救到期", "保險到期", "可發證項目", "FPS類型", "FPS號碼",
      "銀行代碼", "銀行戶口", "戶名", "收款已核實", "已開班", "未來堂數", "學生數",
      "累計收入", "待出糧", "資料完整度", "加入日期", "備註",
    ];
    const lines = [head.map(csvCell).join(",")];
    list.forEach((c) => {
      lines.push([
        c.name, c.phone, c.email, c.active ? (c.verified ? "已核實" : "待核實") : "已停用",
        c.verified ? "是" : "否", c.commission_percent,
        c.credentials.license_type, c.credentials.license_expiry,
        c.credentials.first_aid_type, c.credentials.first_aid_expiry,
        c.credentials.insurance_expiry, c.credentials.qualified_sports.join("|"),
        c.payout.fps_type, c.payout.fps_proxy_value, c.payout.bank_code,
        c.payout.bank_account_no, c.payout.account_holder_name, c.payout.verified ? "是" : "否",
        c.counts.classes, c.counts.upcoming, c.counts.students,
        c.earnings.total, c.earnings.pending,
        `${c.completeness}/${c.completeness_total}`, String(c.created_at || "").slice(0, 10), c.notes,
      ].map(csvCell).join(","));
    });
    const csv = "\uFEFF" + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="zenpass-coach-registry-${hkToday()}.csv"`,
    );
    res.send(csv);
  } catch (e) {
    console.error("[coach-registry] csv error:", e.message);
    res.status(500).json({ success: false, error: "匯出失敗" });
  }
});

// ===== POST 手動登記教練 =====
router.post("/", authenticateToken, requirePermission("ops.coach.write"), (req, res) => {
  try {
    const db = getDb();
    ensureCols(db);
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const phone = normalizePhone(b.phone);
    if (!name) return res.status(400).json({ success: false, error: "請輸入姓名" });
    if (!isEmail(email)) return res.status(400).json({ success: false, error: "請輸入有效電郵" });
    if (b.phone && phone.length !== 8) {
      return res.status(400).json({ success: false, error: "電話要係 8 位香港號碼" });
    }
    const exists = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
    if (exists) return res.status(409).json({ success: false, error: "此電郵已被使用" });

    let commissionRate = null;
    if (b.commission_percent !== undefined && b.commission_percent !== null && b.commission_percent !== "") {
      const pct = Number(b.commission_percent);
      if (!(pct > 0 && pct <= 100)) {
        return res.status(400).json({ success: false, error: "分成要介乎 1–100%" });
      }
      commissionRate = Math.round(pct * 10) / 1000;
    }
    const years = b.coach_years === undefined || b.coach_years === null || b.coach_years === "" ? null : Number(b.coach_years);
    if (years !== null && years !== undefined && (!Number.isFinite(years) || years < 0 || years > 60)) {
      return res.status(400).json({ success: false, error: "年資要介乎 0–60 年" });
    }

    const tempPassword = genTempPassword();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, phone, auth_provider, role,
                          is_coach, coach_verified, email_verified, is_active,
                          commission_rate, coach_years, coach_tags, notes,
                          created_at, updated_at, token_version)
       VALUES (?, ?, ?, ?, ?, 'email', 'coach', 1, 0, 1, 1, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      id, email, bcrypt.hashSync(tempPassword, 10), name, phone || null,
      commissionRate, years, String(b.coach_tags || "").slice(0, 300) || null,
      String(b.notes || "").slice(0, 1000) || null, now, now,
    );

    writeAudit(req, "COACH_CREATE", id, null, {
      name, email, phone: phone || null, commission_rate: commissionRate,
    }, `手動登記教練 ${name}（${email}）`);

    res.status(201).json({
      success: true,
      message: "✅ 教練已登記。請將臨時密碼交予對方，並提醒首次登入後更改。",
      coach: { id, name, email, phone: phone || "" },
      temp_password: tempPassword,
    });
  } catch (e) {
    console.error("[coach-registry] create error:", e.message);
    res.status(500).json({ success: false, error: "登記失敗" });
  }
});

// ===== PATCH 更新名冊 =====
router.patch("/:id", authenticateToken, requirePermission("ops.coach.write"), (req, res) => {
  try {
    const db = getDb();
    ensureCols(db);
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!u) return res.status(404).json({ success: false, error: "教練不存在" });
    if (!(Number(u.is_coach) === 1 || u.role === "coach")) {
      return res.status(400).json({ success: false, error: "此帳號唔係教練" });
    }
    const b = req.body || {};
    const oldValues = {};
    const newValues = {};
    const updates = [];
    const params = [];

    if (b.name !== undefined) {
      const name = String(b.name || "").trim();
      if (!name) return res.status(400).json({ success: false, error: "姓名不可空白" });
      updates.push("name = ?"); params.push(name);
      oldValues.name = u.name; newValues.name = name;
    }
    if (b.phone !== undefined) {
      const phone = normalizePhone(b.phone);
      if (b.phone && phone.length !== 8) {
        return res.status(400).json({ success: false, error: "電話要係 8 位香港號碼" });
      }
      updates.push("phone = ?"); params.push(phone || null);
      oldValues.phone = u.phone; newValues.phone = phone || null;
    }
    if (b.coach_verified !== undefined) {
      const v = b.coach_verified ? 1 : 0;
      updates.push("coach_verified = ?"); params.push(v);
      oldValues.coach_verified = u.coach_verified; newValues.coach_verified = v;
    }
    if (b.is_active !== undefined) {
      const v = b.is_active ? 1 : 0;
      updates.push("is_active = ?"); params.push(v);
      if (!v) updates.push("token_version = COALESCE(token_version,0) + 1");
      oldValues.is_active = u.is_active; newValues.is_active = v;
    }
    if (b.commission_percent !== undefined) {
      let rate = null;
      if (b.commission_percent !== null && b.commission_percent !== "") {
        const pct = Number(b.commission_percent);
        if (!(pct > 0 && pct <= 100)) {
          return res.status(400).json({ success: false, error: "分成要介乎 1–100%" });
        }
        rate = Math.round(pct * 10) / 1000;
      }
      updates.push("commission_rate = ?"); params.push(rate);
      oldValues.commission_rate = u.commission_rate; newValues.commission_rate = rate;
    }
    if (b.coach_years !== undefined) {
      const years = b.coach_years === null || b.coach_years === "" ? null : Number(b.coach_years);
      if (years !== null && years !== undefined && (!Number.isFinite(years) || years < 0 || years > 60)) {
        return res.status(400).json({ success: false, error: "年資要介乎 0–60 年" });
      }
      updates.push("coach_years = ?"); params.push(years);
      oldValues.coach_years = u.coach_years; newValues.coach_years = years;
    }
    if (b.coach_tags !== undefined) {
      const tags = String(b.coach_tags || "").slice(0, 300) || null;
      updates.push("coach_tags = ?"); params.push(tags);
      oldValues.coach_tags = u.coach_tags; newValues.coach_tags = tags;
    }
    if (b.notes !== undefined) {
      const notes = String(b.notes || "").slice(0, 1000) || null;
      updates.push("notes = ?"); params.push(notes);
      oldValues.notes = u.notes; newValues.notes = notes;
    }
    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params, u.id);
    }

    // ---- 收款資料（coach_payout_settings）----
    const payoutKeys = ["fps_type", "fps_proxy_value", "bank_code", "bank_account_no", "account_holder_name"];
    const hasPayout = payoutKeys.some((k) => b[k] !== undefined);
    if (hasPayout) {
      const cur = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id = ?").get(u.id);
      const next = {
        fps_type: b.fps_type !== undefined ? String(b.fps_type || "") : (cur && cur.fps_type) || "",
        fps_proxy_value: b.fps_proxy_value !== undefined ? String(b.fps_proxy_value || "").trim() : (cur && cur.fps_proxy_value) || "",
        bank_code: b.bank_code !== undefined ? String(b.bank_code || "").trim() : (cur && cur.bank_code) || "",
        bank_account_no: b.bank_account_no !== undefined ? String(b.bank_account_no || "").replace(/\s/g, "") : (cur && cur.bank_account_no) || "",
        account_holder_name: b.account_holder_name !== undefined ? String(b.account_holder_name || "").trim() : (cur && cur.account_holder_name) || "",
      };
      if (next.fps_type && !FPS_TYPES.includes(next.fps_type)) {
        return res.status(400).json({ success: false, error: "FPS 類型無效" });
      }
      if (next.fps_type) {
        if (!next.fps_proxy_value) return res.status(400).json({ success: false, error: "請填 FPS 收款號碼" });
        if (next.fps_type === "mobile" && normalizePhone(next.fps_proxy_value).length !== 8) {
          return res.status(400).json({ success: false, error: "FPS 電話要係 8 位" });
        }
        if (next.fps_type === "email" && !isEmail(next.fps_proxy_value)) {
          return res.status(400).json({ success: false, error: "FPS 電郵格式無效" });
        }
        if (next.fps_type === "fps_id" && !/^\d{7,9}$/.test(next.fps_proxy_value)) {
          return res.status(400).json({ success: false, error: "FPS ID 要係 7–9 位數字" });
        }
        if (!next.bank_code) return res.status(400).json({ success: false, error: "請選擇銀行" });
        if (!next.account_holder_name) return res.status(400).json({ success: false, error: "請填戶名" });
      }
      const before = cur ? { ...cur } : null;
      if (!next.fps_type && !next.fps_proxy_value && !next.bank_code && !next.account_holder_name) {
        db.prepare("DELETE FROM coach_payout_settings WHERE coach_id = ?").run(u.id);
      } else {
        db.prepare(
          `INSERT INTO coach_payout_settings
             (coach_id, fps_type, fps_proxy_value, bank_code, bank_account_no, account_holder_name,
              is_verified, verified_at, updated_at)
           VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))
           ON CONFLICT(coach_id) DO UPDATE SET
             fps_type=excluded.fps_type, fps_proxy_value=excluded.fps_proxy_value,
             bank_code=excluded.bank_code, bank_account_no=excluded.bank_account_no,
             account_holder_name=excluded.account_holder_name,
             is_verified=0, verified_by=NULL, verified_at=datetime('now'), updated_at=datetime('now')`,
        ).run(u.id, next.fps_type || "mobile", next.fps_proxy_value || "", next.bank_code || "", next.bank_account_no || null, next.account_holder_name || "", 0);
      }
      oldValues.payout = before
        ? { fps_type: before.fps_type, fps_proxy_value: before.fps_proxy_value, bank_code: before.bank_code, bank_account_no: maskAccount(before.bank_account_no), account_holder_name: before.account_holder_name }
        : null;
      newValues.payout = { ...next, bank_account_no: maskAccount(next.bank_account_no) };
    }

    // ---- 資質（coach_credentials）----
    const credKeys = ["license_type", "license_no", "license_expiry", "first_aid_type", "first_aid_expiry", "insurance_expiry_date"];
    const hasCred = credKeys.some((k) => b[k] !== undefined);
    if (hasCred) {
      ["license_expiry", "first_aid_expiry", "insurance_expiry_date"].forEach((k) => {
        if (b[k] !== undefined && b[k] && !isDate(b[k])) {
          throw Object.assign(new Error(`${k} 格式要 YYYY-MM-DD`), { status: 400 });
        }
      });
      const cur = db.prepare("SELECT * FROM coach_credentials WHERE user_id = ?").get(u.id);
      const next = {
        license_type: b.license_type !== undefined ? String(b.license_type || "").slice(0, 60) : (cur && cur.license_type) || "",
        license_no: b.license_no !== undefined ? String(b.license_no || "").slice(0, 60) : (cur && cur.license_no) || "",
        license_expiry: b.license_expiry !== undefined ? String(b.license_expiry || "").slice(0, 10) : (cur && cur.license_expiry) || "",
        first_aid_type: b.first_aid_type !== undefined ? String(b.first_aid_type || "").slice(0, 60) : (cur && cur.first_aid_type) || "",
        first_aid_expiry: b.first_aid_expiry !== undefined ? String(b.first_aid_expiry || "").slice(0, 10) : (cur && cur.first_aid_expiry) || "",
        insurance_expiry_date: b.insurance_expiry_date !== undefined ? String(b.insurance_expiry_date || "").slice(0, 10) : (cur && cur.insurance_expiry_date) || "",
      };
      if (!next.license_type && !cur) {
        return res.status(400).json({ success: false, error: "請填寫牌照／認證名稱" });
      }
      const before = cur ? { ...cur } : null;
      if (cur) {
        db.prepare(
          `UPDATE coach_credentials SET license_type=?, license_no=?, license_expiry=?,
             first_aid_type=?, first_aid_expiry=?, insurance_expiry_date=?,
             updated_at=datetime('now') WHERE user_id=?`,
        ).run(next.license_type || null, next.license_no || null, next.license_expiry || null,
          next.first_aid_type || null, next.first_aid_expiry || null, next.insurance_expiry_date || null, u.id);
      } else {
        db.prepare(
          `INSERT INTO coach_credentials (id, user_id, license_type, license_no, license_expiry,
             first_aid_type, first_aid_expiry, insurance_expiry_date, status)
           VALUES (?,?,?,?,?,?,?,?, 'pending')`,
        ).run(crypto.randomUUID(), u.id, next.license_type, next.license_no || null,
          next.license_expiry || null, next.first_aid_type || null,
          next.first_aid_expiry || null, next.insurance_expiry_date || null);
      }
      oldValues.credentials = before
        ? { license_type: before.license_type, license_expiry: before.license_expiry, insurance_expiry_date: before.insurance_expiry_date }
        : null;
      newValues.credentials = next;
    }

    writeAudit(req, "COACH_REGISTRY_UPDATE", u.id, oldValues, newValues, `更新教練名冊：${u.name}`);
    res.json({ success: true, message: "✅ 已更新", coach: loadCoaches(db).find((c) => c.id === u.id) || null });
  } catch (e) {
    console.error("[coach-registry] patch error:", e.message);
    res.status(e.status || 500).json({ success: false, error: e.status ? e.message : "更新失敗" });
  }
});

// ===== POST 重設臨時密碼 =====
router.post("/:id/reset-password", authenticateToken, requirePermission("ops.coach.write"), (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT id, name, email, role, is_coach FROM users WHERE id = ?").get(req.params.id);
    if (!u) return res.status(404).json({ success: false, error: "教練不存在" });
    if (!(Number(u.is_coach) === 1 || u.role === "coach")) {
      return res.status(400).json({ success: false, error: "此帳號唔係教練" });
    }
    const tempPassword = genTempPassword();
    db.prepare(
      "UPDATE users SET password_hash = ?, token_version = COALESCE(token_version,0)+1, updated_at = datetime('now') WHERE id = ?",
    ).run(bcrypt.hashSync(tempPassword, 10), u.id);
    writeAudit(req, "COACH_PASSWORD_RESET", u.id, null, { email: u.email }, `重設教練 ${u.name} 密碼（舊 session 已失效）`);
    res.json({ success: true, temp_password: tempPassword, message: "✅ 已重設，舊登入即刻失效" });
  } catch (e) {
    console.error("[coach-registry] reset error:", e.message);
    res.status(500).json({ success: false, error: "重設失敗" });
  }
});

module.exports = router;
