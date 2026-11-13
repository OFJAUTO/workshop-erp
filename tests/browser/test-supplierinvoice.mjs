// ONE supplier-invoice component (21 October 2026, part 2 section 2.5; reworked 4 November 2026: the
// invoice is entered by ACCOUNTS only). Parts receive with NO invoice box (the panel says the paper
// goes to accounts, the line reads "Received · invoice with accounts", accounts get the collect-and-scan
// bell); accounts enter it on the LPO page through THE box with the same rules: a keyboard-mash number
// ("wdwdwdw") is refused live and by the server, a future date is refused, an amount more than 5% off
// the LPO total needs the "amount is right" tick (AED 500,000 on a 14,782 order), files upload with an
// X, and the daily reminder goes to ACCOUNTS once, not twice.
//   node --env-file=.env.test.local tests/browser/test-supplierinvoice.mjs
import { writeFileSync } from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, sql, typeReceiptNumber, confirmCheckIfShown } from "./pw-lib.mjs";

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

// ---- Batch 1: Parts receive part A alone - NO invoice box, the paper goes to accounts. ----
const desk = await browserFor("parts", { viewport: { width: 1500, height: 1400 } });
const page = desk.page;
await page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);
check("the receiving panel lists both ordered parts", (await page.locator("[data-receive-row]").count()) === 2);
await page.locator(`[data-receive-row="${partB.id}"] button`).click(); // untick part B
await page.locator("[data-mark-received]").click();
await page.waitForTimeout(400);
check("NO supplier-invoice box in the receiving panel", (await page.locator("[data-receive-confirm] [data-supplier-invoice-box]").count()) === 0);
check("the panel asks the supplier invoice number (13 Nov)", (await page.locator("[data-receipt-number]").count()) === 1);
await page.screenshot({ path: `${shots}/supplier-invoice-box.png`, fullPage: true });
await typeReceiptNumber(page);
await page.locator("[data-no-stickers]").click(); await confirmCheckIfShown(page);
await page.waitForTimeout(2500);
check("the delivery saves with no invoice asked", /received/i.test((await page.locator('[data-receive-panel] [role="alert"]').textContent().catch(() => "")) ?? ""));
check("part A is received", (await sql("select order_status from public.part_items where id = $1", [partA.id]))[0].order_status === "received");
const po1After = (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po1.id]))[0];
check("the LPO is marked invoice-to-follow by itself", po1After?.supplier_invoice_status === "to_follow");
const collectBell = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'supplier_invoice_missing' and s.role_id = 'accounts' and n.href like $1", [`%${po1.id}%`]);
check("accounts get the collect-and-scan bell at the receive", (collectBell[0]?.n ?? 0) >= 1, `rows ${collectBell[0]?.n}`);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("the received line reads invoice-with-accounts", (await page.locator(`[data-received-line="${partA.id}"] [data-received-words="invoice-with-accounts"]`).count()) === 1);

// ---- Accounts enter po1 on the LPO page: THE box, the same rules as ever. ----
const acc = await browserFor("accounts", { viewport: { width: 1500, height: 1400 } });
const p2 = acc.page;
const lpoUrl = `${base}/parts/orders/${po1.id}`;
await p2.goto(lpoUrl, { waitUntil: "load" });
await p2.waitForTimeout(1500);
check("the LPO page shows the amber with-accounts line and THE box", (await p2.locator("[data-invoice-missing]").count()) === 1 && (await p2.locator("[data-supplier-invoice-box]").count()) === 1);

// A keyboard-mash number is called out live and refused by the server.
await p2.locator("[data-invoice-number]").pressSequentially("wdwdwdw", { delay: 20 });
await p2.waitForTimeout(300);
check("'wdwdwdw' is called out live", (await p2.locator("[data-number-bad]").count()) === 1);
await p2.locator("[data-invoice-date]").fill(today);
await p2.locator("[data-save-invoice]").click();
await p2.waitForURL((u) => u.search.includes("error="), { timeout: 15000 });
check("the server refuses the mash number", /real invoice number/i.test(decodeURIComponent(p2.url())));
check("the LPO stays to-follow on a refusal", (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po1.id]))[0].supplier_invoice_status === "to_follow");

// A future date is called out and refused.
await p2.goto(lpoUrl, { waitUntil: "load" });
await p2.waitForTimeout(1200);
await p2.locator("[data-invoice-number]").fill("INV-2211");
await p2.waitForTimeout(250);
check("a real number clears the warning", (await p2.locator("[data-number-bad]").count()) === 0);
await p2.locator("[data-invoice-date]").fill(tomorrow);
await p2.waitForTimeout(250);
check("a future date is called out live", (await p2.locator("[data-date-bad]").count()) === 1);
// The date box carries max=today, so the browser itself stops the submit (no server round-trip to wait for).
await p2.locator("[data-save-invoice]").click();
await p2.waitForTimeout(1500);
check("the save is stopped with the future date (no navigation)", !p2.url().includes("message=") && (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po1.id]))[0].supplier_invoice_status === "to_follow");

// AED 500,000 against a 14,782 order: the tick is demanded, then the save goes through.
await p2.goto(lpoUrl, { waitUntil: "load" });
await p2.waitForTimeout(1200);
await p2.locator("[data-invoice-number]").fill("INV-2211");
await p2.locator("[data-invoice-date]").fill(today);
await p2.locator("[data-invoice-amount]").pressSequentially("500000", { delay: 15 });
await p2.waitForTimeout(400);
const amountCheck = (await p2.locator("[data-amount-check]").textContent().catch(() => "")) ?? "";
check("the 5% cross-check appears with the two figures", /500,000/.test(amountCheck) && /14,782/.test(amountCheck));
await p2.locator("[data-save-invoice]").click();
await p2.waitForURL((u) => u.search.includes("error="), { timeout: 15000 });
check("without the tick the save is refused", /check the figure/i.test(decodeURIComponent(p2.url())));
check("still to-follow without the tick", (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po1.id]))[0].supplier_invoice_status === "to_follow");

