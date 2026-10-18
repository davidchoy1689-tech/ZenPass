/** ZenPass — 錢包對帳報告 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-wrecon-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  const add = (id, role, w, p) => pre.prepare(
    "INSERT INTO users (id,name,email,role,wallet_balance,pending_payout) VALUES (?,?,?,?,?,?)",
  ).run(id, id, id + "@x.com", role, w, p);
  add("admin1", "admin", 0, 0);
  add("ok_user", "user", 100, 0);
  add("bad_user", "user", 250, 100);
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  // migration 會將 bad_user 調整；重新造出 mismatch 測 endpoint
  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("UPDATE users SET wallet_balance = 250, pending_payout = 100 WHERE id='bad_user'").run();
  db.prepare("UPDATE users SET wallet_balance = 100, pending_payout = 100 WHERE id='ok_user'").run();

  const router = require("../src/routes/wallet");
  const layer = router.stack.find((l) => l.route && l.route.path === "/admin/reconcile");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const call = (userId) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    handler({ user: { id: userId }, query: {} }, res);
    return res;
  };

  console.log("🧪 錢包對帳 tests");

  const good = call("admin1");
  ok(good.statusCode === 200 && good.body.success, "admin 可取得對帳報告");
  ok(good.body.mismatch_count === 1, "偵測到 1 個不一致用戶");
  ok(good.body.mismatches[0].user_id === "bad_user" && good.body.mismatches[0].diff === 150, "diff 正確（250 vs 100 = 150）");
  ok(good.body.wallet_total === 350 && good.body.pending_total === 200, "總額正確");

  const denied = call("ok_user");
  ok(denied.statusCode === 403, "非 admin → 403");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/wallet.js"), "utf8");
  ok(/\/admin\/reconcile/.test(src), "route 已註冊");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
