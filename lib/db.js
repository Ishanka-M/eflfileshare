// Postgres (Supabase) connection — one small pool per serverless instance
import postgres from "postgres";

let sql;
export function db() {
  if (!sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL env variable is not set");
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    sql = postgres(process.env.DATABASE_URL, {
      prepare: false,            // required for Supabase transaction pooler (port 6543)
      max: 3,
      idle_timeout: 20,
      ssl: local ? false : "require",
    });
  }
  return sql;
}

// Write queries with "?" placeholders (like before) — converted to $1, $2 ...
const toPg = (text) => { let i = 0; return text.replace(/\?/g, () => `$${++i}`); };

export async function all(text, params = [], tx) {
  return (tx || db()).unsafe(toPg(text), params);
}
export async function first(text, params = [], tx) {
  const rows = await all(text, params, tx);
  return rows[0] || null;
}
export async function run(text, params = [], tx) {
  return all(text, params, tx);
}
export async function transaction(fn) {
  return db().begin(fn);
}
