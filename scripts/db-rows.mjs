// Prints every row of a query as JSON lines (for checks while building).
//   node --env-file=.env.local scripts/db-rows.mjs "select ... "
import pg from "pg";

const sql = process.argv[2];
if (!sql) {
  console.error("Usage: node --env-file=.env.local scripts/db-rows.mjs \"<select>\"");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const res = await client.query(sql);
  for (const r of res.rows) console.log(JSON.stringify(r));
  console.log(`(${res.rowCount} rows)`);
} catch (e) {
  console.log("ERROR " + e.message);
} finally {
  await client.end();
}
