// GET /api/admin/status — health of D1 + R2, database size, counts, per site/client breakdown, recent activity
import { json } from "../../_lib/util.js";
import { NOT_ARCHIVED } from "../../_lib/accounts.js";

const FREE_DB_LIMIT = 500 * 1024 * 1024;   // D1 Free plan: 500 MB per database

export async function onRequestGet({ env }) {
  // ---- D1 health + size ----
  const t0 = Date.now();
  const ping = await env.DB.prepare("SELECT 1 AS ok").run();
  const db = { ok: true, ms: Date.now() - t0, size_bytes: ping.meta?.size_after ?? null, limit_bytes: FREE_DB_LIMIT };

  // ---- R2 health ----
  const r2 = { ok: false, ms: null, error: null };
  try {
    const t1 = Date.now();
    await env.FILES.head("__healthcheck__");   // returns null for a missing key — that's fine, it means R2 answered
    r2.ok = true; r2.ms = Date.now() - t1;
  } catch (e) { r2.error = e?.message || "R2 not reachable"; }

  const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM sites) AS sites_total,
      (SELECT COUNT(*) FROM sites WHERE is_active = 1) AS sites_active,
      (SELECT COUNT(*) FROM clients) AS clients_total,
      (SELECT COUNT(*) FROM clients WHERE is_active = 1) AS clients_active,
      (SELECT COUNT(*) FROM (SELECT lower(username) FROM uploaders WHERE ${NOT_ARCHIVED}
                             UNION SELECT lower(username) FROM downloaders WHERE ${NOT_ARCHIVED})) AS users_total,
      (SELECT COUNT(*) FROM uploaders WHERE ${NOT_ARCHIVED} AND is_active = 1) AS upload_users,
      (SELECT COUNT(*) FROM downloaders WHERE ${NOT_ARCHIVED} AND is_active = 1) AS download_users,
      (SELECT COUNT(*) FROM files WHERE is_deleted = 0) AS files,
      (SELECT COUNT(*) FROM files WHERE is_deleted = 0 AND channel = 'inbound') AS files_inbound,
      (SELECT COUNT(*) FROM files WHERE is_deleted = 0 AND channel = 'outbound') AS files_outbound,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE is_deleted = 0) AS storage_bytes,
      (SELECT COUNT(*) FROM files f WHERE f.is_deleted = 0
          AND NOT EXISTS (SELECT 1 FROM download_log d WHERE d.file_id = f.id)) AS files_not_downloaded,
      (SELECT COUNT(*) FROM files WHERE is_deleted = 0 AND uploaded_at >= datetime('now', '-1 day')) AS uploads_24h,
      (SELECT COUNT(*) FROM download_log) AS downloads_total,
      (SELECT COUNT(*) FROM download_log WHERE downloaded_at >= datetime('now', '-1 day')) AS downloads_24h,
      (SELECT COUNT(*) FROM sessions WHERE expires_at > datetime('now') AND user_type <> 'admin') AS sessions_active,
      (SELECT MAX(uploaded_at) FROM files) AS last_upload,
      (SELECT MAX(downloaded_at) FROM download_log) AS last_download`).first();

  const breakdown = (await env.DB.prepare(
    `SELECT f.site_code, COALESCE(s.name, f.site_code) AS site_name, f.client_code, COALESCE(c.name, f.client_code) AS client_name,
            SUM(f.channel = 'inbound') AS inbound, SUM(f.channel = 'outbound') AS outbound,
            SUM(f.size_bytes) AS bytes, MAX(f.uploaded_at) AS last_upload
       FROM files f LEFT JOIN sites s ON s.code = f.site_code LEFT JOIN clients c ON c.code = f.client_code
      WHERE f.is_deleted = 0
      GROUP BY f.site_code, f.client_code ORDER BY site_name, client_name`
  ).all()).results;

  const recentUploads = (await env.DB.prepare(
    `SELECT f.original_name, f.site_code, f.client_code, f.channel, f.uploaded_at, u.full_name AS by_name
       FROM files f JOIN uploaders u ON u.id = f.uploaded_by
      WHERE f.is_deleted = 0 ORDER BY f.uploaded_at DESC LIMIT 10`
  ).all()).results;

  const recentDownloads = (await env.DB.prepare(
    `SELECT f.original_name, f.site_code, f.client_code, f.channel, d.downloaded_at, dl.full_name AS by_name
       FROM download_log d JOIN files f ON f.id = d.file_id JOIN downloaders dl ON dl.id = d.downloader_id
      ORDER BY d.downloaded_at DESC LIMIT 10`
  ).all()).results;

  return json({
    ok: true, db, r2, counts, breakdown, recent_uploads: recentUploads, recent_downloads: recentDownloads,
    settings: {
      max_file_mb: Number(env.MAX_FILE_MB || 25),
      allowed_ext: String(env.ALLOWED_EXT || "xlsx,xls,xlsm,csv"),
      session_hours: Number(env.SESSION_HOURS || 12),
    },
    server_time: new Date().toISOString(),
  });
}
