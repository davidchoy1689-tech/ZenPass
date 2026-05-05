-- ============================================
-- ZenPass Schema — 簡化版（保證成功）
-- ============================================

-- 啟用 UUID 生成
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table 1: courses 課程基本資料
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title_zh TEXT NOT NULL,
  title_en TEXT DEFAULT '',
  description_zh TEXT DEFAULT '',
  description_en TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT '其他',
  difficulty TEXT DEFAULT 'beginner',
  price_hkd NUMERIC(10,2) NOT NULL DEFAULT 0,
  credits_cost INTEGER DEFAULT 0,
  duration_min INTEGER NOT NULL DEFAULT 60,
  max_participants INTEGER DEFAULT 15,
  min_participants INTEGER DEFAULT 1,
  venue_name TEXT DEFAULT '',
  venue_address TEXT DEFAULT '',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  image_url TEXT DEFAULT '',
  icon TEXT DEFAULT '📚',
  is_active BOOLEAN DEFAULT true,
  course_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table 2: course_sessions 具體上課時段
CREATE TABLE IF NOT EXISTS course_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  recurring TEXT DEFAULT 'none',
  recurring_end_date DATE,
  max_participants INTEGER DEFAULT 15,
  enrolled_count INTEGER DEFAULT 0,
  venue_name TEXT DEFAULT '',
  venue_address TEXT DEFAULT '',
  status TEXT DEFAULT 'available',
  session_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON course_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON course_sessions(start_time);
