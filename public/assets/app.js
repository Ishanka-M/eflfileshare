// Shared front-end helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(path, opts = {}) {
  const init = { credentials: "same-origin", ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
    init.body = JSON.stringify(opts.body);
    init.headers["content-type"] = "application/json";
  }
  const res = await fetch(path, init);
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith("/api/auth/")) { location.href = "/"; throw new Error("Session expired"); }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Ensures the current session belongs to the expected portal, otherwise sends to login
async function requirePortal(type) {
  try {
    const me = await api("/api/auth/me");
    if (!me.user || me.user.type !== type) { location.href = "/"; return null; }
    const who = $("#who");
    if (who) who.textContent = me.user.full_name + (me.user.type !== "admin" ? ` (${me.user.username})` : "");
    return me;
  } catch { location.href = "/"; return null; }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  location.href = "/";
}

function toast(msg, kind = "") {
  let box = $("#toast");
  if (!box) { box = document.createElement("div"); box.id = "toast"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === "error" ? 5000 : 3000);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
}

// Accepts ISO timestamps from Postgres (or plain UTC 'YYYY-MM-DD HH:MM:SS') → viewer's local time
const parseTs = (s) => new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : String(s).replace(" ", "T") + "Z");

function fmtDate(s) {
  if (!s) return "—";
  const d = parseTs(s);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(s) {
  if (!s) return "";
  const sec = (Date.now() - parseTs(s).getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + " min ago";
  if (sec < 86400) return Math.floor(sec / 3600) + " h ago";
  return Math.floor(sec / 86400) + " d ago";
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
