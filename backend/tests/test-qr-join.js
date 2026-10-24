/**
 * ZenPass — QR 極速登記（姓名＋電話）tests — 2026-10-24
 */
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "***".repeat(64);
const tmp = path.join(os.tmpdir(), "zenpass-qrjoin-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else { console.log("  ❌ " + m); fail++; }
};

function pick(router, p, m) {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[m]);
  if (!l) return null;
  const st = l.route.stack;
  return st[st.length - 1].handle;
}
const call = (h, body, user) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      cookie() { return this; },
      send(o) { resolve({ status: this.statusCode, body: o }); return this; },
    };
    h({ body: body || {}, user, query: {}, params: {}, headers: {}, ip: "127.0.0.1" }, res, () =>
      resolve({ status: 0, body: "next" }),
    );
  });

(async () => {
  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active')");

  const auth = require("../src/routes/auth");
  const join = pick(auth, "/quick-join", "post");
  const upgrade = pick(auth, "/upgrade-account", "post");

  console.log("🧪 QR 極速登記 tests");
  ok(!!join && !!upgrade, "handlers 存在");

  const noName = await call(join, { phone: "91234567" });
  ok(noName.status === 400 && noName.body.code === "NAME_REQUIRED", "冇姓名 → 400");

  const noPhone = await call(join, { name: "陳大文" });
  ok(noPhone.status === 400 && noPhone.body.code === "PHONE_REQUIRED", "冇電話 → 400");

  const badPhone = await call(join, { name: "陳大文", phone: "123" });
  ok(badPhone.status === 400 && badPhone.body.code === "PHONE_INVALID", "電話格式錯 → 400");

  const created = await call(join, { name: "陳大文", phone: "+852 9123 4567", src: "flyer-oct" });
  ok(created.status === 201 && !!created.body.token, "姓名＋電話 → 201 + 自動登入 token");
  const u = db.prepare("select * from users where phone='91234567'").get();
  ok(!!u && u.name === "陳大文", "用戶已建立");
  ok(String(u.email).endsWith("@phone.zenpass.local"), "用佔位電郵");
  ok(u.lead_source === "qr:flyer-oct", `記錄來源（${u.lead_source}）`);
  ok(u.terms_accepted_at != null, "已記錄條款同意時間");
  ok(u.password_hash && u.password_hash.startsWith("$2"), "有密碼 hash（隨機）");

  const dup = await call(join, { name: "另一個人", phone: "91234567" });
  ok(dup.status === 409 && dup.body.code === "PHONE_EXISTS", "重複電話 → 409（唔會自動登入）");

  // 補上電郵／密碼
  const up = await call(upgrade, { email: "taiman@example.com", password: "ZenPass2026" }, { id: u.id, role: "user", email: u.email });
  ok(up.status === 200, "補上電郵＋密碼 → 200");
  const u2 = db.prepare("select email,password_hash from users where id=?").get(u.id);
  ok(u2.email === "taiman@example.com", "電郵已更新");

  const weak = await call(upgrade, { email: "x2@example.com", password: "abc" }, { id: u.id, role: "user" });
  ok(weak.status === 400, "弱密碼 → 400");

  const badEmail = await call(upgrade, { email: "not-an-email", password: "ZenPass2026" }, { id: u.id, role: "user" });
  ok(badEmail.status === 400, "錯電郵 → 400");

  if (fail) { console.error(`❌ ${fail} 項失敗`); process.exit(1); }
  console.log("✅ QR 極速登記 tests passed");
})();
