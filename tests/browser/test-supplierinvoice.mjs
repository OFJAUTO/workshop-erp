// ONE supplier-invoice component (21 October 2026, part 2 section 2.5): the receiving panel and the LPO
// page share SupplierInvoiceBox and the server shares checkSupplierInvoice. Proofs: a keyboard-mash
// number ("wdwdwdw") is refused, a future date is refused, an amount more than 5% off the LPO total
// needs the "amount is right" tick (AED 500,000 on a 14,782 order), "Invoice to follow" marks the LPO
// amber + accounts list + daily Parts reminder (once), files upload with an X, and the same box saves
// the invoice later from the LPO page.
//   node --env-file=.env.local tests/browser/test-supplierinvoice.mjs
import { writeFileSync } from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 28 * 3600000).toISOString().slice(0, 10);

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
let parts = await sql("select id, description from public.part_items where job_id = $1 and is_active order by created_at limit 2", [jobId]);
if (parts.length < 2) {
  await sql("insert into public.part_items (job_id, description, quantity, supplier, cost_aed, availability, order_status) values ($1, 'E2E Second Part', 1, 'E2e Supplier', 300, 'to_order', 'none')", [jobId]);
  parts = await sql("select id, description from public.part_items where job_id = $1 and is_active order by created_at limit 2", [jobId]);
}
const [partA, partB] = parts;
// Two supplier LPOs out for delivery: the amount cross-check reads the LPO's own total (14,782).
const po1 = (await sql(`insert into public.purchase_orders (job_id, number, supplier_name, status, kind, total_cost_aed, approved_at, ordered_at)
  values ($1, 'LPO-E2EI-1', 'E2e Supplier', 'ordered', 'supplier', 14782, now(), now()) returning id, number`, [jobId]))[0];
await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, part_item_id) values ($1, $2, 1, 14782, $3)", [po1.id, partA.description, partA.id]);
await sql("update public.part_items set po_id = $1, order_status = 'ordered', availability = 'to_order', supplier = 'E2e Supplier', cost_aed = 14782 where id = $2", [po1.id, partA.id]);
const po2 = (await sql(`insert into public.purchase_orders (job_id, number, supplier_name, status, kind, total_cost_aed, approved_at, ordered_at)
  values ($1, 'LPO-E2EI-2', 'E2e Trading', 'ordered', 'supplier', 300, now(), now()) returning id, number`, [jobId]))[0];
await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, part_item_id) values ($1, $2, 1, 300, $3)", [po2.id, partB.description, partB.id]);
await sql("update public.part_items set po_id = $1, order_status = 'ordered', availability = 'to_order', supplier = 'E2e Trading', cost_aed = 300 where id = $2", [po2.id, partB.id]);
// A one-pixel PNG for the upload proof.
const png = `${shots}/e2e-invoice.png`;
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

const desk = await browserFor("parts", { viewport: { width: 1500, height: 1400 } });
const page = desk.page;
await page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);

// ---- Batch 1: part A alone (one LPO, total 14,782) ----
check("the receiving panel lists both ordered parts", (await page.locator("[data-receive-row]").count()) === 2);
await page.locator(`[data-receive-row="${partB.id}"] button`).click(); // untick part B
await page.locator("[data-mark-received]").click();
await page.waitForTimeout(400);
check("THE supplier-invoice box sits in the receiving panel", (await page.locator("[data-receive-confirm] [data-supplier-invoice-box]").count()) === 1);

// A keyboard-mash number is called out live and refused by the server.
await page.locator("[data-invoice-number]").pressSequentially("wdwdwdw", { delay: 20 });
await page.waitForTimeout(300);
check("'wdwdwdw' is called out live", (await page.locator("[data-number-bad]").count()) === 1);
await page.locator("[data-invoice-date]").fill(today);
await page.locator("[data-no-stickers]").click();
await page.waitForTimeout(1500);
check("the server refuses the mash number", /real invoice number/i.test((await page.locator('[data-receive-panel] [role="alert"]').textContent().catch(() => "")) ?? ""));
check("nothing was received on a refusal", (await sql("select order_status from public.part_items where id = $1", [partA.id]))[0].order_status === "ordered");

// A future date is called out and refused.
await page.locator("[data-invoice-number]").fill("INV-2211");
await page.waitForTimeout(250);
check("a real number clears the warning", (await page.locator("[data-number-bad]").count()) === 0);
await page.locator("[data-invoice-date]").fill(tomorrow);
await page.waitForTimeout(250);
check("a future date is called out live", (await page.locator("[data-date-bad]").count()) === 1);
await page.locator("[data-no-stickers]").click();
await page.waitForTimeout(1500);
check("the server refuses the future date", /future/i.test((await page.locator('[data-receive-panel] [role="alert"]').textContent().catch(() => "")) ?? ""));

