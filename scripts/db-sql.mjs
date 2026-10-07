// Runs a SQL file against the hosted database as the postgres role.
//   node --env-file=.env.local scripts/db-sql.mjs path/to/file.sql
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node --env-file=.env.local scripts/db-sql.mjs <file.sql>");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const sql = readFileSync(file, "utf8");
  const res = await client.query(sql);
  const results = Array.isArray(res) ? res : [res];
  for (const r of results) {
    if (r.command) console.log(`${r.command}${r.rowCount != null ? " " + r.rowCount : ""}`);
    if (r.rows?.length) console.table(r.rows);
  }
} finally {
  await client.end();
}
