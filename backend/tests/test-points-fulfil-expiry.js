/** ZenPass — 兌換履行清單 + 積分到期 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_s…1234";
const tmp = path.join(os.tmpdir(), "zenpass-pexp-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', points INTEGER DEFAULT 0, points_tier TEXT, points_tier_label TEXT,
    last_checkin TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE points_rewards (id TEXT PRIMARY KEY, name TEXT, description TEXT, points_cost INTEGER,
    reward_type TEXT, reward_value TEXT, icon TEXT, stock INTEGER DEFAULT -1, is_active INTEGER DEFAULT 1);
  CREATE TABLE points_redemptions (id TEXT PRIMARY KEY, user_id TEXT, reward_id TEXT, reward_name TEXT,
    points_spent INTEGER, reward_value TEXT, status TEXT DEFAULT 'active', expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  pre.prepare("INSERT INTO users (id,name,email,points,created_at) VALUES (?,?,?,?,?)").run("u_old", "陳舊用戶", "old@x.com", 320, old);
  pre.prepare("INSERT INTO users (id,name,email,points,created_at) VALUES (?,?,?,?,?)").run("u_new", "活躍用戶", "new@x.com", 150, old);
  pre.prepare("INSERT INTO users (id,name,email,points,created_at) VALUES (?,?,?,?,?)").run("u_zero", "零分用戶", "z@x.com", 0, old);
  pre.prepare("INSERT INTO points_rewards (id,name,points_cost,reward_type,reward_value) VALUES ('r1','$10 折扣碼',200,'discount','10')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  // 活躍用戶有近期交易 → 唔應該到期
  db.prepare("INSERT INTO points_transactions (id, user_id, type, points, balance_after, source, created_at) VALUES (?,?,?,?,?,?,datetime('now','-10 days'))")
    .run("tx1", "u_new", "earn", 50, 150, "checkin");
  // 待履行兌換
  db.prepare("INSERT INTO points_redemptions (id,user_id,reward_id,reward_name,points_spent,reward_value) VALUES (?,?,?,?,?,?)")
    .run("rd1", "u_old", "r1", "ZenPass 環保袋", 500, "pending_fulfilment");

  console.log("🧪 兌換履行 / 積分到期 tests");

  console.log("── 積分到期 ──");
  const { listExpiring, expireInactivePoints, getExpiryMonths } = require("../src/services/points-expiry");
  ok(getExpiryMonths() === 12, "預設 12 個月");
  const targets = listExpiring();
  const ids = targets.map(t => t.id);
  ok(ids.includes("u_old"), "長期無活動（400 日前）→ 列入到期");
  ok(!ids.includes("u_new"), "有近期交易 → 唔到期");
  ok(!ids.includes("u_zero"), "零分用戶 → 唔處理");

  const dry = expireInactivePoints({ dryRun: true });
  ok(dry.results.length >= 1 && db.prepare("SELECT points FROM users WHERE id='u_old'").get().points === 320, "dryRun 唔會改資料");

  const run = expireInactivePoints();
  const uOld = db.prepare("SELECT points, points_tier FROM users WHERE id='u_old'").get();
  ok(uOld.points === 0, "到期後餘額歸零（was 320）");
  ok(uOld.points_tier === "bronze", "等級重設 bronze");
  const expTx = db.prepare("SELECT * FROM points_transactions WHERE user_id='u_old' AND description LIKE '%積分到期%'").get();
  ok(!!expTx && expTx.points === 320, "寫入 expire 交易紀錄");
  ok(run.results.some(r => r.user_id === "u_old" && r.expired), "回傳執行結果");

  console.log("── 履行欄位 ──");
  const cols = db.prepare("PRAGMA table_info('points_redemptions')").all().map(c => c.name);
  ok(cols.includes("fulfilled_at"), "points_redemptions.fulfilled_at");
  ok(cols.includes("fulfilled_by"), "points_redemptions.fulfilled_by");

  console.log("── API / 前端 ──");
  const root = path.join(__dirname, "..");
  const admin = fs.readFileSync(path.join(root, "src/routes/admin.js"), "utf8");
  ok(admin.includes('"/redemptions/pending"'), "admin 待履行清單端點");
  ok(admin.includes('"/redemptions/:id/fulfil"'), "admin 標記已履行端點");
  ok(admin.includes('"/points-expiry/preview"'), "到期預覽端點");
  ok(admin.includes('"/points-expiry/run"'), "手動執行到期端點");

  const web = path.join(root, "..", "frontend-v2");
  const a = fs.readFileSync(path.join(web, "admin.html"), "utf8");
  ok(a.includes('"fulfil"'), "admin tab「兌換待履行」");
  ok(a.includes("/admin/redemptions/pending"), "admin 讀清單");
  const pt = fs.readFileSync(path.join(web, "points.html"), "utf8");
  ok(pt.includes("12 個月"), "積分頁寫明到期規則");

  const idx = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
  ok(idx.includes("expireStalePoints"), "排程會自動執行到期");

  console.log("──────────────────────────────");
  if (fail) { console.error("❌ " + fail + " failed"); process.exit(1); }
  console.log("✅ 兌換履行 / 積分到期 tests passed");
  try { fs.unlinkSync(tmp); } catch (e) {}
})();
