// Applies every migration in supabase/migrations to the TEST database, in order, and records each the way the Supabase
// CLI does (30 October 2026, batch 2 section 1). Refuses anything but the test project. Run after a new migration too:
//   node --env-file=.env.test.local scripts/test-db/migrate-test.mjs        (npm run test:db:migrate)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const LIVE_REF = "uhqcmqudszguqosnjadx";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (process.env.ERP_ENV !== "test" || !url || url.includes(LIVE_REF)) {
  console.error("Refused: this runs only with .env.test.local, against the TEST project.");
  process.exit(2);
}
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)");
  const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
  const done = new Set(rows.map((r) => r.version));
  const dir = path.join("supabase", "migrations");
  const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  let applied = 0;
  for (const f of files) {
    const [, version, name] = f.match(/^(\d{14})_(.+)\.sql$/);
    if (done.has(version)) continue;
    const sql = readFileSync(path.join(dir, f), "utf8");
    try {
      await client.query(sql);
    } catch (e) {
      console.error(`FAILED at ${f}: ${e.message}`);
      process.exit(1);
    }
    await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, array[$3])", [version, name, sql]);
    applied++;
  }
  console.log(`${applied} migration(s) applied, ${files.length} in total.`);
} finally {
  await client.end();
}
