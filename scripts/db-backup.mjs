// Backs up every table of the hosted database to JSON files before a migration.
//   node --env-file=.env.local scripts/db-backup.mjs
// Writes backups/<date-time>/<table>.json (the backups folder is not committed). Nothing is printed except the path and the row counts.
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = `backups/${stamp}`;
  mkdirSync(dir, { recursive: true });
  const { rows: tables } = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name");
  let total = 0;
  for (const { table_name } of tables) {
    const { rows } = await client.query(`select * from public."${table_name}"`);
    writeFileSync(`${dir}/${table_name}.json`, JSON.stringify(rows), "utf8");
    total += rows.length;
    console.log(`${table_name.padEnd(32)} ${rows.length}`);
  }
  const { rows: settings } = await client.query("select key, value from public.settings order by key");
  writeFileSync(`${dir}/_settings-readable.json`, JSON.stringify(Object.fromEntries(settings.map((s) => [s.key, s.value])), null, 2), "utf8");
  console.log(`\nBackup written to ${dir} (${tables.length} tables, ${total} rows).`);
} finally {
  await client.end();
}
