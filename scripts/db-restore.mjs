// Restores a backup made by scripts/db-backup.mjs (or the Settings button) into the hosted database.
//   node --env-file=.env.local scripts/db-restore.mjs backups/2026-10-10T04-00-00
// Every table in the folder is emptied and refilled with the rows from its JSON file; the numbering
// continues from the highest number found. Files in storage (photos, videos, PDFs) are not part of a
// backup and cannot be restored by this script.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node --env-file=.env.local scripts/db-restore.mjs <backup folder>");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const { rows: cols } = await client.query("select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'");
  const typeOf = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
  await client.query("begin");
  await client.query("set local session_replication_role = replica");
  let total = 0;
  for (const f of files) {
    const table = path.basename(f, ".json");
    const rows = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    await client.query(`delete from public."${table}"`);
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = [];
      const params = [];
      for (const r of chunk) {
        const ph = [];
        for (const c of columns) {
          const t = typeOf.get(`${table}.${c}`) ?? "";
          let v = r[c];
          if (v !== null && v !== undefined && (t === "jsonb" || t === "json")) v = JSON.stringify(v);
          params.push(v);
          ph.push(`$${params.length}${t === "jsonb" ? "::jsonb" : t === "json" ? "::json" : ""}`);
        }
        values.push(`(${ph.join(", ")})`);
      }
      await client.query(`insert into public."${table}" (${quoted}) values ${values.join(", ")}`, params);
    }
    total += rows.length;
    console.log(`${table.padEnd(32)} ${rows.length}`);
  }
  // The numbering continues after the highest number restored.
  const seqs = [
    ["customer_number_seq", "customers", "customer_number"],
    ["job_number_seq", "jobs", "job_number"],
    ["quotation_number_seq", "quotations", "number", "Q-"],
    ["estimate_number_seq", "quotations", "number", "E-"],
    ["po_number_seq", "purchase_orders", "number"],
    ["invoice_number_seq", "invoices", "number", "INV-"],
    ["proforma_number_seq", "invoices", "number", "PRO-"],
    ["credit_note_number_seq", "invoices", "number", "CN-"],
    ["receipt_number_seq", "payments", "number"],
  ];
  for (const [seq, table, column, prefix] of seqs) {
    const where = prefix ? `where "${column}" like '${prefix}%'` : "";
    const { rows } = await client.query(`select max(nullif(regexp_replace("${column}", '\\D', '', 'g'), '')::bigint) as m from public."${table}" ${where}`);
    const m = Number(rows[0]?.m ?? 0);
    await client.query(m > 0 ? `select setval('public.${seq}', ${m}, true)` : `alter sequence public.${seq} restart with 1`);
  }
  await client.query("commit");
  console.log(`\nRestored ${files.length} tables, ${total} rows from ${dir}.`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("Restore failed, nothing changed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
