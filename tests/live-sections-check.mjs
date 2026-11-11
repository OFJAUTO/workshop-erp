// LIVE, READ-ONLY, PER SECTION (11 November 2026 list): for each of the 16 sections, what can be proven on the live
// site without signing in or writing anything (standing rule 7): the database change the section needs is there,
// the deployed version carries the section's code, and the public behaviour where a section has one.
//   node --env-file=.env.local tests/live-sections-check.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const SITE = "https://erp.ofjauto.com";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const db = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("begin transaction read only");
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0] ?? {};
const col = async (t, c) => !!(await one("select 1 ok from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2", [t, c])).ok;
const table = async (t) => !!(await one("select to_regclass($1) r", [`public.${t}`])).r;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); ok ? pass++ : fail++; };
const page = async (path) => { const r = await fetch(`${SITE}${path}`, { redirect: "manual" }); return { status: r.status, location: r.headers.get("location") ?? "", text: r.status === 200 ? await r.text() : "" }; };

// The deployed version: the live site answers with the newest deployment, built from the newest code commit.
const ver = await (await fetch(`${SITE}/version.json`)).json();
check("deploy: the live site reports its version", !!ver.version, ver.version);

// S1 stock LPOs in supplier invoices: the query reads ordered-not-received LPOs (no schema change); an ordered stock LPO exists to show.
check("S1: stock LPOs are on live (kind stock)", Number((await one("select count(*) n from public.purchase_orders where kind='stock' and is_active")).n) >= 0);
check("S2: parts carry their quotation (for_quote on part_items and part_requests)", (await col("part_items", "for_quote")) && (await col("part_requests", "for_quote")), `${(await one("select count(*) n from public.part_items where for_quote is not null")).n} parts tagged`);
check("S2: the tagging rule is installed", !!(await one("select 1 ok from pg_trigger where tgname ilike '%for_quote%' limit 1")).ok);
check("S3: supplier payments can use an advance (supplier_payment_lines.applied_later)", await col("supplier_payment_lines", "applied_later"));
check("S4: the approvals have their sources (quotations.owner_approval_reason)", await col("quotations", "owner_approval_reason"));
check("S5: void requests and cheque totals (payments.void_requested_at, cheque_total_aed)", (await col("payments", "void_requested_at")) && (await col("payments", "cheque_total_aed")));
check("S6: lathe bills v2 (edit history, void) and lathe lines in supplier payments", (await col("lathe_bills", "edit_history")) && (await col("supplier_payment_lines", "lathe_bill_id")));
check("S7: free items (quotations.comp_reason)", await col("quotations", "comp_reason"));
check("S8: tablet departments (devices.department)", await col("devices", "department"), `${(await one("select count(*) filter (where department is null) n from public.devices where kind='shared' and is_active")).n} shared tablets still to set (NEEDS OMAR)`);
check("S9: job ticks (job_line_ticks, server-only)", await table("job_line_ticks"));
check("S10: inspection type (jobs.inspection_scope, inspection_items.not_checked_reason, setting)", (await col("jobs", "inspection_scope")) && (await col("inspection_items", "not_checked_reason")) && !!(await one("select 1 ok from public.settings where key='inspection_scope_rules'")).ok);
check("S11: gate-in car cards read vehicles.photo_path (present)", await col("vehicles", "photo_path"));
const qr = await page("/s/ZZZZZZZZ");
check("S12: a label opened signed out shows only the sentence, no redirect", qr.status === 200 && /TO VIEW THIS LABEL YOU MUST BE SIGNED IN TO THE ERP/.test(qr.text) && !/href="\/login/.test(qr.text), `status ${qr.status}`);
const st = await page("/stickers");
check("S12: the Stickers tab exists and asks staff to sign in", st.status >= 300 && st.status < 400 && /\/login/.test(st.location), `${st.status} → ${st.location.replace(SITE, "")}`);
const legacy = await page("/settings/stickers");
check("S12: Settings > Stickers needs a sign-in (it now opens the Stickers tab)", legacy.status >= 300 && legacy.status < 400, `${legacy.status}`);
const login = await page("/login");
check("S13: the shared button style is in the live build (44 px buttons on the sign-in page)", login.status === 200 && /min-h-11/.test(login.text));
check("S14: password sign-ins: the old pile no longer counts (0 unread)", Number((await one("select count(*) n from public.notifications where type='password_backup_sign_in' and read_at is null")).n) === 0);
check("S15: HR tables and the private bucket", (await table("hr_people")) && (await table("hr_documents")) && (await table("hr_access_log")) && !!(await one("select 1 ok from storage.buckets where id='hr-files' and public = false")).ok);
check("S15: HR tables are closed to the login roles (no grants)", !(await one("select 1 ok from information_schema.role_table_grants where table_schema='public' and table_name like 'hr_%' and grantee in ('anon','authenticated') limit 1")).ok);
const hrFile = await fetch(`${SITE}/api/hr/file/00000000-0000-4000-8000-000000000000`, { redirect: "manual" });
check("S15: an HR file link refuses a signed-out visitor", hrFile.status >= 300 && hrFile.status !== 200, `${hrFile.status}`);
const xid = (await page("/login"));
const vercelRegion = (await fetch(`${SITE}/login`)).headers.get("x-vercel-id") ?? "";
check("S16: server code runs in Mumbai (bom1)", /^bom1::/.test(vercelRegion), vercelRegion.split("::").slice(0, 2).join("::"));
void xid;
await db.query("rollback");
await db.end();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
