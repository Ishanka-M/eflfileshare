// Supabase Storage (private bucket). Browser uploads go straight to Supabase with a
// one-time signed upload URL, so files never pass through Vercel's 4.5 MB function limit.
import { createClient } from "@supabase/supabase-js";

let client;
function bucket() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env variables are not set");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client.storage.from(process.env.STORAGE_BUCKET || "efl-files");
}

const check = ({ data, error }, what) => {
  if (error) throw new Error(`Storage ${what} failed: ${error.message}`);
  return data;
};

// → { signedUrl, token, path }  (valid ~2 hours, single object)
export async function signedUploadUrl(path) {
  return check(await bucket().createSignedUploadUrl(path), "sign upload");
}

// → object info (size etc.) or null if the object is not there
export async function objectInfo(path) {
  const { data, error } = await bucket().info(path);
  return error ? null : data;
}

// Short-lived download link that forces "Save as <name>"
export async function signedDownloadUrl(path, downloadName, seconds = 60) {
  const data = check(await bucket().createSignedUrl(path, seconds), "sign download");
  // add ?download= ourselves (supabase-js double-encodes non-ASCII / spaced names)
  return `${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(downloadName)}`;
}

export async function removeObject(path) {
  check(await bucket().remove([path]), "delete");
}
