/**
 * ZenPass Supabase Migration - 建立 courses + course_sessions
 */
require("dotenv").config({ path: __dirname + "/../../.env" });
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://pqgrkeavopksdttrzdqc.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3JrZWF2b3Brc2R0dHJ6ZHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwMzQ3OCwiZXhwIjoyMDkzMzc5NDc4fQ.91zpdSB41hXH89hx0zinfCKNEWjVo2-z8IwtvGfqp3o";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConnection() {
  const { data, error } = await supabase.from("courses").select("id").limit(1);
  if (error) {
    console.log("❌ Connection:", error.message);
    return false;
  }
  console.log("✅ Connection OK");

  // Show existing courses
  const { data: courses } = await supabase
    .from("courses")
    .select("id,name_zh,is_active");
  console.log(`   Existing courses: ${courses?.length || 0}`);
  return true;
}

checkConnection().catch(console.error);
