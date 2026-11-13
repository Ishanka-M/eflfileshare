// PATCH  /api/admin/sites/:code {name?, clients?, is_active?}   (code is permanent)
// DELETE /api/admin/sites/:code  — only when the site has no files
import { json, err, normalizeClients, stripCodeStatements } from "../../../_lib/util.js";

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

export async function onRequestDelete({ env, params }) {
  const code = String(params.code || "").toUpperCase();
  const s = await env.DB.prepare("SELECT code FROM sites WHERE code = ?").bind(code).first();
  if (!s) return err("Site not found", 404);

  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE site_code = ? AND is_deleted = 0").bind(code).first();
  if (live.n > 0)
    return err(`Site ${code} still has ${live.n} file(s). Delete them first (All files → filter by this site), or just untick "Active" to hide the site.`, 409);

  // already-deleted file records (and their download history) go too, so the site row can be removed
  await env.DB.batch([
    env.DB.prepare("DELETE FROM download_log WHERE file_id IN (SELECT id FROM files WHERE site_code = ?)").bind(code),
    env.DB.prepare("DELETE FROM files WHERE site_code = ?").bind(code),
    ...(await stripCodeStatements(env, "uploaders", "sites", code)),
    ...(await stripCodeStatements(env, "downloaders", "sites", code)),
    env.DB.prepare("DELETE FROM sites WHERE code = ?").bind(code),
  ]);
  return json({ ok: true });
}
