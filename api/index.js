// Single Vercel Function that serves every /api/* route (see vercel.json rewrite).
import {
  json, err, verifyPassword, hashPassword, timingSafeEqual, randomToken, sha256Hex,
  COOKIE, getCookie, sessionCookie, clearCookie, USER_TABLE, parseChannels, normalizeChannels,
  parseClients, normalizeClients, canClient, clientFilter, CLIENT_CODE_RE, safeName,
  parseSites, normalizeSites, canSite, siteFilter, siteHasClient,
} from "../lib/util.js";
import { all, first, run, transaction } from "../lib/db.js";
import { signedUploadUrl, objectInfo, signedDownloadUrl, removeObject } from "../lib/storage.js";

export const config = { maxDuration: 30 };

const env = (k, d) => process.env[k] ?? d;
const MAX_MB = () => Number(env("MAX_FILE_MB", 25));
const ALLOWED = () => String(env("ALLOWED_EXT", "xlsx,xls,xlsm,csv")).split(",").map((s) => s.trim().toLowerCase());
const SESSION_HOURS = () => Number(env("SESSION_HOURS", 12));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};
const readJson = async (req) => { try { return await req.json(); } catch { return null; } };
const isSecure = (url, req) => url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

// ───────────────────────── routes ─────────────────────────
// [method, path pattern, required portal (null = public), handler]
const ROUTES = [
  ["POST",   "auth/login",               null,         login],
  ["POST",   "auth/logout",              null,         logout],
  ["GET",    "auth/me",                  null,         me],

  ["POST",   "upload/start",             "uploader",   uploadStart],
  ["POST",   "upload/complete",          "uploader",   uploadComplete],
  ["GET",    "my-uploads",               "uploader",   myUploads],
  ["DELETE", "my-uploads/:id",           "uploader",   myUploadDelete],

  ["GET",    "files",                    "downloader", listFiles],
  ["GET",    "files/:id/download",       "downloader", download],

  ["GET",    "admin/sites",              "admin",      adminSites],
  ["POST",   "admin/sites",              "admin",      adminSiteCreate],
  ["PATCH",  "admin/sites/:code",        "admin",      adminSiteUpdate],
  ["GET",    "admin/clients",            "admin",      adminClients],
  ["POST",   "admin/clients",            "admin",      adminClientCreate],
  ["PATCH",  "admin/clients/:code",      "admin",      adminClientUpdate],
  ["GET",    "admin/users",              "admin",      adminUsers],
  ["POST",   "admin/users",              "admin",      adminUserCreate],
  ["PATCH",  "admin/users/:type/:id",    "admin",      adminUserUpdate],
  ["GET",    "admin/files",              "admin",      adminFiles],
  ["DELETE", "admin/files/:id",          "admin",      adminFileDelete],
];

function match(pattern, path) {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function handle(request) {
  const url = new URL(request.url);
  const path = (url.searchParams.get("__path") ?? url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");

  // CSRF guard: state-changing requests must come from our own site
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return err("Bad origin", 403);
  }

  let route, params;
  for (const r of ROUTES) {
    if (r[0] !== request.method) continue;
    params = match(r[1], path);
    if (params) { route = r; break; }
  }
  if (!route) return err("Not found", 404);

  try {
    const user = await resolveUser(request);
    if (route[2]) {
      if (!user) return err("Please log in", 401);
      if (user.type !== route[2]) return err(`This area is for ${route[2]}s only`, 403);
    }
    return await route[3]({ request, url, params, user });
  } catch (e) {
    console.error(e);
    return err("Server error: " + (e?.message || "unknown"), 500);
  }
}

export const GET = handle, POST = handle, PATCH = handle, DELETE = handle;

async function resolveUser(request) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const s = await first("SELECT user_type, user_id FROM sessions WHERE token_hash = ? AND expires_at > now()", [await sha256Hex(token)]);
  if (!s) return null;
  if (s.user_type === "admin")
    return { type: "admin", id: 0, username: "admin", full_name: "Administrator", channels: ["inbound", "outbound"], clients: ["*"], sites: ["*"] };
  const u = await first(`SELECT id, username, full_name, channels, clients, sites, is_active FROM ${USER_TABLE[s.user_type]} WHERE id = ?`, [s.user_id]);
  if (!u || !u.is_active) return null;
  return { type: s.user_type, id: Number(u.id), username: u.username, full_name: u.full_name,
           channels: parseChannels(u.channels), clients: parseClients(u.clients), sites: parseSites(u.sites) };
}

