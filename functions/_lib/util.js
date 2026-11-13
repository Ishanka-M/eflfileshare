// Shared helpers for all API functions

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const err = (message, status = 400) => json({ ok: false, error: message }, status);

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

export const sha256Hex = async (text) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

export const randomToken = (bytes = 32) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

// ---------- Password hashing: PBKDF2-SHA256 (100k = Workers max) ----------
const ITER = 100000;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
  return `pbkdf2$${ITER}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, iter, saltHex, hashHex] = stored.split("$");
    if (algo !== "pbkdf2") return false;
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: Number(iter) }, key, 256);
    return timingSafeEqual(toHex(bits), hashHex);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- Cookies / sessions ----------
export const COOKIE = "efl_fs_session";

export function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token, hours, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${hours * 3600}${secure ? "; Secure" : ""}`;
}

export const clearCookie = (secure) =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;

export const USER_TABLE = { uploader: "uploaders", downloader: "downloaders" };
export const CHANNELS = ["inbound", "outbound"];

export const parseChannels = (s) =>
  String(s || "").split(",").map((c) => c.trim().toLowerCase()).filter((c) => CHANNELS.includes(c));

export const normalizeChannels = (input) => {
  const arr = Array.isArray(input) ? input : parseChannels(input);
  const clean = [...new Set(arr.map((c) => String(c).toLowerCase()).filter((c) => CHANNELS.includes(c)))];
  return clean.join(",");
};

// ---------- Clients ----------
// Stored on the user as "DONALDSON,VIP" or "*" (= every client, incl. ones added later)
export const parseClients = (s) => {
  const v = String(s || "").trim();
  if (v === "*") return ["*"];
  return v.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
};

export const normalizeClients = (input) => {
  const arr = Array.isArray(input) ? input : String(input || "").split(",");
  const up = [...new Set(arr.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (up.includes("*")) return "*";
  return up.filter((c) => CLIENT_CODE_RE.test(c)).join(",");
};

export const CLIENT_CODE_RE = /^[A-Z0-9_-]{2,20}$/;

export const canClient = (user, code) =>
  !!user && (user.clients.includes("*") || user.clients.includes(String(code || "").toUpperCase()));

// SQL fragment limiting a query to a code list (["*"] = no limit) → { sql, binds }
export const listFilter = (list, column) => {
  if (list.includes("*")) return { sql: "", binds: [] };
  if (!list.length) return { sql: " AND false", binds: [] };
  return { sql: ` AND ${column} IN (${list.map(() => "?").join(",")})`, binds: [...list] };
};
export const clientFilter = (user, column = "f.client_code") => listFilter(user.clients, column);

// ---------- Sites (same "CODE,CODE" / "*" format as clients) ----------
export const parseSites = parseClients;
export const normalizeSites = normalizeClients;
export const canSite = (user, code) =>
  !!user && (user.sites.includes("*") || user.sites.includes(String(code || "").toUpperCase()));
export const siteFilter = (user, column = "f.site_code") => listFilter(user.sites, column);
// clients a site handles ('*' = all) → does it include this client?
export const siteHasClient = (siteClients, code) => {
  const l = parseClients(siteClients);
  return l.includes("*") || l.includes(String(code || "").toUpperCase());
};

// Safe-ish filename for R2 keys
export const safeName = (name) =>
  String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "file";

// Content-Disposition that works for any filename (incl. Sinhala / spaces)
export const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

// Remove one code from a "A,B,C" list ("*" stays "*")
export const removeCode = (list, code) => {
  const v = String(list || "").trim();
  if (v === "*") return v;
  const c = String(code).toUpperCase();
  return v.split(",").map((x) => x.trim()).filter((x) => x && x.toUpperCase() !== c).join(",");
};

// Statements that strip `code` from a code-list column in a table (e.g. users' sites)
export async function stripCodeStatements(env, table, column, code) {
  const { results } = await env.DB.prepare(
    `SELECT rowid AS rid, ${column} AS v FROM ${table} WHERE (',' || ${column} || ',') LIKE ?`
  ).bind(`%,${code},%`).all();
  return results
    .map((r) => ({ rid: r.rid, nv: removeCode(r.v, code), ov: r.v }))
    .filter((r) => r.nv !== r.ov)
    .map((r) => env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`).bind(r.nv, r.rid));
}
