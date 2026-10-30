-- Evanssion Partner Portal: database schema (Cloudflare D1). Safe to run more than once.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'partner',          -- partner | admin
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected | suspended
  pw TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                           -- SHA-256 of the cookie token
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS resets (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  t INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,                        -- sales | presales | technical | spiff
  vendor TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'file',             -- file | link
  url TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  file_name TEXT,
  file_size INTEGER,
  file_type TEXT,
  reward TEXT NOT NULL DEFAULT '',               -- SPIFF only
  starts TEXT,                                   -- SPIFF only, YYYY-MM-DD
  ends TEXT,                                     -- SPIFF only, YYYY-MM-DD
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources_cat ON resources(category, published);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL,
  customer TEXT NOT NULL,
  customer_country TEXT NOT NULL DEFAULT '',
  customer_city TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT '',
  value_usd INTEGER,
  expected_close TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted',      -- submitted | approved | rejected | info
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  protected_until TEXT                           -- set on approval (90 days)
);
CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_match ON deals(vendor, customer);