// ───────────────────────── auth ─────────────────────────
async function login({ request, url }) {
  const body = await readJson(request);
  if (!body) return err("Invalid request");
  const portal = String(body.portal || "");
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!["uploader", "downloader", "admin"].includes(portal)) return err("Unknown portal");
  if (!password) return err("Password required");

  let userId;
  if (portal === "admin") {
    const adminPw = env("ADMIN_PASSWORD");
    if (!adminPw) return err("ADMIN_PASSWORD env variable is not set on the server", 500);
    if (username.toLowerCase() !== "admin" || !timingSafeEqual(password, adminPw)) { await sleep(600); return err("Wrong username or password", 401); }
    userId = 0;
  } else {
    const table = USER_TABLE[portal];
    const u = await first(`SELECT id, password_hash, is_active FROM ${table} WHERE lower(username) = lower(?)`, [username]);
    const ok = u && (await verifyPassword(password, u.password_hash));
    if (!ok) { await sleep(600); return err("Wrong username or password", 401); }
    if (!u.is_active) return err("This account is disabled. Contact the admin.", 403);
    userId = Number(u.id);
    await run(`UPDATE ${table} SET last_login_at = now() WHERE id = ?`, [userId]);
  }

  const hours = SESSION_HOURS();
  const token = randomToken();
  await transaction(async (tx) => {
    await run("DELETE FROM sessions WHERE expires_at <= now()", [], tx);
    await run("INSERT INTO sessions (token_hash, user_type, user_id, expires_at) VALUES (?, ?, ?, now() + make_interval(hours => ?::int))",
      [await sha256Hex(token), portal, userId, hours], tx);
  });
  return json({ ok: true, portal }, 200, { "set-cookie": sessionCookie(token, hours, isSecure(url, request)) });
}

async function logout({ request, url }) {
  const token = getCookie(request, COOKIE);
  if (token) await run("DELETE FROM sessions WHERE token_hash = ?", [await sha256Hex(token)]);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(isSecure(url, request)) });
}

async function me({ user }) {
  let clients = [], sites = [];
  if (user) {
    const rows = await all("SELECT code, name FROM clients WHERE is_active ORDER BY name");
    clients = rows.filter((c) => canClient(user, c.code)).map((c) => ({ code: c.code, name: c.name }));
    // each site the user may use + the user's clients that this site handles
    const srows = await all("SELECT code, name, clients FROM sites WHERE is_active ORDER BY name");
    sites = srows.filter((s) => canSite(user, s.code)).map((s) => ({
      code: s.code, name: s.name, clients: clients.filter((c) => siteHasClient(s.clients, c.code)).map((c) => c.code),
    }));
  }
  return json({ ok: true, user, sites, clients, limits: { maxMb: MAX_MB(), allowedExt: ALLOWED() } });
}

