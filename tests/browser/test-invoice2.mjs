// Supplier invoice rules (20 October 2026, part 2 section 2): number AND date compulsory, "Invoice
// to follow" shows the amber Invoice missing badge and reminds Parts daily, the LPO cannot be marked
// paid without number + date + file, and the invoice takes several files with thumbnails and an X.
//   node --env-file=.env.local tests/browser/test-invoice2.mjs
import { Buffer } from "node:buffer";
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;

// A received supplier LPO whose invoice is still to follow.
const po = (await sql(`insert into public.purchase_orders (job_id, number, supplier_name, status, kind, total_cost_aed, supplier_invoice_status, received_at)
  values ($1, 'LPO-E2E9', 'E2e Supplier', 'received', 'supplier', 100, 'to_follow', now() - interval '3 days') returning id`, [jobId]))[0];
check("test LPO made", !!po?.id);
await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, received_qty) values ($1, 'E2E PART', 1, 100, 1)", [po.id]);

// The daily reminder to Parts (cron step 24): stamped on the LPO, one notification to the parts role.
const cron = await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
const cronBody = await cron.json().catch(() => ({}));
check("cron ran", cron.status === 200, JSON.stringify(cronBody).slice(0, 200));
const stamped = (await sql("select invoice_reminder_at is not null as s from public.purchase_orders where id = $1", [po.id]))[0];
check("the LPO is stamped reminded", stamped?.s === true);
const note = await sql("select n.id from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'supplier_invoice_missing' and n.href = $1 and s.role_id = 'parts'", [`/parts/orders/${po.id}`]);
check("Parts got the Invoice missing reminder", note.length >= 1, `rows ${note.length}`);

// Parts open the LPO: the amber badge, the missing text, the compulsory date box.
const { browser, page } = await browserFor("parts", { viewport: { width: 1500, height: 1100 } });
await page.goto(`${base}/parts/orders/${po.id}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const body0 = (await page.textContent("body")) ?? "";
check("the amber Invoice missing badge", /Invoice missing/i.test(body0));
check("the chase-it line", (await page.locator("[data-invoice-missing]").count()) === 1);
check("the date box exists and is required", (await page.locator("[data-invoice-date][required]").count()) >= 1);
await page.screenshot({ path: `${shots}/invoice-missing.png` });

// Enter number and date (no file): saved; the date is stored.
await page.fill("input[name=invoice_number]", "SI-778");
await page.fill("[data-invoice-date]", "2026-10-18");
await page.getByRole("button", { name: "Save the supplier invoice" }).click();
await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 });
const inv = (await sql("select supplier_invoice_status as st, supplier_invoice_number as n, supplier_invoice_date::text as d from public.purchase_orders where id = $1", [po.id]))[0];
check("number and date saved", inv?.st === "received" && inv?.n === "SI-778" && inv?.d === "2026-10-18", JSON.stringify(inv));
await browser.close();

// Accounts: cannot mark paid without the file; two files up, one removed with the X; then Paid.
const acc = await browserFor("accounts", { viewport: { width: 1500, height: 1100 } });
const p2 = acc.page;
await p2.goto(`${base}/parts/orders/${po.id}`, { waitUntil: "load" });
await p2.waitForTimeout(1500);
check("pay blocked without the file", /scan or photo/i.test((await p2.locator("[data-pay-blocked]").textContent().catch(() => "")) ?? ""));
// A tiny PNG twice (an invoice photographed page by page).
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGNgYGD4z4AGMAXIVQEAvqgD/aXCeBkAAAAASUVORK5CYII=", "base64");
for (const name of ["invoice-page-1.png", "invoice-page-2.png"]) {
  await p2.locator("[data-invoice-files] input[type=file]").setInputFiles({ name, mimeType: "image/png", buffer: png });
  await p2.waitForTimeout(2500);
}
check("two thumbnails", (await p2.locator("[data-invoice-files] [data-invoice-file]").count()) === 2);
check("each has the X", (await p2.locator("[data-invoice-files] [data-remove-file]").count()) === 2);
await p2.screenshot({ path: `${shots}/invoice-files.png` });
await p2.locator("[data-invoice-files] [data-remove-file]").last().click();
await p2.waitForTimeout(1500);
check("one thumbnail after the X", (await p2.locator("[data-invoice-files] [data-invoice-file]").count()) === 1);
const removedRow = await sql("select count(*)::int as n from public.job_files where kind = 'supplier_invoice' and ref_id = $1 and removed_at is not null", [po.id]);
check("the removed file is marked, not deleted", removedRow[0]?.n === 1);

// With number, date and a file on record the pay form appears; Paid to supplier records who and when.
await p2.reload({ waitUntil: "load" });
await p2.waitForTimeout(1500);
check("the pay form appears", (await p2.locator("[data-pay-form]").count()) === 1);
await p2.fill("[data-pay-form] input[name=reference]", "TRF 4411");
await p2.locator("[data-mark-supplier-paid]").click();
await p2.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 });
const paid = (await sql("select supplier_paid_at is not null as p, supplier_paid_reference as r from public.purchase_orders where id = $1", [po.id]))[0];
check("marked paid with the reference", paid?.p === true && paid?.r === "TRF 4411", JSON.stringify(paid));
const body2 = (await p2.textContent("body")) ?? "";
check("the page says Paid to supplier", /Paid to supplier/i.test(body2) || /Paid to E2e Supplier/i.test(body2));
await p2.screenshot({ path: `${shots}/supplier-paid.png` });
await acc.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
