// PATCH /api/admin/sites/:code {name?, clients?, is_active?}   (code is permanent)
import { json, err, normalizeClients } from "../../../_lib/util.js";

export async function onRequestPatch({ request, env, params }) {
  const code = String(params.code || "").toUpperCase();
  const s = await env.DB.prepare("SELECT code FROM sites WHERE code = ?").bind(code).first();
  if (!s) return err("Site not found", 404);

  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }

  const sets = [], binds = [];
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n) return err("Site name cannot be empty");
    sets.push("name = ?"); binds.push(n);
  }
  if (b.clients !== undefined) {
    const c = normalizeClients(b.clients);
    if (!c) return err("Select at least one client for this site");
    sets.push("clients = ?"); binds.push(c);
  }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); binds.push(b.is_active ? 1 : 0); }
  if (!sets.length) return err("Nothing to update");

  await env.DB.prepare(`UPDATE sites SET ${sets.join(", ")} WHERE code = ?`).bind(...binds, code).run();
  return json({ ok: true });
}
