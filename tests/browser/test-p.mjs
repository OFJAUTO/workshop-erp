// Proof for PART C of the night batch: the labels prompt after a delivery (C1), the LPO list with tabs, search and
// the stock-order badge (C2), Returns and leftovers with Scrap and Keep in stock onto the shelf (C3), the supplier
// purchase totals (C4), the supplier invoice asked for at receipt with the > AED 1 mismatch and Accept new price (C5),
// the price memory (C6), and real stock: a stock order through approval, ordered and received onto the shelf with the
// averaged cost, the low-stock reminder from the hourly job, the monthly count (C7).
//   node --env-file=.env.local tests/browser/test-p.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const afterSubmit = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => null); await sleep(600); };
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
let jobId = null;
let supplierId = null;
let stockPoId = null;
let itemId = null;

/* ---------------- 1. Labels prompt, returns and leftovers, price memory ---------------- */
await section("1 labels, returns and leftovers, price memory", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  jobId = seed.json.jobId;
  // The seeded brake pads arrive: the parts page prompts for the labels.
  await sql("update public.part_items set order_status = 'received', received_qty = 1, priced_at = now(), part_number = 'E2E-PM-1', list_price_aed = 100, discount_percent = 10, cost_aed = 90 where id = '22222222-0000-4000-8000-00000000e306'");
  const page = await fetchAs(`/parts/${jobId}`, "parts");
  check("1: the parts page prompts to print the labels of a received part", page.status === 200 && /data-labels-prompt/.test(page.text) && /Print labels \(1\)/.test(plainText(page.text)));
  // Price memory: the last price given for that part number.
  const mem = await fetch(`${base}/api/parts/price-memory?pn=${encodeURIComponent("e2e pm 1")}`, { headers: { cookie: await cookieHeader("parts") } });
  const mj = await mem.json().catch(() => ({}));
  check("1: the price memory finds the last price by part number, spaces and case ignored", mem.status === 200 && mj.memory?.net === 90 && mj.memory?.list_price === 100 && mj.memory?.discount === 10, JSON.stringify(mj));
  // Returns and leftovers: a second part is not needed; one is scrapped, one kept in stock.
  await sql("insert into public.part_items (id, job_id, description, part_number, quantity, cost_aed, order_status, received_qty, not_needed_at, not_needed_by, not_needed_reason, created_by, updated_by) values ('22222222-0000-4000-8000-00000000e3a1', $1, 'E2E Oil Filter', 'E2E-OF-1', 2, 30, 'received', 2, now(), $2, 'Customer declined', $2, $2), ('22222222-0000-4000-8000-00000000e3a2', $1, 'E2E Wiper Blade', 'E2E-WB-1', 1, 15, 'received', 1, now(), $2, 'Wrong size', $2, $2)", [jobId, owner]);
  const desk = await fetchAs("/parts", "parts");
  check("1: the parts desk has the Returns and leftovers tab with a count", /data-returns-tab/.test(desk.text) && /Returns and leftovers \(2\)/.test(plainText(desk.text)));
  const { browser, page: p } = await browserFor("parts", { viewport: { width: 1366, height: 1200 } });
  await go(p, `${base}/parts/no-home`);
  check("1: the page is called Returns and leftovers", /Returns and leftovers/.test(plainText(await p.content())));
  // Keep the oil filter in stock.
  const filterCard = p.locator("[data-no-home='22222222-0000-4000-8000-00000000e3a1']");
  await filterCard.getByRole("button", { name: /Moved to stock/ }).click();
  await filterCard.getByRole("button", { name: /Save the ending/ }).click();
  await afterSubmit(p);
  const stockRow = await until(async () => (await sql("select i.id, i.name, i.quantity::float as quantity, i.unit_cost::float as cost, (select count(*)::int from public.stock_movements m where m.stock_item_id = i.id and m.kind = 'in') as moves from public.stock_items i where i.part_number = 'E2E-OF-1'"))[0], 30, 500);
  check("1: Keep in stock puts the part on the shelf as real stock with its cost", stockRow?.quantity === 2 && stockRow?.cost === 30 && stockRow?.moves === 1, JSON.stringify(stockRow));
  // Scrap the wiper blade with a reason.
  const wiperCard = p.locator("[data-no-home='22222222-0000-4000-8000-00000000e3a2']");
  await wiperCard.getByRole("button", { name: /^Scrap$/ }).click();
  await wiperCard.locator("textarea[name='note']").fill("Bent in the box");
  await wiperCard.getByRole("button", { name: /Save the ending/ }).click();
  await afterSubmit(p);
  const scrapped = await until(async () => (await sql("select disposition, disposition_note from public.part_items where id = '22222222-0000-4000-8000-00000000e3a2'"))[0]?.disposition === "scrap" ? 1 : null, 30, 500);
  check("1: Scrap with a reason ends the part", !!scrapped);
  check("1: the returns page is empty again", !/E2E Wiper Blade|E2E Oil Filter/.test(plainText(await (await fetchAs("/parts/no-home", "parts")).text)));
  await browser.close();
});

