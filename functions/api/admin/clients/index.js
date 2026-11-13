// GET  /api/admin/clients            — all clients with file / user counts
// POST /api/admin/clients {code, name} — create a client
import { json, err, CLIENT_CODE_RE } from "../../../_lib/util.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT c.code, c.name, c.is_active, c.created_at,
            (SELECT COUNT(*) FROM files f WHERE f.client_code = c.code AND f.is_deleted = 0) AS file_count
       FROM clients c ORDER BY c.is_active DESC, c.name`
  ).all();
  return json({ ok: true, clients: results });
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }
  const code = String(b.code || "").trim().toUpperCase();
  const name = String(b.name || "").trim();
  if (!CLIENT_CODE_RE.test(code)) return err("Client code: 2–20 chars, A–Z 0–9 _ - only (e.g. DONALDSON)");
  if (!name) return err("Client name is required");

  const exists = await env.DB.prepare("SELECT 1 FROM clients WHERE code = ?").bind(code).first();
  if (exists) return err(`Client code ${code} already exists`);

  await env.DB.prepare("INSERT INTO clients (code, name) VALUES (?, ?)").bind(code, name).run();
  return json({ ok: true, code });
}