// ───────────────────────── upload (3 steps) ─────────────────────────
// 1) start: validate + reserve rows + hand out signed upload URLs
async function uploadStart({ request, user }) {
  const b = await readJson(request);
  if (!b) return err("Invalid request");

  const site = String(b.site || "").trim().toUpperCase();
  if (!site) return err("Select a site");
  if (!canSite(user, site)) return err(`You are not allowed to upload for site ${site}`, 403);
  const siteRow = await first("SELECT code, clients FROM sites WHERE code = ? AND is_active", [site]);
  if (!siteRow) return err(`Site ${site} does not exist or is disabled`);

  const client = String(b.client || "").trim().toUpperCase();
  if (!client) return err("Select a client");
  if (!canClient(user, client)) return err(`You are not allowed to upload for ${client}`, 403);
  if (!(await first("SELECT code FROM clients WHERE code = ? AND is_active", [client])))
    return err(`Client ${client} does not exist or is disabled`);
  if (!siteHasClient(siteRow.clients, client)) return err(`${client} is not handled at site ${site}`);

  const channel = String(b.channel || "").toLowerCase();
  if (!user.channels.includes(channel)) return err(`You are not allowed to upload to ${channel || "that channel"}`, 403);

  const note = String(b.note || "").trim().slice(0, 300) || null;
  const files = Array.isArray(b.files) ? b.files : [];
  if (!files.length) return err("No file selected");
  if (files.length > 20) return err("Maximum 20 files per upload");

  const maxBytes = MAX_MB() * 1024 * 1024, allowed = ALLOWED();
  for (const f of files) {
    const ext = (String(f.name || "").split(".").pop() || "").toLowerCase();
    if (!allowed.includes(ext)) return err(`"${f.name}" is not allowed. Allowed: ${allowed.join(", ")}`);
    if (!(f.size > 0)) return err(`"${f.name}" is empty`);
    if (f.size > maxBytes) return err(`"${f.name}" is larger than ${MAX_MB()} MB`);
  }

  // tidy up this user's abandoned (never completed) uploads
  await run("DELETE FROM files WHERE uploaded_by = ? AND NOT is_complete AND uploaded_at < now() - interval '1 day'", [user.id]);

  const now = new Date();
  const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const uploads = [];
  for (const f of files) {
    const id = crypto.randomUUID();
    const name = safeName(f.name);
    const ext = (name.split(".").pop() || "").toLowerCase();
    const path = `${site}/${client}/${channel}/${ym}/${id}.${ext}`;   // ASCII-only key; real name kept in DB
    const signed = await signedUploadUrl(path);
    await run(`INSERT INTO files (id, site_code, client_code, channel, original_name, storage_path, content_type, size_bytes, note, uploaded_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, site, client, channel, name, path, MIME[ext] || "application/octet-stream", Math.round(f.size), note, user.id]);
    uploads.push({ id, name, signedUrl: signed.signedUrl, contentType: MIME[ext] || "application/octet-stream" });
  }
  return json({ ok: true, site, client, channel, uploads });
}

// 3) complete: confirm each object really landed in storage, then publish it
async function uploadComplete({ request, user }) {
  const b = await readJson(request);
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x) => UUID_RE.test(String(x)));
  if (!ids.length) return err("Nothing to complete");

  const done = [], failed = [];
  let site, client, channel;
  for (const id of ids) {
    const f = await first("SELECT id, site_code, client_code, channel, original_name, storage_path, size_bytes FROM files WHERE id = ? AND uploaded_by = ? AND NOT is_complete AND NOT is_deleted", [id, user.id]);
    if (!f) { failed.push({ id, error: "not found" }); continue; }
    const info = await objectInfo(f.storage_path);
    if (!info) { await run("DELETE FROM files WHERE id = ?", [id]); failed.push({ id, name: f.original_name, error: "upload did not reach storage" }); continue; }
    const size = Number(info.size ?? f.size_bytes);
    if (size > MAX_MB() * 1024 * 1024) {
      await removeObject(f.storage_path); await run("DELETE FROM files WHERE id = ?", [id]);
      failed.push({ id, name: f.original_name, error: "too large" }); continue;
    }
    await run("UPDATE files SET is_complete = true, size_bytes = ?, uploaded_at = now() WHERE id = ?", [size, id]);
    site = f.site_code; client = f.client_code; channel = f.channel;
    done.push({ id, name: f.original_name, size });
  }
  if (!done.length) return err(`Upload failed: ${failed.map((x) => x.name || x.id).join(", ")}`);
  return json({ ok: true, site, client, channel, files: done, failed });
}

async function myUploads({ user }) {
  const files = await all(
    `SELECT f.id, f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name, f.channel, f.original_name, f.size_bytes, f.note, f.uploaded_at,
            (SELECT COUNT(*)::int FROM download_log d WHERE d.file_id = f.id) AS download_count,
            (SELECT MAX(downloaded_at) FROM download_log d WHERE d.file_id = f.id) AS last_downloaded_at
       FROM files f LEFT JOIN clients c ON c.code = f.client_code LEFT JOIN sites s ON s.code = f.site_code
      WHERE f.uploaded_by = ? AND f.is_complete AND NOT f.is_deleted
      ORDER BY f.uploaded_at DESC LIMIT 200`, [user.id]);
  return json({ ok: true, files });
}

async function myUploadDelete({ params, user }) {
  if (!UUID_RE.test(params.id)) return err("File not found", 404);
  const f = await first("SELECT id, storage_path FROM files WHERE id = ? AND uploaded_by = ? AND NOT is_deleted", [params.id, user.id]);
  if (!f) return err("File not found", 404);
  await removeObject(f.storage_path);
  await run("UPDATE files SET is_deleted = true WHERE id = ?", [f.id]);
  return json({ ok: true });
}

// ───────────────────────── download side ─────────────────────────
async function listFiles({ url, user }) {
  const channel = String(url.searchParams.get("channel") || "").toLowerCase();
  if (!user.channels.includes(channel)) return err(`You don't have access to ${channel || "that channel"}`, 403);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 365);
  const q = String(url.searchParams.get("q") || "").trim();
  const client = String(url.searchParams.get("client") || "").trim().toUpperCase();
  if (client && !canClient(user, client)) return err(`You don't have access to ${client}`, 403);
  const site = String(url.searchParams.get("site") || "").trim().toUpperCase();
  if (site && !canSite(user, site)) return err(`You don't have access to site ${site}`, 403);

  let sql = `SELECT f.id, f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name, f.channel, f.original_name, f.size_bytes, f.note, f.uploaded_at,
                    u.full_name AS uploaded_by,
                    (SELECT MAX(downloaded_at) FROM download_log d WHERE d.file_id = f.id AND d.downloader_id = ?) AS my_last_download,
                    (SELECT COUNT(*)::int FROM download_log d WHERE d.file_id = f.id) AS download_count
               FROM files f JOIN uploaders u ON u.id = f.uploaded_by
               LEFT JOIN clients c ON c.code = f.client_code
               LEFT JOIN sites s ON s.code = f.site_code
              WHERE f.channel = ? AND f.is_complete AND NOT f.is_deleted
                AND f.uploaded_at >= now() - make_interval(days => ?::int)`;
  const binds = [user.id, channel, days];
  if (client) { sql += " AND f.client_code = ?"; binds.push(client); }
  else { const cf = clientFilter(user); sql += cf.sql; binds.push(...cf.binds); }
  if (site) { sql += " AND f.site_code = ?"; binds.push(site); }
  else { const sf = siteFilter(user); sql += sf.sql; binds.push(...sf.binds); }
  if (q) { sql += " AND (f.original_name ILIKE ? OR f.note ILIKE ? OR u.full_name ILIKE ?)"; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += " ORDER BY f.uploaded_at DESC LIMIT 500";
  return json({ ok: true, channel, files: await all(sql, binds) });
}

async function download({ params, user }) {
  if (!UUID_RE.test(params.id)) return err("File not found", 404);
  const f = await first("SELECT id, site_code, client_code, channel, original_name, storage_path FROM files WHERE id = ? AND is_complete AND NOT is_deleted", [params.id]);
  if (!f) return err("File not found", 404);
  if (!user.channels.includes(f.channel) || !canClient(user, f.client_code) || !canSite(user, f.site_code)) return err("You don't have access to this file", 403);

  const link = await signedDownloadUrl(f.storage_path, f.original_name, 60);   // valid 60 s only
  await run("INSERT INTO download_log (file_id, downloader_id) VALUES (?, ?)", [f.id, user.id]);
  return new Response(null, { status: 302, headers: { location: link, "cache-control": "no-store" } });
}

// ───────────────────────── admin: sites ─────────────────────────
async function adminSites() {
  const sites = await all(
    `SELECT s.code, s.name, s.clients, s.is_active, s.created_at,
            (SELECT COUNT(*)::int FROM files f WHERE f.site_code = s.code AND f.is_complete AND NOT f.is_deleted) AS file_count
       FROM sites s ORDER BY s.is_active DESC, s.name`);
  return json({ ok: true, sites });
}

async function adminSiteCreate({ request }) {
  const b = await readJson(request);
  if (!b) return err("Invalid request");
  const code = String(b.code || "").trim().toUpperCase();
  const name = String(b.name || "").trim();
  const clients = normalizeClients(b.clients ?? ["*"]);
  if (!CLIENT_CODE_RE.test(code)) return err("Site code: 2–20 chars, A–Z 0–9 _ - only (e.g. BIYAGAMA)");
  if (!name) return err("Site name is required");
  if (!clients) return err("Select at least one client for this site (or All clients)");
  if (await first("SELECT 1 FROM sites WHERE code = ?", [code])) return err(`Site code ${code} already exists`);
  await run("INSERT INTO sites (code, name, clients) VALUES (?, ?, ?)", [code, name, clients]);
  return json({ ok: true, code });
}

async function adminSiteUpdate({ request, params }) {
  const code = String(params.code || "").toUpperCase();
  if (!(await first("SELECT code FROM sites WHERE code = ?", [code]))) return err("Site not found", 404);
  const b = await readJson(request);
  if (!b) return err("Invalid request");
  const sets = [], binds = [];
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return err("Site name cannot be empty"); sets.push("name = ?"); binds.push(n); }
  if (b.clients !== undefined) { const c = normalizeClients(b.clients); if (!c) return err("Select at least one client for this site"); sets.push("clients = ?"); binds.push(c); }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); binds.push(!!b.is_active); }
  if (!sets.length) return err("Nothing to update");
  await run(`UPDATE sites SET ${sets.join(", ")} WHERE code = ?`, [...binds, code]);
  return json({ ok: true });
}

