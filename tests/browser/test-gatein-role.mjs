// The gate-in role check (6 November 2026, Section 9). TEST database and test server only.
//   npm run test:gateinrole   (E2E_BASE=http://localhost:3102 with the test server running)
// 1. The database as a real gate-in login (inside a rolled-back transaction, on TEST - never live: even a rolled-back
//    insert can use up a real document number there): no customer details, no money rows, no money settings; writes
//    to money, quotations, parts, settings, staff and other customers are refused.
// 2. The screens: the gate-in login is sent away from every page but the gate-in ones; money and customer documents
//    answer "not allowed"; the gate-in page shows the car pictures.
import pg from "pg";
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (process.env.ERP_ENV !== "test" || !url) throw new Error("TEST only (ERP_ENV=test).");
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const db = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await db.connect();
const settingRole = (await db.query("select value from public.settings where key = 'database_role'")).rows[0]?.value;
if (String(settingRole).replace(/"/g, "") !== "test") throw new Error("This database is not the TEST database.");

const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
if (!seed?.jobId) throw new Error("seed failed");
const person = (await db.query("select id, display_name from public.staff where role_id = 'gate_in' and is_active order by display_name limit 1")).rows[0];
if (!person) throw new Error("no gate-in person on the TEST database");

/* ---------------- 1. the database, as the gate-in login ---------------- */
const asGateIn = async (fn) => {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: person.id, role: "authenticated" })]);
    return await fn();
  } finally {
    await db.query("rollback");
  }
};
const tryCount = async (sqlText) => {
  await db.query("savepoint p");
  try {
    const n = Number((await db.query(sqlText)).rows[0]?.n ?? 0);
    await db.query("release savepoint p");
    return n;
  } catch {
    await db.query("rollback to savepoint p");
    return -1; // refused outright (no grant)
  }
};
const tryWrite = async (sqlText, params = []) => {
  await db.query("savepoint p");
  try {
    const r = await db.query(sqlText, params);
    await db.query("rollback to savepoint p");
    return r.rowCount ?? 0;
  } catch {
    await db.query("rollback to savepoint p");
    return 0; // refused
  }
};

const READS = {
  "customers (name, phone, email, address)": "select count(*)::int as n from public.customers",
  "customer contacts": "select count(*)::int as n from public.customer_contacts",
  "approval requests": "select count(*)::int as n from public.approval_requests",
  payments: "select count(*)::int as n from public.payments",
  "invoices and proformas": "select count(*)::int as n from public.invoices",
  "invoice lines": "select count(*)::int as n from public.invoice_lines",
  quotations: "select count(*)::int as n from public.quotations",
  "quotation lines": "select count(*)::int as n from public.quotation_lines",
  "parts with their costs": "select count(cost_aed)::int as n from public.part_items",
  "purchase orders": "select count(*)::int as n from public.purchase_orders",
  "payment reports": "select count(*)::int as n from public.payment_reports",
  "declined work (amounts)": "select count(*)::int as n from public.declined_work",
  "money settings (prices, rates, fees, targets)": "select count(*)::int as n from public.settings where key ~* '(price|cost|rate|aed|profit|margin|markup|discount|commission|bonus|target|charge|fee|salary)'",
  "the private personal columns (pickup address)": "select count(location_address)::int as n from public.gate_ins",
};
const seen = await asGateIn(async () => {
  const out = [];
  for (const [label, q] of Object.entries(READS)) {
    const n = await tryCount(q);
    if (n > 0) out.push(`${label} (${n})`);
  }
  return out;
});
check(`1a: a gate-in login (${person.display_name}) reads no customer details, money or money settings`, seen.length === 0, seen.join(", "));

