// SUPPLIER INVOICES tab + notification (1 November 2026). Parts receive with the invoice and its photo → accounts are
// told ("Supplier invoice · E2E SPARE HUB · INV-4512 · AED 520.00 + VAT · LPO · car · parts") and it waits on their
// Waiting on you; the same invoice entered on a second car's LPO is ONE row split over two jobs; an LPO received with
// the invoice to follow is "Waiting for invoice"; the same supplier, date and amount under another number is a possible
// duplicate; the row opens next to its parts per car (approved vs invoiced price); Mark checked queues the bills for
// Zoho; the status runs New → Checked → Sent to Zoho → Paid; filters, totals, search, the Excel export, the tile and
// the job card.
// Run: node --env-file=.env.test.local tests/browser/test-supplier-invoices.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "supplier-invoices");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const J2 = "22222222-0000-4000-8000-00000000e3a1";

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const desk = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const acc = (await sql("select id, display_name from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1440, h = 1000) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };
const png = path.join(dir, "e2e-invoice.png");
// A small grey picture standing in for the photo of the supplier's invoice.
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNoaGjAgxhGpbFIAwDdcwIBtxZC4AAAAABJRU5ErkJggg==", "base64"));

cleanupDb();
try {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const job = (await sql("select job_number, customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
  await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E SPARE HUB', '100200300400500', true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E SPARE HUB')", [owner.id]);
  const sup = (await sql("select id, name from public.suppliers where name ilike 'E2E SPARE HUB'"))[0];
  // A second car of the same customer whose LPO the same invoice covers too.
  await sql("insert into public.jobs (id, vehicle_id, customer_id, stage, status, priority, department, is_open, gated_in_at, gated_in_by, created_by, updated_by) values ($1, $2, $3, 'parts', 'waiting_parts', 'normal', 'mechanical', true, now(), $4, $4, $4) on conflict (id) do nothing", [J2, job.vehicle_id, job.customer_id, owner.id]);
  const mkPo = async (jid, number, total, partName, qty, unit, extra = "") => {
    const po = (await sql(`insert into public.purchase_orders (job_id, number, supplier_id, supplier_name, status, kind, total_cost_aed, approved_at, ordered_at${extra ? ", supplier_invoice_status, received_at" : ""}) values ($1, $2, $3, $4, 'ordered', 'supplier', $5, now(), now()${extra ? `, '${extra}', now()` : ""}) returning id, number`, [jid, number, sup.id, sup.name, total]))[0];
    const part = (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, supplier, cost_aed, availability, order_status, confirm_status, po_id, created_by, updated_by) values ($1, $2, $3, $3, $4, $5, 'to_order', 'ordered', 'confirmed', $6, $7, $7) returning id", [jid, partName, qty, sup.name, unit, po.id, desk.id]))[0];
    const line = (await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, part_item_id, position) values ($1, $2, $3, $4, $5, 1) returning id", [po.id, partName, qty, unit, part.id]))[0];
    await sql("update public.part_items set po_line_id = $1 where id = $2", [line.id, part.id]);
    return { ...po, partId: part.id };
  };
  const poA = await mkPo(jobId, "LPO-E2ESI-1", 520, "E2E FRONT RH WISHBONE LINK", 2, 260);
  const poB = await mkPo(J2, "LPO-E2ESI-2", 400, "E2E REAR STABILISER LINK", 2, 200);
  const poC = await mkPo(jobId, "LPO-E2ESI-3", 150, "E2E CABIN FILTER", 1, 150, "to_follow");
  await sql("update public.part_items set order_status = 'received', received_qty = 1 where id = $1", [poC.partId]);
  await sql("update public.purchase_order_lines set received_qty = 1 where po_id = $1", [poC.id]);
  const poD = await mkPo(jobId, "LPO-E2ESI-4", 520, "E2E BRAKE HOSE", 2, 260);

  /* ---------- A. Parts receive with the invoice and its photo: accounts are told ---------- */
  const parts = await open(desk.id, 1500, 1400);
  await go(parts.page, `${base}/parts/${jobId}`);
  for (const id of [poC.partId, poD.partId]) await parts.page.locator(`[data-receive-row="${id}"] button`).click().catch(() => {});
  // Only the wishbone links stay ticked.
  const ticked = await parts.page.locator("[data-receive-row] button[aria-pressed='true']").count();
  if (ticked > 1) for (const id of [poC.partId, poD.partId]) if ((await parts.page.locator(`[data-receive-row="${id}"] button[aria-pressed='true']`).count())) await parts.page.locator(`[data-receive-row="${id}"] button`).click();
  await parts.page.locator("[data-mark-received]").click();
  await sleep(400);
  await parts.page.locator("[data-invoice-number]").fill("INV-4512");
  await parts.page.locator("[data-invoice-date]").fill(today);
  await parts.page.locator("[data-invoice-amount]").pressSequentially("520", { delay: 15 });
  await parts.page.locator('[data-supplier-invoice-box] input[type="file"]').setInputFiles(png);
  await until(async () => (await parts.page.locator("[data-supplier-invoice-box] [data-remove-file]").count()) > 0, 40, 400);
  await parts.page.screenshot({ path: shot("a1-parts-receive-with-invoice.png") });
  await parts.page.locator("[data-no-stickers]").click();
  const recA = await until(async () => (await sql("select supplier_invoice_number from public.purchase_orders where id = $1 and supplier_invoice_status = 'received'", [poA.id]))[0]);
  check("A: the parts and the invoice are saved on the LPO", recA?.supplier_invoice_number === "INV-4512");
  // THIS invoice's notice (3 November 2026: older notices of other tests' invoices sit on the shared TEST database, so
  // "the newest one" could be read before this one was written).
  const note = await until(async () => (await sql("select title, body, href from public.notifications where staff_id = $1 and type = 'supplier_invoice_received' and body like '%LPO-E2ESI-1%' order by created_at desc limit 1", [acc.id]))[0]);
  check(`A: accounts are told ("${note?.title}")`, note?.title === "Supplier invoice · E2E SPARE HUB · INV-4512 · AED 520.00 + VAT");
  check(`A: the notice names the LPO, the car and the parts ("${note?.body}")`, (note?.body ?? "").includes("LPO-E2ESI-1") && (note?.body ?? "").includes(job.job_number) && /1 part received/.test(note?.body ?? ""));
  const noBill = (await sql("select count(*)::int as n from public.zoho_outbox where kind = 'bill' and record_id = $1", [poA.id]))[0];
  check("A: no bill goes to Zoho before accounts check it", noBill?.n === 0);

  // The second car's LPO gets the same invoice (its share) and the duplicate under another number.
  await sql("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = 'INV-4512', supplier_invoice_date = $2, supplier_invoice_amount = 400, supplier_invoice_at = now(), received_at = now() where id = $1", [poB.id, today]);
  await sql("update public.purchase_order_lines set received_qty = 2, invoice_unit_cost = 210, invoice_check = 'mismatch' where po_id = $1", [poB.id]);
  await sql("update public.part_items set order_status = 'received', received_qty = 2 where id = $1", [poB.partId]);
  await sql("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = 'INV-9999', supplier_invoice_date = $2, supplier_invoice_amount = 520, supplier_invoice_at = now(), received_at = now() where id = $1", [poD.id, today]);

  /* ---------- B. The tab ---------- */
  const accB = await open(acc.id, 1440, 1000);
  const page = accB.page;
  await go(page, `${base}/supplier-invoices`);
  const row = page.locator(`[data-si-row="${sup.id}|INV4512"]`);
  const rowText = await text(row);
  check(`B: one row for INV-4512 over two cars (${rowText.slice(0, 140)})`, (await row.count()) === 1 && rowText.includes("LPO-E2ESI-1") && rowText.includes("LPO-E2ESI-2"));
  check("B: TRN, before VAT 920.00, VAT 46.00 and total 966.00", rowText.includes("TRN 100200300400500") && rowText.includes("before VAT 920.00") && rowText.includes("VAT 46.00") && rowText.includes("AED 966.00"));
  check("B: its match says the price changed (the second car's line)", (await row.locator("[data-si-match='price_changed']").count()) === 1);
  check("B: status New", (await row.getAttribute("data-si-state")) === "new");
  const waiting = page.locator("[data-si-row][data-si-state='waiting']");
  check(`B: the LPO received without its invoice is "Waiting for invoice"`, (await waiting.count()) === 1 && (await text(waiting)).includes("Invoice missing"));
  const dup = await text(page.locator(`[data-si-row="${sup.id}|INV9999"]`).locator("[data-si-duplicate]"));
  check(`B: the same supplier, date and amount under another number is a possible duplicate ("${dup}")`, /Possible duplicate of INV-4512/.test(dup));
  const totals = await text(page.locator("[data-si-totals]"));
  check(`B: totals at the top with unpaid per supplier ("${totals.slice(0, 120)}")`, /invoices · AED/.test(totals) && totals.includes("E2E SPARE HUB"));
  await page.screenshot({ path: shot("b1-supplier-invoices-tab.png"), fullPage: true });
  // Filters and search.
  await go(page, `${base}/supplier-invoices?status=waiting`);
  check("B: the Waiting for invoice filter", (await page.locator("[data-si-row]").count()) >= 1 && (await page.locator("[data-si-row]:not([data-si-state='waiting'])").count()) === 0);
  await go(page, `${base}/supplier-invoices?q=stabiliser`);
  check("B: search by part name finds the invoice", (await page.locator(`[data-si-row="${sup.id}|INV4512"]`).count()) === 1);
  await go(page, `${base}/supplier-invoices?problems=1`);
  check("B: the match-problems filter keeps the price change and the duplicate", (await page.locator(`[data-si-row="${sup.id}|INV4512"]`).count()) === 1 && (await page.locator(`[data-si-row="${sup.id}|INV9999"]`).count()) === 1);

  /* ---------- C. Opened next to its parts, per car ---------- */
  await go(page, `${base}/supplier-invoices`);
  await page.locator(`[data-si-row="${sup.id}|INV4512"]`).locator("[data-si-open]").click();
  await page.locator("[data-si-opened]").waitFor({ timeout: 15000 });
  check("C: the invoice photo shows (zoomable)", (await page.locator("[data-si-opened] [data-si-image]").count()) >= 1);
  check("C: the parts per car: two cars", (await page.locator("[data-si-opened] [data-si-car]").count()) === 2);
  const prices = await page.locator("[data-si-opened] [data-si-prices]").allTextContents();
  check(`C: approved vs invoiced price (${prices.join(" | ")})`, prices.some((p) => /Approved 200\.00 · invoiced 210\.00/.test(p)));
  await page.screenshot({ path: shot("c1-invoice-opened.png"), fullPage: true });
  // Waiting on you and the tile.
  await go(page, `${base}/dashboard`);
  check("C: accounts' Waiting on you has the invoice to check", (await text(page.locator("[data-waiting-row]").filter({ hasText: "INV-4512" }))).includes("Supplier invoice to check"));
  const tile = page.locator("[data-tile='Supplier invoices to check']");
  check("C: the SUPPLIER INVOICES TO CHECK box opens the tab", (await tile.count()) === 1 && (await tile.getAttribute("href")) === "/supplier-invoices");
  const tileCount = Number((await text(tile)).match(/\d+/)?.[0] ?? 0);
  check(`C: its count includes new, waiting for invoice and price differs (${tileCount})`, tileCount >= 3);

  /* ---------- D. Checked → Sent to Zoho → Paid ---------- */
  // Since the LPO price changes (1 November 2026, night) Mark checked waits while a price is above the limit: the
  // second car's line (200 → 210) first takes the owner's OK (the OK button itself is proven by test-price-changes).
  await go(page, `${base}/supplier-invoices?open=${encodeURIComponent(`${sup.id}|INV4512`)}`);
  await page.locator("[data-si-check]").click();
  await page.waitForURL(/error=/, { timeout: 20000 }).catch(() => {});
  check("D: Mark checked waits for the owner's OK on the higher price, saying so inside the opened invoice", /owner's OK/.test(await text(page.locator("[data-si-opened] [data-si-outcome='error']"))));
  await sql("update public.purchase_order_lines set invoice_check = 'accepted' where po_id = $1 and invoice_check = 'mismatch'", [poB.id]);
  await go(page, `${base}/supplier-invoices?open=${encodeURIComponent(`${sup.id}|INV4512`)}`);
  await page.locator("[data-si-check]").click();
  const checked = await until(async () => { const r = await sql("select count(*)::int as n from public.purchase_orders where id = any($1::uuid[]) and supplier_invoice_checked_at is not null", [[poA.id, poB.id]]); return r[0]?.n === 2 ? r : null; });
  check("D: Mark checked checks both LPOs of the invoice", !!checked);
  const bills = (await sql("select count(*)::int as n from public.zoho_outbox where kind = 'bill' and record_id = any($1::uuid[])", [[poA.id, poB.id]]))[0];
  check(`D: both bills are queued for Zoho Books (OFJ TEST until go-live) (${bills?.n})`, bills?.n === 2);
  await page.waitForURL(/message=/, { timeout: 20000 }).catch(() => {});
  check("D: status Checked by accounts", (await page.locator(`[data-si-row="${sup.id}|INV4512"]`).getAttribute("data-si-state")) === "checked");
  // The Zoho run (live cron, not from a test machine tonight) gives the bill ids; then Paid to supplier.
  await sql("update public.purchase_orders set zoho_bill_id = 'e2e-bill' where id = any($1::uuid[])", [[poA.id, poB.id]]);
  await go(page, `${base}/supplier-invoices`);
  check("D: status Sent to Zoho (bill) once the bills posted", (await page.locator(`[data-si-row="${sup.id}|INV4512"]`).getAttribute("data-si-state")) === "zoho");
  await sql("update public.purchase_orders set supplier_paid_at = now(), supplier_paid_method = 'transfer', supplier_paid_reference = 'E2E-TT-1' where id = any($1::uuid[])", [[poA.id, poB.id]]);
  await go(page, `${base}/supplier-invoices`);
  check("D: status Paid to supplier", (await page.locator(`[data-si-row="${sup.id}|INV4512"]`).getAttribute("data-si-state")) === "paid");
  await page.screenshot({ path: shot("d1-statuses.png"), fullPage: true });

  /* ---------- E. Export, the job card, the LPO ---------- */
  const cookie = (await accB.context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${base}/api/export/supplier-invoices`, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  check(`E: Export to Excel gives a real .xlsx (${buf.length} bytes)`, res.status === 200 && /spreadsheetml/.test(res.headers.get("content-type") ?? "") && buf.slice(0, 2).toString() === "PK");
  const ownB = await open(owner.id);
  await go(ownB.page, `${base}/jobs/${J2}`);
  const jc = await text(ownB.page.locator("[data-job-supplier-invoices]"));
  check(`E: the second car's job card shows its share of the invoice ("${jc.slice(0, 100)}")`, jc.includes("INV-4512") && jc.includes("AED 400.00 of 920.00"));
  await ownB.page.locator("[data-job-supplier-invoices]").scrollIntoViewIfNeeded().catch(() => {});
  await ownB.page.screenshot({ path: shot("e1-job-card-invoices.png") });
  await go(ownB.page, `${base}/parts/orders/${poA.id}`);
  check("E: the LPO links to its supplier invoice", (await ownB.page.locator("[data-lpo-invoice-link]").count()) === 1);
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  await sql("delete from public.zoho_outbox where record_id in (select id from public.purchase_orders where number like 'LPO-E2ESI-%')").catch(() => {});
  cleanupDb();
}
summary();
