// GET  /api/admin/users?type=uploader|downloader   — list
// POST /api/admin/users  {type, username, full_name, password, channels[], clients[] | ["*"]}  — create
import { json, err, hashPassword, USER_TABLE, normalizeChannels, normalizeClients, normalizeSites } from "../../../_lib/util.js";

export async function onRequestGet({ request, env }) {
  const type = new URL(request.url).searchParams.get("type");
  const table = USER_TABLE[type];
  if (!table) return err("type must be uploader or downloader");

  const extra = type === "uploader"
    ? "(SELECT COUNT(*) FROM files f WHERE f.uploaded_by = t.id AND f.is_deleted = 0) AS activity_count"
    : "(SELECT COUNT(*) FROM download_log d WHERE d.downloader_id = t.id) AS activity_count";

  const { results } = await env.DB.prepare(
    `SELECT t.id, t.username, t.full_name, t.channels, t.clients, t.sites, t.is_active, t.created_at, t.last_login_at, ${extra}
       FROM ${table} t ORDER BY t.is_active DESC, t.full_name`
  ).all();
  return json({ ok: true, users: results });
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }

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

  const exists = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE username = ?`).bind(username).first();
  if (exists) return err(`Username "${username}" already exists`);

  const r = await env.DB.prepare(
    `INSERT INTO ${table} (username, full_name, password_hash, channels, clients, sites) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(username, full_name, await hashPassword(password), channels, clients, sites).run();

  return json({ ok: true, id: r.meta.last_row_id });
}
