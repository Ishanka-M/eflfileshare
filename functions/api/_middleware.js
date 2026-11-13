// Runs before every /api/* request: resolves the session and enforces portal access.
import { COOKIE, getCookie, sha256Hex, err, USER_TABLE, parseChannels, parseClients, parseSites } from "../_lib/util.js";

// Which portal may call which path prefix
const RULES = [
  { prefix: "/api/auth/", type: null },                // login / logout / me — handled inside
  { prefix: "/api/admin/", type: "admin" },
  { prefix: "/api/upload", type: "uploader" },
  { prefix: "/api/my-uploads", type: "uploader" },
  { prefix: "/api/files", type: "downloader" },        // list + download
];

export async function onRequest(context) {
  const { request, env, data } = context;
  const url = new URL(request.url);

  // Basic CSRF guard: state-changing requests must come from our own origin
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return err("Bad origin", 403);
  }

  data.user = null;
  const token = getCookie(request, COOKIE);
  if (token) {
    const row = await env.DB.prepare(
      "SELECT user_type, user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"
    ).bind(await sha256Hex(token)).first();

    if (row) {
      if (row.user_type === "admin") {
        data.user = { type: "admin", id: 0, username: "admin", full_name: "Administrator", channels: ["inbound", "outbound"], clients: ["*"], sites: ["*"] };
      } else {
        const u = await env.DB.prepare(
          `SELECT id, username, full_name, channels, clients, sites, is_active FROM ${USER_TABLE[row.user_type]} WHERE id = ?`
        ).bind(row.user_id).first();
        if (u && u.is_active) {
          data.user = { type: row.user_type, id: u.id, username: u.username, full_name: u.full_name,
                        channels: parseChannels(u.channels), clients: parseClients(u.clients), sites: parseSites(u.sites) };
        }
      }
    }
  }

  const rule = RULES.find((r) => url.pathname.startsWith(r.prefix));
  if (rule && rule.type) {
    if (!data.user) return err("Please log in", 401);
    if (data.user.type !== rule.type) return err(`This area is for ${rule.type}s only`, 403);
  }

  try {
    return await context.next();
  } catch (e) {
    console.error(e);
    return err("Server error: " + (e && e.message ? e.message : "unknown"), 500);
  }
}
