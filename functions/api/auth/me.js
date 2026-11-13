import { json, canClient, canSite, siteHasClient } from "../../_lib/util.js";

export async function onRequestGet({ data, env }) {
  // Active clients this user may work with (for upload/download dropdowns)
  let clients = [], sites = [];
  if (data.user) {
    const { results } = await env.DB.prepare("SELECT code, name FROM clients WHERE is_active = 1 ORDER BY name").all();
    clients = results.filter((c) => canClient(data.user, c.code));
    // each site the user may use + the user's clients that this site handles
    const s = await env.DB.prepare("SELECT code, name, clients FROM sites WHERE is_active = 1 ORDER BY name").all();
    sites = s.results.filter((x) => canSite(data.user, x.code)).map((x) => ({
      code: x.code, name: x.name, clients: clients.filter((c) => siteHasClient(x.clients, c.code)).map((c) => c.code),
    }));
  }
  return json({
    ok: true,
    user: data.user,
    sites,
    clients,
    limits: { maxMb: Number(env.MAX_FILE_MB || 25), allowedExt: String(env.ALLOWED_EXT || "xlsx,xls,xlsm,csv").split(",") },
  });
}
