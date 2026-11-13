// GET  /api/admin/sites                       — all sites with file counts
// POST /api/admin/sites {code, name, clients} — create a site
import { json, err, CLIENT_CODE_RE, normalizeClients } from "../../../_lib/util.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT s.code, s.name, s.clients, s.is_active, s.created_at,
            (SELECT COUNT(*) FROM files f WHERE f.site_code = s.code AND f.is_deleted = 0) AS file_count
       FROM sites s ORDER BY s.is_active DESC, s.name`
  ).all();
  return json({ ok: true, sites: results });
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }
  const code = String(b.code || "").trim().toUpperCase();
  const name = String(b.name || "").trim();
  const clients = normalizeClients(b.clients ?? ["*"]);
  if (!CLIENT_CODE_RE.test(code)) return err("Site code: 2–20 chars, A–Z 0–9 _ - only (e.g. BIYAGAMA)");
  if (!name) return err("Site name is required");
  if (!clients) return err("Select at least one client for this site (or All clients)");
  const exists = await env.DB.prepare("SELECT 1 FROM sites WHERE code = ?").bind(code).first();
  if (exists) return err(`Site code ${code} already exists`);
  await env.DB.prepare("INSERT INTO sites (code, name, clients) VALUES (?, ?, ?)").bind(code, name, clients).run();
  return json({ ok: true, code });
}
