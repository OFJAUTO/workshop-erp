// Prints one settings value (or any single-cell query) as raw JSON, for scripts that transform settings.
//   node --env-file=.env.local scripts/db-json.mjs "select value from public.settings where key = 'inspection_checklist'" > out.json
import pg from "pg";

const sql = process.argv[2];
if (!sql) {
  console.error("Usage: node --env-file=.env.local scripts/db-json.mjs \"<select returning one cell>\"");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const res = await client.query(sql);
  const row = res.rows[0];
  const cell = row ? row[Object.keys(row)[0]] : null;
  process.stdout.write(typeof cell === "string" ? cell : JSON.stringify(cell, null, 1));
} finally {
  await client.end();
}
