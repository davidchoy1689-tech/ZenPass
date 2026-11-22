/**
 * ZenPass — 教練名冊（Coach Registry）API tests
 * node backend/tests/test-coach-registry.js
 */
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "zenpass-test-secret-key-0123456789abcdef0123456789";
process.env.NODE_ENV = "test";
const tmp = path.join(os.tmpdir(), "zenpass-coach-registry-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const router = require("../src/routes/admin-coach-registry");

  const pick = (p, m) => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = (fn, req) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; return res; };
    res.send = (v) => { res.body = v; return res; };
    return Promise.resolve(fn({
      query: {}, params: {}, body: {}, headers: {},
      user: { id: "admin-1", role: "super_admin" }, ip: "127.0.0.1", ...req,
    }, res)).then(() => res);
  };
  const getList = pick("/", "get");
  const getCsv = pick("/export.csv", "get");
  const postCreate = pick("/", "post");
  const patchCoach = pick("/:id", "patch");
  const resetPw = pick("/:id/reset-password", "post");

  console.log("\n🧪 教練名冊 API\n");

  // 先跑一次列表，觸發 route 的 idempotent 補欄（模擬舊 DB）
  await call(getList, { user: { id: "admin-1", role: "super_admin" } });
  // init-db 舊 schema 的 users.partner_id 有 FK 指向 partner_venues；測試 DB 補一個最小表
  db.exec("CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT)");

  const now = new Date().toISOString();
  const insUser = db.prepare(`INSERT INTO users (id,name,email,phone,role,is_coach,coach_verified,is_active,commission_rate,notes,created_at,updated_at,token_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  insUser.run("admin-1", "管理員", "admin@test.hk", "90000000", "super_admin", 0, 0, 1, null, null, now, now);
  insUser.run("staff-1", "客服", "staff@test.hk", "90000001", "platform_staff", 0, 0, 1, null, null, now, now);
  insUser.run("coach-1", "陳教練", "c1@test.hk", "91234567", "coach", 1, 1, 1, 0.8, "資深", now, now);
  insUser.run("coach-2", "黃教練", "c2@test.hk", "92345678", "coach", 1, 0, 1, null, null, now, now);
  insUser.run("u-1", "學生甲", "s1@test.hk", "90000002", "user", 0, 0, 1, null, null, now, now);
  insUser.run("u-2", "學生乙", "s2@test.hk", "90000003", "user", 0, 0, 1, null, null, now, now);

  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,first_aid_type,first_aid_expiry,insurance_expiry_date,status)
    VALUES ('cred-1','coach-1','ACSM','L123',?, 'First Aid', ?, ?, 'verified')`).run(soon, soon, past);
  db.prepare(`INSERT INTO coach_payout_settings (coach_id,fps_type,fps_proxy_value,bank_code,bank_account_no,account_holder_name,is_verified,verified_at)
    VALUES ('coach-1','mobile','91234567','004','123456789','CHAN TAI MAN',1,datetime('now'))`).run();

  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('cl-1','coach-1','木柱班','molkky',60,150,'active')`).run();
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,status,coach_id) VALUES ('s-1','cl-1','2030-01-01 10:00:00','2030-01-01 11:00:00','available','coach-1')`).run();
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,status,coach_id) VALUES ('s-2','cl-1','2020-01-01 10:00:00','2020-01-01 11:00:00','available','coach-1')`).run();
  db.prepare(`INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status) VALUES ('b-1','u-1','s-1','cl-1','confirmed','paid')`).run();
  db.prepare(`INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status) VALUES ('b-2','u-2','s-1','cl-1','cancelled','cancelled')`).run();

  // ---- 列表 ----
  let r = await call(getList, { user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 200 && r.body.success, "GET 名冊回傳成功");
  ok(r.body.coaches.length === 2, "列出 2 位教練");
  const c1 = r.body.coaches.find((c) => c.id === "coach-1");
  ok(c1 && c1.verified === true, "coach-1 已核實");
  ok(c1 && c1.expiry.expired === true, "coach-1 保險已過期 → expired 標記");
  ok(c1 && c1.counts.upcoming === 1, "coach-1 未來堂數 = 1");
  ok(c1 && c1.counts.students === 1, "coach-1 學生數 = 1（取消不計）");
  ok(c1 && c1.payout.complete === true && c1.payout.bank_account_masked === "••••6789", "收款資料完整＋戶口已遮罩");
  ok(r.body.summary.expired >= 1 && r.body.summary.verified === 1, "summary 到期／核實數字正確");
  const c2 = r.body.coaches.find((c) => c.id === "coach-2");
  ok(c2 && c2.commission_is_global === true && c2.commission_percent === 80, "未設個人分成 → 跟全平台 80%");

  // 篩選
  r = await call(getList, { query: { q: "黃" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.body.coaches.length === 1 && r.body.coaches[0].id === "coach-2", "搜尋姓名");
  r = await call(getList, { query: { expiry: "expired" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.body.coaches.length === 1 && r.body.coaches[0].id === "coach-1", "篩選已過期");
  r = await call(getList, { query: { status: "pending" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.body.coaches.length === 1 && r.body.coaches[0].id === "coach-2", "篩選待核實");

  // ---- 建立 ----
  r = await call(postCreate, {
    body: { name: "李教練", email: "c3@test.hk", phone: "9345 6789", commission_percent: 85, coach_years: 6 },
    user: { id: "admin-1", role: "super_admin" },
  });
  ok(r.statusCode === 201 && r.body.success, "POST 建立教練成功");
  ok(typeof r.body.temp_password === "string" && r.body.temp_password.length >= 12, "回傳臨時密碼");
  const c3 = db.prepare("SELECT * FROM users WHERE email='c3@test.hk'").get();
  ok(c3 && c3.role === "coach" && Number(c3.is_coach) === 1 && c3.phone === "93456789", "新教練 role/電話正確");
  ok(Math.abs(Number(c3.commission_rate) - 0.85) < 1e-9, "個人分成 85% 存為 0.85");

  r = await call(postCreate, { body: { name: "重複", email: "c3@test.hk" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 409, "重複電郵 → 409");
  r = await call(postCreate, { body: { name: "壞電話", email: "c4@test.hk", phone: "123" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 400, "電話格式錯 → 400");
  r = await call(postCreate, { body: { name: "壞分成", email: "c5@test.hk", commission_percent: 150 }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 400, "分成超範圍 → 400");

  // ---- 更新 ----
  r = await call(patchCoach, {
    params: { id: "coach-2" },
    body: {
      name: "黃Sir", phone: "9234 5678", commission_percent: 75, coach_years: 3,
      coach_verified: true, is_active: true,
      license_type: "NWS", license_expiry: soon, insurance_expiry_date: soon,
      fps_type: "fps_id", fps_proxy_value: "1234567", bank_code: "024",
      bank_account_no: "987654321", account_holder_name: "WONG SIR",
    },
    user: { id: "admin-1", role: "super_admin" },
  });
  ok(r.statusCode === 200 && r.body.success, "PATCH 更新成功");
  const c2b = db.prepare("SELECT * FROM users WHERE id='coach-2'").get();
  ok(c2b.name === "黃Sir" && c2b.phone === "92345678" && Number(c2b.coach_verified) === 1, "姓名／電話／核實已更新");
  ok(Math.abs(Number(c2b.commission_rate) - 0.75) < 1e-9, "個人分成更新為 0.75");
  const cred2 = db.prepare("SELECT * FROM coach_credentials WHERE user_id='coach-2'").get();
  ok(cred2 && cred2.license_type === "NWS" && cred2.license_expiry === soon, "自動建立資質紀錄");
  const pay2 = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id='coach-2'").get();
  ok(pay2 && pay2.fps_type === "fps_id" && pay2.bank_code === "024", "收款資料已建立");

  r = await call(patchCoach, { params: { id: "coach-2" }, body: { phone: "abc" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 400, "PATCH 壞電話 → 400");
  r = await call(patchCoach, { params: { id: "coach-2" }, body: { commission_percent: 0 }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 400, "PATCH 分成 0 → 400");
  r = await call(patchCoach, { params: { id: "coach-2" }, body: { license_expiry: "2026/01/01" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 400, "PATCH 日期格式錯 → 400");
  r = await call(patchCoach, { params: { id: "nope" }, body: { name: "X" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 404, "PATCH 不存在 → 404");

  // 清空收款
  r = await call(patchCoach, {
    params: { id: "coach-2" },
    body: { fps_type: "", fps_proxy_value: "", bank_code: "", bank_account_no: "", account_holder_name: "" },
    user: { id: "admin-1", role: "super_admin" },
  });
  ok(r.statusCode === 200, "清空收款資料成功");
  ok(!db.prepare("SELECT 1 FROM coach_payout_settings WHERE coach_id='coach-2'").get(), "清空後收款紀錄已移除");

  // 停用 → token_version +1
  const tvBefore = Number(db.prepare("SELECT token_version FROM users WHERE id='coach-1'").get().token_version) || 0;
  r = await call(patchCoach, { params: { id: "coach-1" }, body: { is_active: false }, user: { id: "admin-1", role: "super_admin" } });
  const tvAfter = Number(db.prepare("SELECT token_version FROM users WHERE id='coach-1'").get().token_version) || 0;
  ok(r.statusCode === 200 && tvAfter === tvBefore + 1, "停用教練 → 舊 session 失效");

  // ---- 重設密碼 ----
  r = await call(resetPw, { params: { id: "coach-1" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 200 && r.body.temp_password, "重設密碼回傳臨時密碼");
  r = await call(resetPw, { params: { id: "staff-1" }, user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 400, "非教練帳號不可重設 → 400");

  // ---- CSV ----
  db.prepare("UPDATE users SET name='=SUM(A1)' WHERE id='coach-2'").run();
  r = await call(getCsv, { user: { id: "admin-1", role: "super_admin" } });
  ok(r.statusCode === 200 && String(r.body).startsWith("\uFEFF"), "CSV 有 BOM");
  ok(String(r.body).includes("姓名,電話,電郵"), "CSV 有中文表頭");
  ok(String(r.body).includes("'=SUM(A1)"), "CSV 防公式注入（'=）");
  ok(/text\/csv/.test(r.headers["Content-Type"] || ""), "CSV Content-Type 正確");

  console.log(`\n${fail === 0 ? "✅" : "❌"} 通過 ${pass}／${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
