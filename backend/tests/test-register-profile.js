/**
 * ZenPass — 學生註冊資料欄位 tests（2026-10-24）
 * David 指示：姓名、電話必填；出生年份／性別／緊急聯絡人／健康聲明可選填。
 */
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "***".repeat(64);
const tmp = path.join(os.tmpdir(), "zenpass-regprofile-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else { console.log("  ❌ " + m); fail++; }
};

(async () => {
  await require("../src/config/init-db")();
  require("../src/services/launch-mode").set("launch.registration_open", "1");
  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active')");

  const router = require("../src/routes/auth");
  const layer = router.stack.find((l) => l.route && l.route.path === "/register" && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = (body) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(o) { resolve({ status: this.statusCode, body: o }); return this; },
        cookie() { return this; },
      };
      handler({ body, query: {}, params: {}, headers: {}, ip: "127.0.0.1" }, res, () => resolve({ status: 0 }));
    });

  console.log("🧪 學生註冊資料 tests");

  const noPhone = await call({ name: "無電話", email: "nophone@x.com", password: "Abc12345" });
  ok(noPhone.status === 400 && noPhone.body.code === "PHONE_REQUIRED", "冇電話 → 400 PHONE_REQUIRED");

  const badPhone = await call({ name: "短電話", email: "badphone@x.com", password: "Abc12345", phone: "1234" });
  ok(badPhone.status === 400 && badPhone.body.code === "PHONE_INVALID", "電話少過 8 位 → 400 PHONE_INVALID");

  const minimal = await call({ name: "最基本", email: "min@x.com", password: "Abc12345", phone: "+852 9123 4567" });
  ok(minimal.status === 201, "姓名＋電話＋電郵＋密碼 → 201");
  const u1 = db.prepare("select phone,birth_year,gender,health_declared from users where email='min@x.com'").get();
  ok(u1.phone === "91234567", `電話正規化為 8 位（got ${u1.phone}）`);
  ok(u1.birth_year == null && u1.gender == null && u1.health_declared === 0, "選填欄位留空 → 正常");

  const full = await call({
    name: "完整資料",
    email: "full@x.com",
    password: "Abc12345",
    phone: "098765432",
    birth_year: 1992,
    gender: "female",
    emergency_name: "陳大文",
    emergency_phone: "+852 9876 5432",
    health_declared: true,
  });
  ok(full.status === 201, "完整選填 → 201");
  const u2 = db.prepare("select phone,birth_year,gender,emergency_name,emergency_phone,health_declared,health_declared_at from users where email='full@x.com'").get();
  ok(u2.phone === "98765432", "電話去掉開頭 0／+852");
  ok(u2.birth_year === 1992, "出生年份已存");
  ok(u2.gender === "female", "性別已存");
  ok(u2.emergency_name === "陳大文", "緊急聯絡人姓名已存");
  ok(u2.health_declared === 1 && !!u2.health_declared_at, "健康聲明有存同意時間");

  // 註冊頁有欄位
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "register.html"), "utf8");
  ok(/id="phone"[^>]*required/.test(html), "註冊頁電話欄標示必填");
  ok(/id="birthYear"/.test(html) && /id="emName"/.test(html) && /id="health"/.test(html), "註冊頁有選填欄位");

  console.log("── 社交登入補填（profile.html）──");
  const users = require("../src/routes/users");
  const pLayer = users.stack.find((l) => l.route && l.route.path === "/profile" && l.route.methods.put);
  const putProfile = pLayer.route.stack[pLayer.route.stack.length - 1].handle;
  const callPut = (body, user) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      };
      putProfile({ body, user, params: {}, headers: {}, ip: "127.0.0.1" }, res, () => resolve({ status: 0 }));
    });

  // 模擬社交登入帳號（冇電話）
  db.prepare(
    "INSERT INTO users (id,email,name,role,auth_provider,created_at,updated_at) VALUES ('soc1','social@x.com','社交用戶','user','google',datetime('now'),datetime('now'))",
  ).run();
  const bad = await callPut({ phone: "123" }, { id: "soc1", role: "user" });
  ok(bad.status === 400 && bad.body.code === "PHONE_INVALID", "補填錯誤電話 → 400 PHONE_INVALID");

  const goodPut = await callPut(
    { phone: "+852 6123 4567", birth_year: 1988, gender: "male", emergency_name: "陳太", emergency_phone: "98765432", health_declared: true },
    { id: "soc1", role: "user" },
  );
  ok(goodPut.status === 200, "補填成功 → 200");
  const soc = db.prepare("select phone,birth_year,gender,emergency_name,health_declared from users where id='soc1'").get();
  ok(soc.phone === "61234567", "社交帳號電話已正規化");
  ok(soc.birth_year === 1988 && soc.gender === "male" && soc.emergency_name === "陳太", "選填欄位已更新");
  ok(soc.health_declared === 1, "健康聲明已記錄");

  if (fail) { console.error(`❌ ${fail} 項失敗`); process.exit(1); }
  console.log("✅ 學生註冊資料 tests passed");
})();
