// SUPPLIER INVOICE PRICE DIFFERENT FROM THE APPROVED LPO (1 November 2026, LPO-00035-2: wishbone links approved at
// 250.00, invoiced at 260.00). A: Parts receive with the invoice and type 260 beside each part → the job's cost follows
// the invoice, the LPO keeps 250 and shows "Approved 250.00 · invoiced 260.00 (+10.00 each, +20.00 total)", the price up
// is within the limit (the higher of 5% or AED 100) → accepted, the owner told; the job card shows "Supplier price
// change: −AED 40.00". B: a price up above the limit waits for the owner (accounts cannot check the invoice until he
// says OK). C: a price down is accepted at once. D: a short delivery is "Quantity different" and the rest stays to
// receive. E: the owner's monthly report per supplier.
// Run: node --env-file=.env.test.local tests/browser/test-price-changes.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "price-changes");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const png = path.join(dir, "invoice.png");
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNoaGjAgxhGpbFIAwDdcwIBtxZC4AAAAABJRU5ErkJggg==", "base64"));

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const desk = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const acc = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1500, h = 1400) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };

cleanupDb();
try {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  await sql("insert into public.suppliers (name, trn, created_by, updated_by) select 'E2E SPARE HUB', '100200300400500', $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E SPARE HUB')", [owner.id]);
  const sup = (await sql("select id, name from public.suppliers where name ilike 'E2E SPARE HUB'"))[0];
  const mkPo = async (number, lines) => {
    const total = lines.reduce((a, l) => a + l.qty * l.unit, 0);
    const po = (await sql("insert into public.purchase_orders (job_id, number, supplier_id, supplier_name, status, kind, total_cost_aed, approved_at, ordered_at) values ($1, $2, $3, $4, 'ordered', 'supplier', $5, now(), now()) returning id, number", [jobId, number, sup.id, sup.name, total]))[0];
    const out = [];
    let pos = 1;
    for (const l of lines) {
      const part = (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, supplier, cost_aed, availability, order_status, confirm_status, po_id, created_by, updated_by) values ($1, $2, $3, $3, $4, $5, 'to_order', 'ordered', 'confirmed', $6, $7, $7) returning id", [jobId, l.name, l.qty, sup.name, l.unit, po.id, desk.id]))[0];
      const line = (await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, part_item_id, position) values ($1, $2, $3, $4, $5, $6) returning id", [po.id, l.name, l.qty, l.unit, part.id, pos++]))[0];
      await sql("update public.part_items set po_line_id = $1 where id = $2", [line.id, part.id]);
      out.push({ partId: part.id, lineId: line.id });
    }
    return { ...po, lines: out };
  };
  const poA = await mkPo("LPO-E2EPC-1", [{ name: "E2E FRONT RH WISHBONE LINK", qty: 2, unit: 250 }, { name: "E2E FRONT LH WISHBONE LINK", qty: 2, unit: 250 }]);
  // Only LPO A's parts on the receiving panel for now.
  await sql("update public.part_items set order_status = 'received', received_qty = coalesce(confirmed_quantity, quantity) where job_id = $1 and po_id is distinct from $2", [jobId, poA.id]);

  /* ---------- A. Received at 260 each: within the limit ---------- */
  const parts = await open(desk.id);
  await go(parts.page, `${base}/parts/${jobId}`);
  await parts.page.locator("[data-mark-received]").click();
  await parts.page.locator("[data-invoice-number]").fill("INV-2374");
  await parts.page.locator("[data-invoice-date]").fill(today);
  await parts.page.locator("[data-invoice-amount]").pressSequentially("1040", { delay: 10 });
  for (const l of poA.lines) await parts.page.locator(`[data-invoice-price="${l.partId}"]`).fill("260");
  await parts.page.locator('[data-supplier-invoice-box] input[type="file"]').setInputFiles(png);
  await until(async () => (await parts.page.locator("[data-supplier-invoice-box] [data-remove-file]").count()) > 0, 40, 400);
  await parts.page.locator("[data-receive-confirm]").screenshot({ path: shot("a1-receive-with-invoice-price.png") });
  await parts.page.locator("[data-no-stickers]").click();
  const linesA = await until(async () => { const r = await sql("select invoice_unit_cost::float as inv, invoice_check from public.purchase_order_lines where po_id = $1 order by position", [poA.id]); return r.every((x) => x.inv === 260) ? r : null; });
  check("A: the 260 is saved on both LPO lines", !!linesA);
  check("A: within the limit: accepted at once", linesA?.every((x) => x.invoice_check === "accepted"));
  const costs = await sql("select cost_aed::float as approved, final_cost_aed::float as invoiced from public.part_items where id = any($1::uuid[])", [poA.lines.map((l) => l.partId)]);
  check("A: the job's cost follows the invoice (260), the approved price stays (250)", costs.every((c) => c.approved === 250 && c.invoiced === 260));
  const ownerNote = (await sql("select title, href from public.notifications where staff_id = $1 and title like 'Price up after approval · LPO-E2EPC-1%' order by created_at desc limit 1", [owner.id]))[0];
  check(`A: the owner is told, the invoice one tap away ("${ownerNote?.title}")`, !!ownerNote && /supplier-invoices\?open=/.test(ownerNote.href ?? ""));
  const own = await open(owner.id);
  await go(own.page, `${base}/parts/orders/${poA.id}`);
  const shown = await own.page.locator("[data-price-change]").allTextContents();
  check(`A: the LPO shows both prices ("${shown[0]}")`, shown.length === 2 && shown.every((t) => t.startsWith("Approved 250.00 · invoiced 260.00 (+10.00 each, +20.00 total)")));
  await own.page.screenshot({ path: shot("a2-lpo-both-prices.png"), fullPage: true });
  await go(own.page, `${base}/jobs/${jobId}`);
  const jc = await text(own.page.locator("[data-job-price-change]"));
  check(`A: the job card shows the profit drop ("${jc}")`, jc === "Supplier price change: −AED 40.00");
  await own.page.locator("[data-job-supplier-invoices]").scrollIntoViewIfNeeded().catch(() => {});
  await own.page.screenshot({ path: shot("a3-job-card-price-change.png") });

  /* ---------- B. Above the limit: the owner's OK first ---------- */
  const poB = await mkPo("LPO-E2EPC-2", [{ name: "E2E GEARBOX MOUNT", qty: 1, unit: 1000 }]);
  await go(parts.page, `${base}/parts/orders/${poB.id}`);
  await parts.page.locator('input[name="invoice_number"]').fill("INV-9001");
  await parts.page.locator('input[name="invoice_date"]').fill(today);
  await parts.page.locator("[data-receive-form] details summary").click();
  await parts.page.locator(`[data-invoice-price="${poB.lines[0].lineId}"]`).fill("1200");
  await parts.page.locator("[data-record-delivery]").click();
  const lineB = await until(async () => (await sql("select invoice_unit_cost::float as inv, invoice_check from public.purchase_order_lines where id = $1 and invoice_unit_cost is not null", [poB.lines[0].lineId]))[0]);
  check(`B: +AED 200 on a 1,000 LPO is above the limit (AED 100): it waits for the owner (${lineB?.invoice_check})`, lineB?.inv === 1200 && lineB?.invoice_check === "mismatch");
  const okNote = (await sql("select title from public.notifications where staff_id = $1 and title like 'Your OK needed · LPO-E2EPC-2%' limit 1", [owner.id]))[0];
  check(`B: the owner is asked ("${okNote?.title}")`, !!okNote);
  const accB = await open(acc.id);
  await go(accB.page, `${base}/supplier-invoices?open=${encodeURIComponent(`${sup.id}|INV9001`)}`);
  await accB.page.locator("[data-si-check]").click();
  await accB.page.waitForURL(/error=|message=/, { timeout: 20000 }).catch(() => {});
  check("B: accounts cannot check it before the owner's OK", /waits for the owner/.test(decodeURIComponent(accB.page.url().replace(/\+/g, " "))) && !(await sql("select supplier_invoice_checked_at from public.purchase_orders where id = $1", [poB.id]))[0]?.supplier_invoice_checked_at);
  await go(accB.page, `${base}/parts/orders/${poB.id}`);
  check("B: accounts see no OK button (the owner's call)", (await accB.page.locator("[data-price-ok]").count()) === 0);
  await go(own.page, `${base}/parts/orders/${poB.id}`);
  await own.page.screenshot({ path: shot("b1-owner-ok-or-query.png"), fullPage: true });
  await own.page.locator("[data-price-ok]").click();
  const okd = await until(async () => (await sql("select invoice_check from public.purchase_order_lines where id = $1 and invoice_check = 'accepted'", [poB.lines[0].lineId]))[0]);
  check("B: the owner's OK accepts it", !!okd);

  /* ---------- C. A price down: accepted at once ---------- */
  const poC = await mkPo("LPO-E2EPC-3", [{ name: "E2E CABIN FILTER", qty: 1, unit: 300 }]);
  await go(parts.page, `${base}/parts/orders/${poC.id}`);
  await parts.page.locator('input[name="invoice_number"]').fill("INV-9002");
  await parts.page.locator('input[name="invoice_date"]').fill(today);
  await parts.page.locator("[data-receive-form] details summary").click();
  await parts.page.locator(`[data-invoice-price="${poC.lines[0].lineId}"]`).fill("280");
  await parts.page.locator("[data-record-delivery]").click();
  const lineC = await until(async () => (await sql("select invoice_unit_cost::float as inv, invoice_check from public.purchase_order_lines where id = $1 and invoice_unit_cost is not null", [poC.lines[0].lineId]))[0]);
  check(`C: a price down is accepted at once (${lineC?.invoice_check})`, lineC?.inv === 280 && lineC?.invoice_check === "accepted");

  /* ---------- D. One delivered instead of two ---------- */
  const poD = await mkPo("LPO-E2EPC-4", [{ name: "E2E BRAKE HOSE", qty: 2, unit: 50 }]);
  await sql("update public.purchase_order_lines set received_qty = 1 where id = $1", [poD.lines[0].lineId]);
  await sql("update public.part_items set order_status = 'partly_received', received_qty = 1 where id = $1", [poD.lines[0].partId]);
  await sql("update public.purchase_orders set status = 'partly_received', supplier_invoice_status = 'received', supplier_invoice_number = 'INV-9003', supplier_invoice_date = $2, supplier_invoice_amount = 50, supplier_invoice_at = now() where id = $1", [poD.id, today]);
  await go(accB.page, `${base}/supplier-invoices?problems=1`);
  check("D: a short delivery shows Quantity different", (await accB.page.locator(`[data-si-row="${sup.id}|INV9003"] [data-si-match="quantity_different"]`).count()) === 1);
  check("D: the missing one stays to receive", (await sql("select order_status from public.part_items where id = $1", [poD.lines[0].partId]))[0]?.order_status === "partly_received");

  /* ---------- E. The owner's report ---------- */
  await go(own.page, `${base}/reports/supplier-prices`);
  const supRow = await text(own.page.locator("[data-sp-supplier]").filter({ hasText: /E2E SPARE HUB/i }));
  check(`E: the monthly report counts the supplier's changes ("${supRow}")`, /4 times/.test(supRow) && /\+AED 240\.00/.test(supRow) && /−AED 20\.00/.test(supRow));
  await own.page.screenshot({ path: shot("e1-supplier-price-report.png"), fullPage: true });
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
summary();
