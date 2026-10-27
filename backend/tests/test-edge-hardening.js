/**
 * ZenPass — 極限情境加固（超賣 / FPS 清洗 / 出席上限）tests
 * node backend/tests/test-edge-hardening.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const tmp = path.join(os.tmpdir(), "zenpass-edge-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, role] of [["u1","user"],["u2","user"],["coach","coach"],["admin","admin"]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES (?,?,?,?,?)").run(id, id, id + "@x.hk", "9123456" + id.length, role);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,course_type,total_sessions,min_attendance_rate) VALUES ('c1','coach','期制班','新興運動',120,150,'active','term',3,0.8)").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,1,0,'available')").run(now, now);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',?,?,10,0,'available')").run(now, now);

  const bs = require("../src/services/booking-service");
  const { normalizeFpsId, formatFpsId } = require("../src/lib/fps");

  console.log("\n🧪 極限情境加固\n");

  console.log("📋 1. 併發超賣（原子扣位）");
  const r1 = bs.incrementEnrolledCount(db, "s1", 1);
  ok(r1.changes === 1, "第一個人成功扣最後 1 個位");
  const r2 = bs.incrementEnrolledCount(db, "s1", 1);
  ok(r2.changes === 0, "第二個人被原子條件擋住（changes = 0）");
  const sch = db.prepare("SELECT enrolled_count, max_participants FROM class_schedules WHERE id='s1'").get();
  ok(sch.enrolled_count === 1 && sch.max_participants === 1, "名額唔會超過上限（1/1）");
  const bkSrc = fs.readFileSync(path.join(__dirname, "../src/services/booking-service.js"), "utf8");
  ok(/status: 409[\s\S]{0,120}CLASS_FULL/.test(bkSrc), "扣位失敗回 409 CLASS_FULL");
  ok(/enrolled_count \+ \? <= max_participants/.test(bkSrc), "條件式 UPDATE 具原子性");
  const routeSrc = fs.readFileSync(path.join(__dirname, "../src/routes/bookings.js"), "utf8");
  ok(/code: full \? "CLASS_FULL"/.test(routeSrc), "路由前置檢查亦回 CLASS_FULL");

  console.log("📋 2. FPS 識別碼清洗");
  ok(normalizeFpsId("+852 9123 4567") === "91234567", "+852 9123 4567 → 91234567");
  ok(normalizeFpsId("9123-4567") === "91234567", "9123-4567 → 91234567");
  ok(normalizeFpsId("85291234567") === "91234567", "85291234567 → 91234567");
  ok(normalizeFpsId("(912) 34567") === "91234567", "(912) 34567 → 91234567");
  ok(normalizeFpsId(" Chan@Example.COM ") === "chan@example.com", "Email → 細楷無空格");
  ok(normalizeFpsId("") === "", "空值 → 空");
  ok(formatFpsId("91234567") === "9123 4567", "顯示格式化 9123 4567");
  const refundSrc = fs.readFileSync(path.join(__dirname, "../src/routes/bookings.js"), "utf8");
  ok(/normalizeFpsId\(/.test(refundSrc), "退款 API 已套用清洗");
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend-v2/my-bookings.html"), "utf8");
  ok(/function normalizeFps/.test(ui), "學員端提交前亦清洗");

  console.log("📋 3. 期制出席上限");
  for (let i = 1; i <= 4; i++) {
    db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES (?,?,?,?,?,?,?,?)")
      .run("t" + i, "ZP-T" + i, "u1", "s2", "c1", "attended", "paid", 150);
  }
  const svc = require("../src/services/certificate-service");
  const prog = svc.termProgressForUser("u1").find((x) => x.class_id === "c1");
  ok(prog && prog.attended === 3, "出席顯示封頂 3/3（實際 4 筆 attended）got " + (prog && prog.attended));
  ok(prog && prog.percent === 100, "出席率封頂 100% got " + (prog && prog.percent));
  const grads = svc.issueForBooking("t1");
  ok(!!grads && Number(String(grads.level)) >= 2, "達門檻 → 畢業證書");
  const stu = svc.studentSummariesForUser("u1").find((x) => x.name === "u1");
  ok(svc.minutesBetween("2026-01-01 10:00:00", "2026-01-01 12:00:00", 0) === 120, "minutesBetween 正常計算 120 分鐘");
  ok(svc.minutesBetween("2026-01-01 10:00:00", "2026-01-01 10:00:00", 0) === 0, "fallback=0 唔會被誤當 60");
  ok(svc.classAvgMinutes(db, "c1", 120) === 120, "時段無有效時長 → 退回課程設定 120 分鐘");
  ok(stu && stu.hours === 6, "結業時數按全期 3 堂計算（6 小時），唔會 4 堂變 8 got " + (stu && stu.hours));

  console.log("📋 4. 防重複簽到（同一 booking 唔可以累積兩次）");
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('dup1','ZP-D1','u2','s2','c1','confirmed','paid',150)").run();
  const a1 = bs.attendBooking({ params: { id: "dup1" }, user: { id: "admin", role: "admin" }, body: { checkin_method: "coach" } });
  ok(a1.status === 200, "第一次簽到成功");
  const a2 = bs.attendBooking({ params: { id: "dup1" }, user: { id: "admin", role: "admin" }, body: { checkin_method: "coach" } });
  ok(a2.status === 400, "同一 booking 再簽到 → 被拒（status 已非 confirmed）");
  const attCount = db.prepare("SELECT COUNT(*) c FROM bookings WHERE id='dup1' AND status='attended'").get().c;
  ok(attCount === 1, "只會有一筆 attended 紀錄");
  const prog2 = svc.termProgressForUser("u2").find((x) => x.class_id === "c1");
  ok(!prog2 || prog2.percent <= 100, "出席率永遠唔會超過 100%");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
