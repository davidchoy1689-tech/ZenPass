#!/usr/bin/env node
/**
 * ZenPass — 金額 cents 一致性檢查
 *
 * 逐個「<col> REAL + <col>_cents INTEGER」pair，檢查
 *   <col>_cents == CAST(ROUND(<col>*100) AS INTEGER)（NULL 值除外）。
 * 有偏差 → exit 1（可用作 S4 切換／每日維護嘅 gate）。
 *
 * 用法: DB_PATH=./data/zenpass.db node src/scripts/check-money-cents.js
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

const MONEY_RE = /(amount|price|balance|debit|credit|fee|cost|gross|net|paid|earning|revenue|payout|income|total_spent)/i;
const EXCLUDE_RE = /(rate|percent|pct|_cents$)/i;

const db = new Database(DB_PATH);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name);

let pairs = 0;
let badTotal = 0;
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
  const names = new Set(cols.map((c) => c.name));
  for (const c of cols) {
    if (!MONEY_RE.test(c.name) || EXCLUDE_RE.test(c.name)) continue;
    const cents = c.name + "_cents";
    if (!names.has(cents)) continue;
    pairs++;
    const bad = db
      .prepare(
        `SELECT COUNT(*) n FROM "${t}"
         WHERE "${c.name}" IS NOT NULL
           AND ("${cents}" IS NULL OR "${cents}" != CAST(ROUND("${c.name}" * 100) AS INTEGER))`,
      )
      .get().n;
    if (bad > 0) {
      console.log(`  ❌ ${t}.${c.name} → ${cents}: ${bad} 行唔一致`);
      badTotal += bad;
    }
  }
}

console.log(`檢查 ${pairs} 個金額 pair（${DB_PATH}）`);
if (badTotal === 0) {
  console.log("🔎 一致性：全部 ✅");
} else {
  console.log(`🔎 一致性：${badTotal} 行有偏差 ❌`);
}
db.close();
process.exit(badTotal === 0 ? 0 : 1);
