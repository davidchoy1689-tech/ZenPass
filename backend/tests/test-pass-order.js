/** ZenPass — 套票 Pass tests（2026-10-20） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env["JWT_" + "SECRET"] = "t".repeat(48);
const tmp = path.join(os.tmpdir(), "zenpass-pass-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, membership_type TEXT DEFAULT 'none', loyalty_tier TEXT DEFAULT 'bronze',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','u1@x.com')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const { getDb } = require("../src/services/database");
  const db = getDb();

  const credits = require("../src/routes/credits");
  const pick = (p, method) => {
    const layer = credits.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (h, user, body, params = {}) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    await h({ user, body, params, query: {}, headers: {} }, res);
    return res;
  };

  console.log("🧪 套票 Pass tests");

  const packs = await call(pick("/pass-packs", "get"), null, {});
  ok(packs.statusCode === 200 && packs.body.data.packs.length === 3, "有 3 個套票方案");
  const popular = packs.body.data.packs.find((p) => p.id === "popular");
  ok(popular.amount_hkd === 1080 && popular.credits === 100 && popular.bonus === 10, "熱門 Pack：HK$1,080 / 100+10 點");

  const bad = await call(pick("/pass-order", "post"), { id: "u1" }, { pack: "nope", reference: "abc" });
  ok(bad.statusCode === 400, "無效方案 → 400");

  const noRef = await call(pick("/pass-order", "post"), { id: "u1" }, { pack: "popular", method: "fps", reference: "ab" });
  ok(noRef.statusCode === 400, "冇參考編號 → 400");

  const good = await call(pick("/pass-order", "post"), { id: "u1" }, { pack: "popular", method: "fps", reference: "FPS-PASS-001" });
  ok(good.statusCode === 201 && good.body.data.credits_to_add === 110, `建立訂單 110 點（got ${good.statusCode}）`);

  const order = db.prepare("SELECT * FROM credit_topup_orders WHERE user_id='u1'").get();
  ok(order && order.amount_hkd === 1080 && order.credits === 100 && order.bonus_credits === 10 && order.status === "pending", "訂單欄位正確、pending");
  ok(/pass:popular/.test(order.note || ""), "訂單備註有 pack id");
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 0, "未確認前唔會加點");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
