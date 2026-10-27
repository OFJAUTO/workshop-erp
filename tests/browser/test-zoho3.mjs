// Zoho Books phase 3/4, LOCAL proof: the per-supplier VAT switch, the customer-refund card and hook, the
// returned-part hook, the go-live panel (checklist red = switch locked; Mathew's tick from an accounts login),
// the pure start-date gate, the reconciliation and monthly-close pages, and the REAL write guard.
//   node --env-file=.env.local tests/browser/test-zoho3.mjs   (dev server, no ZOHO_* values)
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}

let jobId = null;
let customerId = null;
let vehicleId = null;

/* ---------------- 1. guards and the pure date gate ---------------- */
await section("1 guards and the date gate", async () => {
  const g = await api("/api/e2e/zoho", { action: "write_to_real" });
  check("1: a write at the REAL book is refused", g.json?.refused === true, JSON.stringify(g.json).slice(0, 160));
  const d = await api("/api/e2e/zoho", { action: "date_gate", cases: [
    { docDate: "2026-10-31", live: true, startDate: "2026-11-01" },
    { docDate: "2026-11-01", live: true, startDate: "2026-11-01" },
    { docDate: "2026-11-02", live: true, startDate: "2026-11-01" },
    { docDate: "2026-10-31", live: false, startDate: "2026-11-01" },
    { docDate: "2026-10-31", live: true, startDate: "" },
  ] });
  check("1: the start-date gate refuses only pre-start documents, only once live", JSON.stringify(d.json?.results) === JSON.stringify([true, false, false, false, false]), JSON.stringify(d.json));
  const c = await api("/api/e2e/zoho", { action: "golive_checklist" });
  check("1: the go-live checklist evaluates six gates and is NOT all green", Array.isArray(c.json?.items) && c.json.items.length === 6 && c.json.allGreen === false, JSON.stringify(c.json?.items?.map((i) => `${i.key}:${i.ok ? 1 : 0}`)));
});

/* ---------------- 2. the supplier VAT switch ---------------- */
await section("2 supplier VAT switch", async () => {
  await sql("insert into public.suppliers (name, phone) values ('E2e Novat Supplier', '+971500000097')");
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/parts/suppliers`);
    check("2: the add form carries the VAT switch, ticked by default", (await page.locator("[data-vat-switch] input").first().isChecked()) === true);
    // Open the e2e supplier's edit fold and untick the switch.
    await page.locator("details", { hasText: "E2e Novat Supplier" }).first().locator("summary").click();
    const fold = page.locator("details", { hasText: "E2e Novat Supplier" }).first();
    await fold.locator("[data-vat-switch] input").setChecked(false);
    await fold.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const row = await until(async () => { const r = (await sql("select vat_registered from public.suppliers where name ilike 'e2e novat supplier'"))[0]; return r && r.vat_registered === false ? r : null; });
    check("2: the switch saves (not VAT registered)", row?.vat_registered === false, JSON.stringify(row));
  } finally {
    await browser.close();
  }
});

/* ---------------- 3. the customer-refund card and hook ---------------- */
await section("3 customer refund", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const [job] = await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]);
  customerId = job.customer_id;
  vehicleId = job.vehicle_id;
  const [cn] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, notes) values ('CN-E2EZ3', 'credit_note', $1, $2, $3, 'e2e-z3-cn', 200, 0, 200, 10, 210, 'Goodwill') returning id",
    [jobId, customerId, vehicleId],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Goodwill credit', 1, 200, 200, 10, 210, 0)", [cn.id]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  try {
    await go(page, `${base}/invoices/${cn.id}`);
    check("3: the refund card renders for accounts", (await page.locator("[data-cn-refund]").count()) === 1);
    await page.locator('[data-cn-refund] input[name="amount"]').fill("210");
    await page.locator('[data-cn-refund] label', { hasText: "Bank transfer" }).click();
    await page.locator('[data-cn-refund] input[name="reference"]').fill("TT-99");
    await page.locator("[data-cn-refund-save]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const row = await until(async () => (await sql("select refund_paid_at, refund_method, refund_amount_aed::float as amount from public.invoices where id = $1", [cn.id]))[0]?.refund_paid_at ? (await sql("select refund_paid_at, refund_method, refund_amount_aed::float as amount from public.invoices where id = $1", [cn.id]))[0] : null);
    check("3: the refund is recorded (210, transfer)", !!row && row.refund_method === "transfer" && row.amount === 210, JSON.stringify(row));
    const ob = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'cnrefund' and record_id = $1", [cn.id]))[0]);
    check("3: it joined the Zoho queue", ob?.status === "pending", JSON.stringify(ob));
    await go(page, `${base}/invoices/${cn.id}`);
    check("3: the card shows the recorded refund", (await page.locator("[data-cn-refund-done]").count()) === 1);
  } finally {
    await browser.close();
  }
});

/* ---------------- 4. the returned-part hook (Returns and leftovers) ---------------- */
await section("4 returned part hook", async () => {
  const [part] = await sql(
    "insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, not_needed_at, not_needed_reason) values ($1, 'E2e alternator', 1, 1, 450, 'E2e Novat Supplier', 'in_stock', now(), 'E2e test') returning id",
    [jobId],
  );
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/parts/no-home`);
    const card = page.locator("li, div").filter({ hasText: "E2e alternator" }).first();
    check("4: the part sits on Returns and leftovers", (await page.getByText("E2e alternator").count()) >= 1);
    // The 'returned' ending with the supplier's credit note number.
    await page.getByRole("button", { name: /Returned to supplier/i }).first().click().catch(() => null);
    await sleep(300);
    await page.locator('input[name="note"]').first().fill("SCN-123");
    await page.getByRole("button", { name: /^Save|^Confirm|Returned/i }).last().click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    void card;
    const row = await until(async () => { const r = (await sql("select disposition from public.part_items where id = $1", [part.id]))[0]; return r?.disposition === "returned" ? r : null; });
    check("4: the part is marked returned with the credit note number", row?.disposition === "returned", JSON.stringify(row));
    const ob = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'vendorcredit' and record_id = $1", [part.id]))[0]);
    check("4: the vendor credit joined the Zoho queue", ob?.status === "pending", JSON.stringify(ob));
  } finally {
    await browser.close();
  }
});

