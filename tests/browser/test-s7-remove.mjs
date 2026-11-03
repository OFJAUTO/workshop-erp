// Section 7 (3 November 2026): removing an ORDERED part. J-00969's FRONT LH GRILL SURROUND MOULDING on LPO-00037-1:
// "Remove: not needed (ordered: choose its ending)" seemed to go through, but the part stayed "Ordered", stayed on the
// LPO and in "Our cost". This proves, through the Parts table and Returns and leftovers, as Parts:
//   A. ordered, not delivered, on an APPROVED quotation -> Cancelled with the supplier: the row greys "Removed – Cancelled
//      with the supplier by <name>", no "Ordered" chip, the LPO line is cancelled and the LPO total goes down, Our cost
//      goes down, the supplier message is ready to copy; the approved quotation's line and total are unchanged, the
//      advisor is told to revise and the owner is asked to allow the revision.
//   B. delivered -> Return to supplier: waiting for the credit note, listed on Returns and leftovers, the LPO line stays
//      (delivered) marked "Returned – credit note awaited"; the credit note recorded later completes it (Zoho row queued).
//   C. delivered -> Keep in stock: the stock item and its count go up at the part's cost; the job's cost of it is 0.
//   D. a save that fails shows the plain error INSIDE the window (it stays open), nothing is written, one app_errors row;
//      the same window then saves; the LPO with no line left is cancelled and stays in sight, greyed.
//   E. the window greys what does not fit: an undelivered part cannot be returned or kept, a delivered one not cancelled.
// Review fixes (3 November 2026), in the same sections:
//   A. the job also has an ADDITIONAL quotation approved later: the owner is asked to revise the quotation that charges
//      the part (never the newer one); the workshop managers' bell opens the work order (they cannot open Parts).
//   B. a proforma made before the ending: its internal cost of the part goes to 0 (the tax invoice it becomes copies 0);
//      the row's "Credit note awaited" tag is not a tap target - "Record the credit note" is in the ⋯ menu; the credit
//      note recorded on Returns and leftovers answers in a window on the page, never at the top of the page.
//   C. a tax invoice already out: the customer's price cannot change - Parts and the advisor read "the owner settles it
//      with a credit note" (never "revise"), the owner hears "Cost correction needed", the invoice keeps its cost.
//      C2: a part only partly delivered and kept in stock - the supplier is asked to cancel the rest.
//   D. the LPO left with only a courier charge stays ordered and says how to close it; "Waived – remove" cancels it.
//   H. Returns and leftovers: an ending refused by the server shows its words INSIDE the card that was tapped; the next
//      tap is not swallowed and the result opens in a window.
// Run: node --env-file=.env.test.local tests/browser/test-s7-remove.mjs   (test server on 3102: npm run test:server)
// Screenshots: tests/browser/shots/s7-remove/. ONLY=A,B,... runs some sections (A first: the others need its seed).
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, pageReady, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "s7-remove");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const rowOf = (page, name) => page.locator("[data-row-key]").filter({ has: page.locator("[data-part-name]", { hasText: new RegExp(name, "i") }) }).first();
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const run = (s) => !only.length || only.includes(s);
const money = (t) => Number(String(t).replace(/[^\d.]/g, "")) || 0;

const ID = (n) => `22222222-0000-4000-8000-00000000e7${n}`;
const PB = ID("b1"), PC = ID("c1"), PD = ID("d1"), PE = ID("e1"), PG = ID("a7");
const PO1 = ID("f1"), PO2 = ID("f2");
const LA = ID("a2"), LB = ID("b2"), LC = ID("c2"), LD = ID("d2"), LE = ID("e2");
const Q2 = ID("a3"), PRO = ID("a4"), INV = ID("a5"), CH = ID("a6");
const SUPPLIER = "E2E S7 SUPPLIER";
/** The page's result window (Returns and leftovers, the handover page): waits for it, returns its words, closes it. */
async function resultWindow(page) {
  const win = page.locator("[data-ending-result]");
  const ok = await win.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const words = ok ? await text(win.locator("[data-ending-result-message]")) : "";
  const copy = ok ? await text(win.locator("[data-ending-result-copy]")) : "";
  if (ok) await win.locator("[data-ending-result-close]").click();
  return { ok, words, copy };
}

