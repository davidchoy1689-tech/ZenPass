/** ZenPass — 錢包／出糧帳合併 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-wmerge-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE coach_earnings (id TEXT PRIMARY KEY, coach_id TEXT, net_amount REAL DEFAULT 0, status TEXT DEFAULT 'pending');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, wallet_balance REAL DEFAULT 0,
    pending_payout REAL DEFAULT 0, total_earnings REAL DEFAULT 0,
    membership_type TEXT DEFAULT 'none', loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  const add = (id, wallet, pending, total, coach = 0) => pre.prepare(
    "INSERT INTO users (id,name,email,wallet_balance,pending_payout,total_earnings,is_coach) VALUES (?,?,?,?,?,?,?)",
  ).run(id, id, id + "@x.com", wallet, pending, total, coach);
  add("c_open", 500, 200, 500, 1);   // 部分已出糧
  add("c_paid", 500, 0, 500, 1);     // 全部已出糧
  add("c_extra", 550, 200, 500, 1);  // 有 admin 額外 50
  add("student", 100, 0, 0, 0);      // 非教練錢包
  const addE = (id, coach, amount, status) => pre.prepare(
    "INSERT INTO coach_earnings (id,coach_id,net_amount,status) VALUES (?,?,?,?)",
  ).run(id, coach, amount, status);
  addE("e1", "c_open", 300, "paid");
  addE("e2", "c_open", 200, "pending");
  addE("e3", "c_paid", 500, "paid");
  addE("e4", "c_extra", 500, "paid");
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();

  console.log("🧪 錢包／出糧帳合併 tests");

  const get = (id) => db.prepare("SELECT wallet_balance, pending_payout FROM users WHERE id=?").get(id);
  const c1 = get("c_open");
  ok(c1.wallet_balance === 200 && c1.pending_payout === 200, "部分已出糧：可提款 = 200（減走已出糧 300）");
  const c2 = get("c_paid");
  ok(c2.wallet_balance === 0 && c2.pending_payout === 0, "全部已出糧：可提款 = 0");
  const c3 = get("c_extra");
  ok(c3.wallet_balance === 250 && c3.pending_payout === 250, "保留 admin 額外 50：250");
  const st = get("student");
  ok(st.wallet_balance === 100 && st.pending_payout === 100, "非教練錢包保留 100");

  console.log("── 單一餘額操作 ──");
  const { reservePayout, creditWallet } = require("../src/services/wallet-service");
  const r1 = reservePayout("c_open", 50, "TEST-1");
  ok(r1.success && r1.balance_after === 150, "提款預留 50 → 150");
  const m1 = get("c_open");
  ok(m1.wallet_balance === 150 && m1.pending_payout === 150, "wallet 同 pending 同步扣");

  const r2 = creditWallet({ userId: "c_open", amount: 50, type: "refund", description: "退回" });
  ok(r2.success && r2.balance_after === 200, "退款 50 → 200");
  const m2 = get("c_open");
  ok(m2.wallet_balance === 200 && m2.pending_payout === 200, "退款後兩者同步");

  console.log("── 接線 ──");
  const ceSrc = fs.readFileSync(path.join(__dirname, "../src/routes/coach-earnings.js"), "utf8");
  const adminSrc = fs.readFileSync(path.join(__dirname, "../src/services/admin-service.js"), "utf8");
  const autoSrc = fs.readFileSync(path.join(__dirname, "../src/scripts/auto-settlement.js"), "utf8");
  const wsSrc = fs.readFileSync(path.join(__dirname, "../src/services/wallet-service.js"), "utf8");
  ok(!/pending_payout = pending_payout -/.test(ceSrc), "提款申請唔再只扣 pending_payout");
  ok(/reservePayout\(req\.user\.id/.test(ceSrc), "提款申請用 reservePayout");
  ok(/router\.post\("\/payout-process", authenticateToken, requireAdmin/.test(ceSrc), "payout-process 要 admin");
  ok(/type: "refund"/.test(ceSrc), "拒絕提款會退回餘額");
  ok(/reservePayout\(coach\.coach_id/.test(adminSrc) && /reservePayout\(coach\.coach_id/.test(autoSrc), "批量出糧／自動結算都有預留");
  ok(!/pending_payout = 0/.test(adminSrc), "admin 出糧唔會再硬設 pending_payout = 0");
  ok(/pending_payout = \? WHERE id = \?/.test(wsSrc), "wallet cred/debit 同步 pending_payout");
  ok(/migration\.wallet_merge_20261019/.test(fs.readFileSync(path.join(__dirname, "../src/config/init-db.js"), "utf8")), "有一次性合併遷移");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
