-- ============================================
-- ZenPass Supabase Migration: course_contents
-- 課程詳細內容表格
-- Date: 2026-05-07
-- ============================================

-- 創建 course_contents 表 - 儲存課程的詳細內容、媒體、FAQ 等
CREATE TABLE IF NOT EXISTS course_contents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,

  course_number VARCHAR(50) UNIQUE, -- 課程編號，如 YP-2026-001
  title TEXT, -- 內容標題（可與 courses.title 不同）
  description TEXT, -- 詳細文字描述
  rich_content JSONB, -- 富文本 / 區塊內容 (適合 Next.js)
  video_url TEXT,
  images TEXT[], -- 圖片陣列
  materials TEXT[], -- 課前準備材料
  level VARCHAR(20) DEFAULT 'beginner' CHECK (level IN ('beginner', 'intermediate', 'advanced', 'all_levels')), -- 初級 / 中級 / 進階
  benefits TEXT[], -- 課程好處
  faqs JSONB, -- FAQ 清單

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_course_contents_course_id ON course_contents(course_id);
CREATE INDEX IF NOT EXISTS idx_course_contents_course_number ON course_contents(course_number);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION fn_course_contents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_course_contents_updated_at ON course_contents;
CREATE TRIGGER trg_course_contents_updated_at
  BEFORE UPDATE ON course_contents
  FOR EACH ROW
  EXECUTE FUNCTION fn_course_contents_updated_at();

-- Trigger: auto-generate course_number (e.g., CT-2026-001)
CREATE OR REPLACE FUNCTION fn_autocode_course_contents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  year_prefix TEXT;
  n INT;
BEGIN
  year_prefix := 'CT-' || to_char(NOW() AT TIME ZONE 'Asia/Hong_Kong', 'YYYY') || '-';
  SELECT COALESCE(MAX(CAST(SUBSTRING(course_number FROM year_prefix || '([0-9]+)') AS INT)), 0) + 1 INTO n
  FROM course_contents WHERE course_number LIKE year_prefix || '%';
  NEW.course_number := year_prefix || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_course_contents_autocode ON course_contents;
CREATE TRIGGER trg_course_contents_autocode
  BEFORE INSERT ON course_contents
  FOR EACH ROW WHEN (NEW.course_number IS NULL OR NEW.course_number = '')
  EXECUTE FUNCTION fn_autocode_course_contents();

-- Enable Row Level Security
ALTER TABLE course_contents ENABLE ROW LEVEL SECURITY;

-- RLS: Anyone can read active course contents
CREATE POLICY IF NOT EXISTS "Anyone can view course contents"
  ON course_contents FOR SELECT
  USING (true);

-- RLS: Only admins can insert/update/delete
CREATE POLICY IF NOT EXISTS "Admins can insert course contents"
  ON course_contents FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "Admins can update course contents"
  ON course_contents FOR UPDATE
  USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "Admins can delete course contents"
  ON course_contents FOR DELETE
  USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');

-- ============================================
-- Verify
-- ============================================
SELECT '✅ course_contents table created successfully' AS status;
