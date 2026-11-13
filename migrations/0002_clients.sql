-- Only needed if you ALREADY ran the old schema.sql (before client-wise split).
-- Fresh install? Just run schema.sql — skip this file.
--   npx wrangler d1 execute efl-fileshare-db --remote --file=migrations/0002_clients.sql

CREATE TABLE IF NOT EXISTS clients (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Existing files get parked under a GENERAL client so nothing is lost
INSERT OR IGNORE INTO clients (code, name) VALUES ('GENERAL', 'General (before client split)');

ALTER TABLE uploaders   ADD COLUMN clients TEXT NOT NULL DEFAULT '*';   -- existing users keep full access
ALTER TABLE downloaders ADD COLUMN clients TEXT NOT NULL DEFAULT '*';
ALTER TABLE files       ADD COLUMN client_code TEXT NOT NULL DEFAULT 'GENERAL';

CREATE INDEX IF NOT EXISTS idx_files_client ON files(client_code, channel, is_deleted, uploaded_at DESC);
