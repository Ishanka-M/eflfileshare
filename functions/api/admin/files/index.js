// GET /api/admin/files?site=&client=&channel=&days=  — every file with uploader + download stats
import { json } from "../../../_lib/util.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  const client = String(url.searchParams.get("client") || "").trim().toUpperCase();
  const site = String(url.searchParams.get("site") || "").trim().toUpperCase();
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 365);

  let sql = `SELECT f.id, f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name, f.channel, f.original_name, f.size_bytes, f.note, f.uploaded_at,
                    u.full_name AS uploaded_by,
                    (SELECT COUNT(*) FROM download_log d WHERE d.file_id = f.id) AS download_count,
                    (SELECT GROUP_CONCAT(name, ', ') FROM (
                        SELECT DISTINCT dl.full_name AS name FROM download_log d
                          JOIN downloaders dl ON dl.id = d.downloader_id WHERE d.file_id = f.id)) AS downloaded_by
               FROM files f JOIN uploaders u ON u.id = f.uploaded_by
               LEFT JOIN clients c ON c.code = f.client_code
               LEFT JOIN sites s ON s.code = f.site_code
              WHERE f.is_deleted = 0 AND f.uploaded_at >= datetime('now', ?)`;
  const binds = [`-${days} days`];
  if (site) { sql += " AND f.site_code = ?"; binds.push(site); }
  if (client) { sql += " AND f.client_code = ?"; binds.push(client); }
  if (channel === "inbound" || channel === "outbound") { sql += " AND f.channel = ?"; binds.push(channel); }
  sql += " ORDER BY f.uploaded_at DESC LIMIT 1000";

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ ok: true, files: results });
}
