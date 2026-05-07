-- ============================================
-- ZenPass Supabase Migration: course_contents
-- 課程詳細內容表格
-- Date: 2026-05-07
-- ============================================

CREATE TABLE IF NOT EXISTS course_contents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,

  course_number VARCHAR(50) UNIQUE,
  title TEXT,
  description TEXT,
  rich_content JSONB,
  video_url TEXT,
  images TEXT[],
  materials TEXT[],
  level VARCHAR(20) DEFAULT 'beginner' CHECK (level IN ('beginner', 'intermediate', 'advanced', 'all_levels')),
  benefits TEXT[],
  faqs JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_contents_course_id ON course_contents(course_id);
CREATE INDEX IF NOT EXISTS idx_course_contents_course_number ON course_contents(course_number);

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

ALTER TABLE course_contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view course contents"
  ON course_contents FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert course contents"
  ON course_contents FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.role() = 'authenticated');

CREATE POLICY "Admins can update course contents"
  ON course_contents FOR UPDATE
  USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');

CREATE POLICY "Admins can delete course contents"
  ON course_contents FOR DELETE
  USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');
