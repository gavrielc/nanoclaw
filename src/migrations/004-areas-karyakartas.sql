-- ============================================================
-- 004-areas-karyakartas.sql — Areas, Karyakartas, Validations
-- ============================================================

-- Areas (slug-based PK)
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  name_mr TEXT,
  name_hi TEXT,
  type TEXT NOT NULL DEFAULT 'custom',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Karyakartas (linked to users)
CREATE TABLE IF NOT EXISTS karyakartas (
  phone TEXT PRIMARY KEY,
  is_active INTEGER DEFAULT 1,
  onboarded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (phone) REFERENCES users(phone)
);

-- Many-to-many: karyakarta <-> area
CREATE TABLE IF NOT EXISTS karyakarta_areas (
  karyakarta_phone TEXT NOT NULL,
  area_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT,
  PRIMARY KEY (karyakarta_phone, area_id),
  FOREIGN KEY (karyakarta_phone) REFERENCES karyakartas(phone),
  FOREIGN KEY (area_id) REFERENCES areas(id)
);

-- Complaint validations
CREATE TABLE IF NOT EXISTS complaint_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id TEXT NOT NULL,
  validated_by TEXT,
  action TEXT NOT NULL,
  reason_code TEXT,
  comment TEXT,
  ai_suggested_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id),
  FOREIGN KEY (validated_by) REFERENCES users(phone)
);

-- Add area_id to complaints
ALTER TABLE complaints ADD COLUMN area_id TEXT REFERENCES areas(id);
