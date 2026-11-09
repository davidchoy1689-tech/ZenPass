#!/usr/bin/env node
/**
 * 工單八 — CLI 重設演練沙盒
 *   node scripts/reset-coach-sandbox.js [--session seed-sandbox-session]
 * 只會處理 is_sandbox 場地／seed-sandbox 班次；其他一律拒絕。
 */
const path = require("path");
process.chdir(path.join(__dirname, ".."));
if (!process.env.DB_PATH) process.env.DB_PATH = path.join(__dirname, "..", "data", "zenpass.db");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getDb } = require("../src/services/database");
const { resetSandboxSession } = require("../src/services/sandbox");

const i = process.argv.indexOf("--session");
const sessionId = i > -1 && process.argv[i + 1] ? process.argv[i + 1] : "seed-sandbox-session";

try {
  const db = getDb();
  const out = resetSandboxSession(db, sessionId);
  if (!out.ok) {
    console.error("❌ " + out.error);
    process.exit(1);
  }
  console.log("✅ 沙盒已重設");
  console.log(`   班次：${sessionId}`);
  console.log(`   預約回到未簽到：${out.bookings} 筆；清除點名：${out.attendances}；手冊：${out.handbooks}；回覆：${out.replies}`);
} catch (e) {
  console.error("❌ 重設失敗:", e.message);
  process.exit(1);
}
