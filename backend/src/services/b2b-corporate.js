/**
 * Phase 5.1 — B2B 企業員工福利（Corporate Perks）
 *
 * 企業預付款池（整數 cents）＋員工每月配額（堂）＋工作電郵 OTP 認證。
 * 與個人／家庭錢包完全隔離：企業 Pass 只可由已驗證員工使用，不可轉贈。
 */
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function hktMonthKey(d = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit" }).format(d);
  return s; // YYYY-MM
}

function endOfHktMonthIso(d = new Date()) {
  const [y, m] = hktMonthKey(d).split("-").map(Number);
  const next = m === 12 ? Date.UTC(y + 1, 0, 1) : Date.UTC(y, m, 1);
  // 下月 1 日 00:00 HKT = 前一日 16:00 UTC
  return new Date(next - 8 * 3600000).toISOString();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS corporate_clients (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      business_reg_no TEXT DEFAULT '',
      allowed_email_domains TEXT NOT NULL DEFAULT '[]',
      billing_contact_name TEXT DEFAULT '',
      billing_email TEXT DEFAULT '',
      contract_tier TEXT DEFAULT 'gold_discount_10',
      discount_percent INTEGER DEFAULT 10,
      monthly_quota_units INTEGER DEFAULT 4,
      credit_pool_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS corporate_employees (
      id TEXT PRIMARY KEY,
      corporate_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      work_email TEXT UNIQUE NOT NULL,
      monthly_quota_units INTEGER DEFAULT 4,
      consumed_units_this_month INTEGER DEFAULT 0,
      quota_month TEXT,
      status TEXT DEFAULT 'verified',
      role TEXT DEFAULT 'member',
      verified_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(corporate_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_corp_emp_user ON corporate_employees(user_id);
    CREATE TABLE IF NOT EXISTS corporate_email_otps (
      id TEXT PRIMARY KEY,
      work_email TEXT NOT NULL,
      corporate_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      consumed INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_corp_otp_email ON corporate_email_otps(work_email, consumed);
    CREATE TABLE IF NOT EXISTS fps_clearing_batches (
      id TEXT PRIMARY KEY,
      payout_cycle_code TEXT NOT NULL,
      total_recipients INTEGER NOT NULL DEFAULT 0,
      total_payout_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      bank_batch_reference TEXT,
      bank_mode TEXT DEFAULT 'simulated',
      initiated_by_user_id TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      details_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fps_batch_cycle ON fps_clearing_batches(payout_cycle_code);
    CREATE TABLE IF NOT EXISTS fps_clearing_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      coach_id TEXT NOT NULL,
      coach_name TEXT,
      amount_cents INTEGER NOT NULL,
      fps_id_masked TEXT,
      status TEXT DEFAULT 'processing',
      bank_tx_id TEXT,
      error_code TEXT,
      earning_ids TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fps_item_batch ON fps_clearing_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_fps_item_tx ON fps_clearing_items(bank_tx_id);
  `);

  const add = (table, cols) => {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    cols.forEach(([n, t]) => {
      if (!have.includes(n)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${n} ${t}`);
    });
  };
  add("coach_earnings", [
    ["clearing_batch_id", "TEXT"],
    ["bank_tx_id", "TEXT"],
    ["clearing_status", "TEXT DEFAULT 'pending'"],
    ["held_reason", "TEXT"],
  ]);
  add("bookings", [["corporate_id", "TEXT"], ["corporate_employee_id", "TEXT"]]);
  add("user_passes", [
    ["pass_type", "TEXT"],
    ["corporate_id", "TEXT"],
    ["owner_user_id", "TEXT"],
  ]);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_earnings_clearing ON coach_earnings(clearing_status, payout_id)"); } catch (e) {}
  const empCols = db.prepare("PRAGMA table_info(corporate_employees)").all().map((c) => c.name);
  if (!empCols.includes("role")) db.exec("ALTER TABLE corporate_employees ADD COLUMN role TEXT DEFAULT 'member'");
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_bookings_corp ON bookings(corporate_id, created_at)"); } catch (e) {}
}

function parseDomains(client) {
  try {
    const arr = JSON.parse(client.allowed_email_domains || "[]");
    return Array.isArray(arr) ? arr.map((d) => String(d).toLowerCase().replace(/^@/, "")) : [];
  } catch (e) {
    return [];
  }
}

function emailDomain(email) {
  const m = String(email || "").trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return m ? m[1] : "";
}

function findClientByEmail(db, email) {
  const domain = emailDomain(email);
  if (!domain) return null;
  const clients = db.prepare("SELECT * FROM corporate_clients WHERE status='active'").all();
  return clients.find((c) => parseDomains(c).some((d) => domain === d || domain.endsWith("." + d))) || null;
}

function maskEmail(email) {
  const [u, d] = String(email).split("@");
  if (!d) return "***";
  return `${u.slice(0, 2)}***@${d}`;
}

function maskFps(v) {
  const s = String(v || "");
  if (s.length < 4) return "****";
  return "****" + s.slice(-4);
}

function hashOtp(code) {
  return crypto.createHash("sha256").update("b2b-otp|" + code).digest("hex");
}

function createOtp(db, { workEmail, corporateId }) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const id = uuidv4();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO corporate_email_otps (id, work_email, corporate_id, code_hash, expires_at) VALUES (?,?,?,?,?)",
  ).run(id, workEmail.toLowerCase(), corporateId, hashOtp(code), expires);
  return { id, code, expires_at: expires };
}

