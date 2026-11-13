// PATCH /api/admin/users/:type/:id  {full_name?, password?, channels?, clients?, is_active?}
import { json, err, hashPassword, USER_TABLE, normalizeChannels, normalizeClients, normalizeSites } from "../../../../_lib/util.js";

export async function onRequestPatch({ request, env, params }) {
  const table = USER_TABLE[params.type];
  if (!table) return err("type must be uploader or downloader");
  const id = Number(params.id);

  const user = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first();
  if (!user) return err("User not found", 404);

  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }

  const sets = [], binds = [];
  if (b.full_name !== undefined) {
    const n = String(b.full_name).trim();
    if (!n) return err("Full name cannot be empty");
    sets.push("full_name = ?"); binds.push(n);
  }
  if (b.password !== undefined) {
    if (String(b.password).length < 8) return err("Password must be at least 8 characters");
    sets.push("password_hash = ?"); binds.push(await hashPassword(String(b.password)));
  }
  if (b.channels !== undefined) {
    const c = normalizeChannels(b.channels);
    if (!c) return err("Select at least one channel");
    sets.push("channels = ?"); binds.push(c);
  }
  if (b.clients !== undefined) {
    const c = normalizeClients(b.clients);
    if (!c) return err("Select at least one client (or All clients)");
    sets.push("clients = ?"); binds.push(c);
  }
  if (b.sites !== undefined) {
    const c = normalizeSites(b.sites);
    if (!c) return err("Select at least one site (or All sites)");
    sets.push("sites = ?"); binds.push(c);
  }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); binds.push(b.is_active ? 1 : 0); }
  if (!sets.length) return err("Nothing to update");

  const stmts = [env.DB.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id)];
  // Disabling a user or changing their password logs them out everywhere
  if (b.is_active === false || b.password !== undefined) {
    stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_type = ? AND user_id = ?").bind(params.type, id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}
