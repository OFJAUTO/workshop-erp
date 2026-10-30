// Proof for G1 and H of the 16 October batch: "New workshop order" on the Stock page with the kind of goods (stock
// parts, workshop consumables, tools and equipment flagged as a fixed asset above the Settings amount), stock items as
// parts or consumables; the part sticker (40 × 30: QR left, logo and job number right, the name and "1 OF 2" on the
// black strip) printed the moment a part is ticked received, a staff scan landing on the parts trail, a customer scan
// seeing "OFJ Automotive: genuine part"; the oil service and battery stickers in portrait with the WhatsApp booking
// QR and the warranty months chosen on the battery line; Settings > Stickers with sizes and printers.
//   node --env-file=.env.test.local tests/browser/test-v.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const only = (process.env.ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
async function section(name, fn) {
  if (only.length && !only.some((n) => name.startsWith(n + " "))) return;
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;

/* ---------------- 1. G1: a workshop order for tools, flagged as a fixed asset ---------------- */
await section("1 workshop order", async () => {
  const supplierId = (await sql("insert into public.suppliers (name, is_active, created_by) values ('E2e Tools Supplier', true, $1) returning id", [owner]))[0]?.id;
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/parts/stock`);
  check("1: the Stock page offers 'New workshop order'", (await page.locator("[data-new-workshop-order]").count()) === 1);
  await page.locator("[data-new-workshop-order]").click();
  await page.waitForURL(/order=1/, { timeout: 15000 });
  check("1: the order form asks what kind of goods", (await page.locator("input[name='order_type']").count()) === 3 && (await page.locator("input[name='order_type'][value='stock_parts']").isChecked()));
  check("1: the stock items show for stock parts, the tool lines do not", await page.locator("[data-tools-lines]").isHidden());
  await page.locator("input[name='order_type'][value='tools']").check({ force: true });
  await sleep(200);
  check("1: 'Tools and equipment' shows typed lines and hides the shelf list", await page.locator("[data-tools-lines]").isVisible());
  await page.locator("[data-stock-order-form] select[name='supplier_id']").selectOption(supplierId);
  await page.locator("input[name='tool_desc__1']").fill("E2e torque wrench 1/2 inch");
  await page.locator("input[name='tool_qty__1']").fill("1");
  await page.locator("input[name='tool_cost__1']").fill("2500");
  await page.locator("[data-raise-stock-order]").click();
  await submitted(page);
  const po = (await sql("select id, number, kind, order_type, fixed_asset, total_cost_aed, status from public.purchase_orders where supplier_name = 'E2e Tools Supplier' order by created_at desc limit 1"))[0];
  check("1: the order is raised as tools and equipment, a fixed asset (AED 2,500 ≥ the Settings amount), waiting for approval", !!po && po.kind === "stock" && po.order_type === "tools" && po.fixed_asset === true && Number(po.total_cost_aed) === 2500 && po.status === "pending_approval", JSON.stringify(po));
  const line = (await sql("select description, quantity, unit_cost, stock_item_id, part_item_id from public.purchase_order_lines where po_id = $1", [po?.id]))[0];
  check("1: the typed line is on the order with no stock item and no part", !!line && /torque wrench/i.test(line.description) && line.stock_item_id === null && line.part_item_id === null, JSON.stringify(line));
  const told = await sql("select title from public.notifications where type = 'fixed_asset' and href = $1", [`/parts/orders/${po?.id}`]);
  check("1: accounts are told 'Fixed asset to record'", told.length >= 1 && /Fixed asset to record/.test(told[0].title), JSON.stringify(told));
  await go(page, `${base}/parts/orders?tab=stock`);
  const row = page.locator(`[data-lpo-row='${po?.number}']`);
  check("1: the LPO list marks it 'Tools and equipment' and 'Fixed asset'", (await row.count()) === 1 && /Tools and equipment/.test((await row.textContent()) ?? "") && /Fixed asset/.test((await row.textContent()) ?? ""));
  await browser.close();
  // The owner approves; accounts hear again.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(op, `${base}/parts/orders/${po.id}`);
  await op.locator("button[name='decision'][value='approve']").click();
  await submitted(op);
  const approved = (await sql("select status from public.purchase_orders where id = $1", [po.id]))[0];
  const told2 = await sql("select title from public.notifications where type = 'fixed_asset' and title like 'Fixed asset approved%' and href = $1", [`/parts/orders/${po.id}`]);
  check("1: approved; accounts told 'Fixed asset approved'", approved?.status === "approved" && told2.length >= 1, JSON.stringify({ approved, told2 }));
  await go(op, `${base}/parts/stock`);
  check("1: every stock item has a kind (part or consumable), new items too", (await op.locator("[data-new-item-type]").count()) === 1);
  await ob.close();
  // Tidy: the test order and supplier go (the clean-up removes suppliers named E2e with no orders).
  await sql("delete from public.notifications where href = $1", [`/parts/orders/${po.id}`]);
});

/* ---------------- 2. H1: the part sticker printed the moment a part is received ---------------- */
await section("2 part sticker", async () => {
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const partId = (await sql("select id from public.part_items where job_id = $1 and is_active order by created_at limit 1", [jobId]))[0]?.id;
  await sql("update public.part_items set order_status = 'ordered', confirmed_quantity = 2, quantity = 2, description = 'Front brake pads' where id = $1", [partId]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/parts/${jobId}`);
  // The new flow: tick (on by default), Mark received, then Print stickers opens the sticker page in a new tab.
  await page.locator("[data-mark-received]").click();
  await page.locator("[data-receive-confirm]").waitFor({ timeout: 15000 });
  const [labels] = await Promise.all([page.waitForEvent("popup"), page.locator("[data-print-stickers]").click()]);
  await labels.waitForURL(/\/parts\/labels\//, { timeout: 20000 }).catch(() => null);
  check("2: Print stickers opens the sticker page at once with auto print", /\/parts\/labels\/.*parts=.*auto=1/.test(labels.url()), labels.url().slice(-120));
  await sleep(800);
  const stickers = labels.locator("[data-part-sticker]");
  check("2: one sticker per unit: 2 stickers for a quantity of 2", (await stickers.count()) === 2);
  const first = stickers.first();
  const size = await first.evaluate((el) => ({ w: el.style.width, h: el.style.height }));
  check("2: the sticker is 40 × 30 mm", size.w === "40mm" && size.h === "30mm", JSON.stringify(size));
  const text = (await first.textContent()) ?? "";
  const job = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number;
  check("2: it carries the job number, the part name and '1 OF 2'", text.includes(job) && /front brake pads/i.test(text) && /1 OF 2/.test(text), text.slice(0, 120));
  check("2: the second says '2 OF 2'", /2 OF 2/.test((await stickers.nth(1).textContent()) ?? ""));
  check("2: the name strip prints in capitals", (await first.locator("[data-fit-text]").last().evaluate((el) => getComputedStyle(el).textTransform)) === "uppercase");
  const qrW = parseFloat(await first.locator("img").first().evaluate((el) => el.style.width));
  check("2: the QR on the left is about 20 mm", qrW >= 18 && qrW <= 21, String(qrW));
  const code = (await sql("select code from public.qr_links where kind = 'part' and ref_id = $1", [partId]))[0]?.code;
  check("2: the QR is a short link of this part", !!code);
  check("2: the print bar has Print all (N) and names the printer", /Print all \(2\)/.test((await labels.locator(".bar").textContent()) ?? "") && /Printer 1/.test((await labels.locator(".bar").textContent()) ?? ""));
  await labels.close();
  // A customer scanning the sticker sees only that it is genuine and when it was fitted.
  await sql("update public.part_items set fitted_at = '2026-10-16T08:00:00Z' where id = $1", [partId]);
  const pub = await fetch(`${base}/s/${code}`);
  const html = await pub.text();
  check("2: a customer scan says 'OFJ Automotive: genuine part' and 'Fitted on 16 Oct 2026'", pub.status === 200 && /OFJ Automotive: genuine part/.test(html) && /Fitted on 16 Oct 2026/.test(html) && !/Stage Test Customer/.test(html));
  // A staff scan lands on the part on the job's parts trail, with the LPO and invoice number.
  await go(page, `${base}/s/${code}`);
  await page.waitForURL(/\/parts\/trail\//, { timeout: 15000 }).catch(() => null);
  check("2: a staff scan lands on the parts trail at that part", new RegExp(`/parts/trail/${jobId}\\?part=${partId}`).test(page.url()) && (await page.locator(`[data-trail-part='${partId}']`).count()) === 1, page.url().slice(-100));
  await browser.close();
});

/* ---------------- 3. H2: the battery warranty on the line, the oil service sticker, Settings ---------------- */
await section("3 large stickers", async () => {
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const partId = (await sql("select id from public.part_items where job_id = $1 and is_active order by created_at limit 1", [jobId]))[0]?.id;
  await sql("update public.part_items set description = 'Main battery AGM 95Ah' where id = $1", [partId]);
  await sql("update public.quotation_lines set title = 'Main battery AGM 95Ah' where part_item_id = $1", [partId]);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);
  const chooser = page.locator(`[data-warranty='${partId}']`);
  check("3: the battery line offers the warranty months (12, 24, 36)", (await chooser.count()) === 1 && (await chooser.locator("button").count()) === 3);
  await chooser.locator("[data-warranty-months='24']").click();
  const saved = await until(async () => ((await sql("select warranty_months from public.part_items where id = $1", [partId]))[0]?.warranty_months === 24 ? 1 : null), 30, 500);
  check("3: 24 months is saved on the part", !!saved);
  await browser.close();
  // The oil service sticker: portrait, the plate, the WhatsApp QR.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 900, height: 1200 } });
  await go(op, `${base}/print/service-sticker/${jobId}`);
  const svc = op.locator("[data-service-sticker]");
  const ssize = await svc.evaluate((el) => ({ w: el.style.width, h: el.style.height }));
  const plate = (await sql("select v.plate_code, v.plate_number from public.vehicles v join public.jobs j on j.vehicle_id = v.id where j.id = $1", [jobId]))[0];
  check("3: the oil service sticker is 50 × 100 mm portrait", (await svc.count()) === 1 && ssize.w === "50mm" && ssize.h === "100mm", JSON.stringify(ssize));
  const stext = (await svc.textContent()) ?? "";
  check("3: it carries the plate, the next service band and 'Scan to book'", new RegExp(String(plate?.plate_number ?? "")).test(stext) && /Next service/i.test(stext) && /Scan to book/i.test(stext), stext.slice(0, 160));
  check("3: the print bar names Printer 2", /Print on Printer 2/.test((await op.locator(".bar").textContent()) ?? ""));
  // Settings > Stickers: the sizes, the printers, the WhatsApp number and text.
  await go(op, `${base}/settings/stickers`);
  check("3: Settings shows the battery sticker as 50 × 100", (await op.locator("[data-battery-w]").inputValue()) === "50" && (await op.locator("[data-battery-h]").inputValue()) === "100");
  check("3: Settings shows the printer names and the WhatsApp message", /Printer 1/.test(await op.locator("[data-printer-part]").inputValue()) && /\[PLATE\]/.test(await op.locator("[data-wa-text]").inputValue()));
  await op.locator("[data-wa-number]").fill("971501234567");
  await op.locator("button", { hasText: /^Save sticker settings$/ }).click();
  await submitted(op);
  const wa = (await sql("select value from public.settings where key = 'sticker_service_whatsapp_number'"))[0]?.value;
  check("3: the WhatsApp number saves", wa === "971501234567", JSON.stringify(wa));
  await sql("update public.settings set value = '\"\"'::jsonb where key = 'sticker_service_whatsapp_number'");
  // The test pages render the new layouts.
  for (const kind of ["part", "battery", "service"]) {
    const r = await fetch(`${base}/print/sticker-test?kind=${kind}`, { headers: { cookie: await cookieHeader("owner") } });
    const h = await r.text();
    check(`3: the ${kind} test sticker renders`, r.status === 200 && new RegExp(`data-${kind}-sticker`).test(h));
  }
  const pdf = await fetch(`${base}/api/pdf/stickers/service-${jobId}`, { headers: { cookie: await cookieHeader("owner") } });
  check("3: the service sticker PDF renders", pdf.status === 200 && /pdf/.test(pdf.headers.get("content-type") ?? ""), String(pdf.status));
  await ob.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