// ───────────────────────── admin: clients ─────────────────────────
async function adminClients() {
  const clients = await all(
    `SELECT c.code, c.name, c.is_active, c.created_at,
            (SELECT COUNT(*)::int FROM files f WHERE f.client_code = c.code AND f.is_complete AND NOT f.is_deleted) AS file_count
       FROM clients c ORDER BY c.is_active DESC, c.name`);
  return json({ ok: true, clients });
}

async function adminClientCreate({ request }) {
  const b = await readJson(request);
  if (!b) return err("Invalid request");
  const code = String(b.code || "").trim().toUpperCase();
  const name = String(b.name || "").trim();
  if (!CLIENT_CODE_RE.test(code)) return err("Client code: 2–20 chars, A–Z 0–9 _ - only (e.g. DONALDSON)");
  if (!name) return err("Client name is required");
  if (await first("SELECT 1 FROM clients WHERE code = ?", [code])) return err(`Client code ${code} already exists`);
  await run("INSERT INTO clients (code, name) VALUES (?, ?)", [code, name]);
  return json({ ok: true, code });
}

async function adminClientUpdate({ request, params }) {
  const code = String(params.code || "").toUpperCase();
  if (!(await first("SELECT code FROM clients WHERE code = ?", [code]))) return err("Client not found", 404);
  const b = await readJson(request);
  if (!b) return err("Invalid request");
  const sets = [], binds = [];
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return err("Client name cannot be empty"); sets.push("name = ?"); binds.push(n); }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); binds.push(!!b.is_active); }
  if (!sets.length) return err("Nothing to update");
  await run(`UPDATE clients SET ${sets.join(", ")} WHERE code = ?`, [...binds, code]);
  return json({ ok: true });
}

