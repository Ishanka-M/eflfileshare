// POST /api/auth/switch — a "Both" user jumps between the Upload and Download portals without re-typing the password
import { json, err, COOKIE, getCookie, sha256Hex, USER_TABLE } from "../../_lib/util.js";
import { findRow, startSession, OTHER } from "../../_lib/accounts.js";

export async function onRequestPost({ request, env, data }) {
  const user = data.user;
  if (!user || !OTHER[user.type]) return err("Please log in", 401);

  const target = OTHER[user.type];
  const row = await findRow(env, target, user.username);
  if (!row || !row.is_active) return err(`You don't have ${target === "uploader" ? "Upload" : "Download"} access`, 403);

  const old = getCookie(request, COOKIE);
  if (old) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(old)).run();
  await env.DB.prepare(`UPDATE ${USER_TABLE[target]} SET last_login_at = datetime('now') WHERE id = ?`).bind(row.id).run();

  const cookie = await startSession(env, request, target, row.id);
  return json({ ok: true, portal: target }, 200, { "set-cookie": cookie });
}
