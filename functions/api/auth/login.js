import { json, err, verifyPassword, timingSafeEqual, randomToken, sha256Hex, sessionCookie, USER_TABLE } from "../../_lib/util.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid request"); }

  const portal = String(body.portal || "");
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!["uploader", "downloader", "admin"].includes(portal)) return err("Unknown portal");
  if (!password) return err("Password required");

  let userId;
  if (portal === "admin") {
    if (!env.ADMIN_PASSWORD) return err("ADMIN_PASSWORD secret is not set on the server", 500);
    if (username.toLowerCase() !== "admin" || !timingSafeEqual(password, env.ADMIN_PASSWORD)) {
      await sleep(600);
      return err("Wrong username or password", 401);
    }
    userId = 0;
  } else {
    const table = USER_TABLE[portal];
    const u = await env.DB.prepare(`SELECT id, password_hash, is_active FROM ${table} WHERE username = ?`)
      .bind(username).first();
    const ok = u && (await verifyPassword(password, u.password_hash));
    if (!ok) { await sleep(600); return err("Wrong username or password", 401); }
    if (!u.is_active) return err("This account is disabled. Contact the admin.", 403);
    userId = u.id;
    await env.DB.prepare(`UPDATE ${table} SET last_login_at = datetime('now') WHERE id = ?`).bind(userId).run();
  }

  const hours = Number(env.SESSION_HOURS || 12);
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare(`INSERT INTO sessions (token_hash, user_type, user_id, expires_at)
                    VALUES (?, ?, ?, datetime('now', ?))`)
      .bind(await sha256Hex(token), portal, userId, `+${hours} hours`),
  ]);

  const secure = new URL(request.url).protocol === "https:";
  return json({ ok: true, portal }, 200, { "set-cookie": sessionCookie(token, hours, secure) });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
