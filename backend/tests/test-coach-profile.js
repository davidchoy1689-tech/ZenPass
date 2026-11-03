/**
 * 教練公開專頁 tests（2026-11-04）
 * 覆蓋：slug 派生／重名、未核驗 404、聚合數據、脫敏、off-peak 時區、SSR meta/JSON-LD、301
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.JWT_SECRET = "test_coach_profile_secret_1234567890_abcdef";
const tmp = path.join(os.tmpdir(), "zenpass-cprofile-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

function handlerOf(router, method, p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  return layer ? layer.route.stack[layer.route.stack.length - 1].handle : null;
}
function call(handler, { params = {}, headers = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); return this; },
      type() { return this; },
      send(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); return this; },
      redirect(c, u) { resolve({ status: c, redirect: u, headers: this.headers }); return this; },
    };
    handler({ params, headers: { host: "zenpass.hk", "x-forwarded-proto": "https", ...headers }, query, protocol: "https", body: {} }, res, () =>
      resolve({ status: 0, body: "next" }),
    );
  });
}

(async () => {
  await require("../src/config/init-db")();
  const pre = new (require("better-sqlite3"))(tmp);
  pre.exec(`CREATE TABLE IF NOT EXISTS partner_venues (
    id TEXT PRIMARY KEY, user_id TEXT, name TEXT, district TEXT, status TEXT DEFAULT 'active',
    business_reg_no TEXT, pli_policy_no TEXT, pli_expiry TEXT, pli_status TEXT DEFAULT 'unverified'
  );
  CREATE TABLE IF NOT EXISTS coach_credentials (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, license_type TEXT, license_no TEXT, license_expiry TEXT,
    first_aid_type TEXT, first_aid_expiry TEXT, doc_url TEXT, certificate_url TEXT,
    insurance_policy_url TEXT, insurance_expiry_date TEXT, is_starred INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', reviewer_id TEXT, review_note TEXT, reviewed_at TEXT,
    qualified_sports TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, booking_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
    class_id TEXT, schedule_id TEXT, student_name TEXT, class_title TEXT, sport TEXT, level INTEGER DEFAULT 1,
    level_label TEXT, hours REAL DEFAULT 0, coach_id TEXT, coach_name TEXT, coach_starred INTEGER DEFAULT 0,
    issued_at TEXT, revoked INTEGER DEFAULT 0, revoked_reason TEXT, is_demo INTEGER DEFAULT 0,
    cert_type TEXT, verify_hash TEXT, student_ref_hash TEXT, coach_license_masked TEXT
  );
  CREATE TABLE IF NOT EXISTS coach_ratings (
    id TEXT PRIMARY KEY, coach_id TEXT NOT NULL, booking_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
    rating INTEGER NOT NULL, comment TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
  );`);
  pre.close();
  require("../src/services/migrate-schema").runMigrations();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const svc = require("../src/services/coach-profile");
  const routes = require("../src/routes/coach-public");

  const now = Date.now();
  const past = new Date(now - 26 * 3600 * 1000).toISOString();
  const pastEnd = new Date(now - 26 * 3600 * 1000 + 90 * 60000).toISOString();

  // 下一個星期一 10:00 HKT = 02:00Z
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  d.setUTCHours(2, 0, 0, 0);
  const nextMon = d.toISOString();
  const nextMonEnd = new Date(d.getTime() + 90 * 60000).toISOString();

  db.prepare(
    "INSERT INTO users (id,name,email,phone,role,is_coach,coach_verified,is_active,coach_headline,public_bio,service_types,target_audiences,service_districts,coach_languages) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "coach-a", "Sam Wong", "sam@zenpass.hk", "91234567", "coach", 1, 1, 1,
    "銀髮伸展・防跌強肌", "10 年長者體適能經驗。",
    '["stretching","senior_fitness"]', '["seniors","retirees"]', '["觀塘","葵青"]', '["廣東話","English"]',
  );
  db.prepare("INSERT INTO users (id,name,email,phone,role,is_coach,coach_verified,is_active) VALUES (?,?,?,?,?,?,?,?)").run(
    "coach-b", "Unverified Guy", "b@zenpass.hk", "90000000", "coach", 1, 0, 1,
  );
  db.prepare("INSERT INTO users (id,name,email,phone,role) VALUES (?,?,?,?,?)").run("stu-1", "陳大文", "s@x.com", "91111111", "user");

  db.prepare(
    "INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,first_aid_type,first_aid_expiry,is_starred,status,qualified_sports) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run("cred-1", "coach-a", "註冊教練", "AB123456789", "2027-03-31", "聖約翰急救證書", "2026-12-01", 1, "verified", '["molkky"]');

  db.prepare(
    "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,status,district,venue_name,booking_open) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run("cls-1", "coach-a", "長者深層伸展班", "伸展", 90, 6, 180, "active", "觀塘", "新興運動推廣社", 1);

  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES (?,?,?,?,?,?,?)").run(
    "sch-past", "cls-1", past, pastEnd, 6, 1, "available",
  );
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES (?,?,?,?,?,?,?)").run(
    "sch-next", "cls-1", nextMon, nextMonEnd, 6, 2, "available",
  );
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,status) VALUES (?,?,?,?,?,?)").run(
    "sch-cancel", "cls-1", new Date(now - 5 * 864e5).toISOString(), new Date(now - 5 * 864e5 + 3600e3).toISOString(), 6, "cancelled",
  );

  db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status) VALUES (?,?,?,?,?,?)").run(
    "bk-1", "stu-1", "sch-past", "cls-1", "attended", "paid",
  );
  const certCols = db.prepare("PRAGMA table_info(certificates)").all().map((c) => c.name);
  const certInsert = db.prepare(
    "INSERT INTO certificates (id,code,booking_id,user_id,class_id,student_name,hours,coach_id,revoked,issued_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))",
  );
  certInsert.run("cert-1", "ZP-1", "bk-1", "stu-1", "cls-1", "陳大文", 3, "coach-a", 0);
  // revoked 證書（唔應該計）
  db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status) VALUES (?,?,?,?,?,?)").run(
    "bk-2", "stu-1", "sch-past", "cls-1", "attended", "paid",
  );
  certInsert.run("cert-2", "ZP-2", "bk-2", "stu-1", "cls-1", "陳大文", 99, "coach-a", 1);

  db.prepare("INSERT INTO coach_ratings (id,coach_id,booking_id,user_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,datetime('now'))").run(
    "rt-1", "coach-a", "bk-1", "stu-1", 5, "教練好細心，膝頭痛都跟到。",
  );

  console.log("🧪 教練公開專頁 tests");

  console.log("── Slug ──");
  ok(svc.buildSlug("Sam Wong", "x@y.z", "id1") === "sam-wong", "英文名 → sam-wong");
  ok(svc.buildSlug("靜儀導師", "coach@zenpass.hk", "ce114035-2cb5") === "coach-ce114035", "無英文名 → coach-<id8>");
  ok(svc.buildSlug("", "coach.mindbody@zenpass.hk", "z") === "coach-mindbody", "fallback 用 email local part");
  svc.ensureSlugs(db);
  const slugA = db.prepare("SELECT coach_slug FROM users WHERE id='coach-a'").get().coach_slug;
  ok(slugA === "sam-wong", "backfill 寫入 coach_slug");
  const dup = svc.buildSlug("Sam Wong", "", "id2");
  ok(dup === "sam-wong", "同名基礎 slug 相同（未去重前）");
  const slugB = db.prepare("SELECT coach_slug FROM users WHERE id='coach-b'").get().coach_slug;
  ok(slugB && slugB !== "sam-wong", "第二個同名教練獲唯一 slug（" + slugB + "）");

  console.log("── 可見性 ──");
  ok(svc.getPublicProfile(db, "nobody") === null, "不存在 slug → null");
  ok(svc.getPublicProfile(db, slugB) === null, "未核驗教練 → null");
  const api = handlerOf(routes.apiRouter, "get", "/:slug/profile");
  ok(!!api, "API handler 存在");
  const r404 = await call(api, { params: { slug: "nobody" } });
  ok(r404.status === 404 && r404.body.success === false, "API 未知名 → 404");

  console.log("── 聚合數據 ──");
  const p = svc.getPublicProfile(db, "sam-wong");
  ok(!!p, "已核驗教練 → 有 profile");
  ok(Math.abs(p.trust.verified_teaching_hours - 1.5) < 0.01, "授課時數只計已開始班（1.5h），cancelled 唔計");
  ok(p.trust.certificates_issued === 1, "證書數排除 revoked");
  ok(p.trust.certified_hours === 3, "證書時數排除 revoked");
  ok(p.trust.students_taught === 1, "學員人數 DISTINCT");
  ok(p.trust.rating.count === 1 && p.trust.rating.avg === 5, "評分聚合正確");
  ok(p.upcoming.length === 1, "只回未來可預約班次");
  ok(p.upcoming[0].seats_left === 4, "剩餘名額 = 6-2");
  ok(p.upcoming[0].intensity_level === "moderate", "intensity 預設 moderate");
  ok(p.upcoming[0].is_offpeak === true, "下週一 10:00 HKT → 平日日間");
  ok(p.badges.some((b) => b.key === "first_aid"), "急救有效徽章");
  ok(p.badges.some((b) => b.key === "starred"), "星級教練徽章");
  ok(p.positioning.service_types.length === 2, "service types 標籤");
  ok(p.positioning.districts[0].label === "觀塘", "地區用中文值");

  console.log("── 私隱 ──");
  ok(p.reviews[0].user_label === "陳**", "學員姓名脫敏（中文）");
  ok(!JSON.stringify(p.reviews).includes("陳大文"), "評價無全名洩漏");
  ok(p.credentials.license_masked === "AB****89", "牌照遮罩 AB****89");
  ok(p.contact.whatsapp === "85291234567", "WhatsApp 補 852");
  db.prepare("UPDATE users SET public_contact_hidden=1 WHERE id='coach-a'").run();
  const p2 = svc.getPublicProfile(db, "sam-wong");
  ok(p2.contact.hidden === true && p2.contact.whatsapp === "", "隱藏聯絡 → 唔回傳電話");
  db.prepare("UPDATE users SET public_contact_hidden=0 WHERE id='coach-a'").run();

  console.log("── off-peak 時區 ──");
  ok(svc.isOffpeak("2026-11-02T02:00:00Z") === true, "週一 10:00 HKT → true");
  ok(svc.isOffpeak("2026-11-07T02:00:00Z") === false, "週六 10:00 HKT → false");
  ok(svc.isOffpeak("2026-11-02T09:00:00Z") === false, "週一 17:00 HKT → false");
  ok(svc.isOffpeak("2026-11-02T08:30:00Z") === true, "週一 16:30 HKT → true（邊界）");

  console.log("── 301 ──");
  db.prepare("INSERT INTO coach_slug_redirects (from_slug,to_slug) VALUES (?,?)").run("sam", "sam-wong");
  const page = handlerOf(routes.pageRouter, "get", "/:slug");
  const r301 = await call(page, { params: { slug: "sam" } });
  ok(r301.status === 301 && r301.redirect === "/c/sam-wong", "舊 slug → 301");

  console.log("── SSR / SEO ──");
  const rp = await call(page, { params: { slug: "sam-wong" } });
  ok(rp.status === 200 && typeof rp.body === "string", "/c/:slug 回 HTML");
  ok(!/\{\{[A-Z_]+\}\}/.test(rp.body), "無未替換 template token");
  ok(/<title>Sam Wong｜觀塘銀髮伸展・樂齡體適能教練｜ZenPass<\/title>/.test(rp.body), "動態 title 正確");
  ok(/rel="canonical" href="https:\/\/zenpass\.hk\/c\/sam-wong"/.test(rp.body), "canonical URL");
  ok(/og:title" content="Sam Wong/.test(rp.body), "OG title");
  const m = rp.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ld = null;
  try { ld = JSON.parse(m[1]); } catch (e) {}
  ok(!!ld, "JSON-LD 可 JSON.parse");
  ok(ld && ld["@graph"].map((x) => x["@type"]).join(",").includes("Person"), "JSON-LD 含 Person");
  ok(ld && ld["@graph"].some((x) => x["@type"] === "FAQPage"), "JSON-LD 含 FAQPage");
  ok(rp.headers["cache-control"].includes("max-age=300"), "Cache-Control 300s");
  const ru = await call(page, { params: { slug: "nobody" } });
  ok(ru.status === 404 && /noindex/.test(ru.body), "未知教練頁 → 404 + noindex");

  console.log("── Feature flag ──");
  process.env.COACH_PUBLIC_PROFILE = "0";
  const rf = await call(api, { params: { slug: "sam-wong" } });
  ok(rf.status === 404, "flag 關閉 → 404");
  process.env.COACH_PUBLIC_PROFILE = "1";

  try { fs.unlinkSync(tmp); } catch (e) {}
  if (fail) { console.error(`\n❌ ${fail} 項失敗`); process.exit(1); }
  console.log(`\n🎉 全部通過（${38} 項）`);
})().catch((e) => { console.error(e); process.exit(1); });
