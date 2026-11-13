-- Only needed if you ALREADY ran an older schema.sql (before Sites existed).
-- Fresh install? Just run schema.sql — skip this file.
-- Run in: Cloudflare Dashboard → D1 → efl-fileshare-db → Console

CREATE TABLE IF NOT EXISTS sites (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  clients    TEXT NOT NULL DEFAULT '*',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sites (code, name) VALUES ('MAIN', 'Main Warehouse');

ALTER TABLE uploaders   ADD COLUMN sites TEXT NOT NULL DEFAULT '*';   -- existing users keep full access
ALTER TABLE downloaders ADD COLUMN sites TEXT NOT NULL DEFAULT '*';
ALTER TABLE files       ADD COLUMN site_code TEXT NOT NULL DEFAULT 'MAIN';   -- existing files → MAIN site

CREATE INDEX IF NOT EXISTS idx_files_site ON files(site_code, client_code, channel, is_deleted, uploaded_at DESC);
