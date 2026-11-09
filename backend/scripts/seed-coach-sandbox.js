#!/usr/bin/env node
/**
 * 工單七 — 15 分鐘真教練演練「沙盒種子資料」
 *
 *   node scripts/seed-coach-sandbox.js [--coach-email coach@x.hk] [--reset-times]
 *
 * 安全設計：
 *  - 所有 id 以 seed-sandbox- 開頭，只會 upsert 自己嘅資料，唔會碰真實班／真實學員
 *  - 沙盒場地 is_sandbox=1 → 代堂審批豁免 PLI 硬擋（會寫 pli_warning_bypassed 審計）
 *  - 金錢表只新增／更新狀態，永不 DELETE
 */
const path = require("path");
process.chdir(path.join(__dirname, ".."));
if (!process.env.DB_PATH) process.env.DB_PATH = path.join(__dirname, "..", "data", "zenpass.db");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getDb } = require("../src/services/database");

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const COACH_EMAIL = arg("coach-email", "coach.mindbody@zenpass.hk");

const db = getDb();
const now = Date.now();
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => d.toISOString();
const hktDate = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);

function ensureCols() {
  const add = (table, col, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  add("bookings", "medical_notes", "medical_notes TEXT");
  add("bookings", "checked_in_at", "checked_in_at TEXT");
  add("bookings", "emergency_phone", "emergency_phone TEXT");
  add("bookings", "attendee_type", "attendee_type TEXT DEFAULT 'self'");
  add("bookings", "utm_source", "utm_source TEXT");
  add("bookings", "utm_campaign", "utm_campaign TEXT");
  add("partner_venues", "is_sandbox", "is_sandbox INTEGER DEFAULT 0");
  add("partner_venues", "pli_status", "pli_status TEXT DEFAULT 'unverified'");
  add("partner_venues", "pli_expiry", "pli_expiry TEXT");
  add("classes", "booking_open", "booking_open INTEGER DEFAULT 1");
  add("class_schedules", "coach_override_id", "coach_override_id TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
    id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT, license_expiry TEXT,
    first_aid_type TEXT, first_aid_expiry TEXT, doc_url TEXT, certificate_url TEXT,
    insurance_policy_url TEXT, insurance_expiry_date TEXT, is_starred INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', reviewer_id TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS coach_substitution_requests (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, from_coach_id TEXT NOT NULL, target_coach_id TEXT NOT NULL,
    reason TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT, reviewed_by TEXT, review_note TEXT)`);
}

function main() {
  ensureCols();
  const coach = db.prepare("SELECT id,name,email FROM users WHERE email=?").get(COACH_EMAIL)
    || db.prepare("SELECT id,name,email FROM users WHERE role IN ('coach','partner_coach') ORDER BY created_at LIMIT 1").get();
  if (!coach) throw new Error("找不到教練帳號，請先建立或用 --coach-email 指定");

  const start = new Date(now - 30 * 60000);
  const end = new Date(start.getTime() + 90 * 60000);

  db.prepare(`INSERT INTO partner_venues (id, partner_type, name, address, district, status, is_sandbox, pli_status, created_at)
    VALUES ('seed-sandbox-venue','venue','青衣楓樹窩體育館（沙盒演練）','青衣楓樹窩路 1 號','葵青','active',1,'unverified',datetime('now'))
    ON CONFLICT(id) DO UPDATE SET status='active', is_sandbox=1`).run();

  db.prepare(`INSERT INTO classes (id, coach_id, title, category, duration, max_participants, price_hkd, credits_cost, status,
      venue_name, venue_address, partner_venue_id, booking_open)
    VALUES ('seed-sandbox-class', ?, '芬蘭木柱 · 樂齡與初學體驗班（演練專屬）', '新興運動', 90, 8, 140, 14, 'inactive',
      '青衣楓樹窩體育館（沙盒演練）', '青衣楓樹窩路 1 號', 'seed-sandbox-venue', 0)
    ON CONFLICT(id) DO UPDATE SET coach_id=excluded.coach_id, status='inactive', booking_open=0,
      venue_name=excluded.venue_name, partner_venue_id=excluded.partner_venue_id
  `).run(coach.id);

  db.prepare(`INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status)
    VALUES ('seed-sandbox-session','seed-sandbox-class',?,?,8,2,'available')
    ON CONFLICT(id) DO UPDATE SET start_time=excluded.start_time, end_time=excluded.end_time, status='available', enrolled_count=2
  `).run(fmt(start), fmt(end));

  const mkUser = (id, email, name, phone, credits) => {
    db.prepare(`INSERT INTO users (id, email, name, phone, role, credits, created_at)
      VALUES (?,?,?,?,'user',?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, credits=excluded.credits`).run(id, email, name, phone, credits);
  };
  mkUser("seed-sandbox-stu-a", "sandbox.a@zenpass.hk", "陳大文", "98765432", 3);
  mkUser("seed-sandbox-stu-b", "sandbox.b@zenpass.hk", "李淑芬", "91234567", 1);

  const mkBooking = (id, ref, userId, notes, emergency) => {
    db.prepare(`INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type,
        payment_status, status, amount, group_size, attendee_type, medical_notes, emergency_phone, created_at)
      VALUES (?,?,?,'seed-sandbox-session','seed-sandbox-class','single','paid','confirmed',140,1,'self',?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET status='confirmed', payment_status='paid', medical_notes=excluded.medical_notes,
        emergency_phone=excluded.emergency_phone, checked_in_at=NULL`).run(id, ref, userId, notes, emergency);
  };
  mkBooking("seed-sandbox-bk-a", "ZP-SEED-A", "seed-sandbox-stu-a", "膝關節曾動手術，避免深蹲", "91234567");
  mkBooking("seed-sandbox-bk-b", "ZP-SEED-B", "seed-sandbox-stu-b", "", "98765432");

  db.prepare(`INSERT INTO users (id, email, name, phone, role, created_at)
    VALUES ('seed-sandbox-sarah','sarah.demo@zenpass.hk','Sarah 導師（演練）','97001122','coach',datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run();
  db.prepare(`INSERT INTO coach_credentials (id, user_id, license_type, license_expiry, insurance_expiry_date, status)
    VALUES ('seed-sandbox-cred','seed-sandbox-sarah','芬蘭木柱一級教練','2027-12-31','2027-06-30','verified')
    ON CONFLICT(id) DO UPDATE SET status='verified', insurance_expiry_date='2027-06-30'`).run();

  const existingReq = db.prepare("SELECT status FROM coach_substitution_requests WHERE id='seed-sandbox-subreq-1'").get();
  if (!existingReq) {
    db.prepare(`INSERT INTO coach_substitution_requests (id, session_id, from_coach_id, target_coach_id, reason, status)
      VALUES ('seed-sandbox-subreq-1','seed-sandbox-session',?,'seed-sandbox-sarah','演練：測試代堂審批','pending')`).run(coach.id);
  } else if (existingReq.status !== "pending") {
    db.prepare("UPDATE coach_substitution_requests SET status='pending', reviewed_at=NULL, reviewed_by=NULL WHERE id='seed-sandbox-subreq-1'").run();
  }

  console.log("✅ 沙盒演練資料就緒");
  console.log(`   教練：${coach.name} <${coach.email}>`);
  const hkt = (d) => new Date(d.getTime() + 8 * 3600e3);
  console.log(`   班次：seed-sandbox-session · ${hktDate(start)} ${String(hkt(start).getUTCHours()).padStart(2, "0")}:${pad(hkt(start).getUTCMinutes())}–${String(hkt(end).getUTCHours()).padStart(2, "0")}:${pad(hkt(end).getUTCMinutes())}（HKT）`);
  console.log("   學員：陳大文（3 堂，舊患：膝關節）／李淑芬（1 堂）");
  console.log("   代堂：Sarah 導師（pending，等管理員核准）");
  console.log("   ⚠️ 此班只供演練，請勿公開發售；完結後可將 class.status 設為 archived。");
}

try {
  main();
} catch (e) {
  console.error("❌ Seed 失敗:", e.message);
  process.exit(1);
}
