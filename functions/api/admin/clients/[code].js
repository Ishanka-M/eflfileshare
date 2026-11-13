// PATCH  /api/admin/clients/:code {name?, is_active?}
// DELETE /api/admin/clients/:code  — only when the client has no files
// (code is permanent — it is used in file paths and user permissions)
import { json, err, stripCodeStatements } from "../../../_lib/util.js";

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

export async function onRequestDelete({ env, params }) {
  const code = String(params.code || "").toUpperCase();
  const c = await env.DB.prepare("SELECT code FROM clients WHERE code = ?").bind(code).first();
  if (!c) return err("Client not found", 404);

  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE client_code = ? AND is_deleted = 0").bind(code).first();
  if (live.n > 0)
    return err(`Client ${code} still has ${live.n} file(s). Delete them first (All files → filter by this client), or just untick "Active" to hide the client.`, 409);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM download_log WHERE file_id IN (SELECT id FROM files WHERE client_code = ?)").bind(code),
    env.DB.prepare("DELETE FROM files WHERE client_code = ?").bind(code),
    ...(await stripCodeStatements(env, "uploaders", "clients", code)),
    ...(await stripCodeStatements(env, "downloaders", "clients", code)),
    ...(await stripCodeStatements(env, "sites", "clients", code)),
    env.DB.prepare("DELETE FROM clients WHERE code = ?").bind(code),
  ]);
  return json({ ok: true });
}
