// POST /api/auth/login {username, password, prefer?}
// The portal is chosen automatically from the account:
//   username "admin" + ADMIN_PASSWORD  → Admin
//   Upload access only                 → Upload portal
//   Download access only               → Download portal
//   Both                               → `prefer` (last portal used on this browser), else Upload
import { json, err, verifyPassword, timingSafeEqual, USER_TABLE } from "../../_lib/util.js";
import { findRow, startSession, TYPES } from "../../_lib/accounts.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid request"); }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return err("Enter your username and password");

  // ---- Admin ----
  if (username.toLowerCase() === "admin") {
    if (!env.ADMIN_PASSWORD) return err("ADMIN_PASSWORD secret is not set on the server", 500);
    if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) { await sleep(600); return err("Wrong username or password", 401); }
    const cookie = await startSession(env, request, "admin", 0);
    return json({ ok: true, portal: "admin", access: "admin" }, 200, { "set-cookie": cookie });
  }

  // ---- Users: check both access tables ----
  const valid = [];
  let disabled = false;
  for (const t of TYPES) {
    const row = await findRow(env, t, username);
    if (row && (await verifyPassword(password, row.password_hash))) {
      if (row.is_active) valid.push({ type: t, row }); else disabled = true;
    }
  }
  if (!valid.length) {
    if (disabled) return err("This account is disabled. Contact the admin.", 403);
    await sleep(600);
    return err("Wrong username or password", 401);
  }

  const prefer = String(body.prefer || "");
  const pick = valid.find((v) => v.type === prefer) || valid.find((v) => v.type === "uploader") || valid[0];
  await env.DB.prepare(`UPDATE ${USER_TABLE[pick.type]} SET last_login_at = datetime('now') WHERE id = ?`).bind(pick.row.id).run();

  const cookie = await startSession(env, request, pick.type, pick.row.id);
  const access = valid.length > 1 ? "both" : pick.type === "uploader" ? "upload" : "download";
  return json({ ok: true, portal: pick.type, access }, 200, { "set-cookie": cookie });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