// ───────────────────────── admin: users ─────────────────────────
async function adminUsers({ url }) {
  const type = url.searchParams.get("type");
  const table = USER_TABLE[type];
  if (!table) return err("type must be uploader or downloader");
  const extra = type === "uploader"
    ? "(SELECT COUNT(*)::int FROM files f WHERE f.uploaded_by = t.id AND f.is_complete AND NOT f.is_deleted) AS activity_count"
    : "(SELECT COUNT(*)::int FROM download_log d WHERE d.downloader_id = t.id) AS activity_count";
  const users = await all(`SELECT t.id::int AS id, t.username, t.full_name, t.channels, t.clients, t.sites, t.is_active, t.created_at, t.last_login_at, ${extra}
                             FROM ${table} t ORDER BY t.is_active DESC, t.full_name`);
  return json({ ok: true, users });
}

async function adminUserCreate({ request }) {
  const b = await readJson(request);
  if (!b) return err("Invalid request");
  const table = USER_TABLE[b.type];
  if (!table) return err("type must be uploader or downloader");
  const username = String(b.username || "").trim().toLowerCase();
  const full_name = String(b.full_name || "").trim();
  const password = String(b.password || "");
  const channels = normalizeChannels(b.channels);
  const clients = normalizeClients(b.clients);
  const sites = normalizeSites(b.sites);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return err("Username: 3–32 chars, letters/numbers/. _ - only");
  if (!full_name) return err("Full name is required");
  if (password.length < 8) return err("Password must be at least 8 characters");
  if (!channels) return err("Select at least one channel (Inbound / Outbound)");
  if (!clients) return err("Select at least one client (or All clients)");
  if (!sites) return err("Select at least one site (or All sites)");
  if (await first(`SELECT 1 FROM ${table} WHERE lower(username) = ?`, [username])) return err(`Username "${username}" already exists`);
  const row = await first(`INSERT INTO ${table} (username, full_name, password_hash, channels, clients, sites) VALUES (?, ?, ?, ?, ?, ?) RETURNING id::int AS id`,
    [username, full_name, await hashPassword(password), channels, clients, sites]);
  return json({ ok: true, id: row.id });
}

