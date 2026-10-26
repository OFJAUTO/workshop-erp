// Zoho Books phase 2, LOCAL proof (26 October 2026): the enqueue hooks on the real screens (credit note, supplier
// invoice, mark supplier paid, pay commissions, mark recovery month paid), the new mapping groups, the sync page
// with the new document kinds and the accounts' Waiting wording. The worker itself is proven live
// (test-zoho2-live.mjs); the REAL-org guard stays covered here too.
//   node --env-file=.env.local tests/browser/test-zoho2.mjs   (dev server, no ZOHO_* values)
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
const TODAY = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

let jobId = null;
let customerId = null;
let vehicleId = null;
let supplierId = null;
let poId = null;

/* ---------------- 1. the guard and the stored mapping groups ---------------- */
await section("1 guard and mapping groups", async () => {
  const g = await api("/api/e2e/zoho", { action: "write_to_real" });
  check("1 (h): a write at the REAL book is refused", g.json?.refused === true, JSON.stringify(g.json).slice(0, 160));
  const w = await api("/api/e2e/zoho", { action: "write_org" });
  check("1: the mapping carries the new groups (purchases, expense, paid-from)", !!w.json?.map?.purchases?.parts && !!w.json?.map?.expense?.commission && !!w.json?.map?.paidFrom, JSON.stringify(w.json?.map ?? {}).slice(0, 240));
});

/* ---------------- 2. the credit note hook (the owner's screen) ---------------- */
await section("2 credit note hook", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const [job] = await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]);
  customerId = job.customer_id;
  vehicleId = job.vehicle_id;
  const [inv] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ('INV-E2EZ2', 'tax_invoice', $1, $2, $3, 'e2e-z2-inv', 1000, 0, 1000, 50, 1050) returning id",
    [jobId, customerId, vehicleId],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Repair work', 1, 1000, 1000, 50, 1050, 0)", [inv.id]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  try {
    await go(page, `${base}/invoices/${inv.id}`);
    await page.locator('input[placeholder="Amount before VAT"]').fill("100");
    await page.locator('textarea[placeholder*="corrected"], input[placeholder*="corrected"]').first().fill("E2e goodwill credit");
    await page.getByRole("button", { name: /Issue a credit note/i }).click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const cn = await until(async () => (await sql("select id, number from public.invoices where kind = 'credit_note' and credit_of = $1", [inv.id]))[0]);
    check("2: the credit note exists", !!cn && /^CN-\d{5}$/.test(cn.number), JSON.stringify(cn));
    const rowCn = cn ? await until(async () => (await sql("select status from public.zoho_outbox where kind = 'creditnote' and record_id = $1", [cn.id]))[0]) : null;
    check("2: it joined the Zoho queue", rowCn?.status === "pending", JSON.stringify(rowCn));
    const rowInv = (await sql("select status from public.zoho_outbox where kind = 'invoice' and record_id = $1", [inv.id]))[0];
    check("2: the parent invoice is queued too (it posts first)", rowInv?.status === "pending", JSON.stringify(rowInv));
  } finally {
    await browser.close();
  }
});

/* ---------------- 3. the supplier invoice and mark-paid hooks (the LPO page) ---------------- */
await section("3 supplier invoice and payment hooks", async () => {
  const [sup] = await sql("insert into public.suppliers (name, phone) values ('E2e Hook Supplier', '+971500000098') returning id");
  supplierId = sup.id;
  const [part] = await sql("select id from public.part_items where job_id = $1 limit 1", [jobId]);
  const [po] = await sql(
    "insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ('LPO-E2EZ2-1', 'supplier', $1, $2, 'E2e Hook Supplier', 'received', 400, 'to_follow') returning id",
    [jobId, supplierId],
  );
  poId = po.id;
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost) values ($1, $2, 'Air filter', 2, 200)", [po.id, part.id]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1200 } });
  try {
    await go(page, `${base}/parts/orders/${po.id}`);
    const card = page.locator("[data-invoice-missing]");
    check("3: the amber invoice-missing card is there", (await card.count()) === 1);
    await page.locator('input[name="invoice_number"]').fill("E2EZ2-INV-77");
    await page.locator('input[name="invoice_date"]').fill(TODAY);
    await page.locator("[data-save-invoice]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const billRow = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'bill' and record_id = $1", [poId]))[0]);
    check("3: entering the invoice queued the bill", billRow?.status === "pending", JSON.stringify(billRow));
    // The scan on file (a row is enough for the gate), then Mark paid -> the payment joins the queue.
    await sql("insert into public.job_files (job_id, kind, ref_id, storage_path, content_type) values ($1, 'supplier_invoice', $2, $3, 'application/pdf')", [jobId, poId, `${jobId}/e2e-z2-scan.pdf`]);
    await go(page, `${base}/parts/orders/${po.id}`);
    await page.locator("[data-mark-supplier-paid]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const payRow = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'billpayment' and record_id = $1", [poId]))[0]);
    check("3: Mark paid queued the supplier payment", payRow?.status === "pending", JSON.stringify(payRow));
    const msg = decodeURIComponent(page.url());
    check("3: the LPO reads marked paid", /marked paid/i.test(msg), msg.slice(-120));
  } finally {
    await browser.close();
  }
});

