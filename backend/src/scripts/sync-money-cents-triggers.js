#!/usr/bin/env node
/**
 * ZenPass — Money cents auto-sync triggers (Phase 1 / S2)
 *
 * 目的：令 `<col>_cents` 永遠跟 `<col>`（REAL）保持同步 —— 由 **DB trigger** 做，
 *       唔需要改 33 個 app 檔，亦冇得被 app 繞過。
 *
 * 為每個「<col> REAL + <col>_cents INTEGER」pair 建立：
 *   - AFTER INSERT ON <table>         → 寫回 <col>_cents
 *   - AFTER UPDATE OF <col> ON <table> → 寫回 <col>_cents
 * （UPDATE 用 WHERE 防重複寫入，避免遞歸 no-op）
 *
 * 冪等：先 DROP TRIGGER IF EXISTS 再 CREATE。
 * --dry-run：只列出會建立嘅 trigger，唔改 DB。
 *
 * 用法: DB_PATH=./data/zenpass.db node src/scripts/sync-money-cents-triggers.js [--dry-run]
 */

const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";
const DRY = process.argv.includes("--dry-run");

const MONEY_RE = /(amount|price|balance|debit|credit|fee|cost|gross|net|paid|earning|revenue|payout|income|total_spent)/i;
const EXCLUDE_RE = /(rate|percent|pct|_cents$)/i;

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("recursive_triggers = OFF");

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

const pairs = [];
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
  const names = new Set(cols.map((c) => c.name));
  const hasId = names.has("id");
  for (const c of cols) {
    if (!MONEY_RE.test(c.name)) continue;
    if (EXCLUDE_RE.test(c.name)) continue;
    const cents = c.name + "_cents";
    if (!names.has(cents)) continue; // 未做 S1
    if (!hasId) continue; // 需要 id 做主鍵
    pairs.push({ table: t, col: c.name, cents });
  }
}

console.log(`DB: ${DB_PATH}`);
console.log(`建立 trigger 嘅金額 pair：${pairs.length}`);

const stmts = [];
for (const p of pairs) {
  const ai = `trg_${p.table}_${p.col}_cents_ai`;
  const au = `trg_${p.table}_${p.col}_cents_au`;
  const setExpr = `CAST(ROUND(NEW."${p.col}" * 100) AS INTEGER)`;
  const upd = (when) =>
    `CREATE TRIGGER "${when.name}" AFTER ${when.event}` +
    (when.of ? ` OF "${p.col}"` : "") +
    ` ON "${p.table}"` +
    ` FOR EACH ROW WHEN NEW."${p.col}" IS NOT NULL\n` +
    `BEGIN\n` +
    `  UPDATE "${p.table}" SET "${p.cents}" = ${setExpr}\n` +
    `   WHERE id = NEW.id AND ("${p.cents}" IS NULL OR "${p.cents}" != ${setExpr});\n` +
    `END;`;
  stmts.push({ table: p.table, name: ai, sql: upd({ name: ai, event: "INSERT" }) });
  stmts.push({ table: p.table, name: au, sql: upd({ name: au, event: "UPDATE", of: true }) });
}

if (DRY) {
  for (const s of stmts) console.log("  •", s.name);
  console.log("（dry-run，未改 DB）");
  db.close();
  process.exit(0);
}

let n = 0;
const run = db.transaction(() => {
  for (const s of stmts) {
    db.exec(`DROP TRIGGER IF EXISTS "${s.name}"`);
    db.exec(s.sql);
    n++;
  }
});
try {
  run();
  console.log(`✅ 已建立 / 更新 ${n} 個 trigger（${pairs.length} pairs × insert+update）。`);
} catch (e) {
  console.error("❌ 建立 trigger 失敗：", e.message);
  db.close();
  process.exit(1);
}
db.close();