// AED 500,000 against a 14,782 order: the tick is demanded, then the save goes through.
await page.locator("[data-invoice-date]").fill(today);
await page.locator("[data-invoice-amount]").pressSequentially("500000", { delay: 15 });
await page.waitForTimeout(400);
check("the 5% cross-check appears with the two figures", /500,000/.test((await page.locator("[data-amount-check]").textContent().catch(() => "")) ?? "") && /14,782/.test((await page.locator("[data-amount-check]").textContent().catch(() => "")) ?? ""));
await page.locator("[data-no-stickers]").click();
await page.waitForTimeout(1500);
check("without the tick the save is refused", /check the figure/i.test((await page.locator('[data-receive-panel] [role="alert"]').textContent().catch(() => "")) ?? ""));
// Upload one file, see the X, keep it.
await page.locator('[data-supplier-invoice-box] input[type="file"]').setInputFiles(png);
let removeBtn = 0;
for (let i = 0; i < 25 && !removeBtn; i++) { await page.waitForTimeout(400); removeBtn = await page.locator("[data-supplier-invoice-box] [data-remove-file]").count(); }
check("the uploaded file shows with an X to remove it", removeBtn >= 1);
await page.locator("[data-amount-confirm]").check();
await page.screenshot({ path: `${shots}/supplier-invoice-box.png`, fullPage: true });
await page.locator("[data-no-stickers]").click();
await page.waitForTimeout(2500);
check("with the tick the delivery and the invoice save", /received/i.test((await page.locator('[data-receive-panel] [role="alert"]').textContent().catch(() => "")) ?? ""));
const po1Row = (await sql("select supplier_invoice_number, supplier_invoice_date::text as supplier_invoice_date, supplier_invoice_amount, supplier_invoice_status from public.purchase_orders where id = $1", [po1.id]))[0];
check("the LPO carries number, date, amount, status received", po1Row.supplier_invoice_number === "INV-2211" && po1Row.supplier_invoice_date === today && Number(po1Row.supplier_invoice_amount) === 500000 && po1Row.supplier_invoice_status === "received");
check("part A is received", (await sql("select order_status from public.part_items where id = $1", [partA.id]))[0].order_status === "received");
const filed = await sql("select count(*)::int as n from public.job_files where kind = 'supplier_invoice' and ref_id = $1 and removed_at is null", [po1.id]);
check("the uploaded file re-points to the LPO", (filed[0]?.n ?? 0) === 1);

// ---- Batch 2: part B with "Invoice to follow" ----
await page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator("[data-mark-received]").click();
await page.waitForTimeout(400);
await page.locator("[data-to-follow]").check();
await page.waitForTimeout(250);
check("to-follow folds the fields away and says what happens", (await page.locator("[data-invoice-number]").count()) === 0 && /Invoice missing/.test((await page.locator("[data-supplier-invoice-box]").textContent()) ?? ""));
await page.locator("[data-no-stickers]").click();
await page.waitForTimeout(2000);
check("the delivery records with the invoice marked to follow", (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po2.id]))[0].supplier_invoice_status === "to_follow" && (await sql("select order_status from public.part_items where id = $1", [partB.id]))[0].order_status === "received");

// The daily Parts reminder (cron step 24): once, not twice.
const cron = async () => (await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
await cron();
const bells = await sql("select count(*)::int as n from public.notifications where type = 'supplier_invoice_missing' and title = $1", [`Invoice missing · ${po2.number}`]);
check("Parts get the daily 'Invoice missing' reminder", (bells[0]?.n ?? 0) >= 1);
await cron();
const bells2 = await sql("select count(*)::int as n from public.notifications where type = 'supplier_invoice_missing' and title = $1", [`Invoice missing · ${po2.number}`]);
check("the reminder never fires twice the same day", bells2[0]?.n === bells[0]?.n);

// ---- The LPO page: the SAME box, amber "Invoice missing", the same rules. ----
await page.goto(`${base}/parts/orders/${po2.id}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
check("the LPO page shows the amber missing line and THE box", (await page.locator("[data-invoice-missing]").count()) === 1 && (await page.locator("[data-supplier-invoice-box]").count()) === 1);
await page.screenshot({ path: `${shots}/supplier-invoice-lpo.png`, fullPage: true });
await page.locator("[data-invoice-number]").fill("wdwdwdw");
await page.locator("[data-invoice-date]").fill(today);
await page.locator("[data-save-invoice]").click();
await page.waitForURL((u) => u.search.includes("error="), { timeout: 15000 });
check("the LPO page refuses the mash number too", /real\+?invoice|real%20invoice/i.test(decodeURIComponent(page.url())) || /real invoice number/i.test(decodeURIComponent(page.url())));
await page.locator("[data-invoice-number]").fill("INV-2212");
await page.locator("[data-invoice-date]").fill(today);
await page.locator("[data-save-invoice]").click();
await page.waitForURL((u) => u.search.includes("message="), { timeout: 15000 });
const po2Row = (await sql("select supplier_invoice_number, supplier_invoice_status from public.purchase_orders where id = $1", [po2.id]))[0];
check("the invoice entered later lands on the LPO", po2Row.supplier_invoice_number === "INV-2212" && po2Row.supplier_invoice_status === "received");
await page.waitForTimeout(800);
check("the amber missing line is gone", (await page.locator("[data-invoice-missing]").count()) === 0);

await desk.browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
