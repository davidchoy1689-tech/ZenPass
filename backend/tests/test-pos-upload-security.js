/** ZenPass — POS / Upload 權限與限流 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-possec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none', membership_expires_at TEXT, avatar_url TEXT, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0, partner_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach) VALUES ('u1','普通','u@x.com','user',0)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach) VALUES ('c1','教練','c@x.com','coach',1)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach) VALUES ('admin1','Admin','a@x.com','admin',0)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const router = require("../src/routes/pos");
  const layer = router.stack.find((l) => l.route && l.route.path === "/sale");
  const coachGuard = layer.route.stack[1].handle;

  const callGuard = (userId) => {
    let status = 200;
    let next = false;
    coachGuard(
      { user: { id: userId, role: "user" }, cookies: {}, headers: {} },
      { status(c) { status = c; return this; }, json() { return this; } },
      () => { next = true; },
    );
    return { status, next };
  };

  console.log("🧪 POS / Upload 安全 tests");

  const normal = callGuard("u1");
  ok(!normal.next && normal.status === 403, "普通用戶記錄銷售 → 403");
  const coach = callGuard("c1");
  ok(coach.next, "教練可以記錄銷售");
  ok(callGuard("admin1").next, "admin 可以用 POS");

  const posSrc = fs.readFileSync(path.join(__dirname, "../src/routes/pos.js"), "utf8");
  ok((posSrc.match(/authenticateToken, requireCoach/g) || []).length === 6, "POS 5 個 route 都 requireCoach（含 import）");

  const upSrc = fs.readFileSync(path.join(__dirname, "../src/routes/upload.js"), "utf8");
  ok(/uploadLimiter/.test(upSrc) && /max: 30/.test(upSrc), "上傳限流 30 次/小時");
  ok(/keyGenerator: \(req\) => \(req\.user && req\.user\.id\)/.test(upSrc), "限流按用戶計");
  ok(/uploadLimiter, upload\.array/.test(upSrc), "limiter 已套用");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
