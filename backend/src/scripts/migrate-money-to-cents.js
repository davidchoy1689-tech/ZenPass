#!/usr/bin/env node
/**
 * ZenPass — Money → integer cents migration (Phase 1)
 *
 * 目的：消除浮點金額（REAL）帶嚟嘅分毫誤差。
 * 做法（**加成式 / 可回滾**）：
 *   為每個金額欄新增 `<col>_cents INTEGER`，並 backfill = ROUND(col*100)。
 *   舊欄位暫時保留（dual），待讀寫層切換去 `_cents` 後，另一階段先移除舊欄。
 *
 * 特性：
 *   - 冪等：已存在 `_cents` 欄會 skip
 *   - 單一 transaction（失敗即整批回滾）
 *   - append-only 記錄入 audit_log
 *   - --dry-run 只列出會改嘅欄，唔改 DB
 *
 * 用法:
 *   DB_PATH=./data/zenpass.db node src/scripts/migrate-money-to-cents.js [--dry-run]
 */

const Database = require("better-sqlite3");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";
const DRY = process.argv.includes("--dry-run");

// 認作「金額」嘅欄名；排除率 / 百分比 等
const MONEY_RE = /(amount|price|balance|debit|credit|fee|cost|gross|net|paid|earning|revenue|payout|income|total_spent)/i;
const EXCLUDE_RE = /(rate|percent|pct|_cents$)/i;
const MONEY_TYPES = /^(REAL|NUMERIC|DECIMAL|FLOAT|DOUBLE)/i;

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

const targets = []; // { table, col, cents }
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
  const names = new Set(cols.map((c) => c.name));
  for (const c of cols) {
    if (!MONEY_TYPES.test(c.type || "")) continue;
    if (!MONEY_RE.test(c.name)) continue;
    if (EXCLUDE_RE.test(c.name)) continue;
    const cents = c.name + "_cents";
    if (names.has(cents)) continue; // 已遷移
    targets.push({ table: t, col: c.name, cents });
  }
}

console.log(`DB: ${DB_PATH}`);
console.log(`金額欄（待轉 cents）：${targets.length}`);
for (const x of targets) console.log(`  - ${x.table}.${x.col} -> ${x.cents}`);

if (targets.length === 0) {
  console.log("✅ 冇需要遷移嘅欄（已冪等）。");
  db.close();
  process.exit(0);
}
if (DRY) {
  console.log("（dry-run，未改 DB）");
  db.close();
  process.exit(0);
}

const logAudit = db.prepare(
  `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, description, created_at)
   VALUES (?, 'migrate_money_cents', 'column', ?, NULL, ?, datetime('now'))`,
);

const run = db.transaction(() => {
  for (const x of targets) {
    db.exec(`ALTER TABLE "${x.table}" ADD COLUMN "${x.cents}" INTEGER`);
    const r = db
      .prepare(
        `UPDATE "${x.table}" SET "${x.cents}" = CAST(ROUND("${x.col}" * 100) AS INTEGER)
         WHERE "${x.col}" IS NOT NULL`,
      )
      .run();
    try {
      logAudit.run(
        crypto.randomUUID(),
        `${x.table}.${x.col}`,
        `money->cents: ${x.col} backfilled to ${x.cents} (${r.changes} rows)`,
      );
    } catch (e) {
      /* audit 失敗唔應阻住遷移 */
    }
    console.log(`  ✅ ${x.table}.${x.col} -> ${x.cents} (${r.changes} rows)`);
  }
});

try {
  run();
  console.log(`\n✅ 遷移完成（${targets.length} 欄）。舊欄位仍保留（dual-write 階段）。`);
} catch (e) {
  console.error("❌ 遷移失敗，已回滾：", e.message);
  db.close();
  process.exit(1);
}

// ---- 驗證：每欄逐行 check cents == ROUND(orig*100) ----
let bad = 0;
for (const x of targets) {
  const r = db
    .prepare(
      `SELECT COUNT(*) c FROM "${x.table}"
       WHERE "${x.col}" IS NOT NULL
         AND ("${x.cents}" IS NULL OR "${x.cents}" != CAST(ROUND("${x.col}" * 100) AS INTEGER))`,
    )
    .get().c;
  if (r !== 0) {
    console.log(`  ❌ ${x.table}.${x.col}: ${r} 行唔對`);
    bad += r;
  }
}
console.log(bad === 0 ? "🔎 驗證：全部欄逐行一致 ✅" : `🔎 驗證：${bad} 行有問題 ❌`);
db.close();
process.exit(bad === 0 ? 0 : 1);
