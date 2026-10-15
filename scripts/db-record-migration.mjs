// Records a migration file as applied in the Supabase CLI's history, for the times the CLI cannot reach the
// database and the file was run with db-sql.mjs instead.
//   node --env-file=.env.local scripts/db-record-migration.mjs supabase/migrations/<version>_<name>.sql
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node --env-file=.env.local scripts/db-record-migration.mjs <migration file>");
  process.exit(1);
}
const m = basename(file).match(/^(\d{14})_(.+)\.sql$/);
if (!m) {
  console.error("The file name must be <14 digits>_<name>.sql");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query("select 1 from supabase_migrations.schema_migrations where version = $1", [m[1]]);
  if (rows.length) {
    console.log(`${m[1]} is already recorded.`);
  } else {
    await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, array[$3])", [m[1], m[2], readFileSync(file, "utf8")]);
    console.log(`Recorded ${m[1]} ${m[2]}.`);
  }
} finally {
  await client.end();
}
