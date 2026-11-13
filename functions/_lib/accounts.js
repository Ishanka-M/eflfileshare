// Accounts = one person, identified by username, with Upload access (a row in `uploaders`),
// Download access (a row in `downloaders`), or Both (a row in each, kept in sync).
// No schema change: the two original user tables stay exactly as they were.
import { USER_TABLE, randomToken, sha256Hex, sessionCookie } from "./util.js";

export const TYPES = ["uploader", "downloader"];
export const OTHER = { uploader: "downloader", downloader: "uploader" };
export const ACCESS_TYPES = { upload: ["uploader"], download: ["downloader"], both: ["uploader", "downloader"] };

// Deleted users that still have history are kept but renamed "~del<id>~<name>" and hidden.
export const ARCHIVED_PREFIX = "~del";
export const NOT_ARCHIVED = `username NOT LIKE '${ARCHIVED_PREFIX}%'`;

// Find a live (not archived) account row by username in one table
export async function findRow(env, type, username) {
  return env.DB.prepare(
    `SELECT * FROM ${USER_TABLE[type]} WHERE lower(username) = lower(?) AND ${NOT_ARCHIVED}`
  ).bind(String(username || "")).first();
}

// Statements that remove one row: hard delete if it has no history, otherwise archive it
// (keeps "Uploaded by / Downloaded by" names in reports, frees the username, blocks login).
export async function removeRowStatements(env, type, row) {
  const hist = type === "uploader"
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE uploaded_by = ?").bind(row.id).first()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM download_log WHERE downloader_id = ?").bind(row.id).first();
  const table = USER_TABLE[type];
  const stmts = [env.DB.prepare("DELETE FROM sessions WHERE user_type = ? AND user_id = ?").bind(type, row.id)];
  if (hist.n > 0) {
    stmts.push(env.DB.prepare(`UPDATE ${table} SET username = ?, is_active = 0, password_hash = '!' WHERE id = ?`)
      .bind(`${ARCHIVED_PREFIX}${row.id}~${row.username}`, row.id));
  } else {
    stmts.push(env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(row.id));
  }
  return { stmts, archived: hist.n > 0 };
}

// Create a login session and return the Set-Cookie header value
export async function startSession(env, request, portal, userId) {
  const hours = Number(env.SESSION_HOURS || 12);
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare(`INSERT INTO sessions (token_hash, user_type, user_id, expires_at)
                    VALUES (?, ?, ?, datetime('now', ?))`)
      .bind(await sha256Hex(token), portal, userId, `+${hours} hours`),
  ]);
  const secure = new URL(request.url).protocol === "https:";
  return sessionCookie(token, hours, secure);
}