/* ---------------- 2. Real stock: an item below minimum, a stock order through approval and receipt ---------------- */
await section("2 stock order", async () => {
  supplierId = (await sql("insert into public.suppliers (name, email, created_by, updated_by) values ('E2E Stock Supplier', 'stock@e2e.test', $1, $1) returning id", [owner]))[0]?.id;
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 1400 } });
  await go(page, `${base}/parts/stock`);
  const form = page.locator("form", { has: page.locator("[data-add-stock-item]") });
  await form.locator('input[name="name"]').fill("E2E Brake Cleaner");
  await form.locator('input[name="part_number"]').fill("E2E-BC-500");
  await form.locator('input[name="minimum_level"]').fill("5");
  await form.locator('input[name="reorder_quantity"]').fill("12");
  await form.locator('input[name="unit_cost"]').fill("10");
  await form.locator('select[name="supplier_id"]').selectOption(supplierId);
  await form.locator("[data-add-stock-item]").click();
  await afterSubmit(page);
  const item = await until(async () => (await sql("select id, quantity::float as quantity, minimum_level::float as minimum from public.stock_items where name ilike 'e2e brake cleaner'"))[0], 30, 500);
  itemId = item?.id ?? null;
  check("2: the item is on the stock list and below its minimum", !!itemId && (await page.locator(`[data-stock-item="${itemId}"][data-low="1"]`).count()) === 1);
  await page.locator(`[data-reorder="${itemId}"]`).click();
  await page.locator("[data-stock-order-form]").waitFor({ timeout: 10000 });
  check("2: Reorder opens the stock order with the reorder quantity filled in", (await page.locator(`[data-order-line="${itemId}"] input[name="qty__${itemId}"]`).inputValue()) === "12");
  await page.locator("[data-raise-stock-order]").click();
  await page.waitForURL((u) => /\/parts\/orders\/[0-9a-f-]{36}/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  stockPoId = (page.url().match(/\/parts\/orders\/([0-9a-f-]{36})/) ?? [])[1] ?? null;
  const po = stockPoId ? (await sql("select number, kind, status, job_id, total_cost_aed::float as total from public.purchase_orders where id = $1", [stockPoId]))[0] : null;
  check("2: the stock order is an LPO with no job, waiting for approval, AED 120", po?.kind === "stock" && po?.status === "pending_approval" && po?.job_id === null && po?.total === 120, JSON.stringify(po));
  await browser.close();
  const list = await fetchAs("/parts/orders?tab=stock", "parts");
  check("2: the LPO list's Stock orders tab shows it with the badge", new RegExp(`data-lpo-row="${po?.number}"`).test(list.text) && /Stock order/.test(plainText(list.text)) && /data-lpo-tabs/.test(list.text));
  const found = await fetchAs(`/parts/orders?q=${encodeURIComponent("brake cleaner")}`, "parts");
  check("2: the search finds it by the item on its lines", new RegExp(`data-lpo-row="${po?.number}"`).test(found.text));
  // The owner approves; Parts mark it ordered; the delivery lands on the shelf.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1400 } });
  await go(op, `${base}/parts/orders/${stockPoId}`);
  await op.getByRole("button", { name: /^Approve$/ }).click();
  await afterSubmit(op);
  check("2: the owner approves it with one tap", (await sql("select status from public.purchase_orders where id = $1", [stockPoId]))[0]?.status === "approved");
  await ob.close();
  const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1366, height: 1400 } });
  await go(pp, `${base}/parts/orders/${stockPoId}`);
  await pp.locator("[data-lpo-ordered]").click();
  await afterSubmit(pp);
  check("2: Parts mark it ordered", (await sql("select status from public.purchase_orders where id = $1", [stockPoId]))[0]?.status === "ordered");
  await go(pp, `${base}/parts/orders/${stockPoId}`);
  check("2: the delivery form asks for the supplier invoice at the same time", (await pp.locator("[data-invoice-at-receipt]").count()) === 1);
  await pp.locator('[data-invoice-mode="now"]').click();
  await pp.locator('input[name="invoice_number"]').fill("SINV-E2E-1");
  await pp.locator("[data-receive-form] details summary").click();
  const lineId = (await sql("select id from public.purchase_order_lines where po_id = $1", [stockPoId]))[0]?.id;
  await pp.locator(`[data-invoice-price="${lineId}"]`).fill("12");
  await pp.locator("[data-record-delivery]").click();
  await afterSubmit(pp);
  const after = (await sql("select i.quantity::float as quantity, i.unit_cost::float as cost, i.low_notified_at, (select count(*)::int from public.stock_movements m where m.stock_item_id = i.id and m.kind = 'in' and m.po_id = $2) as moves from public.stock_items i where i.id = $1", [itemId, stockPoId]))[0];
  check("2: the delivery lands on the shelf with the cost averaged in", after?.quantity === 12 && after?.cost === 10 && after?.moves === 1, JSON.stringify(after));
  const poAfter = (await sql("select status, supplier_invoice_status, supplier_invoice_number, supplier_invoice_checked_at from public.purchase_orders where id = $1", [stockPoId]))[0];
  const line = (await sql("select invoice_unit_cost::float as price, invoice_check from public.purchase_order_lines where id = $1", [lineId]))[0];
  check("2: the invoice is saved and the price more than AED 1 off is flagged for a decision", poAfter?.status === "received" && poAfter?.supplier_invoice_status === "received" && poAfter?.supplier_invoice_number === "SINV-E2E-1" && !poAfter?.supplier_invoice_checked_at && line?.price === 12 && line?.invoice_check === "mismatch", JSON.stringify({ poAfter, line }));
  const notif = await until(async () => (await sql("select title from public.notifications where type = 'supplier_invoice_mismatch' and href = $1 limit 1", [`/parts/orders/${stockPoId}`]))[0], 20, 500);
  check("2: accounts and the owner are told about the price difference", !!notif, notif?.title);
  await pb.close();
  // Accounts see the invoice to check and accept the new price.
  const acc = await fetchAs("/dashboard", "accounts");
  check("2: the accounts dashboard counts the invoice to check", /Supplier invoices to check/.test(plainText(acc.text)) && /data-tile="Supplier invoices to check"[^>]*>[\s\S]*?<span class="text-xl font-extrabold">[1-9]/.test(acc.text));
  const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1366, height: 1400 } });
  await go(ap, `${base}/parts/orders/${stockPoId}`);
  check("2: Accept new price and Dispute sit on the flagged line", (await ap.locator(`[data-invoice-check="${lineId}"]`).count()) === 1);
  await ap.locator(`[data-invoice-check="${lineId}"] button[value="accept"]`).click();
  await afterSubmit(ap);
  const decided = (await sql("select l.invoice_check, p.supplier_invoice_checked_at from public.purchase_order_lines l join public.purchase_orders p on p.id = l.po_id where l.id = $1", [lineId]))[0];
  check("2: Accept new price settles the line and the LPO", decided?.invoice_check === "accepted" && !!decided?.supplier_invoice_checked_at, JSON.stringify(decided));
  await ab.close();
  const totals = await fetchAs("/parts/suppliers/totals", "parts");
  check("2: the supplier purchase totals list the supplier with AED 120", /data-supplier-total="E2E Stock Supplier"/i.test(totals.text) && /AED 120/.test(plainText(totals.text)));
});

