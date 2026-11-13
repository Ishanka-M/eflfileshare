import { json, COOKIE, getCookie, sha256Hex, clearCookie } from "../../_lib/util.js";

export async function onRequestPost({ request, env }) {
  const token = getCookie(request, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  const secure = new URL(request.url).protocol === "https:";
  return json({ ok: true }, 200, { "set-cookie": clearCookie(secure) });
}
