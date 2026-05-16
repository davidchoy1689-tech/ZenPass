#!/usr/bin/env node
/**
 * ZenPass 禪流 - enrolled_count 同步脚本
 * 
 * 将 class_schedules 表中的 enrolled_count 与实际的 booking 记录同步
 * （只计算 status = 'confirmed' 或 'attended' 的 booking）
 * 
 * 用法: node backend/src/scripts/sync-enrolled-count.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/zenpass.db");

function syncEnrolledCount() {
  console.log("🔄 开始同步 enrolled_count...");
  console.log(`   DB: ${DB_PATH}`);
  
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  
  // 找出所有 enrolled_count 与实际 booking 数量不一致的 schedule
  const mismatches = db.prepare(`
    SELECT cs.id, cs.enrolled_count AS db_enrolled, 
           (SELECT COUNT(*) FROM bookings 
            WHERE schedule_id = cs.id 
            AND (status = 'confirmed' OR status = 'attended')) AS actual_count
    FROM class_schedules cs
    WHERE cs.enrolled_count != (
      SELECT COUNT(*) FROM bookings 
      WHERE schedule_id = cs.id 
      AND (status = 'confirmed' OR status = 'attended')
    )
  `).all();
  
  console.log(`\n📊 发现 ${mismatches.length} 条不一致的记录:`);
  for (const m of mismatches) {
    console.log(`   ID: ${m.id} | DB enrolled: ${m.db_enrolled} | Actual: ${m.actual_count}`);
  }
  
  // 执行同步
  const updateStmt = db.prepare(`
    UPDATE class_schedules 
    SET enrolled_count = (
      SELECT COUNT(*) FROM bookings 
      WHERE schedule_id = class_schedules.id 
      AND (status = 'confirmed' OR status = 'attended')
    )
  `);
  
  const result = updateStmt.run();
  console.log(`\n✅ 同步完成! 更新了 ${result.changes} 条记录`);
  
  // 验证
  const remaining = db.prepare(`
    SELECT COUNT(*) AS cnt FROM class_schedules cs
    WHERE cs.enrolled_count != (
      SELECT COUNT(*) FROM bookings 
      WHERE schedule_id = cs.id 
      AND (status = 'confirmed' OR status = 'attended')
    )
  `).get();
  
  if (remaining.cnt === 0) {
    console.log("✅ 验证通过：所有 enrolled_count 已同步\n");
  } else {
    console.log(`⚠️ 仍有 ${remaining.cnt} 条记录未同步\n`);
  }
  
  db.close();
}

syncEnrolledCount();
