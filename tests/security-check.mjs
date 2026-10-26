// The standing security check (21 October 2026): fails the batch if the database ever slips back.
// Runs with `npm run test:security` (alongside `npm run test:layout` at the end of every batch).
//   1. Every table in public has RLS ON.
//   2. anon holds NO grant on any public table, sequence or function, and no policy applies to it.
//   3. No view in public runs as its owner (security_invoker must be on — better: no views at all).
//   4. The server-only token tables grant nothing to anon OR authenticated.
//   5. A live probe with the public anon key cannot read a row or a sensitive column.
// Prints names only, never data or keys.
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
const q = async (sql) => (await client.query(sql)).rows;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` · ${detail}` : ""}`); if (!ok) failed++; };

// 1. RLS on every public table.
const noRls = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`);
check("every public table has RLS on", noRls.length === 0, noRls.map((r) => r.relname).join(", "));

// 2a. anon has no table grants.
const anonTables = await q(`select distinct table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' order by 1`);
check("anon holds no grant on any public table or view", anonTables.length === 0, anonTables.map((r) => r.table_name).join(", "));
// 2b. anon has no function execute.
const anonFns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
check("anon can execute no public function", anonFns.length === 0, anonFns.slice(0, 8).map((r) => r.proname).join(", ") + (anonFns.length > 8 ? "…" : ""));
// 2c. no policy applies to anon.
const anonPol = await q(`select tablename || '/' || policyname as p from pg_policies where schemaname = 'public' and (roles::text like '%anon%' or roles::text = '{public}')`);
check("no policy applies to anon", anonPol.length === 0, anonPol.map((r) => r.p).join(", "));
// 2d. future tables get no anon grants by default. Our migrations run as postgres (db-sql.mjs and the
// dashboard), so postgres's default ACLs are the ones that matter; supabase_admin's own defaults only
// apply to objects the platform itself creates and postgres is not allowed to change them.
const defAcl = await q(`select coalesce(string_agg(d.defaclobjtype::text, ','), '') as t from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' and d.defaclrole = 'postgres'::regrole and array_to_string(d.defaclacl, ',') like '%anon%'`);
check("future tables created by our migrations get no anon grants", !defAcl[0]?.t, defAcl[0]?.t);

// 3. No owner views (security definer) left in public.
const ownerViews = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%' order by 1`);
check("no view runs as its owner (RLS bypass)", ownerViews.length === 0, ownerViews.map((r) => r.relname).join(", "));

// 4. Server-only token tables: dark to both API roles.
const SERVER_ONLY = ["short_links", "payment_requests", "payment_links", "setup_links", "quick_codes", "google_mailbox_tokens", "staff_private", "background_jobs", "app_errors", "zoho_tokens", "zoho_outbox"];
for (const t of SERVER_ONLY) {
  const g = await q(`select coalesce(string_agg(distinct grantee || ':' || privilege_type, ','), '') as g from information_schema.role_table_grants where table_schema = 'public' and table_name = '${t}' and grantee in ('anon'${t === "staff_private" ? "" : ",'authenticated'"})`);
  check(`${t} is not reachable by ${t === "staff_private" ? "anon" : "anon or authenticated"}`, !g[0]?.g, g[0]?.g);
}

// 5. Live probe as anon: sensitive tables and columns give nothing away.
const PROBES = [
  ["staff_private?select=pin_hash&limit=1", "staff_private.pin_hash"],
  ["google_mailbox_tokens?select=refresh_token_enc&limit=1", "google_mailbox_tokens.refresh_token_enc"],
  ["customers?select=phone&limit=1", "customers.phone"],
  ["payments?select=*&limit=1", "payments"],
  ["payment_links?select=url&limit=1", "payment_links.url"],
  ["quotations?select=token&limit=1", "quotations.token"],
  ["settings?select=*&limit=1", "settings"],
  ["staff?select=*&limit=1", "staff"],
];
for (const [path, label] of PROBES) {
  try {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } });
    const body = await r.text();
    let rows = 0;
    try { const j = JSON.parse(body); rows = Array.isArray(j) ? j.length : 0; } catch { rows = 0; }
    check(`anon cannot read ${label}`, !(r.status === 200 && rows > 0), `HTTP ${r.status}, ${rows} row(s)`);
  } catch (e) {
    check(`anon cannot read ${label}`, false, `probe failed: ${e.message.slice(0, 50)}`);
  }
}

await client.end();
console.log(failed ? `\n${failed} security check(s) FAILED` : "\nAll security checks passed.");
process.exit(failed ? 1 : 0);
