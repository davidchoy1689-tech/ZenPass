-- =============================================
-- ZenPass Auto-Generate Reference Codes
-- Migration Date: 2026-05-06
-- =============================================
-- 
-- Adds BEFORE INSERT triggers that auto-populate
-- reference code fields when new records are created.
-- Only fires when the code field is NULL or empty.
--
-- Code Format Reference:
-- ┌──────────────────┬──────────────────────────┐
-- │ Table            │ Code Format              │
-- ├──────────────────┼──────────────────────────┤
-- │ courses          │ CRS-001 ~ CRS-019        │
-- │ course_sessions  │ SES-001 ~ SES-027        │
-- │ users            │ USR-001 ~ USR-021        │
-- │ course_categories│ CAT-001 ~ CAT-007        │
-- │ bookings         │ BK-YYYYMMDD-NNN          │
-- │ transactions     │ TXN-YYYYMM-NNN           │
-- │ settlements      │ STL-YYYY-MM-NN           │
-- │ venues           │ VEN-NNN                  │
-- │ partners         │ PTN-NNN                  │
-- │ payments         │ PAY-YYYYMMDD-NNN         │
-- │ commissions      │ COM-YYYYMM-NNN           │
-- │ payouts          │ POT-YYYYMM-NNN           │
-- └──────────────────┴──────────────────────────┘

-- =============================================
-- 1. Courses → CRS-NNN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_courses()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(course_reference FROM 'CRS-([0-9]+)') AS INT)),0)+1 INTO n
  FROM courses WHERE course_reference ~ '^CRS-[0-9]+$';
  NEW.course_reference := 'CRS-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_courses_autocode ON courses;
CREATE TRIGGER trg_courses_autocode BEFORE INSERT ON courses
  FOR EACH ROW WHEN (NEW.course_reference IS NULL OR NEW.course_reference = '')
  EXECUTE FUNCTION fn_autocode_courses();

-- =============================================
-- 2. Sessions → SES-NNN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_sessions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(session_reference FROM 'SES-([0-9]+)') AS INT)),0)+1 INTO n
  FROM course_sessions WHERE session_reference ~ '^SES-[0-9]+$';
  NEW.session_reference := 'SES-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sessions_autocode ON course_sessions;
CREATE TRIGGER trg_sessions_autocode BEFORE INSERT ON course_sessions
  FOR EACH ROW WHEN (NEW.session_reference IS NULL OR NEW.session_reference = '')
  EXECUTE FUNCTION fn_autocode_sessions();

-- =============================================
-- 3. Users → USR-NNN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_users()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(user_code FROM 'USR-([0-9]+)') AS INT)),0)+1 INTO n
  FROM users WHERE user_code ~ '^USR-[0-9]+$';
  NEW.user_code := 'USR-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_users_autocode ON users;
CREATE TRIGGER trg_users_autocode BEFORE INSERT ON users
  FOR EACH ROW WHEN (NEW.user_code IS NULL OR NEW.user_code = '')
  EXECUTE FUNCTION fn_autocode_users();

-- =============================================
-- 4. Categories → CAT-NNN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_categories()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(category_code FROM 'CAT-([0-9]+)') AS INT)),0)+1 INTO n
  FROM course_categories WHERE category_code ~ '^CAT-[0-9]+$';
  NEW.category_code := 'CAT-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_categories_autocode ON course_categories;
CREATE TRIGGER trg_categories_autocode BEFORE INSERT ON course_categories
  FOR EACH ROW WHEN (NEW.category_code IS NULL OR NEW.category_code = '')
  EXECUTE FUNCTION fn_autocode_categories();

-- =============================================
-- 5. Bookings → BK-YYYYMMDD-NNN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_bookings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  today TEXT;
  n INT;
BEGIN
  today := to_char(NEW.created_at AT TIME ZONE 'Asia/Hong_Kong', 'YYYYMMDD');
  SELECT COALESCE(MAX(CAST(SUBSTRING(booking_code FROM 'BK-' || today || '-([0-9]+)') AS INT)),0)+1 INTO n
  FROM bookings WHERE booking_code LIKE 'BK-' || today || '-%';
  NEW.booking_code := 'BK-' || today || '-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_bookings_autocode ON bookings;
CREATE TRIGGER trg_bookings_autocode BEFORE INSERT ON bookings
  FOR EACH ROW WHEN (NEW.booking_code IS NULL OR NEW.booking_code = '')
  EXECUTE FUNCTION fn_autocode_bookings();

-- =============================================
-- 6. Transactions → TXN-YYYYMM-NNN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_transactions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ym TEXT;
  n INT;