/* ---------------- 5. the go-live panel: locked while red; Mathew's tick ---------------- */
await section("5 go-live panel", async () => {
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1800 } });
  try {
    await go(page, `${base}/settings/zoho`);
    check("5: the panel renders with the six gates", (await page.locator("[data-golive-checklist] [data-golive-item]").count()) === 6);
    check("5: at least one gate is red and the switch is LOCKED", (await page.locator('[data-golive-ok="0"]').count()) >= 1 && (await page.locator("[data-golive-flip-btn]").isDisabled()) === true);
    check("5: the owner has no review tick (it belongs to accounts)", (await page.locator("[data-golive-tick]").count()) === 0);
    await page.screenshot({ path: "tests/browser/shots/zoho3-golive-locked.png", fullPage: true });
  } finally {
    await browser.close();
  }
  const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  try {
    await go(ap, `${base}/zoho`);
    check("5: accounts see the review card with the tick", (await ap.locator("[data-golive-tick]").count()) === 1);
    await ap.locator("[data-golive-tick]").click();
    await ap.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const ticked = await until(async () => { const r = (await sql("select value from public.settings where key = 'zoho_golive_reviewed'"))[0]?.value; return r?.at ? r : null; });
    check("5: the tick stores who and when", !!ticked?.at && !!ticked?.name, JSON.stringify(ticked));
    const c = await api("/api/e2e/zoho", { action: "golive_checklist" });
    check("5: the reviewed gate is green now, the rest still block", c.json?.items?.find((i) => i.key === "reviewed")?.ok === true && c.json?.allGreen === false, JSON.stringify(c.json?.items?.map((i) => `${i.key}:${i.ok ? 1 : 0}`)));
  } finally {
    await ab.close();
  }
  // Put the tick back so the live checklist stays truthful.
  await sql("update public.settings set value = '{}'::jsonb where key = 'zoho_golive_reviewed'");
});

/* ---------------- 6. reconciliation and monthly close pages ---------------- */
await section("6 reconciliation and close pages", async () => {
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/zoho/reconciliation`);
    const body = plainText(await page.content());
    check("6: the reconciliation page renders with the backfill button", (await page.locator("[data-recon-backfill]").count()) === 1 && /yesterday per the ERP next to yesterday per Zoho/i.test(body), body.slice(0, 160));
    await go(page, `${base}/zoho/close`);
    check("6: the monthly close renders its lines", (await page.locator("[data-close-line]").count()) >= 7);
    check("6: the Excel export link is there", (await page.locator("[data-close-export]").count()) === 1);
    const month = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 7);
    const xlsx = await fetch(`${base}/api/export/zoho-close?month=${month}`, { headers: { cookie: (await import("./pw-lib.mjs")).cookieHeader ? await (await import("./pw-lib.mjs")).cookieHeader("accounts") : "" } });
    check("6: the export answers with a spreadsheet", xlsx.status === 200 && /spreadsheetml/.test(xlsx.headers.get("content-type") ?? ""), `${xlsx.status} ${xlsx.headers.get("content-type")}`);
    await page.screenshot({ path: "tests/browser/shots/zoho3-close.png", fullPage: true });
  } finally {
    await browser.close();
  }
});

await sql("delete from public.zoho_outbox where job_id = $1 or record_id in (select id from public.invoices where job_id = $1) or record_id in (select id from public.part_items where job_id = $1)", [jobId]).catch(() => null);
cleanupDb();
process.exit(summary() ? 1 : 0);
