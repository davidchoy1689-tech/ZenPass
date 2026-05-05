-- ============================================
-- ZenPass Supabase Schema Migration
-- 建立 courses（課程資料） + course_sessions（上課時段）
-- ============================================

-- 注意：舊嘅 courses table 太簡化，需要重建
-- 因為有用家數據，先 rename 舊表再做
ALTER TABLE courses RENAME TO courses_old;

-- Table 1: courses 課程基本資料
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES coaches(id),
  
  -- 基本資料
  title_zh TEXT NOT NULL,
  title_en TEXT DEFAULT '',
  description_zh TEXT DEFAULT '',
  description_en TEXT DEFAULT '',
  
  -- 分類設定
  category TEXT NOT NULL DEFAULT '其他',
  difficulty TEXT DEFAULT 'beginner' 
    CHECK (difficulty IN ('beginner','intermediate','advanced','all_levels')),
  
  -- 價錢（全部 HK$）
  price_hkd NUMERIC(10,2) NOT NULL DEFAULT 0,
  credits_cost INTEGER DEFAULT 0,
  
  -- 上課設定
  duration_min INTEGER NOT NULL DEFAULT 60,
  max_participants INTEGER DEFAULT 15,
  min_participants INTEGER DEFAULT 1,
  
  -- 場地
  venue_name TEXT DEFAULT '',
  venue_address TEXT DEFAULT '',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  
  -- 媒體
  image_url TEXT DEFAULT '',
  icon TEXT DEFAULT '📚',
  
  -- 狀態
  is_active BOOLEAN DEFAULT true,
  course_reference TEXT,
  
  -- 時間戳
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_courses_coach ON courses(coach_id);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active);

-- Table 2: course_sessions 具體上課時段
CREATE TABLE IF NOT EXISTS course_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  
  -- 時段
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  
  -- 循環設定 (每週/雙周/每月)
  recurring TEXT DEFAULT 'none' 
    CHECK (recurring IN ('none','daily','weekly','biweekly','monthly')),
  recurring_end_date DATE,
  
  -- 容量
  max_participants INTEGER DEFAULT 15,
  enrolled_count INTEGER DEFAULT 0,
  
  -- 位置 (可 override 課程預設場地)
  venue_name TEXT DEFAULT '',
  venue_address TEXT DEFAULT '',
  
  -- 狀態
  status TEXT DEFAULT 'available' 
    CHECK (status IN ('available','full','cancelled','completed')),
  session_reference TEXT,
  
  -- 時間戳
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_course ON course_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON course_sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON course_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON course_sessions((start_time::date));

-- 搬遷舊資料到新表（如果有的話）
INSERT INTO courses (id, title_zh, title_en, description_zh, category, is_active, course_reference, created_at)
SELECT 
  id, 
  name_zh, 
  name_en, 
  description, 
  COALESCE(icon, '📚'),
  is_active,
  course_code,
  created_at
FROM courses_old
ON CONFLICT (id) DO NOTHING;

-- 完成
SELECT '✅ Migration completed' as status;
SELECT COUNT(*) as courses_count FROM courses;
