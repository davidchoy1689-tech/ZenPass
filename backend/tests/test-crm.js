/**
 * ZenPass — 管理員 CRM（學員 360°／教練資質）tests
 * node backend/tests/test-crm.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "zenpass-test-secret-0123456789abcdef0123456789";
const tmp = path.join(os.tmpdir(), "zenpass-crm-" + Date.now() + ".db");
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
  for (const [id, role] of [["admin","admin"],["coach1","coach"],["u1","user"],["u2","user"]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES (?,?,?,?,?)").run(id, id, id + "@x.hk", "9123" + id.length + "678", role);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const t = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,course_type,total_sessions,sport_slug) VALUES ('c1','coach1','木柱班','新興運動',120,150,'active','term',4,'molkky')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count) VALUES ('s1','c1',?,?,10,3)").run(t, t);
  require("../src/services/booking-service").ensureAttendeeColumns(db);
  const ins = db.prepare(
    "INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,child_name) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  ins.run("b1", "ZP-C1", "u1", "s1", "c1", "attended", "paid", 150, null);
  ins.run("b2", "ZP-C2", "u1", "s1", "c1", "attended", "paid", 150, "陳小麗");
  ins.run("b3", "ZP-C3", "u1", "s1", "c1", "cancelled", "refunded", 150, null);
  ins.run("b4", "ZP-C4", "u1", "s1", "c1", "no_show", "paid", 150, null);

  const svc = require("../src/services/certificate-service");
  svc.issueForBooking("b1");

  try { require("../src/routes/coach-credentials").ensureSchema && require("../src/routes/coach-credentials").ensureSchema(db); } catch (e) {}
  db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
    id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT, license_url TEXT,
    license_expiry TEXT, first_aid_type TEXT, first_aid_expiry TEXT, first_aid_url TEXT,
    insurance_policy_url TEXT, insurance_expiry_date TEXT, status TEXT DEFAULT 'pending',
    reviewed_at TEXT, reviewed_by TEXT, review_note TEXT, created_at TEXT DEFAULT (datetime('now')),
    qualified_sports TEXT, is_starred INTEGER DEFAULT 0, certificate_url TEXT
  );`);
  db.prepare(`INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,insurance_expiry_date,status,created_at,qualified_sports,is_starred)
    VALUES ('cc1','coach1','一級教練','MOL-1','2026-12-31','2026-11-10','verified','2026-01-01','["molkky"]',1)`).run();

  const router = require("../src/routes/admin-crm");
  const handler = (p, m) => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const list = handler("/crm/students", "get");
  const detail = handler("/crm/students/:id", "get");
  const putCred = handler("/coaches/:id/credentials", "put");
  const call = (fn, req) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    return Promise.resolve(fn({ query: {}, params: {}, body: {}, ...req }, res)).then(() => res);
  };

  console.log("\n🧪 CRM（學員 360° / 教練資質）\n");

  console.log("📋 1. 學員聚合");
  const r1 = await call(list, { query: {} });
  ok(r1.statusCode === 200 && Array.isArray(r1.body.students), "回傳 students 陣列");
  const s1 = (r1.body.students || []).find((x) => x.id === "u1");
  ok(!!s1, "搵到學員 u1");
  ok(s1.bookings === 4, "預約總數 4（got " + s1.bookings + "）");
  ok(s1.attended === 2, "出席 2 次（got " + s1.attended + "）");
  ok(s1.cancelled === 1 && s1.no_shows === 1, "取消 1 / 缺席 1");
  ok(s1.spent === 450, "已付金額 HK$450（3 筆 paid；已退款不計，got " + s1.spent + "）");
  ok(s1.hours === 4, "累計時數 4 小時（2 × 2h，got " + s1.hours + "）");
  ok(s1.certs === 2, "證書 2 張（單堂 + 出席證書，got " + s1.certs + "）");
  ok(Array.isArray(s1.children) && s1.children.includes("陳小麗"), "子女檔案：陳小麗");

  console.log("📋 2. 搜尋");
  const r2 = await call(list, { query: { search: "u1" } });
  ok((r2.body.students || []).length === 1 && r2.body.students[0].id === "u1", "以名稱搜尋只回 u1");
  const r3 = await call(list, { query: { search: "9999" } });
  ok((r3.body.students || []).length === 0, "查無結果 → 空陣列");

  console.log("📋 3. 學員詳情");
  const r4 = await call(detail, { params: { id: "u1" } });
  ok(r4.statusCode === 200 && r4.body.user.id === "u1", "回傳學員基本資料");
  ok((r4.body.bookings || []).length === 4, "詳情含 4 筆預約");
  ok((r4.body.certificates || []).length === 2, "詳情含 2 張證書");
  ok(Array.isArray(r4.body.terms), "詳情含期制進度");
  const miss = await call(detail, { params: { id: "nope" } });
  ok(miss.statusCode === 404, "不存在的學員 → 404");

  console.log("📋 4. 教練資質更新");
  const r5 = await call(putCred, {
    params: { id: "coach1" },
    user: { id: "admin", role: "admin" },
    body: { license_expiry: "2027-06-30", insurance_expiry_date: "2027-05-01", qualified_sports: ["molkky", "floor-curling"] },
  });
  ok(r5.statusCode === 200, "更新成功");
  const cc = db.prepare("SELECT * FROM coach_credentials WHERE user_id='coach1'").get();
  ok(cc.license_expiry === "2027-06-30" && cc.insurance_expiry_date === "2027-05-01", "到期日已更新");
  ok(JSON.parse(cc.qualified_sports).includes("floor-curling"), "可發證項目已加入地板冰壺");
  const audit = db.prepare("SELECT * FROM audit_log WHERE action_type='coach.credentials_updated'").get();
  ok(!!audit, "已寫入 audit_log");
  const r6 = await call(putCred, { params: { id: "u2" }, user: { id: "admin", role: "admin" }, body: { license_expiry: "2027-01-01" } });
  ok(r6.statusCode === 404, "未提交資質的教練 → 404");
  const r7 = await call(putCred, { params: { id: "coach1" }, user: { id: "admin", role: "admin" }, body: {} });
  ok(r7.statusCode === 400, "冇欄位 → 400");

  console.log("📋 5. 接線與介面");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/app\.use\("\/api\/admin", require\("\.\/routes\/admin-crm"\)\)/.test(idx), "已掛載 /api/admin CRM 路由");
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/loadStudents/.test(ui) && /\/admin\/crm\/students/.test(ui), "後台有學員檔案分頁");
  ok(/toggleStudent/.test(ui) && /stuSearch/.test(ui), "有搜尋與展開詳情");
  ok(/expiryPill/.test(ui) && /已過期/.test(ui), "資質到期有黃／紅標");
  ok(/api\.put\("\/admin\/coaches\//.test(ui), "可以編輯到期日（PUT credentials）");

  console.log("📋 6. 發證閘門聯動（移除項目後不可發證）");
  const svc2 = require("../src/services/certificate-service");
  const elig1 = svc2.issuerEligibility("coach1", "floor-curling", "冰壺班");
  ok(elig1.ok === true, "加入 floor-curling 後可發冰壺證書（underscore/hyphen 通配）");
  await call(putCred, {
    params: { id: "coach1" }, user: { id: "admin", role: "admin" },
    body: { qualified_sports: ["molkky"] },
  });
  const elig2 = svc2.issuerEligibility("coach1", "floor-curling", "冰壺班");
  ok(elig2.ok === false && /未獲此項目/.test(elig2.reason || ""), "移除 floor-curling → 發證閘門即刻封鎖");
  await call(putCred, {
    params: { id: "coach1" }, user: { id: "admin", role: "admin" }, body: { status: "suspended" },
  });
  const elig3 = svc2.issuerEligibility("coach1", "molkky", "木柱班");
  ok(elig3.ok === false, "status=suspended → 一律不可發證");
  const badStatus = await call(putCred, {
    params: { id: "coach1" }, user: { id: "admin", role: "admin" }, body: { status: "whatever" },
  });
  ok(badStatus.statusCode === 400, "無效 status → 400");

  console.log("📋 7. 權限（靜態檢查 requireAdmin）");
  const src = fs.readFileSync(path.join(__dirname, "../src/routes/admin-crm.js"), "utf8");
  const routeCount = (src.match(/router\.(get|put)\(/g) || []).length;
  const adminGuard = (src.match(/authenticateToken, requireAdmin, requireOpsRole/g) || []).length;
  ok(routeCount >= 3 && adminGuard === routeCount, "每一條路由都有 authenticateToken + requireAdmin + ops 角色（" + adminGuard + "/" + routeCount + "）");
  ok(/requireOpsRole/.test(src), "另有 ops 角色檢查");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