/* ---------------- 4. the commission hook (the pay screen) ---------------- */
await section("4 commission hook", async () => {
  const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
  const [q] = await sql(
    "insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, token, vat_percent, commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, commission_decided_by, commission_decided_at, created_by, updated_by) values ('quotation', 'Q-E2EZ2', 1, $1, $2, $3, 'draft', 'e2e-z2-q', 5, 'E2e Payee Zoho', 'aed', 400, 400, 'approved', $4, now(), $4, now(), $4, $4) returning id",
    [jobId, customerId, vehicleId, advisor],
  );
  const [inv] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, token) values ('INV-E2EZ2B', 'tax_invoice', $1, $2, $3, 'issued', 800, 0, 800, 40, 840, 'e2e-z2-inv-b') returning id",
    [jobId, customerId, vehicleId],
  );
  await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, is_deposit, received_by, status, verified_at, verified_by, bank_charge_aed, client_key) values ($1, $2, $3, 'cash', 840, false, $4, 'recorded', now(), $4, 0, 'e2e-z2-pay')", [jobId, inv.id, customerId, advisor]);
  // The job must owe nothing for the commission to turn payable: the section-2 invoice is settled too.
  const [inv2] = await sql("select id from public.invoices where number = 'INV-E2EZ2'");
  await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, is_deposit, received_by, status, verified_at, verified_by, bank_charge_aed, client_key) values ($1, $2, $3, 'cash', 1050, false, $4, 'recorded', now(), $4, 0, 'e2e-z2-pay2')", [jobId, inv2.id, customerId, advisor]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1100 } });
  try {
    await go(page, `${base}/commissions`);
    await page.locator(`[data-pay-tick="${q.id}"]`).click();
    await sleep(300);
    await page.locator("[data-pay-save]").click();
    await page.waitForURL((u) => /voucher=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const v = await until(async () => (await sql("select cp.id, cp.number from public.commission_payments cp join public.quotations q on q.commission_payment_id = cp.id where q.id = $1", [q.id]))[0]);
    check("4: the voucher exists", !!v && /^CPV-\d{5}$/.test(v.number), JSON.stringify(v));
    const row = v ? await until(async () => (await sql("select status from public.zoho_outbox where kind = 'commission' and record_id = $1", [v.id]))[0]) : null;
    check("4: paying the voucher queued the expense", row?.status === "pending", JSON.stringify(row));
  } finally {
    await browser.close();
  }
});

/* ---------------- 5. the recovery-month hook ---------------- */
await section("5 recovery month hook", async () => {
  const month = TODAY.slice(0, 7);
  await sql("insert into public.recovery_trips (job_id, kind, company, location_details, status, price_aed, delivered_at) values ($1, 'delivery', 'E2e Rec Co', 'E2e pin', 'approved', 180, now())", [jobId]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1100 } });
  try {
    await go(page, `${base}/recovery?month=${month}`);
    const whoRow = page.locator("[data-recovery-who='E2e Rec Co']");
    await whoRow.locator("[data-month-pay]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const payout = await until(async () => (await sql("select id, total_aed::float as total from public.recovery_payouts where who = 'E2e Rec Co' and month = $1", [month]))[0]);
    check("5: the payout row exists (180.00)", !!payout && payout.total === 180, JSON.stringify(payout));
    const row = payout ? await until(async () => (await sql("select status from public.zoho_outbox where kind = 'recovery' and record_id = $1", [payout.id]))[0]) : null;
    check("5: marking the month paid queued the expense", row?.status === "pending", JSON.stringify(row));
  } finally {
    await browser.close();
  }
});

/* ---------------- 6. the mapping screen and the sync page ---------------- */
await section("6 mapping screen and sync page", async () => {
  const zohoConfigured = ((await sql("select count(*)::int as n from public.zoho_tokens where is_active"))[0]?.n ?? 0) > 0 && !!process.env.ZOHO_CLIENT_ID;
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1600 } });
  try {
    if (!zohoConfigured) {
      const stored = (await sql("select value from public.settings where key = 'zoho_account_map'"))[0]?.value;
      await go(page, `${base}/settings/zoho/mapping`);
      check("6: the purchases/expenses card carries five boxes", (await page.locator("[data-map-purchases] select").count()) === 5);
      check("6: the reference card gained the advances-refund box", (await page.locator('[data-map-box="map__advances_refund"]').count()) === 1);
      await page.screenshot({ path: "tests/browser/shots/zoho2-mapping.png", fullPage: true });
      await page.locator("[data-map-save]").click();
      await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      const saved = (await sql("select value from public.settings where key = 'zoho_account_map'"))[0]?.value;
      check("6: Save keeps the purchases and expense names", JSON.stringify(saved?.purchases) === JSON.stringify(stored?.purchases) && JSON.stringify(saved?.expense) === JSON.stringify(stored?.expense), JSON.stringify(saved?.purchases));
    } else console.log("NOTE  mapping screen skipped: a real connection + client id exist on this dev server");
    // A failed bill row shows with the supplier's invoice number and the honest Waiting wording.
    await sql("update public.zoho_outbox set status = 'failed', last_error = 'Mapping missing: Parts purchases. Pick the account on Settings > Zoho Books > Mapping.' where kind = 'bill' and record_id = $1", [poId]);
    await go(page, `${base}/zoho?show=failed`);
    const body = plainText(await page.content());
    check("6: the sync page names the bill by the supplier invoice and supplier", /E2EZ2-INV-77 · E2e Hook Supplier/.test(body), body.slice(0, 200));
    check("6: the kind chip reads Supplier bill", /Supplier bill/.test(body));
    await page.screenshot({ path: "tests/browser/shots/zoho2-sync-kinds.png", fullPage: true });
    await go(page, `${base}/dashboard`);
    const dash = plainText(await page.content());
    check("6: Waiting on you reads 'Supplier bill: Mapping missing…'", /Supplier bill: Mapping missing: Parts purchases/.test(dash), dash.slice(0, 200));
  } finally {
    await browser.close();
  }
});

cleanupDb();
process.exit(summary() ? 1 : 0);
