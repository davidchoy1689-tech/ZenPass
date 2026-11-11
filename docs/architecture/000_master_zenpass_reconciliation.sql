-- ============================================================================
-- ZenPass 兼容層（Reconciliation）— 只讀 VIEW，不建表、不改資料
-- 目的：讓按「Master 清冊」表名寫的 SELECT / 報表可直接執行
-- 警告：SQLite view 預設不可寫；寫入請用真實表名（見 docs/architecture/PHASE1-5-SCHEMA-MAP.md）
-- 執行：sqlite3 data/zenpass.db < migrations/000_master_zenpass_reconciliation.sql
-- ============================================================================
PRAGMA foreign_keys = ON;

-- 1) schedules → class_schedules + classes（規格名：capacity / price_per_class_cents / is_booking_open）
DROP VIEW IF EXISTS schedules;
CREATE VIEW schedules AS
SELECT
  s.id                            AS id,
  s.class_id                      AS class_id,
  COALESCE(s.coach_override_id, s.coach_id, c.coach_id) AS coach_id,
  s.studio_id                     AS studio_id,
  COALESCE(c.venue_name, '')      AS venue_name,
  COALESCE(s.district, c.district, '') AS district,
  s.start_time                    AS start_time,
  s.end_time                      AS end_time,
  COALESCE(s.max_participants, c.max_participants, 8) AS capacity,
  COALESCE(c.price_hkd_cents, CAST(ROUND(COALESCE(c.price_hkd,0)*100) AS INTEGER), 14000) AS price_per_class_cents,
  COALESCE(s.booking_open, c.booking_open, 1) AS is_booking_open,
  COALESCE(s.is_dropin_enabled, 0) AS is_dropin_enabled,
  COALESCE(s.is_flash_sale_enabled, 0) AS is_flash_sale_enabled,
  s.flash_price_cents             AS flash_price_cents,
  CASE s.status
    WHEN 'available' THEN 'scheduled'
    WHEN 'full' THEN 'scheduled'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE s.status
  END                             AS status,
  COALESCE(c.class_reference, '') AS class_reference,
  COALESCE(c.target_audience_enum, 'general_fitness') AS target_audience_enum,
  s.created_at                    AS created_at
FROM class_schedules s
LEFT JOIN classes c ON c.id = s.class_id;

-- 2) audit_logs → audit_log
DROP VIEW IF EXISTS audit_logs;
CREATE VIEW audit_logs AS
SELECT
  a.id            AS id,
  a.user_id       AS user_id,
  a.action_type   AS action,
  a.entity_type   AS target_type,
  a.entity_id     AS target_id,
  COALESCE(a.description, a.new_values, '') AS details,
  a.created_at    AS created_at
FROM audit_log a;

-- 3) coach_earnings_ledger → coach_earnings（唯讀；booking_id 暫無，回 NULL）
DROP VIEW IF EXISTS coach_earnings_ledger;
CREATE VIEW coach_earnings_ledger AS
SELECT
  e.id                    AS id,
  e.coach_id              AS coach_id,
  e.schedule_id           AS schedule_id,
  NULL                    AS booking_id,
  CASE e.earning_type
    WHEN 'affiliate_product_commission' THEN 'affiliate_product_commission'
    ELSE 'teaching_share_80'
  END                     AS earning_type,
  COALESCE(e.net_amount_cents, CAST(ROUND(COALESCE(e.net_amount,0)*100) AS INTEGER)) AS amount_cents,
  COALESCE(e.payout_month, substr(e.date,1,7)) AS payout_month,
  e.clearing_batch_id     AS clearing_batch_id,
  e.bank_tx_id            AS bank_tx_id,
  COALESCE(e.clearing_status, 'pending') AS clearing_status,
  e.created_at            AS created_at
FROM coach_earnings e;

-- 驗證
-- SELECT COUNT(*) FROM schedules;              -- 應 ≈ class_schedules 數量（183）
-- SELECT COUNT(*) FROM audit_logs;             -- 應 ≈ audit_log 數量
-- SELECT COUNT(*) FROM coach_earnings_ledger;  -- 應 ≈ coach_earnings 數量
