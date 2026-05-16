#!/usr/bin/env node
/**
 * ZenPass 禪流 - enrolled_count 同步測試
 * 
 * 測試 enrolled_count 與實際 booking 記錄的一致性
 * 
 * 用法: node backend/tests/test-enrolled-count.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../backend/data/zenpass.db");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function runTests() {
  console.log("=".repeat(60));
  console.log("🧪 ZenPass enrolled_count 一致性測試");
  console.log("=".repeat(60));
  
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  
  // 測試 1：所有 enrolled_count 與實際 booking 匹配
  console.log("\n📋 測試 1: enrolled_count = actual confirmed/attended bookings");
  const mismatches = db.prepare(`
    SELECT COUNT(*) AS cnt FROM class_schedules cs
    WHERE cs.enrolled_count != (
      SELECT COUNT(*) FROM bookings 
      WHERE schedule_id = cs.id 
      AND (status = 'confirmed' OR status = 'attended')
    )
  `).get();
  assert(mismatches.cnt === 0, `所有 schedules 的 enrolled_count 與實際 booking 數量一致 (mismatches: ${mismatches.cnt})`);
  
  // 測試 2：enrolled_count 不超過 max_participants
  console.log("\n📋 測試 2: enrolled_count <= max_participants");
  const overflows = db.prepare(`
    SELECT COUNT(*) AS cnt FROM class_schedules
    WHERE enrolled_count > max_participants
  `).get();
  assert(overflows.cnt === 0, `沒有 enrolled_count 超過 max_participants (overflows: ${overflows.cnt})`);
  
  // 測試 3：enrolled_count >= 0
  console.log("\n📋 測試 3: enrolled_count >= 0");
  const negatives = db.prepare(`
    SELECT COUNT(*) AS cnt FROM class_schedules
    WHERE enrolled_count < 0
  `).get();
  assert(negatives.cnt === 0, `沒有 enrolled_count 為負數 (negatives: ${negatives.cnt})`);
  
  // 測試 4：pending_payment 的 booking 不計入 enrolled_count（因為 enrolled_count 已在 create 時增加）
  console.log("\n📋 測試 4: pending_payment bookings 已被 enrolled_count 涵蓋");
  const pendingSchedules = db.prepare(`
    SELECT cs.id, cs.enrolled_count, 
           (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'confirmed') AS confirmed_count,
           (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'attended') AS attended_count,
           (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'pending_payment') AS pending_count
    FROM class_schedules cs
    WHERE cs.enrolled_count != (
      SELECT COUNT(*) FROM bookings 
      WHERE schedule_id = cs.id 
      AND (status = 'confirmed' OR status = 'attended')
    )
  `).all();
  // enrolled_count 應 >= confirmed+attended，因為 pending_payment 會先 count 但尚未 confirmed
  // 這個 test 只是檢查 enrolled_count 不會少於 confirmed+attended
  const undercounts = db.prepare(`
    SELECT COUNT(*) AS cnt FROM class_schedules cs
    WHERE cs.enrolled_count < (
      SELECT COUNT(*) FROM bookings 
      WHERE schedule_id = cs.id 
      AND (status = 'confirmed' OR status = 'attended')
    )
  `).get();
  assert(undercounts.cnt === 0, `沒有 enrolled_count 低估 bookings (confirmed+attended) 數量 (undercounts: ${undercounts.cnt})`);
  
  // 總結
  console.log("\n" + "=".repeat(60));
  console.log(`📊 結果: ${passed} ✅ 通過, ${failed} ❌ 失敗`);
  console.log("=".repeat(60));
  
  db.close();
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
