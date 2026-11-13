// DELETE /api/admin/files/:id — admin removes any file
import { json, err } from "../../../_lib/util.js";

export async function onRequestDelete({ env, params }) {
  const f = await env.DB.prepare("SELECT id, r2_key FROM files WHERE id = ? AND is_deleted = 0").bind(params.id).first();
  if (!f) return err("File not found", 404);
  await env.FILES.delete(f.r2_key);
  await env.DB.prepare("UPDATE files SET is_deleted = 1 WHERE id = ?").bind(f.id).run();
  return json({ ok: true });
}
