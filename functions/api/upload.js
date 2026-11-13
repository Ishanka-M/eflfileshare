// POST /api/upload  (uploader only) — multipart form: file (1..n), site, client, channel, note
import { json, err, safeName, canClient, canSite, siteHasClient } from "../_lib/util.js";

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};

export async function onRequestPost({ request, env, data }) {
  const user = data.user;
  let form;
  try { form = await request.formData(); } catch { return err("Expected a file upload"); }

  const channel = String(form.get("channel") || "").toLowerCase();
  if (!user.channels.includes(channel)) return err(`You are not allowed to upload to ${channel || "that channel"}`, 403);

  const site = String(form.get("site") || "").trim().toUpperCase();
  if (!site) return err("Select a site");
  if (!canSite(user, site)) return err(`You are not allowed to upload for site ${site}`, 403);
  const siteRow = await env.DB.prepare("SELECT code, clients FROM sites WHERE code = ? AND is_active = 1").bind(site).first();
  if (!siteRow) return err(`Site ${site} does not exist or is disabled`);

  const client = String(form.get("client") || "").trim().toUpperCase();
  if (!client) return err("Select a client");
  if (!canClient(user, client)) return err(`You are not allowed to upload for ${client}`, 403);
  const clientRow = await env.DB.prepare("SELECT code FROM clients WHERE code = ? AND is_active = 1").bind(client).first();
  if (!clientRow) return err(`Client ${client} does not exist or is disabled`);
  if (!siteHasClient(siteRow.clients, client)) return err(`${client} is not handled at site ${site}`);

  const note = String(form.get("note") || "").trim().slice(0, 300) || null;
  const files = form.getAll("file").filter((f) => f && typeof f === "object" && "arrayBuffer" in f);
  if (!files.length) return err("No file selected");
  if (files.length > 20) return err("Maximum 20 files per upload");

  const maxBytes = Number(env.MAX_FILE_MB || 25) * 1024 * 1024;
  const allowed = String(env.ALLOWED_EXT || "xlsx,xls,xlsm,csv").split(",").map((s) => s.trim().toLowerCase());

  // Validate everything first so we never half-upload a batch
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!allowed.includes(ext)) return err(`"${f.name}" is not allowed. Allowed: ${allowed.join(", ")}`);
    if (f.size === 0) return err(`"${f.name}" is empty`);
    if (f.size > maxBytes) return err(`"${f.name}" is larger than ${env.MAX_FILE_MB || 25} MB`);
  }

  const saved = [];
  const now = new Date();
  const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  for (const f of files) {
    const id = crypto.randomUUID();
    const name = safeName(f.name);
    const ext = (name.split(".").pop() || "").toLowerCase();
    const contentType = MIME[ext] || f.type || "application/octet-stream";
    const key = `${site}/${client}/${channel}/${ym}/${id}/${name}`;

    await env.FILES.put(key, f.stream(), {
      httpMetadata: { contentType },
      customMetadata: { uploadedBy: user.username, site, client, channel, originalName: name },
    });

    try {
      await env.DB.prepare(
        `INSERT INTO files (id, site_code, client_code, channel, original_name, r2_key, content_type, size_bytes, note, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, site, client, channel, name, key, contentType, f.size, note, user.id).run();
    } catch (e) {
      await env.FILES.delete(key); // keep R2 and D1 in sync
      throw e;
    }
    saved.push({ id, name, size: f.size });
  }

  return json({ ok: true, site, client, channel, files: saved });
}
