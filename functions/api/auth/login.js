import { json, err, verifyPassword, timingSafeEqual, USER_TABLE } from "../../_lib/util.js";
import { findRow, startSession, OTHER } from "../../_lib/accounts.js";

const PORTAL_NAME = { uploader: "Upload", downloader: "Download" };

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
    const u = await findRow(env, portal, username);
    const ok = u && (await verifyPassword(password, u.password_hash));
    if (!ok) {
      // Right password but wrong portal? Tell them which portal to use.
      const other = await findRow(env, OTHER[portal], username);
      if (other && other.is_active && (await verifyPassword(password, other.password_hash)))
        return err(`This account has ${PORTAL_NAME[OTHER[portal]]} access only — choose the ${PORTAL_NAME[OTHER[portal]]} Portal.`, 403);
      await sleep(600);
      return err("Wrong username or password", 401);
    }
    if (!u.is_active) return err("This account is disabled. Contact the admin.", 403);
    userId = u.id;
    await env.DB.prepare(`UPDATE ${USER_TABLE[portal]} SET last_login_at = datetime('now') WHERE id = ?`).bind(userId).run();
  }

  const cookie = await startSession(env, request, portal, userId);
  return json({ ok: true, portal }, 200, { "set-cookie": cookie });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
