// PATCH  /api/admin/accounts/:username  {full_name?, password?, access?, channels?, clients?, sites?, is_active?}
// DELETE /api/admin/accounts/:username
import { json, err, hashPassword, USER_TABLE, normalizeChannels, normalizeClients, normalizeSites } from "../../../_lib/util.js";
import { TYPES, ACCESS_TYPES, findRow, removeRowStatements } from "../../../_lib/accounts.js";

async function load(env, username) {
  const rows = {};
  for (const t of TYPES) { const r = await findRow(env, t, username); if (r) rows[t] = r; }
  return rows;
}

export async function onRequestPatch({ request, env, params }) {
  const rows = await load(env, params.username);
  if (!Object.keys(rows).length) return err("User not found", 404);

  let b;
  try { b = await request.json(); } catch { return err("Invalid request"); }

  // fields shared by both rows
  const f = {};
  if (b.full_name !== undefined) { f.full_name = String(b.full_name).trim(); if (!f.full_name) return err("Full name cannot be empty"); }
  if (b.password !== undefined) {
    if (String(b.password).length < 8) return err("Password must be at least 8 characters");
    f.password_hash = await hashPassword(String(b.password));
  }
  if (b.channels !== undefined) { f.channels = normalizeChannels(b.channels); if (!f.channels) return err("Select at least one channel"); }
  if (b.sites !== undefined) { f.sites = normalizeSites(b.sites); if (!f.sites) return err("Select at least one site (or All sites)"); }
  if (b.clients !== undefined) { f.clients = normalizeClients(b.clients); if (!f.clients) return err("Select at least one client (or All clients)"); }
  if (b.is_active !== undefined) f.is_active = b.is_active ? 1 : 0;

  let wanted = Object.keys(rows);
  if (b.access !== undefined) {
    wanted = ACCESS_TYPES[b.access];
    if (!wanted) return err("Choose access: Upload, Download or Both");
  }

  const stmts = [];
  const base = rows.uploader || rows.downloader;   // source for values when adding a new access
  const cols = Object.keys(f);

  for (const t of TYPES) {
    const has = !!rows[t], want = wanted.includes(t);
    if (has && want && cols.length) {
      stmts.push(env.DB.prepare(`UPDATE ${USER_TABLE[t]} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
        .bind(...cols.map((c) => f[c]), rows[t].id));
      if (f.password_hash || f.is_active === 0)          // force logout everywhere
        stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_type = ? AND user_id = ?").bind(t, rows[t].id));
    } else if (!has && want) {                             // grant new access
      const v = { ...base, ...f };
      stmts.push(env.DB.prepare(
        `INSERT INTO ${USER_TABLE[t]} (username, full_name, password_hash, channels, clients, sites, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(base.username.toLowerCase(), v.full_name, v.password_hash, v.channels, v.clients, v.sites, v.is_active ?? 1));
    } else if (has && !want) {                             // revoke access
      stmts.push(...(await removeRowStatements(env, t, rows[t])).stmts);
    }
  }
  if (!stmts.length) return err("Nothing to update");
  await env.DB.batch(stmts);
  return json({ ok: true });
}

export async function onRequestDelete({ env, params }) {
  const rows = await load(env, params.username);
  if (!Object.keys(rows).length) return err("User not found", 404);
  const stmts = [];
  let archived = false;
  for (const t of Object.keys(rows)) {
    const r = await removeRowStatements(env, t, rows[t]);
    stmts.push(...r.stmts); archived = archived || r.archived;
  }
  await env.DB.batch(stmts);
  return json({ ok: true, archived });
}
