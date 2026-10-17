/**
 * Test: 教練註冊收集資料 → 批核自動寫入 profile → 課程頁自動顯示
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : "test_secret_key_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-coach-profile-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const fails = [];
const ok = (cond, msg) => {
  if (cond) console.log("  ✅ " + msg);
  else {
    console.log("  ❌ " + msg);
    fails.push(msg);
  }
};

console.log("🧪 教練資料（註冊 → 批核 → 課程頁）tests");

// 建立最小 schema（users / coach_applications），跑 init-db 補欄
const db = new Database(tmp);
db.exec(`
CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, avatar_url TEXT,
  password_hash TEXT, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
  credits INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE coach_applications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
  email TEXT NOT NULL, years_experience TEXT, specialties TEXT, certificates TEXT,
  bio TEXT, venue_name TEXT, venue_address TEXT, venue_photos TEXT, facilities TEXT,
  application_reference TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by TEXT, reviewed_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
`);
db.prepare("INSERT INTO users (id,name,email) VALUES (?,?,?)").run("u1", "陳大文", "coach@x.com");
db.prepare(
  `INSERT INTO coach_applications (id,user_id,name,phone,email,years_experience,specialties,certificates,bio,venue_address,application_reference,status)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
).run(
  "app1", "u1", "陳大文", "91234567", "coach@x.com", "8",
  "芬蘭木柱,地板冰壺", "香港新興運動總會認可導師", "8 年新興運動教學，擅長帶新手。",
  "沙田", "CA-0001", "pending",
);
db.close();

(async () => {
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const conn = getDb();

  console.log("── DB schema ──");
  const cols = conn.prepare("PRAGMA table_info('users')").all().map((c) => c.name);
  ["coach_headline", "coach_bio", "coach_tags", "coach_languages", "coach_years"].forEach((c) =>
    ok(cols.includes(c), "users." + c + " 存在"),
  );
  const appCols = conn.prepare("PRAGMA table_info('coach_applications')").all().map((c) => c.name);
  ["headline", "languages", "avatar_url"].forEach((c) => ok(appCols.includes(c), "coach_applications." + c + " 存在"));

  console.log("── 批核 → 自動寫入 profile ──");
  conn.prepare("UPDATE coach_applications SET headline=?, languages=? WHERE id=?").run(
    "新興運動教練 · 8 年經驗", "廣東話,English", "app1",
  );
  const admin = { id: "admin1" };
  const adminService = require("../src/services/admin-service");
  const r = adminService.approveCoach("app1", admin.id);
  ok(r.status === 200, "approveCoach 回 200");

  const u = conn.prepare("SELECT * FROM users WHERE id='u1'").get();
  ok(u.is_coach === 1 && u.coach_verified === 1, "已標記為已認證教練");
  ok(u.coach_years === 8, "教學年資 = 8（got " + u.coach_years + "）");
  ok(String(u.coach_languages).includes("廣東話"), "授課語言已寫入");
  ok(String(u.coach_headline).includes("8 年經驗"), "頭銜已寫入");
  const tags = String(u.coach_tags || "").split(",");
  ok(tags.includes("芬蘭木柱"), "專長寫入 tags");
  ok(tags.includes("香港新興運動總會認可導師"), "資歷寫入 tags");
  ok(String(u.coach_bio).includes("8 年"), "簡介已寫入");

  console.log("── 教練自行更新（public-profile）──");
  const coachRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "coach.js"), "utf8");
  ok(coachRoute.includes('router.post("/public-profile"'), "有 POST /coach/public-profile");
  ok(coachRoute.includes('router.get("/public-profile"'), "有 GET /coach/public-profile");
  ok(coachRoute.includes("coach_headline"), "更新包含 headline");
  ok(coachRoute.includes('if (!u.is_coach)'), "未批核教練不可更新");

  console.log("── 開班後課程頁自動帶出 ──");
  const classesRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "classes.js"), "utf8");
  ok(classesRoute.includes("u.coach_headline"), "課程詳情 SELECT coach_headline");
  ok(classesRoute.includes("u.coach_bio"), "課程詳情 SELECT coach_bio");
  ok(classesRoute.includes("classData.coach_stats"), "課程詳情組裝 coach_stats");
  ok(classesRoute.includes("開辦課程"), "coach_stats 有真實開班數");

  const detail = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "detail.html"), "utf8");
  ok(detail.includes("coach_headline"), "detail.html 用 coach_headline");
  ok(detail.includes("coach_stats"), "detail.html 顯示教練統計");

  const apply = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-apply.html"), "utf8");
  ok(apply.includes('id="f-headline"'), "註冊頁收集頭銜");
  ok(apply.includes('id="langs"'), "註冊頁收集授課語言");
  ok(apply.includes('id="f-avatar"'), "註冊頁收集頭像");
  ok(apply.includes("/coach/public-profile"), "已批核可用同一頁維護資料");

  console.log("──────────────────────────────");
  if (fails.length) {
    console.error("❌ " + fails.length + " failed");
    process.exit(1);
  }
  console.log("✅ 教練資料 tests passed");
  try {
    fs.unlinkSync(tmp);
  } catch (e) {}
})();
