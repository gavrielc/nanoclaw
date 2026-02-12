-- ============================================================
-- 003-user-role-temp-block.sql — Add role and blocked_until to users
-- ============================================================

-- User role: user, karyakarta, admin, superadmin
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- Temporary block expiry (ISO timestamp). NULL = not temp-blocked.
ALTER TABLE users ADD COLUMN blocked_until TEXT;
