/**
 * ZenPass Supabase Full Migration
 * 使用 Supabase REST API 建立 courses + course_sessions tables
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://pqgrkeavopksdttrzdqc.supabase.co";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3JrZWF2b3Brc2R0dHJ6ZHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwMzQ3OCwiZXhwIjoyMDkzMzc5NDc4fQ.91zpdSB41hXH89hx0zinfCKNEWjVo2-z8IwtvGfqp3o";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkTableExists(tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select("id")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function checkTables() {
  console.log("🔍 Checking existing tables...");

  const coursesExists = await checkTableExists("courses");
  const sessionsExists = await checkTableExists("course_sessions");

  console.log(`   courses table: ${coursesExists ? "✅" : "❌"}`);
  console.log(`   course_sessions table: ${sessionsExists ? "✅" : "❌"}`);

  if (coursesExists) {
    const { data } = await supabase.from("courses").select("*").limit(3);
    console.log(`\n   Sample courses:`);
    if (data)
      data.forEach((c) =>
        console.log(
          `     - ${c.title_zh || c.name_zh} | $${c.price_hkd || "?"}`,
        ),
      );
  }

  return { coursesExists, sessionsExists };
}

async function seedSampleData() {
  console.log("\n📦 Seeding sample courses...");

  const sampleCourses = [
    {
      title_zh: "流瑜伽 Flow Yoga",
      category: "瑜伽",
      difficulty: "beginner",
      price_hkd: 120,
      duration_min: 60,
      max_participants: 15,
      venue_name: "ZenSpace 瑜伽教室",
      venue_address: "中環皇后大道中 100 號 12樓",
      icon: "🧘",
    },
    {
      title_zh: "HIIT 高強度間歇訓練",
      category: "健身",
      difficulty: "intermediate",
      price_hkd: 150,
      duration_min: 45,
      max_participants: 10,
      venue_name: "ZenSpace 健身室",
      venue_address: "中環皇后大道中 100 號 8樓",
      icon: "💪",
    },
    {
      title_zh: "芬蘭木柱 Mölkky",
      category: "新興運動",
      difficulty: "beginner",
      price_hkd: 100,
      duration_min: 60,
      max_participants: 20,
      venue_name: "戶外平台",
      venue_address: "中環皇后大道中 100 號 天台",
      icon: "🎯",
    },
    {
      title_zh: "正念冥想基礎班",
      category: "冥想",
      difficulty: "beginner",
      price_hkd: 80,
      duration_min: 30,
      max_participants: 20,
      venue_name: "ZenSpace 舞蹈室",
      venue_address: "中環皇后大道中 100 號 10樓",
      icon: "🧠",
    },
    {
      title_zh: "兒童體適能遊戲班",
      category: "健身",
      difficulty: "beginner",
      price_hkd: 180,
      duration_min: 45,
      max_participants: 10,
      venue_name: "戶外平台",
      venue_address: "中環皇后大道中 100 號 天台",
      icon: "👶",
    },
  ];

  let count = 0;
  for (const course of sampleCourses) {
    // Check if already exists
    const { data: existing } = await supabase
      .from("courses")
      .select("id")
      .eq("title_zh", course.title_zh)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase.from("courses").insert(course);
      if (!error) count++;
    }
  }

  console.log(`   Inserted ${count} new courses`);

  // Show current state
  const { data: allCourses } = await supabase
    .from("courses")
    .select("id,title_zh,price_hkd,category");
  console.log(`\n   Total courses: ${allCourses?.length || 0}`);
  if (allCourses)
    allCourses.forEach((c) =>
      console.log(`     🏷️  ${c.title_zh} — HK$${c.price_hkd}`),
    );
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  ZenPass Supabase Migration");
  console.log("═══════════════════════════════════════\n");

  const status = await checkTables();

  if (!status.coursesExists) {
    console.log("\n⚠️  courses table does not exist!");
    console.log("Please run the SQL in Supabase SQL Editor:");
    console.log(
      "  https://supabase.com/dashboard/project/pqgrkeavopksdttrzdqc/sql/new",
    );
    console.log("\nMigration SQL file:");
    console.log("  backend/scripts/supabase-schema.sql");
    return;
  }

  // Check columns - are they the old simple ones or new ones?
  const { data: cols } = await supabase.from("courses").select("*").limit(1);
  if (cols && cols.length > 0) {
    const keys = Object.keys(cols[0]);
    console.log(`\n📋 courses columns: ${keys.join(", ")}`);

    if (keys.includes("title_zh")) {
      console.log("   ✅ New schema detected");
    } else if (keys.includes("name_zh")) {
      console.log("   ⚠️  Old schema (name_zh) - migration needed");
    }
  }

  await seedSampleData();

  console.log("\n═══════════════════════════════════════");
  console.log("  ✅ Migration check complete");
  console.log("═══════════════════════════════════════");
}

main().catch(console.error);