async function adminUserUpdate({ request, params }) {
  const table = USER_TABLE[params.type];
  if (!table) return err("type must be uploader or downloader");
  const id = Number(params.id);
  if (!Number.isInteger(id) || !(await first(`SELECT id FROM ${table} WHERE id = ?`, [id]))) return err("User not found", 404);
  const b = await readJson(request);
  if (!b) return err("Invalid request");

  const sets = [], binds = [];
  if (b.full_name !== undefined) { const n = String(b.full_name).trim(); if (!n) return err("Full name cannot be empty"); sets.push("full_name = ?"); binds.push(n); }
  if (b.password !== undefined) { if (String(b.password).length < 8) return err("Password must be at least 8 characters"); sets.push("password_hash = ?"); binds.push(await hashPassword(String(b.password))); }
  if (b.channels !== undefined) { const c = normalizeChannels(b.channels); if (!c) return err("Select at least one channel"); sets.push("channels = ?"); binds.push(c); }
  if (b.clients !== undefined) { const c = normalizeClients(b.clients); if (!c) return err("Select at least one client (or All clients)"); sets.push("clients = ?"); binds.push(c); }
  if (b.sites !== undefined) { const c = normalizeSites(b.sites); if (!c) return err("Select at least one site (or All sites)"); sets.push("sites = ?"); binds.push(c); }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); binds.push(!!b.is_active); }
  if (!sets.length) return err("Nothing to update");

  await transaction(async (tx) => {
    await run(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, [...binds, id], tx);
    if (b.is_active === false || b.password !== undefined)   // force logout everywhere
      await run("DELETE FROM sessions WHERE user_type = ? AND user_id = ?", [params.type, id], tx);
  });
  return json({ ok: true });
}

// ───────────────────────── admin: files ─────────────────────────
async function adminFiles({ url }) {
  const channel = url.searchParams.get("channel");
  const client = String(url.searchParams.get("client") || "").trim().toUpperCase();
  const site = String(url.searchParams.get("site") || "").trim().toUpperCase();
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 365);
  let sql = `SELECT f.id, f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name, f.channel, f.original_name, f.size_bytes, f.note, f.uploaded_at,
                    u.full_name AS uploaded_by,
                    (SELECT COUNT(*)::int FROM download_log d WHERE d.file_id = f.id) AS download_count,
                    (SELECT string_agg(DISTINCT dl.full_name, ', ') FROM download_log d
                       JOIN downloaders dl ON dl.id = d.downloader_id WHERE d.file_id = f.id) AS downloaded_by
               FROM files f JOIN uploaders u ON u.id = f.uploaded_by
               LEFT JOIN clients c ON c.code = f.client_code
               LEFT JOIN sites s ON s.code = f.site_code
              WHERE f.is_complete AND NOT f.is_deleted AND f.uploaded_at >= now() - make_interval(days => ?::int)`;
  const binds = [days];
  if (site) { sql += " AND f.site_code = ?"; binds.push(site); }
  if (client) { sql += " AND f.client_code = ?"; binds.push(client); }
  if (channel === "inbound" || channel === "outbound") { sql += " AND f.channel = ?"; binds.push(channel); }
  sql += " ORDER BY f.uploaded_at DESC LIMIT 1000";
  return json({ ok: true, files: await all(sql, binds) });
}

async function adminFileDelete({ params }) {
  if (!UUID_RE.test(params.id)) return err("File not found", 404);
  const f = await first("SELECT id, storage_path FROM files WHERE id = ? AND NOT is_deleted", [params.id]);
  if (!f) return err("File not found", 404);
  await removeObject(f.storage_path);
  await run("UPDATE files SET is_deleted = true WHERE id = ?", [f.id]);
  return json({ ok: true });
}
