/** ZenPass — 企業每月 Credit 重置（香港時間）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-corpreset-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('emp1','員工','e@x.com')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { calcNextReset, processCorporateResets } = require("../src/services/corporate-reset");

  console.log("🧪 企業每月重置（HKT）tests");

  // 2026-10-18 12:00 HKT = 2026-10-18 04:00 UTC
  const now = new Date("2026-10-18T04:00:00.000Z");
  ok(calcNextReset("monthly", now) === "2026-10-31T16:00:00.000Z", "月費：下月 1 日 00:00 HKT");
  ok(calcNextReset("quarterly", now) === "2026-12-31T16:00:00.000Z", "季費：下季 1 日 00:00 HKT");
  ok(calcNextReset("yearly", now) === "2026-12-31T16:00:00.000Z", "年費：下年 1 月 1 日 00:00 HKT");
  ok(calcNextReset("monthly", new Date("2026-12-20T04:00:00.000Z")) === "2026-12-31T16:00:00.000Z", "12 月 → 跨年正確");
  ok(calcNextReset(null, now) === calcNextReset("monthly", now), "預設 = 月費");

  console.log("── 實際重置 ──");
  db.prepare(
    "INSERT INTO corporate_companies (id,name,credit_pool,credit_used,monthly_allocation,billing_cycle,status,next_reset_at) VALUES ('co1','測試公司',100,40,100,'monthly','active','2020-01-01 00:00:00')",
  ).run();
  db.prepare(
    "INSERT INTO corporate_members (id,company_id,user_id,monthly_credit_used,monthly_limit) VALUES ('cm1','co1','emp1',5,10)",
  ).run();

  const n = processCorporateResets();
  ok(n === 1, "處理 1 間到期公司");
  const co = db.prepare("SELECT credit_used, next_reset_at, last_reset_at FROM corporate_companies WHERE id='co1'").get();
  ok(co.credit_used === 0, "credit_used 歸零");
  ok(co.next_reset_at === calcNextReset("monthly"), "next_reset_at = 下月 1 日 00:00 HKT");
  const mem = db.prepare("SELECT monthly_credit_used, monthly_reset_at FROM corporate_members WHERE id='cm1'").get();
  ok(mem.monthly_credit_used === 0 && /^\d{4}-\d{2}$/.test(mem.monthly_reset_at), "員工月度用量歸零（HKT 月份）");
  const audit = db.prepare("SELECT * FROM audit_log WHERE entity_id='co1' AND action_type='corporate.reset'").get();
  ok(!!audit && /60 credit/.test(audit.description), "audit 記錄 60 未用 credit 過期");

  const n2 = processCorporateResets();
  ok(n2 === 0, "再次執行唔會重複重置");

  console.log("── 接線 ──");
  const src = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/processCorporateResets/.test(src), "scheduler 已接");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