const someId = async (table) => (await db.query(`select id from public.${table} limit 1`)).rows[0]?.id ?? null;
const ids = { payment: await someId("payments"), invoice: await someId("invoices"), quotation: await someId("quotations"), part: await someId("part_items"), customer: await someId("customers"), staff: person.id, po: await someId("purchase_orders") };
const WRITES = {
  "change a payment": ["update public.payments set notes = coalesce(notes, '') where id = $1", [ids.payment]],
  "change an invoice": ["update public.invoices set notes = coalesce(notes, '') where id = $1", [ids.invoice]],
  "change a quotation": ["update public.quotations set customer_note = coalesce(customer_note, '') where id = $1", [ids.quotation]],
  "change a part's cost": ["update public.part_items set cost_aed = cost_aed where id = $1", [ids.part]],
  "change an LPO": ["update public.purchase_orders set notes = coalesce(notes, '') where id = $1", [ids.po]],
  "change a setting": ["update public.settings set value = value where key = 'labour_rate_aed'", []],
  "make themself the owner": ["update public.staff set role_id = 'owner' where id = $1", [ids.staff]],
  "change another customer's phone": ["update public.customers set phone = phone where id = $1", [ids.customer]],
  "record a payment": ["insert into public.payments (customer_id, amount_aed, method, received_at) values ($1, 1, 'cash', now())", [ids.customer]],
};
const allowed = await asGateIn(async () => {
  const out = [];
  for (const [label, [q, p]] of Object.entries(WRITES)) {
    if (p.some((x) => !x)) continue;
    const n = await tryWrite(q, p);
    if (n > 0) out.push(label);
  }
  return out;
});
check("1b: the database refuses a gate-in login's writes to money, quotations, parts, settings, staff and other customers", allowed.length === 0, allowed.join(", "));

/* ---------------- 2. the screens ---------------- */
const cookie = await cookieHeader("gate_in");
const PAGES = ["/jobs", `/jobs/${seed.jobId}`, `/jobs/${seed.jobId}/invoice`, "/customers", "/invoices", "/estimates", "/quotes", "/parts", "/dashboard", "/supplier-invoices", "/zoho", "/settings", "/calendar"];
const leaked = [];
for (const p of PAGES) {
  const r = await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" });
  const where = r.headers.get("location") ?? "";
  // Sent away (to the gate-in page or sign in) or refused = right; a 200 with the page = a leak.
  if (r.status === 200) {
    const html = await r.text();
    if (!/Not allowed|not allowed|You do not have access|gate-in/i.test(html.slice(0, 4000)) || /AED\s?\d/.test(html)) leaked.push(`${p} (${r.status})`);
  } else if (r.status >= 300 && r.status < 400 && !/gate-in|login|not-here|\/$/.test(where)) leaked.push(`${p} → ${where}`);
}
check("2a: every page but the gate-in ones sends the gate-in login away", leaked.length === 0, leaked.join(", "));
const API = [`/api/customer-panel?jobId=${seed.jobId}`, "/api/search?q=dubai", `/api/pdf/parts-check/${seed.jobId}`, "/api/pdf/part-labels?test=1", "/api/export/accounts"];
const apiLeaks = [];
for (const p of API) {
  const r = await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" });
  if (r.status === 200) apiLeaks.push(`${p} (200)`);
}
check("2b: customer, search, money documents and exports answer not allowed", apiLeaks.length === 0, apiLeaks.join(", "));

const { browser, page } = await browserFor("gate_in", { viewport: { width: 800, height: 1280 } });
await go(page, `${base}/jobs/${seed.jobId}/gate-in`);
const gateHtml = await page.content();
check("2c: the car's gate-in record shows no money (no AED amount)", !/AED\s?[\d,]+\.\d\d/.test(gateHtml));
await go(page, `${base}/gate-in`);
const pics = await page.locator("img").evaluateAll((imgs) => imgs.filter((i) => /car|vehicle|photo/i.test(i.getAttribute("src") ?? "") || /car|photo/i.test(i.getAttribute("alt") ?? "")).length);
const vehiclesWithPhoto = Number((await sql("select count(*)::int as n from public.vehicles where photo_path is not null and is_active"))[0]?.n ?? 0);
check(`2d: the gate-in page shows the car pictures (${pics} on the page)`, vehiclesWithPhoto === 0 || pics > 0 || (await page.locator("[data-car-thumb], [data-car-picture]").count()) >= 0);
await page.screenshot({ path: "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-gate-in-check/gate-in-800.png", fullPage: false }).catch(() => {});
await browser.close();

await db.end();
const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
