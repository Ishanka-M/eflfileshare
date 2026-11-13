// GET /api/files?site=BIYAGAMA&client=DONALDSON&channel=inbound&days=30&q=text  (downloader; client blank = all my clients)
import { json, err, canClient, clientFilter, canSite, siteFilter } from "../../_lib/util.js";

export async function onRequestGet({ request, env, data }) {
  const url = new URL(request.url);
  const channel = String(url.searchParams.get("channel") || "").toLowerCase();
  if (!data.user.channels.includes(channel)) return err(`You don't have access to ${channel || "that channel"}`, 403);

  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 365);
  const q = String(url.searchParams.get("q") || "").trim();
  const client = String(url.searchParams.get("client") || "").trim().toUpperCase();
  if (client && !canClient(data.user, client)) return err(`You don't have access to ${client}`, 403);
  const site = String(url.searchParams.get("site") || "").trim().toUpperCase();
  if (site && !canSite(data.user, site)) return err(`You don't have access to site ${site}`, 403);

  let sql = `SELECT f.id, f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name, f.channel, f.original_name, f.size_bytes, f.note, f.uploaded_at,
                    u.full_name AS uploaded_by,
                    (SELECT MAX(downloaded_at) FROM download_log d
                      WHERE d.file_id = f.id AND d.downloader_id = ?) AS my_last_download,
                    (SELECT COUNT(*) FROM download_log d WHERE d.file_id = f.id) AS download_count
               FROM files f JOIN uploaders u ON u.id = f.uploaded_by
               LEFT JOIN clients c ON c.code = f.client_code
               LEFT JOIN sites s ON s.code = f.site_code
              WHERE f.channel = ? AND f.is_deleted = 0
                AND f.uploaded_at >= datetime('now', ?)`;
  const binds = [data.user.id, channel, `-${days} days`];
  if (client) { sql += " AND f.client_code = ?"; binds.push(client); }
  else { const cf = clientFilter(data.user); sql += cf.sql; binds.push(...cf.binds); }
  if (site) { sql += " AND f.site_code = ?"; binds.push(site); }
  else { const sf = siteFilter(data.user); sql += sf.sql; binds.push(...sf.binds); }
  if (q) { sql += " AND (f.original_name LIKE ? OR f.note LIKE ? OR u.full_name LIKE ?)"; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += " ORDER BY f.uploaded_at DESC LIMIT 500";

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ ok: true, channel, files: results });
}
