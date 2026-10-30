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
const q = async (sql, params) => (await client.query(sql, params)).rows;

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
const SERVER_ONLY = ["short_links", "payment_requests", "payment_links", "setup_links", "quick_codes", "google_mailbox_tokens", "staff_private", "background_jobs", "app_errors", "zoho_tokens", "zoho_outbox", "zoho_reconciliation", "zoho_outbox_archive", "card_settlements", "bodyshop_problems", "ceramic_usage", "settlement_reports", "access_refusals"];
for (const t of SERVER_ONLY) {
  const g = await q(`select coalesce(string_agg(distinct grantee || ':' || privilege_type, ','), '') as g from information_schema.role_table_grants where table_schema = 'public' and table_name = '${t}' and grantee in ('anon'${t === "staff_private" ? "" : ",'authenticated'"})`);
  check(`${t} is not reachable by ${t === "staff_private" ? "anon" : "anon or authenticated"}`, !g[0]?.g, g[0]?.g);
}

// 4b. The go-live switch (archives the Zoho queue, clears every stored Zoho id, flips the books) runs for the server only.
const switchFn = await q(`select has_function_privilege('authenticated', 'public.zoho_switch_org(text, text, boolean, uuid, date)', 'execute') as auth, has_function_privilege('anon', 'public.zoho_switch_org(text, text, boolean, uuid, date)', 'execute') as anon`);
check("the Zoho go-live switch cannot be run by a browser session", switchFn[0] && !switchFn[0].auth && !switchFn[0].anon, JSON.stringify(switchFn[0]));

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

// 6. A team leader's own login (28 October 2026, B2) reads no prices or costs: simulated inside a rolled-back
//    transaction as the authenticated role with a real leader's id (nothing is written).
{
  const leader = (await q("select id from public.staff where role_id = 'team_leader' and is_active order by display_name limit 1"))[0]?.id;
  if (!leader) check("a team leader exists for the probe", false, "no team leader");
  else {
    const tables = ["services", "stock_movements", "declined_work", "gate_outs", "jobs", "job_events", "customers", "customer_contacts", "advisor_bonus_periods", "advisor_bonus_overrides", "price_imports", "price_import_lines", "supplier_discount_changes", "stock_items", "quotations", "quotation_lines", "invoices", "payments", "part_items", "purchase_orders", "film_rolls", "film_usage"];
    const seen = [];
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: leader, role: "authenticated" })]);
      for (const t of tables) {
        await client.query("savepoint p");
        try {
          const n = Number((await client.query(`select count(*)::int as n from public.${t}`)).rows[0].n);
          if (n > 0) seen.push(`${t} (${n})`);
          await client.query("release savepoint p");
        } catch {
          await client.query("rollback to savepoint p");
        }
      }
      const money = Number((await client.query("select count(*)::int as n from public.settings where key ~* '(price|cost|rate|aed|profit|margin|markup|discount|commission|bonus|target|charge|fee|salary|recovery_rates|recovery_types|film_types|package)'")).rows[0].n);
      if (money > 0) seen.push(`settings money keys (${money})`);
      const files = Number((await client.query("select count(*)::int as n from storage.objects where bucket_id = 'job-files'")).rows[0].n);
      if (files > 0) seen.push(`job-files bucket (${files})`);
    } finally {
      await client.query("rollback");
    }
    check("a team leader's login reads no prices, costs or money files", seen.length === 0, seen.join(", "));
  }
}

// 7. Customer details (29 October 2026, batch 2 section 1): a workshop login - workshop manager, technician, Parts,
//    QC, team leader - reads no customer, contact, approval request or personal column (pickup address, who brought
//    loose items, the owner report, the collector at gate-out, a booking's collection address). Each role is probed
//    with a real person's id inside a rolled-back transaction; nothing is written.
{
  const PRIVATE_COLUMNS = [["gate_ins", "location_address"], ["gate_ins", "location_name"], ["jobs", "brought_by"], ["jobs", "owner_report"], ["gate_outs", "collector_name"], ["gate_outs", "collector_phone"], ["gate_outs", "delivered_to"], ["gate_outs", "delivery_address"], ["job_items", "collector_name"], ["appointments", "collect_address"]];
  // The login role itself (every role) has no SELECT on the private columns: the server reads them for the customer roles.
  const granted = [];
  for (const [t, c] of PRIVATE_COLUMNS) {
    const ok = (await q("select has_column_privilege('authenticated', $1, $2, 'SELECT') as ok", [`public.${t}`, c]))[0]?.ok;
    if (ok) granted.push(`${t}.${c}`);
  }
  check("the login role cannot read the personal columns (pickup address, collectors, owner report)", granted.length === 0, granted.join(", "));
  for (const role of ["workshop_manager", "technician", "parts", "qc_inspector", "team_leader"]) {
    const person = (await q("select id, display_name from public.staff where role_id = $1 and is_active and display_name not ilike 'E2e %' order by display_name limit 1", [role]))[0];
    if (!person) {
      console.log(`SKIP no active ${role} to probe`);
      continue;
    }
    const seen = [];
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: person.id, role: "authenticated" })]);
      for (const t of ["customers", "customer_contacts", "approval_requests"]) {
        await client.query("savepoint p");
        try {
          const n = Number((await client.query(`select count(*)::int as n from public.${t}`)).rows[0].n);
          if (n > 0) seen.push(`${t} (${n})`);
          await client.query("release savepoint p");
        } catch {
          await client.query("rollback to savepoint p");
        }
      }
      for (const [t, c] of PRIVATE_COLUMNS) {
        await client.query("savepoint p");
        try {
          const n = Number((await client.query(`select count(${c})::int as n from public.${t}`)).rows[0].n);
          seen.push(`${t}.${c} readable (${n})`);
          await client.query("release savepoint p");
        } catch {
          await client.query("rollback to savepoint p");
        }
      }
    } finally {
      await client.query("rollback");
    }
    check(`a ${role.replace("_", " ")}'s login (${person.display_name}) reads no customer data`, seen.length === 0, seen.join(", "));
  }
}

await client.end();
console.log(failed ? `\n${failed} security check(s) FAILED` : "\nAll security checks passed.");
process.exit(failed ? 1 : 0);