/* ---------------- 3. Low stock reminder and the monthly count ---------------- */
await section("3 low stock and the count", async () => {
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 1400 } });
  await go(page, `${base}/parts/stock`);
  const details = page.locator(`[data-stock-item="${itemId}"] details`);
  await details.locator("summary").click();
  const adjust = details.locator("form", { has: page.locator('input[name="delta"]') });
  await adjust.locator('input[name="delta"]').fill("-9");
  await adjust.locator('input[name="note"]').fill("Spilled a box");
  await adjust.getByRole("button", { name: /^Adjust$/ }).click();
  await afterSubmit(page);
  check("3: an adjustment takes stock off with a reason", (await sql("select quantity::float as q from public.stock_items where id = $1", [itemId]))[0]?.q === 3);
  const cron = await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  const cj = await cron.json().catch(() => ({}));
  const low = await until(async () => (await sql("select title from public.notifications where type = 'stock_low' and title ilike '%e2e brake cleaner%' limit 1"))[0], 10, 500);
  check("3: the hourly job tells Parts once that the item is below its minimum", cron.status === 200 && !!low && !!(await sql("select low_notified_at from public.stock_items where id = $1", [itemId]))[0]?.low_notified_at, JSON.stringify({ status: cron.status, stockLow: cj.stockLow, low: low?.title }));
  await go(page, `${base}/parts/stock?count=1`);
  await page.locator(`[data-count-line="${itemId}"] input`).fill("4");
  await page.locator("[data-save-count]").click();
  await afterSubmit(page);
  const counted = (await sql("select i.quantity::float as q, i.last_counted_at, (select quantity::float from public.stock_movements m where m.stock_item_id = i.id and m.kind = 'count' order by created_at desc limit 1) as delta from public.stock_items i where i.id = $1", [itemId]))[0];
  check("3: the count replaces the figure and writes the difference", counted?.q === 4 && counted?.delta === 1 && !!counted?.last_counted_at, JSON.stringify(counted));
  await browser.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
