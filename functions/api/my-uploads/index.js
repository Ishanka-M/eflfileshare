// GET /api/my-uploads  (uploader) — the uploader's own recent files + whether they've been downloaded
import { json } from "../../_lib/util.js";

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name, f.channel, f.original_name, f.size_bytes, f.note, f.uploaded_at,
            (SELECT COUNT(*) FROM download_log d WHERE d.file_id = f.id) AS download_count,
            (SELECT MAX(downloaded_at) FROM download_log d WHERE d.file_id = f.id) AS last_downloaded_at
       FROM files f LEFT JOIN clients c ON c.code = f.client_code LEFT JOIN sites s ON s.code = f.site_code
      WHERE f.uploaded_by = ? AND f.is_deleted = 0
      ORDER BY f.uploaded_at DESC
      LIMIT 200`
  ).bind(data.user.id).all();
  return json({ ok: true, files: results });
}
