// GET /api/files/:id/download  (downloader) — streams the file from R2 and logs the download
import { err, contentDisposition, canClient, canSite } from "../../../_lib/util.js";

export async function onRequestGet({ env, data, params }) {
  const f = await env.DB.prepare(
    "SELECT id, site_code, client_code, channel, original_name, r2_key, content_type FROM files WHERE id = ? AND is_deleted = 0"
  ).bind(params.id).first();
  if (!f) return err("File not found", 404);
  if (!data.user.channels.includes(f.channel) || !canClient(data.user, f.client_code) || !canSite(data.user, f.site_code))
    return err("You don't have access to this file", 403);

  const obj = await env.FILES.get(f.r2_key);
  if (!obj) return err("File is missing from storage", 404);

  await env.DB.prepare("INSERT INTO download_log (file_id, downloader_id) VALUES (?, ?)").bind(f.id, data.user.id).run();

  return new Response(obj.body, {
    headers: {
      "content-type": f.content_type || "application/octet-stream",
      "content-length": String(obj.size),
      "content-disposition": contentDisposition(f.original_name),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
