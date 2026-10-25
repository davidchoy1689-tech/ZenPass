/**
 * 週末首發開班（2026-10-31 Mölkky / 2026-11-01 地板冰壺）+ 教練星級
 * 用法：cd /var/www/zenpass/backend && node ../scripts/seed-launch-classes.cjs [--apply]
 */
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const DB = process.env.ZP_DB || path.resolve(__dirname, "..", "backend", "data", "zenpass.db");
const db = new Database(DB);

// 確保必要欄位／表存在（idempotent）
function ensureCols(table, cols) {
  try {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    cols.forEach(([n, t]) => { if (!have.includes(n)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) { console.warn("migrate", table, e.message); }
}
ensureCols("classes", [["min_participants", "INTEGER DEFAULT 1"], ["photos_gallery", "TEXT"], ["sport_slug", "TEXT"], ["partner_venue_id", "TEXT"], ["partner_id", "TEXT"], ["booking_open", "INTEGER DEFAULT 0"], ["image_url", "TEXT"], ["district", "TEXT"]]);
ensureCols("partner_venues", [["photos_gallery", "TEXT"], ["rental_price_per_hour", "REAL"], ["partner_type", "TEXT"], ["contact_person", "TEXT"], ["facilities", "TEXT"], ["commission_plan", "TEXT"], ["commission_rate", "REAL"], ["partner_reference", "TEXT"], ["insurance_declared", "INTEGER DEFAULT 0"], ["insurance_doc_url", "TEXT"], ["insurance_expiry", "TEXT"], ["owner_id", "TEXT"]]);
db.prepare(`CREATE TABLE IF NOT EXISTS coach_credentials (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, license_type TEXT, license_no TEXT, license_expiry TEXT,
  first_aid_type TEXT, first_aid_expiry TEXT, doc_url TEXT, certificate_url TEXT,
  insurance_policy_url TEXT, insurance_expiry_date TEXT, is_starred INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', reviewer_id TEXT, review_note TEXT, reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id)
)`).run();

const COACH_EMAIL = "coach@zenpass.hk";
const coach = db.prepare("SELECT id,name,email FROM users WHERE email=?").get(COACH_EMAIL);
if (!coach) { console.error("❌ 找唔到教練", COACH_EMAIL); process.exit(1); }

// 場地：觀塘已有；荔枝角冇就建
function ensureVenue(name, district, address) {
  let v = db.prepare("SELECT * FROM partner_venues WHERE name=? AND district=?").get(name, district);
  if (v) return v;
  const id = crypto.randomUUID();
  if (APPLY) {
    db.prepare(`INSERT INTO partner_venues (id, partner_type, name, description, address, phone, email,
      contact_person, category, district, facilities, commission_plan, commission_rate, partner_reference,
      status, created_at, updated_at, rental_price_per_hour)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', datetime('now'), datetime('now'), ?)`)
      .run(id, "full", name, "ZenPass 合作場地", address || "", "23870724", "venue@zenpass.hk",
        "場地負責人", "運動場", district, JSON.stringify(["冷氣", "鏡面", "木地板"]), "basic", 0.2,
        "PV-" + Date.now().toString().slice(-6), 300);
  }
  return { id, name, district, rental_price_per_hour: 300 };
}

const kw = ensureVenue("新興運動推廣社", "觀塘", "觀塘巧明街 112 號 4 樓");
const lck = ensureVenue("荔枝角體育工作室", "荔枝角", "荔枝角青山道 500 號 3 樓");

const PLAN = [
  {
    title: "芬蘭木柱體驗班（週末首發）", slug: "molkky", sport: "molkky",
    desc: "芬蘭國技 Mölkky：擲木棒撞倒木柱，剛好 50 分即勝。3 分鐘學識，零運動底子都玩得，最適合朋友同家庭聚會。",
    venue: kw, start: "2026-10-31T07:00:00.000Z", dur: 120, price: 150, cap: 10, min: 4,
    photo: "/assets/img/sports/molkky.svg",
  },
  {
    title: "地板冰壺歡樂班（週末首發）", slug: "floor-curling", sport: "floor-curling",
    desc: "冰壺陸上版：推壺入圓心，力度與角度並重。講策略、低衝擊，長者同新手都玩得開心。",
    venue: lck, start: "2026-11-01T06:00:00.000Z", dur: 120, price: 150, cap: 10, min: 4,
    photo: "/assets/img/sports/floor-curling.svg",
  },
];

const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const out = [];

for (const p of PLAN) {
  let cls = db.prepare("SELECT * FROM classes WHERE title=?").get(p.title);
  const classId = cls ? cls.id : crypto.randomUUID();
  if (!cls) {
    if (APPLY) {
      db.prepare(`INSERT INTO classes (id, coach_id, title, description, category, difficulty, duration,
        max_participants, price_hkd, credits_cost, venue_name, venue_address, partner_venue_id, partner_id,
        district, sport_slug, status, booking_open, min_participants, photos_gallery, image_url,
        created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', 1, ?, ?, ?, ?, ?)`)
        .run(classId, coach.id, p.title, p.desc, "新興運動", "beginner", p.dur,
          p.cap, p.price, p.price / 10, p.venue.name, p.venue.address || "", p.venue.id, p.venue.id,
          p.venue.district, p.sport, p.min, JSON.stringify([p.photo]), p.photo, now, now);
    }
  } else {
    if (APPLY) {
      db.prepare(`UPDATE classes SET description=?, duration=?, max_participants=?, price_hkd=?, credits_cost=?,
        venue_name=?, partner_venue_id=?, partner_id=?, district=?, sport_slug=?, booking_open=1,
        min_participants=?, photos_gallery=?, image_url=?, status='active', updated_at=? WHERE id=?`)
        .run(p.desc, p.dur, p.cap, p.price, p.price / 10, p.venue.name, p.venue.id, p.venue.id,
          p.venue.district, p.sport, p.min, JSON.stringify([p.photo]), p.photo, now, classId);
    }
  }

  // 排程
  const endIso = new Date(new Date(p.start).getTime() + p.dur * 60000).toISOString();
  const existing = db.prepare("SELECT id FROM class_schedules WHERE class_id=? AND start_time=?").get(classId, p.start);
  let schId = existing && existing.id;
  if (!existing) {
    schId = crypto.randomUUID();
    if (APPLY) {
      db.prepare(`INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status)
        VALUES (?,?,?,?,?,0,'available')`).run(schId, classId, p.start, endIso, p.cap);
    }
  }
  out.push({ title: p.title, classId, scheduleId: schId, start: p.start, price: p.price, venue: p.venue.name });
}

// 教練資質：verified + starred + 保單有效至 2027-12-31
const cred = db.prepare("SELECT * FROM coach_credentials WHERE user_id=?").get(coach.id);
const credData = {
  license_type: cred ? cred.license_type : "新興運動教練認證",
  license_no: cred ? cred.license_no : "ZP-DEMO-0001",
  license_expiry: "2027-12-31",
  first_aid_type: cred ? cred.first_aid_type : "聖約翰救傷隊 CPR/AED",
  first_aid_expiry: "2027-12-31",
  insurance_policy_url: cred ? cred.insurance_policy_url : "/assets/images/generated/insurance-demo.pdf",
};
if (cred) {
  if (APPLY) {
    db.prepare(`UPDATE coach_credentials SET license_expiry=?, first_aid_expiry=?, status='verified', is_starred=1,
      reviewed_at=datetime('now'), updated_at=datetime('now') WHERE user_id=?`).run("2027-12-31", "2027-12-31", coach.id);
  }
} else if (APPLY) {
  db.prepare(`INSERT INTO coach_credentials (id, user_id, license_type, license_no, license_expiry,
    first_aid_type, first_aid_expiry, insurance_policy_url, status, is_starred, reviewed_at)
    VALUES (?,?,?,?,?,?,?,?, 'verified', 1, datetime('now'))`)
    .run(crypto.randomUUID(), coach.id, credData.license_type, credData.license_no, "2027-12-31",
      credData.first_aid_type, "2027-12-31", credData.insurance_policy_url);
}

console.log(APPLY ? "✅ 已寫入" : "（dry-run）");
console.log(JSON.stringify(out, null, 2));
