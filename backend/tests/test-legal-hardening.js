/**
 * ZenPass — 法律防禦（風險披露存證 / 意外備案 / 急救徽章）tests
 * node backend/tests/test-legal-hardening.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "zenpass-test-secret-0123456789abcdef0123456789";
const tmp = path.join(os.tmpdir(), "zenpass-legal-" + Date.now() + ".db");
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
  for (const [id, role, coach] of [["admin","admin",0],["coach1","coach",1],["u1","user",0]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role,is_coach) VALUES (?,?,?,?,?,?)").run(id, id, id + "@x.hk", "91234567", role, coach);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const t = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,sport_slug) VALUES ('c1','coach1','芬蘭木柱體驗班','新興運動',120,150,'active','molkky')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,10,1,'available')").run(t, t);

  console.log("\n🧪 法律防禦加固\n");

  console.log("📋 1. 具體運動風險披露");
  const { riskProfile, RISK_VERSION, SPORT_RISKS } = require("../src/config/sport-risks");
  ok(typeof RISK_VERSION === "string" && RISK_VERSION.length > 5, "有版本號：" + RISK_VERSION);
  ok(Object.keys(SPORT_RISKS).length >= 10, "覆蓋 10+ 運動項目");
  const mk = riskProfile("molkky", "新興運動", "芬蘭木柱體驗班");
  ok(mk.key === "molkky" && /木柱/.test(mk.label) && mk.risks.length >= 2, "芬蘭木柱有具體風險清單");
  const cl = riskProfile("", "", "攀石體驗日");
  ok(cl.key === "climbing" && /跌落|骨折|韌帶/.test(cl.risks.join("")), "攀石有離地／跌落風險描述");
  const kid = riskProfile("kids-fitness", "", "");
  ok(kid.key === "kids-fitness" && kid.tips.some((x) => /家長|監護人/.test(x)), "兒童體適能提示家長陪同");
  const gen = riskProfile("", "體能", "神秘班");
  ok(gen.key === "general" && gen.risks.length >= 1, "未知項目有通用風險（唔會空白）");

  console.log("📋 2. 報名存證欄位");
  const bs = require("../src/services/booking-service");
  bs.ensureAttendeeColumns(db);
  bs.ensureLegalColumns(db);
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  ok(["ip_address", "user_agent", "risk_version", "risk_ack_at"].every((c) => cols.includes(c)), "bookings 有 IP／UA／風險版本／簽署時間");
  const bSrc = fs.readFileSync(path.join(__dirname, "../src/services/booking-service.js"), "utf8");
  ok(/riskAcknowledged/.test(bSrc) && /riskVersion/.test(bSrc), "報名會寫入風險確認與版本");
  ok(/user_agent|ua:/.test(bSrc), "會記錄 user agent");
  const bkUi = fs.readFileSync(path.join(__dirname, "../../frontend-v2/booking.html"), "utf8");
  ok(/riskCard/.test(bkUi) && /具體固有風險提示/.test(bkUi), "報名頁顯示具體風險卡");
  ok(/riskVersion/.test(bkUi) && /riskAcknowledged/.test(bkUi), "前端提交帶風險版本與確認");

  console.log("📋 3. 課程頁風險與急救徽章");
  const classesSrc = fs.readFileSync(path.join(__dirname, "../src/routes/classes.js"), "utf8");
  ok(/riskProfile\(/.test(classesSrc) && /risk_notice/.test(classesSrc), "課程 API 回傳 risk_notice");
  ok(/coach_first_aid/.test(classesSrc), "課程 API 回傳教練急救資格");
  const dt = fs.readFileSync(path.join(__dirname, "../../frontend-v2/detail.html"), "utf8");
  ok(/具備認可急救資格/.test(dt), "課程頁顯示 ⛑️ 急救徽章");
  ok(/本課程由上述核證教練主理/.test(dt), "課程頁標明平台只提供預訂及存證");

  console.log("📋 4. 現場意外備案 API");
  const coachRouter = require("../src/routes/coach");
  const layer = coachRouter.stack.find((l) => l.route && l.route.path === "/incidents" && l.route.methods.post);
  const fn = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = (body, user) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    return Promise.resolve(fn({ body, user, ip: "203.0.113.9", headers: {} }, res)).then(() => res);
  };
  const bad1 = await call({}, { id: "coach1" });
  ok(bad1.statusCode === 400 && bad1.body.code === "NAME_REQUIRED", "冇姓名 → 400");
  const bad2 = await call({ student_name: "陳大文" }, { id: "coach1" });
  ok(bad2.statusCode === 400 && bad2.body.code === "BODY_PART_REQUIRED", "冇受傷部位 → 400");
  const bad3 = await call({ student_name: "陳大文", body_part: "右足踝", treatment: "x" }, { id: "coach1" });
  ok(bad3.statusCode === 400 && bad3.body.code === "TREATMENT_REQUIRED", "處理方式太短 → 400");
  const forbidden = await call({ student_name: "陳大文", body_part: "右足踝", treatment: "敷冰袋" }, { id: "u1" });
  ok(forbidden.statusCode === 403, "普通用戶 → 403");
  const good = await call(
    { booking_id: "b1", schedule_id: "s1", student_name: "陳大文", body_part: "右足踝", treatment: "即時敷冰袋 10 分鐘，可自行步行", notes: "已通知家長" },
    { id: "coach1" },
  );
  ok(good.statusCode === 200 && !!good.body.id, "教練提交成功");
  const inc = db.prepare("SELECT * FROM incident_logs WHERE id = ?").get(good.body.id);
  ok(!!inc && inc.body_part === "右足踝" && /冰袋/.test(inc.treatment), "已寫入 incident_logs");
  ok(inc.ip_address === "203.0.113.9", "已記錄提交 IP");
  ok(!!inc.occurred_at && !!inc.created_at, "有事故時間與建立時間（時間封存）");
  const audit = db.prepare("SELECT * FROM audit_log WHERE action_type='incident.logged'").get();
  ok(!!audit, "已寫入 audit_log");

  console.log("📋 5. 後台查看");
  const opsRouter = require("../src/routes/admin-ops");
  const l2 = opsRouter.stack.find((l) => l.route && l.route.path === "/incidents" && l.route.methods.get);
  const fn2 = l2.route.stack[l2.route.stack.length - 1].handle;
  const res2 = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; } };
  await fn2({ user: { id: "admin", role: "admin" }, query: {} }, res2);
  ok(res2.body.success === true && res2.body.incidents.length >= 1, "管理員可讀取意外紀錄");
  const ops = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/loadIncidents/.test(ops) && /現場意外備案/.test(ops), "後台有意外備案列表");

  console.log("📋 6. 課前安全指引");
  const cd = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-dashboard.html"), "utf8");
  ok(/強制動態熱身/.test(cd), "課前指引列明強制熱身");
  ok(/嚴禁拖鞋／涼鞋/.test(cd), "課前指引列明鞋履要求");
  ok(/incidentSheet/.test(cd), "教練工作台有 🚨 備案入口");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