const partsUser = (await sql("select id, display_name from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const owner = (await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1440, h = 900) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };

/** Opens the row's menu and the ending window; types the reason; picks the ending. */
async function openEnding(page, name, ending, reason) {
  const row = rowOf(page, name);
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.locator("button[aria-label='More for this part']").click();
  await page.getByRole("button", { name: /Remove: not needed \(ordered: choose its ending\)/ }).click();
  const dialog = page.locator("[data-end-dialog]");
  await dialog.waitFor({ timeout: 10000 });
  if (ending) await dialog.locator(`[data-end-option="${ending}"]`).click();
  if (reason) await dialog.locator("input[name='reason']").pressSequentially(reason, { delay: 10 });
  return dialog;
}
const ourCost = async (page) => money(await text(page.locator("[data-cost-grand]")));

cleanupDb();
try {
  await sql("insert into public.suppliers (name, vat_registered, created_by, updated_by) select $1, false, $2, $2 where not exists (select 1 from public.suppliers where name ilike $1)", [SUPPLIER, owner.id]);
  // The stage job: approved by the customer (Q-STAGE-1, with FRONT BRAKE PADS at AED 300 on it).
  const st = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = st.jobId;
  const q1 = st.quotationId;
  const pa = (await sql("select id from public.part_items where job_id = $1 and description ilike 'front brake pads' limit 1", [jobId]))[0];
  await sql("update public.part_requests set status = 'unavailable' where job_id = $1 and status in ('open', 'listed')", [jobId]);
  // LPO-E2E-S7-1, ordered, nothing delivered: the pads (on the approved quotation) and a wiper blade.
  await sql("insert into public.part_items (id, job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, delivery_date, confirm_status, part_type, priced_at, priced_by, order_status, created_by, updated_by) values ($1, $2, 'E2E S7 WIPER BLADE', 'E2E-WB-7', 1, 1, 150, $3, 'to_order', (now() + interval '3 days')::date, 'confirmed', 'genuine', now(), $4, 'ordered', $4, $4)", [PB, jobId, SUPPLIER, partsUser.id]);
  await sql("insert into public.purchase_orders (id, number, job_id, kind, supplier_name, status, total_cost_aed, ordered_at, ordered_by, approved_at, approved_by, created_by, updated_by) values ($1, 'LPO-E2E-S7-1', $2, 'supplier', $3, 'ordered', 350, now(), $4, now(), $5, $4, $4)", [PO1, jobId, SUPPLIER, partsUser.id, owner.id]);
  await sql("insert into public.purchase_order_lines (id, po_id, part_item_id, position, description, part_number, quantity, unit_cost, expected_date, created_by, updated_by) values ($1, $2, $3, 1, 'front brake pads', 'PAD-STAGE-1', 1, 200, (now() + interval '3 days')::date, $5, $5), ($4, $2, $6, 2, 'E2E S7 WIPER BLADE', 'E2E-WB-7', 1, 150, (now() + interval '3 days')::date, $5, $5)", [LA, PO1, pa.id, LB, partsUser.id, PB]);
  await sql("update public.part_items set supplier = $2, order_status = 'ordered', po_id = $3, po_line_id = $4, expected_date = (now() + interval '3 days')::date where id = $1", [pa.id, SUPPLIER, PO1, LA]);
  await sql("update public.part_items set po_id = $2, po_line_id = $3 where id = $1", [PB, PO1, LB]);
  // LPO-E2E-S7-2, received: an oil filter ×2 and a cabin filter, both here.
  await sql("insert into public.part_items (id, job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, priced_at, priced_by, order_status, received_qty, created_by, updated_by) values ($1, $3, 'E2E S7 OIL FILTER', 'E2E-OF-7', 2, 2, 40, $4, 'to_order', 'confirmed', 'genuine', now(), $5, 'received', 2, $5, $5), ($2, $3, 'E2E S7 CABIN FILTER', 'E2E-CF-7', 1, 1, 60, $4, 'to_order', 'confirmed', 'genuine', now(), $5, 'received', 1, $5, $5)", [PC, PD, jobId, SUPPLIER, partsUser.id]);
  await sql("insert into public.purchase_orders (id, number, job_id, kind, supplier_name, status, total_cost_aed, ordered_at, ordered_by, approved_at, approved_by, received_at, created_by, updated_by) values ($1, 'LPO-E2E-S7-2', $2, 'supplier', $3, 'received', 220, now(), $4, now(), $5, now(), $4, $4)", [PO2, jobId, SUPPLIER, partsUser.id, owner.id]);
  await sql("insert into public.purchase_order_lines (id, po_id, part_item_id, position, description, part_number, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, $3, $4, 1, 'E2E S7 OIL FILTER', 'E2E-OF-7', 2, 40, 2, now(), $6, $6), ($2, $3, $5, 2, 'E2E S7 CABIN FILTER', 'E2E-CF-7', 1, 60, 1, now(), $6, $6)", [LC, LD, PO2, PC, PD, partsUser.id]);
  await sql("update public.part_items set po_id = $2, po_line_id = $3 where id = $1", [PC, PO2, LC]);
  await sql("update public.part_items set po_id = $2, po_line_id = $3 where id = $1", [PD, PO2, LD]);
  // C2: four spark plugs ordered on LPO-E2E-S7-2, only one arrived.
  await sql("insert into public.part_items (id, job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, priced_at, priced_by, order_status, received_qty, po_id, created_by, updated_by) values ($1, $2, 'E2E S7 SPARK PLUG', 'E2E-SP-7', 4, 4, 20, $3, 'to_order', 'confirmed', 'genuine', now(), $4, 'partly_received', 1, $5, $4, $4)", [PE, jobId, SUPPLIER, partsUser.id, PO2]);
  await sql("insert into public.purchase_order_lines (id, po_id, part_item_id, position, description, part_number, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, $2, $3, 3, 'E2E S7 SPARK PLUG', 'E2E-SP-7', 4, 20, 1, now(), $4, $4)", [LE, PO2, PE, partsUser.id]);
  await sql("update public.part_items set po_line_id = $2 where id = $1", [PE, LE]);
  // An ADDITIONAL quotation, approved after the first one (another number, no line for the pads).
  const jobRow = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
  await sql("insert into public.quotations (id, kind, number, version, job_id, customer_id, vehicle_id, status, token, validity_days, sent_at, responded_at, total_aed, created_by, updated_by) values ($1, 'quotation', 'Q-E2ES7B', 1, $2, $3, $4, 'approved', 'e2es7q2' || floor(random()*1e9)::text, 7, now(), now(), 525, $5, $5)", [Q2, jobId, jobRow.customer_id, jobRow.vehicle_id, owner.id]);
  check("setup: the additional quotation is there, approved, newer than the first", !!(await sql("select 1 from public.quotations where id = $1 and status = 'approved'", [Q2]))[0]);
  const q1Before = (await sql("select total_aed::float as total, status from public.quotations where id = $1", [q1]))[0];
  const lineBefore = (await sql("select id, line_total::float as total, is_active from public.quotation_lines where quotation_id = $1 and part_item_id = $2", [q1, pa.id]))[0];
  check(`setup: the pads are on the approved quotation (${q1Before?.status}, line AED ${lineBefore?.total})`, q1Before?.status === "approved" && lineBefore?.is_active === true);

  const desk = await open(partsUser.id);
  const page = desk.page;
  await go(page, `${base}/parts/${jobId}`);
  await pageReady(page);

  /* ---------- E. The window greys what does not fit ---------- */
  if (run("E") || run("A")) {
    const dlg = await openEnding(page, "front brake pads", null, null);
    const allowed = async (k) => (await dlg.locator(`[data-end-option="${k}"]`).getAttribute("data-allowed")) === "1";
    check("E: not delivered - Cancelled with the supplier is offered", await allowed("cancelled"));
    check("E: not delivered - Return to supplier is greyed, with the reason", !(await allowed("return")) && /Not delivered yet: nothing to return/.test(await text(dlg.locator("[data-end-why='return']"))));
    check("E: not delivered - Keep in stock is greyed, with the reason", !(await allowed("stock")) && /nothing to put on the shelf/.test(await text(dlg.locator("[data-end-why='stock']"))));
    check("E: the Save button waits for a reason", await dlg.locator("[data-end-save]").isDisabled());
    await page.screenshot({ path: shot("e1-window-not-delivered.png") });
    await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
  }

  /* ---------- A. Cancelled with the supplier, on an approved quotation ---------- */
  if (run("A")) {
    const costBefore = await ourCost(page);
    const dlg = await openEnding(page, "front brake pads", "cancelled", "Not required for this job");
    await page.screenshot({ path: shot("a1-cancel-chosen.png") });
    await dlg.locator("[data-end-save]").click();
    const done = await until(async () => (await dlg.locator("[data-end-done]").count()) > 0, 40);
    check("A: the window answers in place (Saved ✓, it did not close first)", !!done);
    const message = await text(dlg.locator("[data-end-message]"));
    check(`A: the answer names the LPO's new total ("${message.slice(0, 140)}")`, /Cancelled with the supplier/.test(message) && /LPO-E2E-S7-1 total now AED 150\.00/.test(message));
    const copy = await text(dlg.locator("[data-end-supplier-copy]"));
    check(`A: the cancellation is ready to copy for the supplier ("${copy.slice(0, 90)}")`, /Please cancel:/.test(copy) && /FRONT BRAKE PADS × 1/.test(copy) && (await dlg.locator("[data-copy-text]").count()) === 1);
    await page.screenshot({ path: shot("a2-cancel-saved.png") });
    await dlg.locator("[data-end-close]").click();
    const row = rowOf(page, "front brake pads");
    const ended = await text(row.locator("[data-part-ended]"));
    check(`A: the row greys "Removed – Cancelled with the supplier by ${partsUser.display_name}" ("${ended}")`, ended.startsWith(`Removed – Cancelled with the supplier by ${partsUser.display_name}`) && /Not required for this job/.test(ended));
    check("A: no Ordered chip and no Put back on the row", !/Ordered/.test(await text(row.locator("[data-status-line]"))) && !(await row.getByRole("button", { name: /Put back/ }).count()));
    check("A: the line total shows a dash", (await text(row.locator("[data-line-total]"))) === "—");
    const costAfter = await until(async () => { const c = await ourCost(page); return Math.abs(costBefore - c - 210) < 0.02 ? c : null; }, 20) ?? (await ourCost(page));
    check(`A: Our cost goes down by the pads with VAT (AED ${costBefore} → ${costAfter})`, Math.abs(costBefore - costAfter - 210) < 0.02);
    const part = (await sql("select order_status, is_active, final_cost_aed::float as final, removed_at, disposition, disposition_at, return_status from public.part_items where id = $1", [pa.id]))[0];
    check(`A: the part is off the job (order ${part?.order_status}, active ${part?.is_active}, cost ${part?.final})`, part?.order_status === "none" && part?.is_active === false && part?.final === 0 && !!part?.removed_at && !!part?.disposition_at && (part?.disposition === "cancelled" || part?.disposition === null));
    const line = (await sql("select is_active from public.purchase_order_lines where id = $1", [LA]))[0];
    const po = (await sql("select status, total_cost_aed::float as total, notes from public.purchase_orders where id = $1", [PO1]))[0];
    check(`A: the LPO line is cancelled and the LPO total went down (${po?.status}, AED ${po?.total})`, line?.is_active === false && po?.status === "ordered" && Math.abs(po.total - 150) < 0.01 && /FRONT BRAKE PADS: cancelled with the supplier/.test(po?.notes ?? ""));
    await page.reload();
    await pageReady(page);
    const card = page.locator("[data-supplier-lpo='LPO-E2E-S7-1']");
    check("A: the LPO card shows the line cancelled, greyed", /Cancelled – not delivered/.test(await text(card.locator("[data-lpo-line-cancelled]"))));
    check("A: the LPO card total reads AED 150.00 · 1 line cancelled", /AED 150\.00 before VAT · 1 line cancelled/.test(await text(card.locator("[data-lpo-total]"))));
    check("A: the part is not waiting to be received", !/front brake pads/i.test(await text(page.locator("[data-received-card]"))));
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: shot("a3-lpo-card-after-cancel.png") });
    // The customer's approved price never changes silently.
    const q1After = (await sql("select total_aed::float as total, status, revision_requested_at from public.quotations where id = $1", [q1]))[0];
    const lineAfter = (await sql("select line_total::float as total, is_active from public.quotation_lines where id = $1", [lineBefore.id]))[0];
    check(`A: the approved quotation is unchanged (AED ${q1After?.total}, line AED ${lineAfter?.total}, still on it)`, q1After?.status === "approved" && Math.abs((q1After?.total ?? 0) - (q1Before?.total ?? -1)) < 0.01 && lineAfter?.is_active === true && Math.abs(lineAfter.total - lineBefore.total) < 0.01);
    const told = await until(async () => (await sql("select title, body from public.notifications where job_id = $1 and title like 'Part removed after approval%' order by created_at desc limit 1", [jobId]))[0]);
    check(`A: the advisor is told to revise ("${told?.title}")`, !!told && /revise the quotation/.test(told.title) && /approved price has not changed/.test(told.body ?? ""));
    check("A: the owner is asked to allow the revision", !!q1After?.revision_requested_at);
    // The job's other quotation (approved later, never charging the pads) is left alone.
    const q2After = (await sql("select revision_requested_at, revision_request_parts from public.quotations where id = $1", [Q2]))[0];
    check("A: the ADDITIONAL quotation approved later is not the one asked about", !q2After?.revision_requested_at && !q2After?.revision_request_parts);
    const ownerBell = (await sql("select href from public.notifications where job_id = $1 and type = 'revision_request' order by created_at desc limit 1", [jobId]))[0];
    check(`A: the owner's bell opens the quotation that charges the pads (${ownerBell?.href ?? "none"})`, !!ownerBell?.href && ownerBell.href.includes(`/quote/${q1}`));
    // Workshop managers cannot open the Parts page: their bell opens the car's work order.
    const mgrBells = await until(async () => { const r = await sql("select href from public.notifications where job_id = $1 and title like 'Part removed · %'", [jobId]); return r.length ? r : null; }, 20);
    check(`A: the managers' bell opens the work order (${(mgrBells ?? []).map((b) => b.href).join(", ")})`, !!mgrBells?.length && mgrBells.every((b) => b.href === `/jobs/${jobId}/work`));
    // His box shows the part leaving the quotation - never "nothing left to change" (the part is off the job, but the
    // approved quotation still charges it).
    const own = await open(owner.id);
    await go(own.page, `${base}/jobs/${jobId}/quote/${q1}?revise=1`);
    await pageReady(own.page);
    const boxText = await text(own.page.locator("[data-owner-box]"));
    check(`A: the owner's box lists the pads as taken off ("${boxText.slice(0, 120)}")`, (await own.page.locator("[data-revision-empty]").count()) === 0 && /FRONT BRAKE PADS/i.test(boxText));
    await own.page.screenshot({ path: shot("a4-owner-revision-box.png") });
  }

  /* ---------- B. Return to supplier, then the credit note ---------- */
  if (run("B")) {
    // A proforma already made for the job carries the oil filters' cost on its line (internal only).
    const jr = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
    await sql("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ($1, 'E2E-PRO-S7', 'proforma', $2, $3, $4, 'issued', now(), 120, 120, 6, 126, 'e2es7pro' || floor(random()*1e9)::text, $5, $5)", [PRO, jobId, jr.customer_id, jr.vehicle_id, owner.id]);
    await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, part_item_id) values ($1, 1, 'parts', 'E2E S7 OIL FILTER', 2, 60, 120, 6, 126, 80, $2)", [PRO, PC]);
    await go(page, `${base}/parts/${jobId}`);
    await pageReady(page);
    const dlg = await openEnding(page, "E2E S7 OIL FILTER", null, null);
    check("B: delivered - Cancelled is greyed (already delivered)", (await dlg.locator("[data-end-option='cancelled']").getAttribute("data-allowed")) === "0" && /Already delivered \(2 here\)/.test(await text(dlg.locator("[data-end-why='cancelled']"))));
    await dlg.locator("[data-end-option='return']").click();
    await dlg.locator("input[name='reason']").pressSequentially("Customer brought his own", { delay: 10 });
    await dlg.locator("[data-end-save]").click();
    await until(async () => (await dlg.locator("[data-end-done]").count()) > 0, 40);
    check("B: the return asks the supplier for the credit note (copy ready)", /Please send the credit note/.test(await text(dlg.locator("[data-end-supplier-copy]"))));
    check("B: the answer says the cost is off the proforma too", /off the proforma/.test(await text(dlg.locator("[data-end-message]"))));
    await page.screenshot({ path: shot("b1-return-saved.png") });
    await dlg.locator("[data-end-close]").click();
    const p = (await sql("select is_active, final_cost_aed::float as final, return_status, returned_qty::float as qty, disposition from public.part_items where id = $1", [PC]))[0];
    check(`B: waiting for the credit note (${p?.disposition ?? "NULL"}, ${p?.return_status}, ${p?.qty} back)`, p?.is_active === false && p?.final === 0 && p?.return_status === "to_return" && p?.qty === 2 && (p?.disposition === "return_pending" || p?.disposition === null));
    const proLine = (await sql("select cost_aed::float as cost from public.invoice_lines where invoice_id = $1 and part_item_id = $2", [PRO, PC]))[0];
    check(`B: the proforma's internal cost of the part follows the ending (AED ${proLine?.cost})`, proLine?.cost === 0);
    const line = (await sql("select is_active from public.purchase_order_lines where id = $1", [LC]))[0];
    check("B: the delivered line stays on the LPO (the supplier invoices it, the credit note takes it off)", line?.is_active === true);
    // The row's tag is only words (the status line is 20 px high); the 44 px "Record the credit note" is in the ⋯ menu.
    const awaitedTag = rowOf(page, "E2E S7 OIL FILTER").locator("[data-credit-awaited]");
    check("B: the row says the credit note is awaited (a tag, not a 20 px link)", (await awaitedTag.count()) === 1 && (await awaitedTag.evaluate((el) => el.tagName)) === "SPAN");
    await rowOf(page, "E2E S7 OIL FILTER").locator("button[aria-label='More for this part']").click();
    const recordItem = page.getByRole("button", { name: "Record the credit note", exact: true });
    const itemBox = await recordItem.boundingBox().catch(() => null);
    check(`B: "Record the credit note" is in the row's menu, 44 px high (${itemBox ? Math.round(itemBox.height) : "none"})`, !!itemBox && itemBox.height >= 43.5);
    await page.keyboard.press("Escape").catch(() => {});
    await page.reload();
    await pageReady(page);
    const card = page.locator("[data-supplier-lpo='LPO-E2E-S7-2']");
    check("B: the LPO card marks the line Returned – credit note awaited", (await card.locator("[data-lpo-line-ended='return_pending']").count()) === 1);
    check(`B: the card shows the returns ("${await text(card.locator("[data-lpo-returns]"))}")`, /Returns −AED 80\.00/.test(await text(card.locator("[data-lpo-returns]"))));
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: shot("b2-lpo-card-return.png") });
    await go(page, `${base}/parts/no-home`);
    await pageReady(page);
    const item = page.locator(`[data-credit-note-awaited="${PC}"]`);
    check(`B: Returns and leftovers lists it under Waiting for a supplier credit note ("${(await text(item)).slice(0, 110)}")`, (await item.count()) === 1 && /E2E S7 OIL FILTER × 2/i.test(await text(item)) && /AED 80\.00 to be credited/.test(await text(item)));
    await item.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: shot("b3-waiting-for-credit-note.png") });
    await item.locator("[data-credit-note-number]").pressSequentially("E2E-CN-77", { delay: 10 });
    const urlBefore = page.url();
    await item.locator("[data-ending-save]").click();
    // The answer opens in a window on this page (the card leaves the list): never as words at the top of the page.
    const win = page.locator("[data-ending-result]");
    await win.waitFor({ timeout: 30000 }).catch(() => {});
    check(`B: the credit note's answer opens in a window ("${(await text(win.locator("[data-ending-result-message]"))).slice(0, 100)}")`, /credit note E2E-CN-77 recorded/i.test(await text(win.locator("[data-ending-result-message]"))));
    check("B: the page did not move to a ?message= address", page.url() === urlBefore);
    await page.screenshot({ path: shot("b4-credit-note-recorded.png") });
    await win.locator("[data-ending-result-close]").click();
    const rec = await until(async () => (await sql("select disposition, disposition_note, return_status from public.part_items where id = $1 and disposition = 'returned'", [PC]))[0], 40);
    check(`B: the credit note completes the return (${rec?.disposition}, ${rec?.disposition_note})`, rec?.return_status === "returned" && rec?.disposition_note === "E2E-CN-77");
    const z = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'vendorcredit' and record_id = $1", [PC]))[0], 20);
    check(`B: the supplier credit is queued for Zoho Books (${z?.status})`, !!z);
    const gone = await until(async () => ((await page.locator(`[data-credit-note-awaited="${PC}"]`).count()) === 0 ? true : null), 20);
    check("B: it leaves the waiting list", !!gone);
  }

  /* ---------- C. Keep in stock ---------- */
  if (run("C")) {
    // The cabin filter is on the approved quotation, and a TAX INVOICE is already out with its cost (the car is paid).
    // (A test puts a line on an approved quotation by setting it to draft and back: the header lock leaves status.)
    await sql("update public.quotations set status = 'draft' where id = $1", [q1]);
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_mode, markup_percent, line_total, part_item_id, customer_approved, is_active, created_by, updated_by) values ($1, 90, 'part', 'E2E S7 CABIN FILTER', 'manual', 1, 60, 'percent', 50, 90, $2, true, true, $3, $3)", [q1, PD, owner.id]);
    check("C: setup - the cabin filter is on the approved quotation", !!(await sql("select 1 from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [q1, PD]))[0]);
    await sql("update public.quotations set status = 'approved' where id = $1", [q1]);
    const jr = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
    await sql("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ($1, 'E2E-INV-S7', 'tax_invoice', $2, $3, $4, 'issued', now(), 90, 90, 4.5, 94.5, 'e2es7inv' || floor(random()*1e9)::text, $5, $5)", [INV, jobId, jr.customer_id, jr.vehicle_id, owner.id]);
    await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, part_item_id) values ($1, 1, 'parts', 'E2E S7 CABIN FILTER', 1, 90, 90, 4.5, 94.5, 60, $2)", [INV, PD]);
    const since = new Date().toISOString();
    await go(page, `${base}/parts/${jobId}`);
    await pageReady(page);
    const dlg = await openEnding(page, "E2E S7 CABIN FILTER", "stock", "Spare one, keep it");
    await dlg.locator("[data-end-save]").click();
    await until(async () => (await dlg.locator("[data-end-done]").count()) > 0, 40);
    const message = await text(dlg.locator("[data-end-message]"));
    check(`C: the answer says what went on the shelf ("${message.slice(0, 120)}")`, /Kept in stock/.test(message) && /1 on the shelf at AED 60\.00 each/.test(message));
    // A tax invoice out: no "revise" - the owner settles it with a credit note, and he is told to correct the cost.
    check(`C: the answer says the tax invoice is out and the owner settles it ("${message.slice(-260)}")`, /tax invoice E2E-INV-S7 is already issued: the customer's price cannot change any more/i.test(message) && /credit note/.test(message) && !/revise/i.test(message));
    check("C: the answer says the tax invoice still counts its cost", /E2E-INV-S7 is already issued and still counts its cost \(AED 60\.00\)/.test(message));
    await page.screenshot({ path: shot("c1-stock-saved.png") });
    await dlg.locator("[data-end-close]").click();
    const advisorBell = await until(async () => (await sql("select title, body from public.notifications where job_id = $1 and created_at >= $2 and title like 'Part removed%' and title not like 'Part removed · %' order by created_at desc limit 1", [jobId, since]))[0], 20);
    check(`C: the advisor reads the credit-note words, never "revise" ("${advisorBell?.title}")`, /after the tax invoice/.test(advisorBell?.title ?? "") && /credit note/.test(advisorBell?.body ?? "") && !/revise the quotation/.test(advisorBell?.title ?? ""));
    const costBell = await until(async () => (await sql("select title from public.notifications where job_id = $1 and created_at >= $2 and title like 'Cost correction needed%' limit 1", [jobId, since]))[0], 20);
    check(`C: the owner hears the tax invoice's cost needs correcting ("${costBell?.title ?? "none"}")`, !!costBell);
    const invLine = (await sql("select cost_aed::float as cost from public.invoice_lines where invoice_id = $1 and part_item_id = $2", [INV, PD]))[0];
    check(`C: the tax invoice itself is never changed from here (cost AED ${invLine?.cost})`, invLine?.cost === 60);
    const item = (await sql("select id, quantity::float as qty, unit_cost::float as cost from public.stock_items where name ilike 'e2e s7 cabin filter' and is_active limit 1"))[0];
    check(`C: the stock item counts it at its cost (${item?.qty} at AED ${item?.cost})`, item?.qty === 1 && Math.abs((item?.cost ?? 0) - 60) < 0.01);
    const mv = (await sql("select kind, quantity::float as qty, unit_cost::float as cost from public.stock_movements where part_item_id = $1", [PD]))[0];
    check(`C: one movement in (${mv?.kind} ${mv?.qty} at ${mv?.cost})`, mv?.kind === "in" && mv?.qty === 1 && Math.abs((mv?.cost ?? 0) - 60) < 0.01);
    const p = (await sql("select is_active, final_cost_aed::float as final, disposition, stock_item_id from public.part_items where id = $1", [PD]))[0];
    check("C: the part is off the job at cost 0, tied to its stock item", p?.is_active === false && p?.final === 0 && p?.disposition === "stock" && p?.stock_item_id === item?.id);

    /* C2. Only 1 of 4 spark plugs arrived; the one is kept in stock: the supplier is asked to cancel the other 3. */
    await go(page, `${base}/parts/${jobId}`);
    await pageReady(page);
    const dlg2 = await openEnding(page, "E2E S7 SPARK PLUG", "stock", "Wrong heat range");
    check("C2: the window says the rest is cancelled with the supplier", /Only 1 of 4 arrived: the other 3 are cancelled/.test(await text(dlg2.locator("[data-end-partly]"))));
    await dlg2.locator("[data-end-save]").click();
    await until(async () => (await dlg2.locator("[data-end-done]").count()) > 0, 40);
    const copy2 = await text(dlg2.locator("[data-end-supplier-copy]"));
    check(`C2: the supplier is asked to cancel the 3 never delivered ("${copy2.slice(0, 120)}")`, /Please cancel \(not delivered\):/.test(copy2) && /E2E-SP-7 · E2E S7 SPARK PLUG × 3/.test(copy2) && !/We are returning/.test(copy2));
    await page.screenshot({ path: shot("c2-partly-kept.png") });
    await dlg2.locator("[data-end-close]").click();
    const lineE = (await sql("select quantity::float as qty, is_active from public.purchase_order_lines where id = $1", [LE]))[0];
    check(`C2: the LPO line is cut to what arrived (${lineE?.qty})`, lineE?.qty === 1 && lineE?.is_active === true);
  }

  /* ---------- D. A save that fails, then the same window saves ---------- */
  if (run("D")) {
    await go(page, `${base}/parts/${jobId}`);
    await pageReady(page);
    // The LPO line refuses to change (a test-only trigger on this one line), so the ending cannot be completed.
    await sql(`create or replace function public.e2e_s7_fail() returns trigger language plpgsql as $f$ begin if new.id = '${LB}'::uuid then raise exception 'e2e forced failure'; end if; return new; end $f$`);
    await sql("revoke all on function public.e2e_s7_fail() from public, anon, authenticated");
    await sql("drop trigger if exists e2e_s7_fail on public.purchase_order_lines");
    await sql("create trigger e2e_s7_fail before update on public.purchase_order_lines for each row execute function public.e2e_s7_fail()");
    const since = new Date().toISOString();
    try {
      const dlg = await openEnding(page, "E2E S7 WIPER BLADE", "cancelled", "Wrong size ordered");
      await dlg.locator("[data-end-save]").click();
      const err = await until(async () => { const t = await text(dlg.locator("[data-end-error]")); return t || null; }, 40);
      check(`D: the error shows inside the window ("${err}")`, err === "Couldn't save – nothing was recorded. Try again or tell the owner.");
      check("D: the window stays open, Save still there", (await dlg.isVisible()) && (await dlg.locator("[data-end-save]").count()) === 1);
      await page.screenshot({ path: shot("d1-save-failed.png") });
      const p = (await sql("select is_active, order_status, disposition_at, removed_at, final_cost_aed from public.part_items where id = $1", [PB]))[0];
      check("D: nothing was written on the part", p?.is_active === true && p?.order_status === "ordered" && !p?.disposition_at && !p?.removed_at && p?.final_cost_aed === null);
      const logged = await until(async () => (await sql("select count(*)::int as n from public.app_errors where place = 'end_part' and job_id = $1 and at >= $2", [jobId, since]))[0]?.n || null, 20);
      check(`D: the technical error is written to app_errors (${logged ?? 0})`, logged === 1);
    } finally {
      await sql("drop trigger if exists e2e_s7_fail on public.purchase_order_lines");
      await sql("drop function if exists public.e2e_s7_fail()");
    }
    // The supplier also billed a courier charge on this LPO (it stays on an ordered LPO when its last part goes).
    await sql("insert into public.supplier_charges (id, job_id, supplier_name, description, amount_aed, po_id, created_by, updated_by) values ($1, $2, $3, 'E2E COURIER', 25, $4, $5, $5)", [CH, jobId, SUPPLIER, PO1, partsUser.id]);
    await sql("update public.purchase_orders set total_cost_aed = 175 where id = $1", [PO1]);
    const dlg = page.locator("[data-end-dialog]");
    await dlg.locator("[data-end-save]").click();
    const done = await until(async () => (await dlg.locator("[data-end-done]").count()) > 0, 40);
    const message = await text(dlg.locator("[data-end-message]"));
    check(`D: the same window then saves; the courier charge stays and the words say how to close it ("${message.slice(0, 200)}")`, !!done && /charges \(AED 25\.00\) stay/.test(message) && /Waived – remove/.test(message));
    await dlg.locator("[data-end-close]").click();
    const poKept = (await sql("select status, total_cost_aed::float as total from public.purchase_orders where id = $1", [PO1]))[0];
    check(`D: the LPO keeps only the charge (${poKept?.status}, AED ${poKept?.total})`, poKept?.status === "ordered" && poKept?.total === 25);
    // The supplier waived it: "Waived – remove" takes it off and the LPO with nothing left is cancelled.
    await page.reload();
    await pageReady(page);
    const waive = page.locator("[data-supplier-charges] [data-charge-waive]");
    check("D: the charge on the empty LPO offers Waived – remove", (await waive.count()) === 1);
    await waive.click();
    const said = await until(async () => { const t = await text(page.locator("[data-charge-message]")); return t || null; }, 40);
    check(`D: the answer is next to the charge ("${said}")`, /LPO-E2E-S7-1 has nothing left: cancelled/.test(said ?? ""));
    const po = await until(async () => { const r = (await sql("select status, total_cost_aed::float as total from public.purchase_orders where id = $1", [PO1]))[0]; return r?.status === "cancelled" ? r : null; }, 20);
    check(`D: the LPO with nothing left is cancelled (${po?.status}, AED ${po?.total})`, po?.status === "cancelled" && po?.total === 0);
    await page.reload();
    await pageReady(page);
    const cancelled = page.locator("[data-cancelled-lpos] [data-supplier-lpo='LPO-E2E-S7-1']");
    check("D: the cancelled LPO stays in sight, greyed, with its two cancelled lines", (await cancelled.count()) === 1 && (await cancelled.locator("[data-lpo-line-cancelled]").count()) === 2 && /Cancelled – no part left on it/.test(await text(cancelled.locator("[data-lpo-state]"))));
    await cancelled.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: shot("d2-cancelled-lpo.png") });
    await sql("delete from public.app_errors where place = 'end_part' and job_id = $1", [jobId]).catch(() => null);
  }

  /* ---------- H. Returns and leftovers: a refusal shows INSIDE the card; the next tap saves, the result in a window ---------- */
  if (run("H")) {
    // A horn, delivered, marked not needed by the technician (no ending yet): it sits on Returns and leftovers.
    await sql("insert into public.part_items (id, job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, priced_at, priced_by, order_status, received_qty, not_needed_at, not_needed_by, not_needed_reason, created_by, updated_by) values ($1, $2, 'E2E S7 HORN', 'E2E-HN-7', 1, 1, 70, $3, 'to_order', 'confirmed', 'genuine', now(), $4, 'received', 1, now(), $4, 'Old one works', $4, $4)", [PG, jobId, SUPPLIER, partsUser.id]);
    await go(page, `${base}/parts/no-home`);
    await pageReady(page);
    const card = page.locator(`[data-no-home="${PG}"]`);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.locator("[data-ending-choice='stock']").click();
    // Meanwhile the part went to the technician (another screen): the server refuses the ending in plain words.
    await sql("update public.part_items set issue_status = 'confirmed' where id = $1", [PG]);
    const urlBefore = page.url();
    await card.locator("[data-ending-save]").click();
    const err = await until(async () => { const t = await text(card.locator("[data-ending-error]")); return t || null; }, 40);
    check(`H: the refusal shows inside the card that was tapped ("${err}")`, /With the technician: bring it back to Parts first/.test(err ?? ""));
    check("H: the page stayed where it was (no ?error= at the top of the page) and the words are in sight", page.url() === urlBefore && (await card.locator("[data-ending-error]").isVisible().catch(() => false)));
    await page.screenshot({ path: shot("h1-refused-in-card.png") });
    // Back with Parts: the next tap is not swallowed by the double-tap lock, and the result opens in a window.
    await sql("update public.part_items set issue_status = 'none' where id = $1", [PG]);
    await card.locator("[data-ending-save]").click();
    const r = await resultWindow(page);
    check(`H: the second tap saves; the result opens in a window ("${r.words.slice(0, 100)}")`, r.ok && /Kept in stock/.test(r.words));
    const ended = (await sql("select disposition, is_active from public.part_items where id = $1", [PG]))[0];
    check("H: the horn is kept in stock", ended?.disposition === "stock" && ended?.is_active === false);
    const left = await until(async () => ((await page.locator(`[data-no-home="${PG}"]`).count()) === 0 ? true : null), 20);
    check("H: the card left the list", !!left);
  }
} catch (e) {
  check("the run finished without a crash", false, e instanceof Error ? e.message : String(e));
} finally {
  await sql("drop trigger if exists e2e_s7_fail on public.purchase_order_lines").catch(() => null);
  await sql("drop function if exists public.e2e_s7_fail()").catch(() => null);
  for (const b of browsers) await b.browser.close().catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