// Fill again, upload one file (the X shows), tick the amount, save: received.
await p2.goto(lpoUrl, { waitUntil: "load" });
await p2.waitForTimeout(1200);
await p2.locator("[data-invoice-number]").fill("INV-2211");
await p2.locator("[data-invoice-date]").fill(today);
await p2.locator("[data-invoice-amount]").pressSequentially("500000", { delay: 15 });
await p2.waitForTimeout(400);
await p2.locator('[data-supplier-invoice-box] input[type="file"]').setInputFiles(png);
let removeBtn = 0;
for (let i = 0; i < 25 && !removeBtn; i++) { await p2.waitForTimeout(400); removeBtn = await p2.locator("[data-supplier-invoice-box] [data-remove-file]").count(); }
check("the uploaded file shows with an X to remove it", removeBtn >= 1);
await p2.locator("[data-amount-confirm]").check();
await p2.screenshot({ path: `${shots}/supplier-invoice-lpo.png`, fullPage: true });
await p2.locator("[data-save-invoice]").click();
await p2.waitForURL((u) => u.search.includes("message="), { timeout: 15000 });
const po1Row = (await sql("select supplier_invoice_number, supplier_invoice_date::text as supplier_invoice_date, supplier_invoice_amount, supplier_invoice_status from public.purchase_orders where id = $1", [po1.id]))[0];
check("the LPO carries number, date, amount, status received", po1Row.supplier_invoice_number === "INV-2211" && po1Row.supplier_invoice_date === today && Number(po1Row.supplier_invoice_amount) === 500000 && po1Row.supplier_invoice_status === "received");
const filed = await sql("select count(*)::int as n from public.job_files where kind = 'supplier_invoice' and ref_id = $1 and removed_at is null", [po1.id]);
check("the uploaded file sits on the LPO", (filed[0]?.n ?? 0) === 1);
await p2.waitForTimeout(500);
check("the amber missing line is gone", (await p2.locator("[data-invoice-missing]").count()) === 0);

// ---- Batch 2: part B received by Parts; the daily reminder goes to ACCOUNTS once, not twice. ----
await page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator("[data-mark-received]").click();
await page.waitForTimeout(400);
await typeReceiptNumber(page);
await page.locator("[data-no-stickers]").click(); await confirmCheckIfShown(page);
let followed = false;
for (let i = 0; i < 40 && !followed; i++) {
  followed = (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po2.id]))[0]?.supplier_invoice_status === "to_follow" && (await sql("select order_status from public.part_items where id = $1", [partB.id]))[0]?.order_status === "received";
  if (!followed) await page.waitForTimeout(500);
}
check("the delivery records with the invoice to follow by itself", followed, ((await page.locator('[data-receive-panel] [role="alert"]').textContent().catch(() => "")) ?? "").slice(0, 160));

// The daily reminder (cron step 24): to ACCOUNTS, once, not twice.
const cron = async () => (await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
await cron();
const bells = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'supplier_invoice_missing' and n.title = $1 and s.role_id = 'accounts'", [`Invoice missing · ${po2.number}`]);
// 13 November 2026: the invoice number is typed at receiving, so the old daily "Invoice missing" bell stops; only an
// "Invoice comes later" receipt is reminded (day 3, day 5, overdue: test-receipts).
check("receipts carry the number: no old daily 'Invoice missing' bell", (bells[0]?.n ?? 0) === 0);
const partsBells = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'supplier_invoice_missing' and n.title = $1 and s.role_id = 'parts'", [`Invoice missing · ${po2.number}`]);
check("Parts get NO daily reminder", (partsBells[0]?.n ?? 0) === 0);
await cron();
const bells2 = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'supplier_invoice_missing' and n.title = $1 and s.role_id = 'accounts'", [`Invoice missing · ${po2.number}`]);
check("the reminder never fires twice the same day", bells2[0]?.n === bells[0]?.n);

// ---- The invoice entered later by accounts lands on the LPO; the amber line goes. ----
const lpo2Url = `${base}/parts/orders/${po2.id}`;
await p2.goto(lpo2Url, { waitUntil: "load" });
await p2.waitForTimeout(1500);
check("po2 shows the amber line and THE box for accounts", (await p2.locator("[data-invoice-missing]").count()) === 1 && (await p2.locator("[data-supplier-invoice-box]").count()) === 1);
await p2.locator("[data-invoice-number]").fill("INV-2212");
await p2.locator("[data-invoice-date]").fill(today);
await p2.locator("[data-save-invoice]").click();
await p2.waitForURL((u) => u.search.includes("message="), { timeout: 15000 });
const po2Row = (await sql("select supplier_invoice_number, supplier_invoice_status from public.purchase_orders where id = $1", [po2.id]))[0];
check("the invoice entered later lands on the LPO", po2Row.supplier_invoice_number === "INV-2212" && po2Row.supplier_invoice_status === "received");
await p2.waitForTimeout(800);
check("the amber missing line is gone on po2", (await p2.locator("[data-invoice-missing]").count()) === 0);

await acc.browser.close();
await desk.browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
