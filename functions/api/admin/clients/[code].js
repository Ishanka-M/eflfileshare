// PATCH /api/admin/clients/:code {name?, is_active?}
// (code is permanent — it is used in file paths and user permissions)
import { json, err } from "../../../_lib/util.js";

export async function onRequestPatch({ request, env, params }) {
  const code = String(params.code || "").toUpperCase();
  const c = await env.DB.prepare("SELECT code FROM clients WHERE code = ?").bind(code).first();
  if (!c) return err("Client not found", 404);

  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }

  const sets = [], binds = [];
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n) return err("Client name cannot be empty");
    sets.push("name = ?"); binds.push(n);
  }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); binds.push(b.is_active ? 1 : 0); }
  if (!sets.length) return err("Nothing to update");

  await env.DB.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE code = ?`).bind(...binds, code).run();
  return json({ ok: true });
}