function quotaState(db, emp, client) {
  const month = hktMonthKey();
  if (emp.quota_month !== month) {
    const quota = Number(emp.monthly_quota_units ?? client.monthly_quota_units ?? 4);
    db.prepare("UPDATE corporate_employees SET consumed_units_this_month=0, quota_month=?, monthly_quota_units=? WHERE id=?")
      .run(month, quota, emp.id);
    emp.consumed_units_this_month = 0;
    emp.quota_month = month;
    emp.monthly_quota_units = quota;
    syncPass(db, emp, client);
  }
  return {
    month,
    quota: Number(emp.monthly_quota_units || 0),
    used: Number(emp.consumed_units_this_month || 0),
    remaining: Math.max(0, Number(emp.monthly_quota_units || 0) - Number(emp.consumed_units_this_month || 0)),
  };
}

function syncPass(db, emp, client) {
  const quota = Number(emp.monthly_quota_units || client.monthly_quota_units || 4);
  const used = Number(emp.consumed_units_this_month || 0);
  const existing = db
    .prepare("SELECT * FROM user_passes WHERE corporate_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1")
    .get(client.id, emp.user_id);
  const expires = endOfHktMonthIso();
  if (existing) {
    db.prepare("UPDATE user_passes SET total_credits=?, remaining_credits=?, expires_at=?, status=?, updated_at=datetime('now') WHERE id=?")
      .run(quota, Math.max(0, quota - used), expires, quota - used > 0 ? "active" : "exhausted", existing.id);
    return existing.id;
  }
  const id = uuidv4();
  const u = db.prepare("SELECT name, phone FROM users WHERE id=?").get(emp.user_id);
  db.prepare(
    `INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at,notes,pass_type,corporate_id,owner_user_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,0,'active',?,?, 'corporate_pass', ?, ?, datetime('now'), datetime('now'))`,
  ).run(id, emp.user_id, u?.phone || "", u?.name || "", quota, Math.max(0, quota - used), expires, `企業福利 · ${client.company_name}`, client.id, emp.user_id);
  return id;
}

function linkEmployee(db, { client, userId, workEmail }) {
  let emp = db.prepare("SELECT * FROM corporate_employees WHERE work_email=?").get(workEmail.toLowerCase());
  if (emp && emp.user_id !== userId) {
    return { error: "EMAIL_ALREADY_LINKED" };
  }
  if (!emp) {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO corporate_employees (id, corporate_id, user_id, work_email, monthly_quota_units, consumed_units_this_month, quota_month, status)
       VALUES (?,?,?,?,?,0,?, 'verified')`,
    ).run(id, client.id, userId, workEmail.toLowerCase(), Number(client.monthly_quota_units || 4), hktMonthKey());
    emp = db.prepare("SELECT * FROM corporate_employees WHERE id=?").get(id);
  } else if (emp.status !== "verified") {
    db.prepare("UPDATE corporate_employees SET status='verified', verified_at=datetime('now') WHERE id=?").run(emp.id);
    emp.status = "verified";
  }
  const passId = syncPass(db, emp, client);
  return { employee: emp, pass_id: passId };
}

function resolveSchedulePrice(sched) {
  const now = Date.now();
  const start = new Date(String(sched.start_time).includes("T") ? sched.start_time : String(sched.start_time).replace(" ", "T") + "Z").getTime();
  const mins = Math.round((start - now) / 60000);
  const flash = Number(sched.is_flash_sale_enabled) === 1 && mins <= 180 && mins > 0 && Number(sched.flash_price_cents) > 0;
  if (flash) return { price_cents: Number(sched.flash_price_cents), is_flash: true, minutes_to_start: mins };
  const base = Number(sched.schedule_price_cents || 0) || Math.round(Number(sched.price_hkd || 0) * 100);
  return { price_cents: base, is_flash: false, minutes_to_start: mins };
}

module.exports = {
  ensureSchema,
  hktMonthKey,
  endOfHktMonthIso,
  emailDomain,
  findClientByEmail,
  parseDomains,
  maskEmail,
  maskFps,
  createOtp,
  hashOtp,
  quotaState,
  syncPass,
  linkEmployee,
  resolveSchedulePrice,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
};
