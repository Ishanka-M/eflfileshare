// DELETE /api/my-uploads/:id  (uploader) — remove a file you uploaded by mistake
import { json, err } from "../../_lib/util.js";

export async function onRequestDelete({ env, data, params }) {
  const f = await env.DB.prepare("SELECT id, r2_key FROM files WHERE id = ? AND uploaded_by = ? AND is_deleted = 0")
    .bind(params.id, data.user.id).first();
  if (!f) return err("File not found", 404);

  await env.FILES.delete(f.r2_key);
  await env.DB.prepare("UPDATE files SET is_deleted = 1 WHERE id = ?").bind(f.id).run();
  return json({ ok: true });
}
