/** ZenPass — 雙向匿名評分（場地／教練）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_abcdefghijklmnopqrstuvwxyz1234";
const tmp = path.join(os.tmpdir(), "zenpass-mutual-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const fails = [];
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fails.push(m);
  }
};

(async () => {
  // 先建最小 schema（含 init-db 遷移會用到嘅欄），再跑 init-db 補 mutual_reviews
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, avatar_url TEXT,
    password_hash TEXT, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    credits INTEGER DEFAULT 0, role TEXT DEFAULT 'user', created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, user_id TEXT, status TEXT DEFAULT 'active',
    category TEXT, district TEXT, address TEXT, email TEXT, partner_type TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, coach_id TEXT, category TEXT, duration INTEGER DEFAULT 60,
    max_participants INTEGER DEFAULT 10, price_hkd REAL DEFAULT 100, status TEXT DEFAULT 'active',
    partner_venue_id TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT,
    enrolled_count INTEGER DEFAULT 0, max_participants INTEGER DEFAULT 10, status TEXT DEFAULT 'available');
  CREATE TABLE bookings (id TEXT PRIMARY KEY, user_id TEXT, class_id TEXT, schedule_id TEXT,
    status TEXT DEFAULT 'confirmed', created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE venue_rentals (id TEXT PRIMARY KEY, venue_id TEXT, coach_id TEXT, status TEXT,
    start_time TEXT, end_time TEXT, price_hkd REAL);
  `);
  pre.prepare("INSERT INTO users (id,name,email,is_coach) VALUES (?,?,?,?)").run("stu1", "學生甲", "s@x.com", 0);
  pre.prepare("INSERT INTO users (id,name,email,is_coach) VALUES (?,?,?,?)").run("co1", "教練乙", "c@x.com", 1);
  pre.prepare("INSERT INTO users (id,name,email,is_coach) VALUES (?,?,?,?)").run("own1", "場地丙", "v@x.com", 0);
  pre.prepare("INSERT INTO partner_venues (id,name,user_id,status) VALUES (?,?,?,?)").run("v1", "康樂中心", "own1", "active");
  pre.prepare("INSERT INTO classes (id,title,coach_id,category,partner_venue_id) VALUES (?,?,?,?,?)").run("cl1", "伸展班", "co1", "伸展", "v1");
  pre.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time) VALUES (?,?,?,?)").run("sc1", "cl1", "2026-10-01 10:00:00", "2026-10-01 11:00:00");
  pre.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status) VALUES (?,?,?,?,?)").run("bk1", "stu1", "cl1", "sc1", "attended");
  pre.prepare("INSERT INTO venue_rentals (id,venue_id,coach_id,status) VALUES (?,?,?,?)").run("rt1", "v1", "co1", "completed");
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const conn = getDb();
  const { submitReview, summary, venueComposite, coachComposite, smooth } = require("../src/services/mutual-review");

  console.log("🧪 雙向匿名評分 tests");
  console.log("── 表 / 唯一性 ──");
  const cols = conn.prepare("PRAGMA table_info('mutual_reviews')").all().map((c) => c.name);
  ok(cols.includes("rater_id") && cols.includes("visible_at"), "mutual_reviews 表已建立（含 rater_id / visible_at）");

  console.log("── 三個方向 ──");
  const a = submitReview({
    raterId: "stu1", raterRole: "student", targetType: "venue", targetId: "v1",
    contextType: "booking", contextId: "bk1", rating: 5, tags: ["清潔"], reasons: [], comment: "好乾淨",
  });
  ok(!!a.id, "學生 → 場地 提交成功");

  const b = submitReview({
    raterId: "co1", raterRole: "coach", targetType: "venue", targetId: "v1",
    contextType: "rental", contextId: "rt1", rating: 4, tags: ["器材"], reasons: [], comment: "器材齊",
  });
  ok(!!b.id, "教練 → 場地 提交成功");

  const c = submitReview({
    raterId: "own1", raterRole: "venue", targetType: "coach", targetId: "co1",
    contextType: "rental", contextId: "rt1", rating: 5, tags: ["準時"], reasons: [], comment: "準時有禮",
  });
  ok(!!c.id, "場地 → 教練 提交成功");

  console.log("── 防濫用 ──");
  let dupErr = null;
  try {
    submitReview({
      raterId: "stu1", raterRole: "student", targetType: "venue", targetId: "v1",
      contextType: "booking", contextId: "bk1", rating: 1, reasons: ["清潔問題"],
    });
  } catch (e) {
    dupErr = e;
  }
  ok(dupErr && dupErr.status === 409, "同一 context 重複評分 → 409");

  let reasonErr = null;
  try {
    submitReview({
      raterId: "stu1", raterRole: "student", targetType: "venue", targetId: "v1",
      contextType: "booking", contextId: "bk9", rating: 2, reasons: [],
    });
  } catch (e) {
    reasonErr = e;
  }
  ok(reasonErr && /原因/.test(reasonErr.message), "≤3 星冇原因 → 拒絕");

  let permErr = null;
  try {
    submitReview({
      raterId: "stu1", raterRole: "student", targetType: "venue", targetId: "v1",
      contextType: "booking", contextId: "rt1", rating: 5,
    });
  } catch (e) {
    permErr = e;
  }
  ok(permErr && permErr.status === 404, "非自己預約 → 拒絕");

  let dirErr = null;
  try {
    submitReview({ raterId: "stu1", raterRole: "student", targetType: "coach", targetId: "co1", contextId: "bk1", rating: 5 });
  } catch (e) {
    dirErr = e;
  }
  ok(dirErr && dirErr.status === 400, "不支援方向（學生評教練走 /api/reviews）→ 400");

  console.log("── 匿名彙總 ──");
  const s1 = summary("venue", "v1");
  ok(s1.count === 2, "場地有 2 則評分（學生 + 教練）");
  ok(s1.by_role.length === 2, "按角色分組：學員 / 教練");
  ok(!("rater_id" in s1) && !JSON.stringify(s1.comments).includes("學生甲"), "彙總唔會泄露評分者身份");
  ok(s1.comments.every((x) => ["學員", "教練", "場地"].includes(x.by)), "留言只顯示角色，冇姓名");

  const sc = summary("coach", "co1");
  ok(sc.count === 1, "教練收到 1 則場地評分");
  ok(Array.isArray(sc.comments) && sc.comments.length === 0, "留言要 7 日後才顯示（防對號入座）");

  console.log("── 綜合分 ──");
  ok(smooth(0, 0).score === 4, "無評價 → 4.0（中性）");
  const vc = venueComposite("v1", 5);
  ok(vc.score >= 4 && vc.score <= 5, "場地綜合分 = " + vc.score + "（履約50% + 教練25% + 學生25%）");
  ok(vc.parts.coach_rating !== null && vc.parts.student_rating !== null, "綜合分含 3 個部分");
  const cc = coachComposite("co1", 4.5);
  ok(cc.venue_rating !== null && cc.score >= 4.3, "教練綜合分含場地評分（" + cc.score + "，80% 學生 + 20% 場地）");

  console.log("── 前端接線 ──");
  const web = path.join(__dirname, "..", "..", "frontend-v2");
  const my = fs.readFileSync(path.join(web, "my-bookings.html"), "utf8");
  ok(my.includes("openRateVenue"), "學生評場地 UI 存在");
  ok(my.includes("mutual-reviews/submit"), "用匿名 API");

  const vr = fs.readFileSync(path.join(web, "venue-rentals.html"), "utf8");
  ok(vr.includes("rateVenue"), "教練評場地 UI 存在");

  const mc = fs.readFileSync(path.join(web, "merchant-centre.html"), "utf8");
  ok(mc.includes("raRateCoach"), "場地評教練 UI 存在");
  [my, vr, mc].forEach((html, i) =>
    ok(html.includes("匿名"), ["學生", "教練", "場地"][i] + " 評分介面標明匿名"),
  );

  console.log("──────────────────────────────");
  if (fails.length) {
    console.error("❌ " + fails.length + " failed");
    process.exit(1);
  }
  console.log("✅ 雙向匿名評分 tests passed");
  try {
    fs.unlinkSync(tmp);
  } catch (e) {}
})();
