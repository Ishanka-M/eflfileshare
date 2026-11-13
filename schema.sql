-- EFL File Share — D1 schema
-- Run once: Cloudflare Dashboard → D1 → efl-fileshare-db → Console → paste this → Execute
--   (or CLI:  npx wrangler d1 execute efl-fileshare-db --remote --file=schema.sql)

-- ===== Clients (Donaldson, VIP, Hafele ...) — files are separated per client =====
CREATE TABLE IF NOT EXISTS clients (
  code       TEXT PRIMARY KEY,               -- short code, e.g. DONALDSON, VIP, HAFELE
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Sites (warehouses) — files are organised Site → Client → Inbound/Outbound =====
CREATE TABLE IF NOT EXISTS sites (
  code       TEXT PRIMARY KEY,               -- e.g. BIYAGAMA, KATUNAYAKE
  name       TEXT NOT NULL,
  clients    TEXT NOT NULL DEFAULT '*',      -- clients handled at this site: 'DONALDSON,VIP' or * = all
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== User base 1: Uploaders (people who send files) =====
CREATE TABLE IF NOT EXISTS uploaders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  channels      TEXT NOT NULL DEFAULT 'inbound,outbound',  -- comma list: inbound / outbound
  clients       TEXT NOT NULL DEFAULT '',                  -- comma list of client codes, or * = all clients
  sites         TEXT NOT NULL DEFAULT '',                  -- comma list of site codes, or * = all sites
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- ===== User base 2: Downloaders (people who receive files) =====
CREATE TABLE IF NOT EXISTS downloaders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  channels      TEXT NOT NULL DEFAULT 'inbound,outbound',
  clients       TEXT NOT NULL DEFAULT '',
  sites         TEXT NOT NULL DEFAULT '',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Sessions for all three portals (uploader / downloader / admin)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_type   TEXT NOT NULL CHECK (user_type IN ('uploader','downloader','admin')),
  user_id     INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- File metadata (actual bytes live in R2)
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,                -- uuid
  site_code     TEXT NOT NULL REFERENCES sites(code),
  client_code   TEXT NOT NULL REFERENCES clients(code),
  channel       TEXT NOT NULL CHECK (channel IN ('inbound','outbound')),
  original_name TEXT NOT NULL,
  r2_key        TEXT NOT NULL UNIQUE,
  content_type  TEXT,
  size_bytes    INTEGER NOT NULL,
  note          TEXT,
  uploaded_by   INTEGER NOT NULL REFERENCES uploaders(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_channel ON files(channel, is_deleted, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_client ON files(client_code, channel, is_deleted, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_site ON files(site_code, client_code, channel, is_deleted, uploaded_at DESC);

-- Who downloaded what, when
CREATE TABLE IF NOT EXISTS download_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id        TEXT NOT NULL REFERENCES files(id),
  downloader_id  INTEGER NOT NULL REFERENCES downloaders(id),
  downloaded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dl_file ON download_log(file_id);
CREATE INDEX IF NOT EXISTS idx_dl_user ON download_log(downloader_id, file_id);

-- ===== Starter data (edit later in the Admin page) =====
INSERT OR IGNORE INTO clients (code, name) VALUES
  ('DONALDSON', 'Donaldson'),
  ('VIP',       'VIP Industries'),
  ('HAFELE',    'Häfele India'),
  ('HELENK',    'Helen Kaminski');
INSERT OR IGNORE INTO sites (code, name) VALUES ('MAIN', 'Main Warehouse');
