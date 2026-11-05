-- 2026-11-09 Pooling Engine（拼團開班）
-- 注意：SQLite 唔支援 ADD COLUMN IF NOT EXISTS，請由 migration runner 逐句執行並忽略 duplicate column。
ALTER TABLE class_schedules ADD COLUMN min_threshold INTEGER DEFAULT 4;
ALTER TABLE class_schedules ADD COLUMN pooling_deadline TEXT;
ALTER TABLE class_schedules ADD COLUMN pooling_status TEXT DEFAULT 'none';
ALTER TABLE class_schedules ADD COLUMN preauth_status TEXT DEFAULT 'none';

ALTER TABLE bookings ADD COLUMN fps_receipt_received INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN receipt_media_id TEXT;
