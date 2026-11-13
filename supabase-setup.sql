-- ════════════════════════════════════════════════════════════════
--  EFL File Share — Supabase setup
--  Supabase Dashboard → SQL Editor → New query → paste ALL of this → Run
--  (safe to run again)
-- ════════════════════════════════════════════════════════════════

-- Clients (Donaldson, VIP, Hafele ...) — files are separated per client
create table if not exists clients (
  code        text primary key,                    -- DONALDSON, VIP, HAFELE ...
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- User base 1: Uploaders (send files)
create table if not exists uploaders (
  id             bigint generated always as identity primary key,
  username       text not null unique,             -- stored lower-case
  full_name      text not null,
  password_hash  text not null,
  channels       text not null default 'inbound,outbound',
  clients        text not null default '',          -- 'DONALDSON,VIP' or '*' = all
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- User base 2: Downloaders (receive files)
create table if not exists downloaders (
  id             bigint generated always as identity primary key,
  username       text not null unique,
  full_name      text not null,
  password_hash  text not null,
  channels       text not null default 'inbound,outbound',
  clients        text not null default '',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

create table if not exists sessions (
  token_hash  text primary key,
  user_type   text not null check (user_type in ('uploader','downloader','admin')),
  user_id     bigint not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sessions_expiry on sessions(expires_at);

create table if not exists files (
  id             uuid primary key,
  client_code    text not null references clients(code),
  channel        text not null check (channel in ('inbound','outbound')),
  original_name  text not null,
  storage_path   text not null unique,
  content_type   text,
  size_bytes     integer not null,
  note           text,
  uploaded_by    bigint not null references uploaders(id),
  uploaded_at    timestamptz not null default now(),
  is_complete    boolean not null default false,    -- true once the browser upload is confirmed
  is_deleted     boolean not null default false
);
create index if not exists idx_files_list on files(client_code, channel, uploaded_at desc) where is_complete and not is_deleted;

create table if not exists download_log (
  id             bigint generated always as identity primary key,
  file_id        uuid not null references files(id),
  downloader_id  bigint not null references downloaders(id),
  downloaded_at  timestamptz not null default now()
);
create index if not exists idx_dl_file on download_log(file_id);
create index if not exists idx_dl_user on download_log(downloader_id, file_id);

-- ===== Sites (warehouses) — files are organised Site → Client → Inbound/Outbound =====
create table if not exists sites (
  code        text primary key,                    -- e.g. BIYAGAMA, KATUNAYAKE
  name        text not null,
  clients     text not null default '*',           -- clients handled at this site: 'DONALDSON,VIP' or '*' = all
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into sites (code, name) values ('MAIN', 'Main Warehouse') on conflict (code) do nothing;

-- upgrade-safe: adds the site columns if this DB was created before sites existed
alter table uploaders   add column if not exists sites text not null default '*';   -- 'BIYAGAMA,...' or '*'
alter table downloaders add column if not exists sites text not null default '*';
alter table files       add column if not exists site_code text not null default 'MAIN' references sites(code);
create index if not exists idx_files_site on files(site_code, client_code, channel, uploaded_at desc) where is_complete and not is_deleted;

-- 🔒 Lock tables: only our server (direct DB connection) can read/write.
--    RLS on + no policies = Supabase public API keys get nothing.
alter table clients      enable row level security;
alter table uploaders    enable row level security;
alter table downloaders  enable row level security;
alter table sessions     enable row level security;
alter table files        enable row level security;
alter table download_log enable row level security;
alter table sites        enable row level security;

-- 🔒 Private storage bucket for the Excel files (25 MB per file)
insert into storage.buckets (id, name, public, file_size_limit)
values ('efl-files', 'efl-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- (Optional) add your clients right away — or do it later in the Admin page
insert into clients (code, name) values
  ('DONALDSON', 'Donaldson'),
  ('VIP',       'VIP Industries'),
  ('HAFELE',    'Häfele India'),
  ('HELENK',    'Helen Kaminski')
on conflict (code) do nothing;
