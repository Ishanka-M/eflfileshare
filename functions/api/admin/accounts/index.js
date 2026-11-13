// GET  /api/admin/accounts  — every user with their access (upload / download / both)
// POST /api/admin/accounts  {username, full_name, password, access, channels[], clients[], sites[]}
import { json, err, hashPassword, USER_TABLE, normalizeChannels, normalizeClients, normalizeSites } from "../../../_lib/util.js";
import { NOT_ARCHIVED, ACCESS_TYPES, findRow } from "../../../_lib/accounts.js";

export async function onRequestGet({ env }) {
  const [up, dn] = await Promise.all([
    env.DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM files f WHERE f.uploaded_by = t.id AND f.is_deleted = 0) AS files_sent
                      FROM uploaders t WHERE t.${NOT_ARCHIVED}`).all(),
    env.DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM download_log d WHERE d.downloader_id = t.id) AS downloads
                      FROM downloaders t WHERE t.${NOT_ARCHIVED}`).all(),
  ]);

  const map = new Map();
  const put = (row, type) => {
    const key = row.username.toLowerCase();
    const a = map.get(key) || {
      username: row.username, full_name: row.full_name, channels: row.channels, clients: row.clients, sites: row.sites,
      is_active: 1, created_at: row.created_at, last_login_at: null, upload: false, download: false, files_sent: 0, downloads: 0,
    };
    a[type === "uploader" ? "upload" : "download"] = true;
    a.is_active = a.is_active && row.is_active ? 1 : 0;
    if (row.last_login_at && (!a.last_login_at || row.last_login_at > a.last_login_at)) a.last_login_at = row.last_login_at;
    if (type === "uploader") a.files_sent = row.files_sent; else a.downloads = row.downloads;
    map.set(key, a);
  };
  up.results.forEach((r) => put(r, "uploader"));      // uploader row wins for shared fields
  dn.results.forEach((r) => put(r, "downloader"));

  const accounts = [...map.values()].map((a) => ({ ...a, access: a.upload && a.download ? "both" : a.upload ? "upload" : "download" }))
    .sort((x, y) => (y.is_active - x.is_active) || x.full_name.localeCompare(y.full_name));
  return json({ ok: true, accounts });
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }

  const username = String(b.username || "").trim().toLowerCase();
  const full_name = String(b.full_name || "").trim();
  const password = String(b.password || "");
  const types = ACCESS_TYPES[b.access];
  const channels = normalizeChannels(b.channels);
  const clients = normalizeClients(b.clients);
  const sites = normalizeSites(b.sites);

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return err("Username: 3–32 chars, letters/numbers/. _ - only");
  if (!full_name) return err("Full name is required");
  if (password.length < 8) return err("Password must be at least 8 characters");
  if (!types) return err("Choose access: Upload, Download or Both");
  if (!channels) return err("Select at least one channel (Inbound / Outbound)");
  if (!sites) return err("Select at least one site (or All sites)");
  if (!clients) return err("Select at least one client (or All clients)");

  if ((await findRow(env, "uploader", username)) || (await findRow(env, "downloader", username)))
    return err(`Username "${username}" already exists`);

  const hash = await hashPassword(password);
  await env.DB.batch(types.map((t) => env.DB.prepare(
    `INSERT INTO ${USER_TABLE[t]} (username, full_name, password_hash, channels, clients, sites) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(username, full_name, hash, channels, clients, sites)));

  return json({ ok: true, username });
}
