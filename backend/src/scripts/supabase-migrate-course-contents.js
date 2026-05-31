#!/usr/bin/env node
/**
 * ZenPass course_contents Migration Runner
 *
 * 用法：node supabase-migrate-course-contents.js
 *
 * 這個腳本會檢查 course_contents 表是否存在，
 * 如果不存在，記錄需要執行的 SQL 並提供 Supabase SQL Editor 連結。
 *
 * 由於 Supabase REST API 不支援 DDL 操作，
 * 請手動在 Supabase SQL Editor 執行 SQL。
 */

require("dotenv").config({ path: __dirname + "/../../.env" });
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://pqgrkeavopksdttrzdqc.supabase.co";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3JrZWF2b3Brc2R0dHJ6ZHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwMzQ3OCwiZXhwIjoyMDkzMzc5NDc4fQ.91zpdSB41hXH89hx0zinfCKNEWjVo2-z8IwtvGfqp3o";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const SQL_FILE = path.join(
  __dirname,
  "../../supabase/migrations/20260507_course_contents.sql",
);

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  ZenPass course_contents Migration");
  console.log("═══════════════════════════════════════════\n");

  // Step 1: Check if table already exists
  console.log("🔍 Checking existing tables...");
  let exists = false;
  try {
    const { data, error } = await supabase
      .from("course_contents")
      .select("id")
      .limit(1);
    exists = !error;
    console.log(
      `   course_contents table: ${exists ? "✅ EXISTS" : "❌ NOT FOUND"}`,
    );
  } catch {
    console.log("   course_contents table: ❌ NOT FOUND");
  }

  if (exists) {
    console.log("\n✅ Migration already completed — table exists!");
    return;
  }

  // Step 2: Read SQL file
  const sql = fs.readFileSync(SQL_FILE, "utf-8");
  console.log(`\n📄 Migration SQL loaded (${sql.length} chars)`);

  // Step 3: Instructions for the user
  console.log("\n⚠️  Need to run SQL in Supabase SQL Editor");
  console.log("──────────────────────────────────────────────");
  console.log("📋 請複製以下 SQL 到 Supabase SQL Editor 執行：");
  console.log(
    "   🔗 https://supabase.com/dashboard/project/pqgrkeavopksdttrzdqc/sql/new\n",
  );
  console.log("   或者複製檔案內容到手動執行：");
  console.log(`   📁 ${SQL_FILE}\n`);
  console.log("   快速指令 (macOS):");
  console.log("   pbcopy < " + SQL_FILE);
  console.log("   然後貼上到 Supabase SQL Editor 執行\n");

  // Show summary
  console.log("📋 Migration 內容摘要：");
  console.log("   - 建立 course_contents 表");
  console.log("   - 建立索引 (course_id, course_number)");
  console.log("   - 自動更新 updated_at trigger");
  console.log("   - 自動產生 course_number (CT-YYYY-NNN) trigger");
  console.log("   - 啟用 Row Level Security");
  console.log("   - 設定 RLS policies");
  console.log("──────────────────────────────────────────────\n");
}

main().catch(console.error);
