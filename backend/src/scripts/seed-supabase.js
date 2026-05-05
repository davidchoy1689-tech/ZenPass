/**
 * Seed Supabase with data from existing SQLite database
 */
const { createClient } = require('@supabase/supabase-js');
const Database = require('better-sqlite3');

const supabase = createClient(
  'https://pqgrkeavopksdttrzdqc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3JrZWF2b3Brc2R0dHJ6ZHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwMzQ3OCwiZXhwIjoyMDkzMzc5NDc4fQ.91zpdSB41hXH89hx0zinfCKNEWjVo2-z8IwtvGfqp3o'
);

const db = new Database('./data/zenpass.db');

async function seed() {
  console.log('=== Seeding Supabase from SQLite ===\n');
  
  // 1. Seed courses
  const sqliteCourses = db.prepare("SELECT * FROM classes WHERE status = 'active'").all();
  console.log(`📚 Found ${sqliteCourses.length} courses in SQLite`);
  
  let courseCount = 0;
  for (const c of sqliteCourses) {
    const { error } = await supabase.from('courses').insert({
      title_zh: c.title || '未命名課程',
      title_en: c.title_en || '',
      description_zh: c.description || '',
      category: c.category || '其他',
      difficulty: c.difficulty || 'beginner',
      price_hkd: c.price_hkd || 0,
      credits_cost: c.credits_cost || 0,
      duration_min: c.duration || 60,
      max_participants: c.max_participants || 15,
      venue_name: c.venue_name || '',
      venue_address: c.venue_address || '',
      is_active: true
    });
    if (error) {
      console.log(`  ❌ ${c.title}: ${error.message}`);
    } else {
      courseCount++;
    }
  }
  console.log(`✅ Seeded ${courseCount} courses`);
  
  // 2. Build course ID mapping (SQLite id → Supabase UUID)
  const { data: supabaseCourses } = await supabase.from('courses').select('id, title_zh');
  const courseMap = {};
  if (supabaseCourses) {
    for (const c of sqliteCourses) {
      const match = supabaseCourses.find(sc => sc.title_zh === c.title);
      if (match) courseMap[c.id] = match.id;
    }
  }
  
  // 3. Seed sessions
  const sqliteSchedules = db.prepare('SELECT * FROM class_schedules').all();
  let sessionCount = 0;
  
  for (const s of sqliteSchedules) {
    const newCourseId = courseMap[s.class_id];
    if (!newCourseId) {
      console.log(`  ⚠️  No mapping for schedule ${s.id} (class_id: ${s.class_id})`);
      continue;
    }
    
    const { error } = await supabase.from('course_sessions').insert({
      course_id: newCourseId,
      start_time: s.start_time,
      end_time: s.end_time,
      max_participants: s.max_participants || 15,
      enrolled_count: s.enrolled_count || 0,
      status: s.status || 'available'
    });
    if (error) {
      console.log(`  ❌ Session ${s.id}: ${error.message}`);
    } else {
      sessionCount++;
    }
  }
  console.log(`✅ Seeded ${sessionCount} course sessions`);
  
  // 4. Summary
  const { data: finalCourses } = await supabase.from('courses').select('id, title_zh, price_hkd, category');
  const { data: finalSessions } = await supabase.from('course_sessions').select('id, course_id');
  
  console.log(`\n📊 Final summary:`);
  console.log(`   courses: ${finalCourses?.length || 0}`);
  console.log(`   course_sessions: ${finalSessions?.length || 0}`);
  
  if (finalCourses) {
    finalCourses.forEach(c => console.log(`   🏷️  ${c.title_zh} — HK$${c.price_hkd} [${c.category}]`));
  }
  
  db.close();
}

seed().catch(console.error);
