#!/usr/bin/env node
/**
 * test-schema-class-schedule-title.js — 回歸：class_schedules.title 一定要由
 * 啟動 migration 建立（唔可以只靠 route 內 ensureSeriesCols）。
 * 背景：2026-11-17 曾因為欄位只在 coach 路由 lazy 建立，令公開
 *       /api/classes/upcoming 喺部署後爆 "no such column: cs.title"。
 */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-test-secret";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-schtitle-" + Date.now() + ".db");

let pass = 0, bad = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));

const initDatabase = require("../src/config/init-db");
initDatabase();
const { runMigrations } = require("../src/services/migrate-schema");
runMigrations();

const { getDb } = require("../src/services/database");
const db = getDb();
const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);

ok(cols.includes("title"), "啟動 migration 已建立 class_schedules.title");
ok(cols.includes("series_id"), "series_id 仍在");
ok(cols.includes("timezone"), "timezone 仍在");

// 再跑一次要 idempotent（唔會爆）
let threw = null;
try { runMigrations(); } catch (e) { threw = e; }
ok(!threw, "重跑 migration 唔會爆", threw && threw.message);

// 公開課程列表 SQL 直接可跑（唔再 no such column）
const fs = require("fs");
const src = fs.readFileSync(path.join(__dirname, "../src/routes/classes.js"), "utf8");
ok(/COALESCE\(NULLIF\(cs\.title,''\), c\.title\)/.test(src), "公開列表已用時段名優先");
try {
  db.prepare(
    `SELECT cs.id, COALESCE(NULLIF(cs.title,''), c.title) AS title FROM class_schedules cs
       LEFT JOIN classes c ON c.id = cs.class_id LIMIT 1`,
  ).all();
  ok(true, "公開列表 SQL 可執行");
} catch (e) {
  ok(false, "公開列表 SQL 可執行", e.message);
}

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