BEGIN
  ym := to_char(NEW.created_at AT TIME ZONE 'Asia/Hong_Kong', 'YYYYMM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(tx_code FROM 'TXN-' || ym || '-([0-9]+)') AS INT)),0)+1 INTO n
  FROM transactions WHERE tx_code LIKE 'TXN-' || ym || '-%';
  NEW.tx_code := 'TXN-' || ym || '-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_transactions_autocode ON transactions;
CREATE TRIGGER trg_transactions_autocode BEFORE INSERT ON transactions
  FOR EACH ROW WHEN (NEW.tx_code IS NULL OR NEW.tx_code = '')
  EXECUTE FUNCTION fn_autocode_transactions();

-- =============================================
-- 7. Settlements → STL-YYYY-MM-NN
-- =============================================
CREATE OR REPLACE FUNCTION fn_autocode_settlements()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prefix TEXT;
  n INT;
BEGIN
  prefix := 'STL-' || NEW.period_year::TEXT || '-' || LPAD(NEW.period_month::TEXT, 2, '0') || '-';
  SELECT COALESCE(MAX(CAST(SUBSTRING(settlement_code FROM prefix || '([0-9]+)') AS INT)),0)+1 INTO n
  FROM settlements WHERE settlement_code LIKE prefix || '%';
  NEW.settlement_code := prefix || LPAD(n::TEXT, 2, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_settlements_autocode ON settlements;
CREATE TRIGGER trg_settlements_autocode BEFORE INSERT ON settlements
  FOR EACH ROW WHEN (NEW.settlement_code IS NULL OR NEW.settlement_code = '')
  EXECUTE FUNCTION fn_autocode_settlements();

-- =============================================
-- 8. Venues → VEN-NNN (future use)
-- =============================================
ALTER TABLE venues ADD COLUMN IF NOT EXISTS reference_code TEXT;

CREATE OR REPLACE FUNCTION fn_autocode_venues()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_code FROM 'VEN-([0-9]+)') AS INT)),0)+1 INTO n
  FROM venues WHERE reference_code ~ '^VEN-[0-9]+$';
  NEW.reference_code := 'VEN-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_venues_autocode ON venues;
CREATE TRIGGER trg_venues_autocode BEFORE INSERT ON venues
  FOR EACH ROW WHEN (NEW.reference_code IS NULL OR NEW.reference_code = '')
  EXECUTE FUNCTION fn_autocode_venues();

-- =============================================
-- 9. Partners → PTN-NNN (future use)
-- =============================================
ALTER TABLE partners ADD COLUMN IF NOT EXISTS reference_code TEXT;

CREATE OR REPLACE FUNCTION fn_autocode_partners()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_code FROM 'PTN-([0-9]+)') AS INT)),0)+1 INTO n
  FROM partners WHERE reference_code ~ '^PTN-[0-9]+$';
  NEW.reference_code := 'PTN-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_partners_autocode ON partners;
CREATE TRIGGER trg_partners_autocode BEFORE INSERT ON partners
  FOR EACH ROW WHEN (NEW.reference_code IS NULL OR NEW.reference_code = '')
  EXECUTE FUNCTION fn_autocode_partners();

-- =============================================
-- 10. Payments → PAY-YYYYMMDD-NNN (future use)
-- =============================================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_code TEXT;

CREATE OR REPLACE FUNCTION fn_autocode_payments()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE today TEXT; n INT;
BEGIN
  today := to_char(NOW() AT TIME ZONE 'Asia/Hong_Kong', 'YYYYMMDD');
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_code FROM 'PAY-' || today || '-([0-9]+)') AS INT)),0)+1 INTO n
  FROM payments WHERE reference_code LIKE 'PAY-' || today || '-%';
  NEW.reference_code := 'PAY-' || today || '-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_payments_autocode ON payments;
CREATE TRIGGER trg_payments_autocode BEFORE INSERT ON payments
  FOR EACH ROW WHEN (NEW.reference_code IS NULL OR NEW.reference_code = '')
  EXECUTE FUNCTION fn_autocode_payments();

-- =============================================
-- 11. Commissions → COM-YYYYMM-NNN (future use)
-- =============================================
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS reference_code TEXT;

CREATE OR REPLACE FUNCTION fn_autocode_commissions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ym TEXT; n INT;
BEGIN
  ym := to_char(NOW() AT TIME ZONE 'Asia/Hong_Kong', 'YYYYMM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_code FROM 'COM-' || ym || '-([0-9]+)') AS INT)),0)+1 INTO n
  FROM commissions WHERE reference_code LIKE 'COM-' || ym || '-%';
  NEW.reference_code := 'COM-' || ym || '-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_commissions_autocode ON commissions;
CREATE TRIGGER trg_commissions_autocode BEFORE INSERT ON commissions
  FOR EACH ROW WHEN (NEW.reference_code IS NULL OR NEW.reference_code = '')
  EXECUTE FUNCTION fn_autocode_commissions();

-- =============================================
-- 12. Payouts → POT-YYYYMM-NNN (future use)
-- =============================================
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS reference_code TEXT;

CREATE OR REPLACE FUNCTION fn_autocode_payouts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ym TEXT; n INT;
BEGIN
  ym := to_char(NOW() AT TIME ZONE 'Asia/Hong_Kong', 'YYYYMM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_code FROM 'POT-' || ym || '-([0-9]+)') AS INT)),0)+1 INTO n
  FROM payouts WHERE reference_code LIKE 'POT-' || ym || '-%';
  NEW.reference_code := 'POT-' || ym || '-' || LPAD(n::TEXT, 3, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_payouts_autocode ON payouts;
CREATE TRIGGER trg_payouts_autocode BEFORE INSERT ON payouts
  FOR EACH ROW WHEN (NEW.reference_code IS NULL OR NEW.reference_code = '')
  EXECUTE FUNCTION fn_autocode_payouts();

-- =============================================
-- Verify
-- =============================================
SELECT '✅ Auto-code triggers deployed' AS status;
