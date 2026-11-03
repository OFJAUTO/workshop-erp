// Section 12 of 2 November 2026 (built 3 November): PARTS ACCOUNTS + the suppliers search. Proves on the TEST database,
// through the screens as accounts and the owner (rule 7: never the live database):
//   A. the menu: accounts and the owner have "Parts accounts"; Parts do not (the page refuses them) but keep Supplier invoices;
//   B. the five totals across the top (parts bought, charged to customers, margin, owed to suppliers, problems);
//   C. PARTS LINES: car/job, part, supplier, LPO, qty, cost (the supplier invoice price), selling, margin, status with the
//      four dots; the supplier filter, the plate search without spaces and the quick chips;
//   D. LPOs: approved by and when; "Approved but not ordered", "Ordered but not received", "Received, invoice missing";
//   E. SUPPLIER INVOICES: the existing screen as a tab (the menu link still opens /supplier-invoices); Mark checked pressed
//      inside the tab comes back to the tab;
//   F. PAYMENTS TO SUPPLIERS: unpaid per supplier with VAT, the paid invoice with its method and reference;
//   G. RETURNS AND CREDITS: a part returned 20 days ago with no credit note is red;
//   H. PROBLEMS: bought but never charged, received without a supplier invoice, a price different from the LPO, a
//      placeholder cost, a cost changed after invoicing, the credit note missing, a supplier without TRN;
//   I. the Excel export: the tab and "everything" (six sheets), refused for Parts;
//   J. SUPPLIERS: the search by phone digits, TRN, contact; "VAT registered but no TRN" and "Unpaid balance" with
//      "Unpaid AED x (n)"; the LPO page's #paid anchor;
//   K. a phone (390 px): the page never slides sideways.
// Review fixes of 3 November, inside the sections above: the Parts bought box opens exactly its lines (B); plain dates in
// the status and a waiting main LPO's part under its own supplier (C); the answer of Mark checked next to the button and
// "Export this tab" keeping Unpaid (E); a split invoice paid on one LPO (only the rest unpaid, Pay links to the unpaid
// LPO) and a stock order's payment box (F); a typed credit note number on file and a never-bought part left out (G); a
// car released on credit with its proforma unpaid is charged (H); Excel dates as Dubai days (I); landlines (J).
//   npm run test:s12-parts-accounts     (test server: E2E_BASE, default the production test server on :3102)
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s12-parts-accounts");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 20 * 60 * 1000).unref();

/** SQL that stops the test on an error (the shared helper hides them). */
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const ID = (n) => `22222222-0000-4000-8000-00000000ec${n}`;
const tok = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const browsers = [];

try {
  cleanupDb();
  /* ---------------- Seeds (TEST database only) ---------------- */
  const OWNER = (await q("select id::text as id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const ACC = (await q("select id::text as id, display_name from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
  const DESK = (await q("select id::text as id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const ownerName = (await q("select display_name from public.staff where id = $1", [OWNER]))[0].display_name;
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const C1 = seed.jobId;
  const c1 = (await q("select job_number, customer_id::text as customer_id, vehicle_id::text as vehicle_id from public.jobs where id = $1", [C1]))[0];
  const make = (await q("select make_id::text as m from public.vehicles where id = $1", [c1.vehicle_id]))[0].m;

  await q("insert into public.suppliers (name, trn, vat_registered, phone, created_by, updated_by) select 'E2E S12 PARTS HUB', '100200300400599', true, '+971 4 555 1212', $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E S12 PARTS HUB')", [OWNER]);
  await q("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E S12 NO TRN', null, true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E S12 NO TRN')", [OWNER]);
  const HUB = (await q("select id::text as id, name from public.suppliers where name ilike 'E2E S12 PARTS HUB'"))[0];
  const NOTRN = (await q("select id::text as id, name from public.suppliers where name ilike 'E2E S12 NO TRN'"))[0];
  const contactOn = (await q("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'suppliers' and column_name = 'contact_name'"))[0].n === 1;
  if (contactOn) await q("update public.suppliers set contact_name = 'Rahul S12' where id = $1", [HUB.id]);

  /** One row into a table: a value starting with now() is written as SQL (a moment), every other value as a parameter. */
  const insert = async (table, cols, ret = "id::text as id") => {
    const params = [];
    const vals = Object.keys(cols).map((k) => {
      const v = cols[k];
      if (typeof v === "string" && /^now\(\)/.test(v)) return v;
      params.push(v);
      return `$${params.length}`;
    });
    return (await q(`insert into public.${table} (${Object.keys(cols).join(", ")}) values (${vals.join(", ")}) returning ${ret}`, params))[0];
  };
  /** An LPO of a supplier with one line and its part (the part's own state given in `part`). */
  const lpo = async (jobId, n, s, status, total, partName, qty, unit, { po = {}, part = {}, line = {} } = {}) => {
    const row = await insert("purchase_orders", { job_id: jobId, number: `LPO-E2ES12-${n}`, supplier_id: s.id, supplier_name: s.name, status, kind: "supplier", total_cost_aed: total, approved_at: "now()", approved_by: OWNER, ...(status === "approved" ? {} : { ordered_at: "now()" }), ...po }, "id::text as id, number");
    const p = await insert("part_items", { job_id: jobId, description: partName, quantity: qty, confirmed_quantity: qty, supplier: s.name, cost_aed: unit, availability: "to_order", order_status: status === "approved" ? "to_order" : "ordered", confirm_status: "confirmed", po_id: row.id, created_by: DESK, updated_by: DESK, ...part });
    const l = await insert("purchase_order_lines", { po_id: row.id, description: partName, quantity: qty, unit_cost: unit, part_item_id: p.id, position: 1, ...line });
    await q("update public.part_items set po_line_id = $1 where id = $2", [l.id, p.id]);
    return { ...row, partId: p.id, lineId: l.id };
  };
  const yesterday = new Date(Date.now() + 4 * 3600000 - 86400000).toISOString().slice(0, 10);
  // On the open car (C1):
  const A = await lpo(C1, 1, HUB, "approved", 300, "E2E S12 FRONT BRAKE PADS", 1, 300, { po: { approved_at: "now() - interval '3 hours'" } });
  const B = await lpo(C1, 2, HUB, "ordered", 180, "E2E S12 CABIN FILTER", 1, 180, { line: { expected_date: yesterday }, part: { expected_date: yesterday } });
  const C = await lpo(C1, 3, HUB, "received", 150, "E2E S12 OIL FILTER", 1, 150, { po: { supplier_invoice_status: "to_follow", received_at: "now() - interval '9 days'" }, part: { order_status: "received", received_qty: 1 }, line: { received_qty: 1 } });
  const D = await lpo(C1, 4, HUB, "received", 520, "E2E S12 FRONT RH WISHBONE LINK", 2, 250, { po: { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-1", supplier_invoice_date: today, supplier_invoice_amount: 520, supplier_invoice_at: "now()", received_at: "now()" }, part: { order_status: "received", received_qty: 2, final_cost_aed: 260 }, line: { received_qty: 2, invoice_unit_cost: 260, invoice_check: "accepted" } });
  const E = await lpo(C1, 5, HUB, "received", 400, "E2E S12 REAR STABILISER LINK", 1, 400, { po: { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-2", supplier_invoice_date: today, supplier_invoice_amount: 400, supplier_invoice_at: "now()", received_at: "now()", supplier_invoice_checked_at: "now()", supplier_paid_at: "now()", supplier_paid_by: OWNER, supplier_paid_method: "transfer", supplier_paid_reference: "FT-S12" }, part: { order_status: "received", received_qty: 1 }, line: { received_qty: 1 } });
  const N = await lpo(C1, 6, NOTRN, "received", 90, "E2E S12 BULB", 1, 90, { po: { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-3", supplier_invoice_date: today, supplier_invoice_amount: 90, supplier_invoice_at: "now()", received_at: "now()" }, part: { order_status: "received", received_qty: 1 }, line: { received_qty: 1 } });
  // A placeholder price (AED 1.00 from "OFJ Additional"), and a part returned 20 days ago with no credit note.
  const F = (await q("insert into public.part_items (job_id, description, quantity, supplier, cost_aed, availability, order_status, confirm_status, created_by, updated_by) values ($1, 'E2E S12 GRILL MOULDING', 1, 'OFJ Additional', 1, 'to_order', 'to_order', 'confirmed', $2, $2) returning id::text as id", [C1, DESK]))[0];
  const G = await lpo(C1, 7, HUB, "received", 300, "E2E S12 TRANSMISSION MOUNT", 1, 300, { po: { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-4", supplier_invoice_date: today, supplier_invoice_amount: 300, supplier_invoice_at: "now()", received_at: "now() - interval '25 days'" }, part: { order_status: "received", received_qty: 1, returned_qty: 1, return_status: "returned", disposition: "returned", final_cost_aed: 0 }, line: { received_qty: 1 } });
  await q("update public.part_items set disposition_at = now() - interval '20 days' where id = $1", [G.partId]);

  // A car that left with its tax invoice: one part fitted but never on the invoice; one on it at a stale cost (500 vs 2 × 260).
  await q("insert into public.vehicles (id, customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, model_year, created_by, updated_by) values ($1, $2, 'UAE', 'Dubai', 'S', '12012', true, $3, 2022, $4, $4)", [ID("01"), c1.customer_id, make, OWNER]);
  await q("insert into public.jobs (id, vehicle_id, customer_id, stage, status, priority, department, gated_in_by, first_approval_at, stage_entered_at, is_open, created_by, updated_by) values ($1, $2, $3, 'ready', 'closed', 'normal', 'mechanical', $4, now(), now(), false, $4, $4)", [ID("02"), ID("01"), c1.customer_id, OWNER]);
  const J2 = ID("02");
  const H = await lpo(J2, 8, HUB, "received", 610, "E2E S12 WATER PUMP", 1, 90, { po: { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-5", supplier_invoice_date: today, supplier_invoice_amount: 610, supplier_invoice_at: "now()", received_at: "now()", supplier_invoice_checked_at: "now()" }, part: { order_status: "received", received_qty: 1, issue_status: "confirmed", issue_confirmed_at: "now()" }, line: { received_qty: 1 } });
  const W = (await q("insert into public.part_items (job_id, description, quantity, confirmed_quantity, supplier, cost_aed, final_cost_aed, availability, order_status, confirm_status, po_id, received_qty, issue_status, issue_confirmed_at, created_by, updated_by) values ($1, 'E2E S12 FRONT LH WISHBONE LINK', 2, 2, $2, 250, 260, 'to_order', 'received', 'confirmed', $3, 2, 'confirmed', now(), $4, $4) returning id::text as id", [J2, HUB.name, H.id, DESK]))[0];
  await q("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, part_item_id, position, received_qty, invoice_unit_cost, invoice_check) values ($1, 'E2E S12 FRONT LH WISHBONE LINK', 2, 250, $2, 2, 2, 260, 'accepted')", [H.id, W.id]);
  const INV = (await q("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, issued_by, created_by, updated_by) values ($1, 'E2E-INV-ec03', 'tax_invoice', $2, $3, $4, 'issued', now(), $5, 'itemised', 700, 0, 700, 35, 735, $6, $6, $6) returning id::text as id", [ID("03"), J2, c1.customer_id, ID("01"), tok(), OWNER]))[0];
  await q("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, part_item_id, created_by, updated_by) values ($1, 1, 'parts', 'E2E S12 FRONT LH WISHBONE LINK', 2, 350, 700, 35, 735, 500, $2, $3, $3)", [INV.id, W.id, OWNER]);

  /* Review fixes of 3 November (sections L to Q below): a split invoice paid on one LPO, a stock order, a typed credit
     note, a waiting main LPO of two suppliers, and a car released on credit with its proforma unpaid. */
  await q("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E S12 SPLIT CO', '100200300400588', true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E S12 SPLIT CO')", [OWNER]);
  await q("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E S12 SHELF CO', '100200300400577', true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E S12 SHELF CO')", [OWNER]);
  const SPLIT = (await q("select id::text as id, name from public.suppliers where name ilike 'E2E S12 SPLIT CO'"))[0];
  const SHELF = (await q("select id::text as id, name from public.suppliers where name ilike 'E2E S12 SHELF CO'"))[0];
  const splitInv = { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-SPLIT", supplier_invoice_date: today, supplier_invoice_at: "now()", received_at: "now()", supplier_invoice_checked_at: "now()" };
  // One supplier invoice over two cars: LPO-E2ES12-9 (C1, AED 500) paid, LPO-E2ES12-10 (J2, AED 300) not yet.
  const S9 = await lpo(C1, 9, SPLIT, "received", 500, "E2E S12 SPLIT BUMPER CLIP", 1, 500, { po: { ...splitInv, supplier_invoice_amount: 500, supplier_paid_at: "now()", supplier_paid_by: OWNER, supplier_paid_method: "transfer", supplier_paid_reference: "FT-S12-SPLIT" }, part: { order_status: "received", received_qty: 1 }, line: { received_qty: 1 } });
  const S10 = await lpo(J2, 10, SPLIT, "received", 300, "E2E S12 SPLIT WASHER JET", 1, 300, { po: { ...splitInv, supplier_invoice_amount: 300 }, part: { order_status: "received", received_qty: 1 }, line: { received_qty: 1 } });
  // A stock order (no car), received with its invoice, unpaid: its "Pay on the LPO" must land on a payment box.
  const STK = await insert("purchase_orders", { job_id: null, number: "LPO-E2E-S12-13", supplier_id: SHELF.id, supplier_name: SHELF.name, status: "received", kind: "stock", order_type: "stock_parts", total_cost_aed: 200, approved_at: "now()", approved_by: OWNER, ordered_at: "now()", supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-STOCK", supplier_invoice_date: today, supplier_invoice_amount: 200, supplier_invoice_at: "now()", received_at: "now()", supplier_invoice_checked_at: "now()" }, "id::text as id, number");
  // A part returned to the supplier with its credit note NUMBER typed (no scan), 20 days ago: on file, never "missing".
  const TC = (await q("insert into public.part_items (job_id, description, quantity, confirmed_quantity, supplier, cost_aed, final_cost_aed, availability, order_status, confirm_status, po_id, received_qty, returned_qty, return_status, disposition, disposition_at, disposition_note, created_by, updated_by) values ($1, 'E2E S12 TYPED CN HORN', 1, 1, $2, 120, 0, 'to_order', 'received', 'confirmed', $3, 1, 1, 'returned', 'returned', now() - interval '20 days', 'CN-S12-77', $4, $4) returning id::text as id", [C1, HUB.name, G.id, DESK]))[0];
  // A main LPO still waiting for approval, for two suppliers: one part on it, and one marked not needed (never bought).
  const MAIN = await insert("purchase_orders", { job_id: C1, number: "LPO-E2ES12-11", supplier_id: null, supplier_name: "2 suppliers", status: "pending_approval", kind: "main", total_cost_aed: 260 }, "id::text as id, number");
  const MX = (await q("insert into public.part_items (job_id, description, quantity, supplier, cost_aed, availability, order_status, confirm_status, po_id, created_by, updated_by) values ($1, 'E2E S12 MAIN LPO WIPER', 1, $2, 60, 'to_order', 'to_order', 'confirmed', $3, $4, $4) returning id::text as id", [C1, HUB.name, MAIN.id, DESK]))[0];
  const MY = (await q("insert into public.part_items (job_id, description, quantity, supplier, cost_aed, availability, order_status, confirm_status, po_id, not_needed_at, return_status, created_by, updated_by) values ($1, 'E2E S12 NOT NEEDED NEVER BOUGHT', 1, $2, 200, 'to_order', 'to_order', 'confirmed', $3, now(), 'returned', $4, $4) returning id::text as id", [C1, SPLIT.name, MAIN.id, DESK]))[0];
  // A car released on credit: gone, its proforma unpaid (it becomes the tax invoice when paid), a shelf part fitted on it.
  await q("insert into public.vehicles (id, customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, model_year, created_by, updated_by) values ($1, $2, 'UAE', 'Dubai', 'S', '12013', true, $3, 2022, $4, $4)", [ID("05"), c1.customer_id, make, OWNER]);
  await q("insert into public.jobs (id, vehicle_id, customer_id, stage, status, priority, department, gated_in_by, first_approval_at, stage_entered_at, is_open, work_done_at, created_by, updated_by) values ($1, $2, $3, 'ready', 'closed', 'normal', 'mechanical', $4, now(), now(), false, now(), $4, $4)", [ID("04"), ID("05"), c1.customer_id, OWNER]);
  const CR = (await q("insert into public.part_items (job_id, description, quantity, confirmed_quantity, supplier, cost_aed, final_cost_aed, availability, order_status, confirm_status, received_qty, issue_status, issue_confirmed_at, created_by, updated_by) values ($1, 'E2E S12 CREDIT DOOR MIRROR', 1, 1, 'Our stock', 80, 80, 'in_stock', 'none', 'confirmed', 1, 'confirmed', now(), $2, $2) returning id::text as id", [ID("04"), DESK]))[0];
  const PRO = (await q("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, issued_by, created_by, updated_by) values ($1, 'E2E-PRO-ec06', 'proforma', $2, $3, $4, 'issued', now(), $5, 'itemised', 150, 0, 150, 7.5, 157.5, $6, $6, $6) returning id::text as id", [ID("06"), ID("04"), c1.customer_id, ID("05"), tok(), OWNER]))[0];
  await q("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, part_item_id, created_by, updated_by) values ($1, 1, 'parts', 'E2E S12 CREDIT DOOR MIRROR', 1, 150, 150, 7.5, 157.5, 80, $2, $3, $3)", [PRO.id, CR.id, OWNER]);

  /* Integration with section 7 (3 November): its endings are written INACTIVE with removed_at set. Three parts of their
     own supplier: one going back to the supplier with the credit note awaited (16 days), one cancelled on an LPO that
     was paid before, one cancelled on an unpaid LPO. The disposition is named once section 7's migration is on the TEST
     database, else stored the old way (disposition empty, disposition_at set). */
  await q("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E S12 ENDINGS CO', '100200300400566', true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E S12 ENDINGS CO')", [OWNER]);
  const ENDS = (await q("select id::text as id, name from public.suppliers where name ilike 'E2E S12 ENDINGS CO'"))[0];
  const named = /return_pending/.test((await q("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'part_items_disposition_check'"))[0]?.d ?? "");
  const endPart = (id, state, extra) => q(`update public.part_items set is_active = false, removed_at = now(), not_needed_at = now(), final_cost_aed = 0, disposition = $2::text, disposition_at = now() - ($3::text || ' days')::interval, ${extra} where id = $1`, [id, named ? state : null, String(state === "return_pending" ? 16 : 0)]);
  const RP = await lpo(C1, 14, ENDS, "received", 300, "E2E S12 ENDING RETURN PENDING", 1, 300, { po: { supplier_invoice_status: "received", supplier_invoice_number: "INV-S12-END1", supplier_invoice_date: today, supplier_invoice_amount: 300, supplier_invoice_at: "now()", received_at: "now() - interval '20 days'" }, part: { order_status: "received", received_qty: 1 }, line: { received_qty: 1 } });
  await endPart(RP.partId, "return_pending", "order_status = 'received', return_status = 'to_return', returned_qty = 1");
  const CP = await lpo(C1, 15, ENDS, "ordered", 200, "E2E S12 ENDING CANCELLED PAID", 1, 200, { po: { supplier_paid_at: "now() - interval '2 days'", supplier_paid_by: OWNER, supplier_paid_method: "transfer", supplier_paid_reference: "FT-S12-END" } });
  await endPart(CP.partId, "cancelled", "order_status = 'none', return_status = 'none', returned_qty = 0");
  const CU = await lpo(C1, 16, ENDS, "ordered", 150, "E2E S12 ENDING CANCELLED UNPAID", 1, 150);
  await endPart(CU.partId, "cancelled", "order_status = 'none', return_status = 'none', returned_qty = 0");

  const PA = `${base}/parts-accounts`;

  /* ---------------- A. The menu and who may open it ---------------- */
  const acc = await browserForId(ACC.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(acc);
  const page = acc.page;
  await go(page, PA);
  check("A: accounts have Parts accounts in the menu", (await page.locator('a[href="/parts-accounts"]').count()) >= 1);
  check("A: accounts keep the Supplier invoices menu link too", (await page.locator('a[href="/supplier-invoices"]').count()) >= 1);
  const parts = await browserForId(DESK, { viewport: { width: 1440, height: 1000 } });
  browsers.push(parts);
  await go(parts.page, PA);
  check("A: Parts cannot open Parts accounts (costs stay with accounts and the owner)", (await parts.page.locator("[data-pa-totals]").count()) === 0 && (await parts.page.locator('a[href="/parts-accounts"]').count()) === 0);
  await go(parts.page, `${base}/supplier-invoices`);
  check("A: Parts still reach Supplier invoices", (await parts.page.locator("[data-si-list]").count()) === 1);

  /* ---------------- B. Totals ---------------- */
  await go(page, `${PA}?supplier=${HUB.id}`);
  const tiles = await page.locator("[data-pa-totals] [data-pa-tile]").count();
  check("B: five totals across the top", tiles === 5);
  const owed = await text(page.locator("[data-pa-tile='owed']"));
  check(`B: Owed to suppliers counts the unpaid invoices with VAT ("${owed.slice(0, 90)}")`, /AED/.test(owed) && /unpaid invoice/.test(owed));
  const probTile = page.locator("[data-pa-tile='problems']");
  check("B: the Problems tile shows red problems", Number((await text(probTile)).match(/\d+/)?.[0] ?? 0) >= 4 && /red/.test(await text(probTile)));
  await page.screenshot({ path: shot("b1-totals-and-lines.png"), fullPage: true });
  // Review fix: a box opens exactly the list its figure is made of (Parts bought → the "Parts bought" chip).
  const boughtTile = page.locator("[data-pa-tile='bought']");
  const boughtLines = Number((await text(boughtTile)).match(/(\d+) part line/)?.[1] ?? -1);
  await boughtTile.click();
  await page.waitForURL(/quick=bought/, { timeout: 15000 }).catch(() => null);
  const boughtShown = await page.locator("[data-pa-list='lines'] [data-pa-row]").count();
  check(`B: the Parts bought box opens its own lines (${boughtLines} in the box, ${boughtShown} listed)`, page.url().includes("quick=bought") && boughtLines >= 1 && boughtLines === boughtShown);
  const sumShown = await page.locator("[data-pa-list='lines'] [data-pa-row] [data-pa-cost]").evaluateAll((els) => Math.round(els.reduce((a, e) => a + Number(e.getAttribute("data-pa-cost")), 0) * 100) / 100);
  const boughtValue = Number(((await boughtTile.getAttribute("data-tile-value")) ?? "").replace(/[^\d.]/g, ""));
  check(`B: and its amount is the sum of those lines (AED ${boughtValue} = ${sumShown})`, Math.abs(boughtValue - sumShown) < 0.01);
  await go(page, `${PA}?supplier=${HUB.id}`);

  /* ---------------- C. Parts lines ---------------- */
  const rowD = page.locator(`[data-pa-list='lines'] [data-pa-row='${D.partId}']`);
  check("C: the wishbone link is a line, cost at the supplier invoice price (2 × 260 = 520)", (await rowD.count()) === 1 && (await rowD.locator("[data-pa-cost]").getAttribute("data-pa-cost")) === "520.00");
  check("C: its status is Received with the Ordered and Received dots on", (await rowD.getAttribute("data-pa-state")) === "received" && (await rowD.locator("[data-pa-dot='Received']").getAttribute("data-on")) === "1" && (await rowD.locator("[data-pa-dot='Invoiced']").getAttribute("data-on")) === "0");
  const rowDText = await text(rowD);
  check(`C: the line names the car, the supplier and the LPO ("${rowDText.slice(0, 120)}")`, rowDText.includes(c1.job_number) && rowDText.includes(HUB.name) && rowDText.includes("LPO-E2ES12-4") && rowDText.includes("× 2"));
  const rowW = page.locator(`[data-pa-list='lines'] [data-pa-row='${W.id}']`);
  check("C: the part on the tax invoice reads Invoiced with its selling and margin (700 − 520 = 180)", (await rowW.getAttribute("data-pa-state")) === "invoiced" && (await rowW.locator("[data-pa-selling]").getAttribute("data-pa-selling")) === "700.00" && (await rowW.locator("[data-pa-margin]").getAttribute("data-pa-margin")) === "180.00");
  const rowB = page.locator(`[data-pa-list='lines'] [data-pa-row='${B.partId}']`);
  check("C: the cabin filter ordered for yesterday is late", /Late: expected/.test(await text(rowB)));
  check(`C: its status gives the date in plain words, never 2026-11-02 ("${(await text(rowB.locator("[data-pa-status]"))).slice(0, 60)}")`, /Ordered, expected \d{1,2} [A-Z][a-z]{2} \d{4}/.test(await text(rowB.locator("[data-pa-status]"))) && !/\d{4}-\d{2}-\d{2}/.test(await text(rowB)));
  const rowMX = page.locator(`[data-pa-list='lines'] [data-pa-row='${MX.id}']`);
  check(`C: a part on a waiting main LPO of two suppliers reads its own supplier and stays under the supplier filter ("${(await text(rowMX)).slice(0, 100)}")`, (await rowMX.count()) === 1 && (await text(rowMX)).includes(HUB.name) && !(await text(rowMX)).includes("2 suppliers"));
  await go(page, `${PA}?q=dubais12012`);
  check("C: the search finds a car by its plate typed without spaces", (await page.locator(`[data-pa-row='${W.id}']`).count()) === 1 && (await page.locator(`[data-pa-row='${D.partId}']`).count()) === 0);
  await go(page, `${PA}?supplier=${HUB.id}&quick=invoiced`);
  check("C: the quick chip Invoiced keeps only invoiced lines", (await page.locator("[data-pa-list='lines'] [data-pa-row]").count()) >= 1 && (await page.locator("[data-pa-list='lines'] [data-pa-row]:not([data-pa-state='invoiced'])").count()) === 0);
  await go(page, `${PA}?supplier=${NOTRN.id}`);
  check("C: the supplier filter keeps that supplier's lines only", (await page.locator(`[data-pa-row='${N.partId}']`).count()) === 1 && (await page.locator(`[data-pa-row='${D.partId}']`).count()) === 0);

  /* ---------------- D. LPOs ---------------- */
  await go(page, `${PA}?tab=lpos&supplier=${HUB.id}&quick=approved_not_ordered`);
  const aRow = page.locator(`[data-pa-row='${A.id}']`);
  check("D: Approved but not ordered lists LPO-E2ES12-1", (await aRow.count()) === 1 && (await page.locator("[data-pa-list='lpos'] [data-pa-row]").count()) === 1);
  check(`D: approved by whom and when ("${(await text(aRow.locator("[data-pa-approved]"))).slice(0, 80)}")`, (await text(aRow.locator("[data-pa-approved]"))).includes(ownerName));
  await page.screenshot({ path: shot("d1-lpos-approved-not-ordered.png"), fullPage: true });
  await go(page, `${PA}?tab=lpos&supplier=${HUB.id}&quick=ordered_not_received`);
  check("D: Ordered but not received lists LPO-E2ES12-2", (await page.locator(`[data-pa-row='${B.id}']`).count()) === 1 && (await page.locator("[data-pa-list='lpos'] [data-pa-row]").count()) === 1);
  await go(page, `${PA}?tab=lpos&supplier=${HUB.id}&quick=received_no_invoice`);
  check("D: Received, invoice missing lists LPO-E2ES12-3 with its days", (await page.locator(`[data-pa-row='${C.id}']`).count()) === 1 && /9 days/.test(await text(page.locator(`[data-pa-row='${C.id}']`))));
  await go(page, `${PA}?tab=lpos&supplier=${HUB.id}`);
  check("D: the paid LPO says Paid to supplier with its reference", (await page.locator(`[data-pa-row='${E.id}']`).getAttribute("data-pa-state")) === "paid" && /FT-S12/.test(await text(page.locator(`[data-pa-row='${E.id}'] [data-pa-paid]`))));
  check("D: the LPO card shows its supplier invoice match", (await page.locator(`[data-pa-row='${D.id}'] [data-pa-match='price_changed']`).count()) === 1);

  /* ---------------- E. Supplier invoices: the existing screen as a tab ---------------- */
  await go(page, `${PA}?tab=invoices&supplier=${HUB.id}`);
  const key = `${HUB.id}|INVS121`;
  check("E: the Supplier invoices tab is the same screen (its rows and filters)", (await page.locator("[data-si-filters]").count()) === 1 && (await page.locator(`[data-si-row="${key}"]`).count()) === 1);
  await page.locator(`[data-si-row="${key}"] [data-si-open]`).click();
  await page.waitForURL(/open=/, { timeout: 15000 }).catch(() => null);
  check("E: a row opens inside the tab", page.url().includes("/parts-accounts") && page.url().includes("tab=invoices") && (await page.locator(`[data-si-opened="${key}"]`).count()) === 1);
  await page.locator("[data-si-check]").click();
  const checked = await until(async () => (await q("select supplier_invoice_checked_at from public.purchase_orders where id = $1", [D.id]))[0]?.supplier_invoice_checked_at);
  await page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
  check("E: Mark checked pressed in the tab checks the invoice and comes back to the tab", !!checked && page.url().includes("/parts-accounts") && page.url().includes("tab=invoices"));
  // Review fix: the answer shows next to the button pressed (inside the opened invoice), never above the totals.
  check("E: the answer of Mark checked sits inside the opened invoice, next to its buttons", (await page.locator(`[data-si-opened="${key}"] [data-si-outcome='success']`).count()) === 1 && (await page.getByText(/checked ✓/).count()) === 1);
  await page.screenshot({ path: shot("e1-supplier-invoices-tab.png"), fullPage: true });
  // Review fix: "Export this tab" on Supplier invoices carries the tab's own filters (Unpaid here), so the file = the screen.
  await go(page, `${PA}?tab=invoices&supplier=${HUB.id}&unpaid=1`);
  const onScreen = await page.locator("[data-si-list] [data-si-row]").count();
  const exportHref = (await page.locator("[data-pa-export]").getAttribute("href")) ?? "";
  check(`E: the export link keeps Unpaid (${exportHref})`, exportHref.includes("tab=invoices") && exportHref.includes("unpaid=1") && exportHref.includes(`supplier=${HUB.id}`));
  const siFile = await fetch(`${base}${exportHref}`, { headers: { cookie: await cookieHeader(ACC.id) } });
  const siWb = new ExcelJS.Workbook();
  await siWb.xlsx.load(Buffer.from(await siFile.arrayBuffer()));
  const siRows = [];
  siWb.getWorksheet("Supplier invoices")?.eachRow((r, i) => { if (i > 1) siRows.push(String(r.getCell(1).value ?? "")); });
  const inFile = siRows.filter((n) => n && !/ invoices$/.test(n)).length;
  check(`E: the exported file has the same unpaid invoices as the screen (${inFile} in the file, ${onScreen} on screen)`, siFile.status === 200 && onScreen >= 1 && inFile === onScreen);
  check("E: the paid invoice INV-S12-2 is not in the Unpaid file", !(await page.locator("[data-si-list] [data-si-row]").filter({ hasText: "INV-S12-2" }).count()));
  await go(page, `${base}/supplier-invoices?supplier=${HUB.id}`);
  check("E: /supplier-invoices still opens on its own (menu link kept)", (await page.locator(`[data-si-row="${key}"]`).count()) === 1);

  /* ---------------- F. Payments to suppliers ---------------- */
  await go(page, `${PA}?tab=payments&supplier=${HUB.id}`);
  const hub = page.locator(`[data-pa-list='payments'] [data-pa-row='${HUB.id}']`);
  // Unpaid with VAT: INV-S12-1 520 + INV-S12-4 300 = 820 → 861.00 (INV-S12-2 is paid, INV-S12-5 checked but unpaid 610 → 640.50).
  const unpaidAttr = Number(await hub.locator("[data-pa-unpaid]").getAttribute("data-pa-unpaid"));
  check(`F: the supplier's unpaid balance with VAT (${unpaidAttr})`, Math.abs(unpaidAttr - 1501.5) < 0.01);
  await hub.locator("[data-pa-invoices-open]").click();
  const paidLine = await text(hub.locator("[data-pa-invoice-row]").filter({ hasText: "INV-S12-2" }));
  check(`F: the paid invoice shows how and the reference ("${paidLine.slice(0, 100)}")`, /Paid/.test(paidLine) && /transfer/.test(paidLine) && /FT-S12/.test(paidLine));
  await page.screenshot({ path: shot("f1-payments-to-suppliers.png"), fullPage: true });
  await go(page, `${PA}?tab=payments&quick=unpaid`);
  check("F: Unpaid only keeps suppliers with something to pay", (await page.locator(`[data-pa-row='${HUB.id}']`).count()) === 1 && (await page.locator("[data-pa-list='payments'] [data-pa-row][data-pa-state='paid']").count()) === 0);
  // Review fix: one invoice split over two cars, paid on LPO-E2ES12-9 only. Only the rest (300 + VAT = 315) is unpaid,
  // and the Pay link opens the LPO still to pay, never the paid one.
  await go(page, `${PA}?tab=payments&supplier=${SPLIT.id}`);
  const split = page.locator(`[data-pa-list='payments'] [data-pa-row='${SPLIT.id}']`);
  check(`F: a split invoice paid on one LPO counts only the rest as unpaid (${await split.locator("[data-pa-unpaid]").getAttribute("data-pa-unpaid")})`, (await split.locator("[data-pa-unpaid]").getAttribute("data-pa-unpaid")) === "315.00");
  check(`F: and the paid share as paid ("${(await text(split)).slice(0, 160)}")`, /Paid AED 525\.00/.test(await text(split)));
  await split.locator("[data-pa-invoices-open]").click();
  check("F: the invoice reads Partly paid with a Pay link to LPO-E2ES12-10 only", (await split.locator("[data-pa-partly-paid]").count()) === 1 && (await split.locator(`[data-pa-pay='${S10.id}']`).count()) === 1 && (await split.locator(`[data-pa-pay='${S9.id}']`).count()) === 0);
  await page.screenshot({ path: shot("f2-split-partly-paid.png"), fullPage: true });
  await go(page, `${PA}?tab=invoices&supplier=${SPLIT.id}&open=${encodeURIComponent(`${SPLIT.id}|INVS12SPLIT`)}`);
  check("F: the opened invoice shows each LPO paid or not, and pays only the unpaid one", (await page.locator(`[data-si-share-paid='${S9.id}']`).count()) === 1 && (await page.locator(`[data-si-share-unpaid='${S10.id}']`).count()) === 1 && (await page.locator(`[data-si-pay='${S10.id}']`).count()) === 1 && (await page.locator(`[data-si-pay='${S9.id}']`).count()) === 0);
  await go(page, `${base}/parts/suppliers?filter=unpaid&q=${encodeURIComponent("E2E S12 SPLIT")}`);
  check(`F: the suppliers list says the same unpaid figure ("${await text(page.locator(`[data-supplier-row='${SPLIT.id}'] [data-supplier-unpaid]`))}")`, (await page.locator(`[data-supplier-row='${SPLIT.id}'] [data-supplier-unpaid]`).getAttribute("data-supplier-unpaid")) === "315.00");
  // Review fix: a stock order's "Pay on the LPO" lands on a real payment box (no car needed).
  await go(page, `${PA}?tab=payments&supplier=${SHELF.id}`);
  const shelf = page.locator(`[data-pa-list='payments'] [data-pa-row='${SHELF.id}']`);
  await shelf.locator("[data-pa-invoices-open]").click();
  const stockPay = shelf.locator(`[data-pa-pay='${STK.id}']`);
  check("F: the stock order has its Pay on the LPO link", (await stockPay.count()) === 1);
  await stockPay.click();
  await page.waitForURL(new RegExp(`/parts/orders/${STK.id}`), { timeout: 15000 }).catch(() => null);
  check("F: it opens the stock order's payment box, with the Paid to supplier form for accounts", (await page.locator("#paid[data-supplier-pay]").count()) === 1 && (await page.locator("#paid [data-pay-form]").count()) === 1 && (await page.locator("#paid [data-stock-order-pay]").count()) === 1);
  await page.screenshot({ path: shot("f3-stock-order-pay-box.png"), fullPage: true });

  /* ---------------- G. Returns and credits ---------------- */
  await go(page, `${PA}?tab=returns&supplier=${HUB.id}`);
  const gRow = page.locator(`[data-pa-row='${G.partId}']`);
  check("G: the returned mount waits for the credit note, red after 14 days", (await gRow.getAttribute("data-pa-state")) === "waiting_credit" && /20 days ago/.test(await text(gRow)) && (await gRow.getAttribute("class"))?.includes("border-red-bar"));
  check("G: the credit expected with VAT (300 + 15)", (await gRow.locator("[data-pa-credit]").getAttribute("data-pa-credit")) === "315.00");
  // Review fix: the credit note NUMBER typed on Returns and leftovers counts as on file (no scan needed), shown once.
  const tcRow = page.locator(`[data-pa-row='${TC.id}']`);
  const tcText = await text(tcRow);
  check(`G: a return with its credit note number typed reads Credit note on file ("${tcText.slice(0, 140)}")`, (await tcRow.getAttribute("data-pa-state")) === "credit_on_file" && tcText.includes("Credit note CN-S12-77") && !tcText.includes("Note: CN-S12-77") && !(await tcRow.getAttribute("class"))?.includes("border-red-bar"));
  await page.screenshot({ path: shot("g1-returns-and-credits.png"), fullPage: true });
  // Review fix: a part marked not needed while its main LPO still waits for approval was never bought: no credit, not listed.
  await go(page, `${PA}?tab=returns`);
  check("G: a not-needed part never bought (main LPO waiting) is not under Returns and credits", (await page.locator(`[data-pa-row='${MY.id}']`).count()) === 0);
  // Integration with section 7: its endings are inactive and "removed", and must still be read by their ending.
  await go(page, `${PA}?tab=returns&supplier=${ENDS.id}`);
  const rpRow = page.locator(`[data-pa-list='returns'] [data-pa-row='${RP.partId}']`);
  check(`G7: section 7's Return to supplier (credit note awaited) waits for the credit note, red after 16 days, credit 315.00 (${await rpRow.getAttribute("data-pa-state").catch(() => "missing")})`, (await rpRow.count()) === 1 && (await rpRow.getAttribute("data-pa-state")) === "waiting_credit" && (await rpRow.getAttribute("class"))?.includes("border-red-bar") && (await rpRow.locator("[data-pa-credit]").getAttribute("data-pa-credit")) === "315.00" && /Parts record the credit note/.test(await text(rpRow)));
  const cpRow = page.locator(`[data-pa-list='returns'] [data-pa-row='${CP.partId}']`);
  check(`G7: cancelled with the supplier after its LPO was paid: credit due (${await cpRow.getAttribute("data-pa-state").catch(() => "missing")})`, (await cpRow.count()) === 1 && (await cpRow.getAttribute("data-pa-state")) === "credit_due" && /Cancelled after the LPO was paid/.test(await text(cpRow)));
  check("G7: cancelled on an unpaid LPO: nothing to credit, not listed", (await page.locator(`[data-pa-row='${CU.partId}']`).count()) === 0);
  await page.screenshot({ path: shot("g7-section7-endings-returns.png"), fullPage: true });
  await go(page, `${PA}?supplier=${ENDS.id}`);
  const cuLine = page.locator(`[data-pa-list='lines'] [data-pa-row='${CU.partId}']`);
  const rpLine = page.locator(`[data-pa-list='lines'] [data-pa-row='${RP.partId}']`);
  check(`G7: Parts lines show the endings in section 7's words, cost 0 (${await cuLine.getAttribute("data-pa-state").catch(() => "missing")})`, (await cuLine.getAttribute("data-pa-state")) === "cancelled" && /Cancelled with the supplier/.test(await text(cuLine)) && (await cuLine.locator("[data-pa-cost]").getAttribute("data-pa-cost")) === "0.00" && (await rpLine.getAttribute("data-pa-state")) === "return_pending" && (await rpLine.locator("[data-pa-cost]").getAttribute("data-pa-cost")) === "0.00");

  /* ---------------- H. Problems ---------------- */
  await go(page, `${PA}?tab=problems`);
  const has = async (rule, partOrPo) => (await page.locator(`[data-pa-problem='${rule}']`).filter({ hasText: partOrPo }).count()) >= 1;
  check("H: bought but never charged (the water pump fitted on a car that left invoiced)", await has("not_charged", "E2E S12 WATER PUMP"));
  check("H: received without a supplier invoice (9 days, red)", (await page.locator(`[data-pa-row='no_supplier_invoice:${C.id}']`).getAttribute("data-pa-severity")) === "red");
  check("H: a price different from the LPO", await has("price_differs", "LPO-E2ES12-4"));
  check("H: a placeholder cost (AED 1.00 from OFJ Additional)", await has("placeholder_cost", "E2E S12 GRILL MOULDING"));
  const stale = await text(page.locator("[data-pa-problem='stale_invoice_cost']").filter({ hasText: "E2E S12 FRONT LH WISHBONE LINK" }));
  check(`H: a cost changed after invoicing ("${stale.slice(0, 160)}")`, /counts the cost as AED 500\.00/.test(stale) && /AED 520\.00/.test(stale) && /overstated by AED 20\.00/.test(stale));
  check("H: the credit note missing", await has("credit_missing", "E2E S12 TRANSMISSION MOUNT"));
  check("H: not for the return whose credit note number was typed", !(await has("credit_missing", "E2E S12 TYPED CN HORN")));
  check("H: a car released on credit with its proforma unpaid is charged (no Bought, never charged)", !(await has("not_charged", "E2E S12 CREDIT DOOR MIRROR")));
  check("H: the supplier without TRN", await has("supplier_no_trn", "E2E S12 NO TRN"));
  check("H: red first", (await page.locator("[data-pa-list='problems'] [data-pa-row]").first().getAttribute("data-pa-severity")) === "red");
  await page.screenshot({ path: shot("h1-problems.png"), fullPage: true });
  await go(page, `${PA}?tab=problems&quick=placeholder_cost`);
  check("H: the quick chip per rule", (await page.locator("[data-pa-list='problems'] [data-pa-row]").count()) >= 1 && (await page.locator("[data-pa-list='problems'] [data-pa-row]:not([data-pa-problem='placeholder_cost'])").count()) === 0);

  /* ---------------- I. Excel export ---------------- */
  const accCookie = await cookieHeader(ACC.id);
  const one = await fetch(`${base}/api/export/parts-accounts?tab=lpos&supplier=${HUB.id}`, { headers: { cookie: accCookie } });
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.load(Buffer.from(await one.arrayBuffer()));
  const lpoSheet = wb1.getWorksheet("LPOs");
  const lpoNumbers = [];
  lpoSheet?.eachRow((r, i) => { if (i > 1) lpoNumbers.push(String(r.getCell(1).value ?? "")); });
  check(`I: the LPOs tab exports as Excel with its rows (${lpoNumbers.filter((n) => n.startsWith("LPO-E2ES12")).length})`, one.status === 200 && /spreadsheetml/.test(one.headers.get("content-type") ?? "") && lpoNumbers.filter((n) => n.startsWith("LPO-E2ES12")).length >= 6);
  // Review fix: a moment goes into Excel as its Dubai day (01:30 Dubai is that day, never the UTC day before).
  const aDubaiDay = (await q("select to_char(approved_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as d from public.purchase_orders where id = $1", [A.id]))[0].d;
  let aCell = null;
  lpoSheet?.eachRow((r, i) => { if (i > 1 && String(r.getCell(1).value ?? "") === "LPO-E2ES12-1") aCell = r.getCell(10).value; });
  const aDay = aCell instanceof Date ? aCell.toISOString().slice(0, 10) : String(aCell);
  check(`I: the Approved date in the file is the Dubai day (${aDay} = ${aDubaiDay})`, aDay === aDubaiDay);
  const everything = await fetch(`${base}/api/export/parts-accounts?tab=all`, { headers: { cookie: accCookie } });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await everything.arrayBuffer()));
  const names = wb.worksheets.map((w) => w.name);
  check(`I: "Export everything" has the six sheets (${names.join(", ")})`, ["Parts lines", "LPOs", "Supplier invoices", "Payments to suppliers", "Returns and credits", "Problems"].every((n) => names.includes(n)));
  const refused = await fetch(`${base}/api/export/parts-accounts?tab=all`, { headers: { cookie: await cookieHeader(DESK) } });
  check("I: the export refuses Parts (403)", refused.status === 403);

  /* ---------------- J. Suppliers: search and quick filters ---------------- */
  await go(page, `${base}/parts/suppliers?q=${encodeURIComponent("555 1212")}`);
  check("J: the search finds a supplier by its phone digits", (await page.locator(`[data-supplier-row='${HUB.id}']`).count()) === 1 && (await page.locator(`[data-supplier-row='${NOTRN.id}']`).count()) === 0);
  // Review fix: a landline stored as +971 4 … is found when typed the way it is printed locally (04 …).
  await go(page, `${base}/parts/suppliers?q=${encodeURIComponent("04 555 1212")}`);
  check("J: the landline +971 4 555 1212 is found by 04 555 1212", (await page.locator(`[data-supplier-row='${HUB.id}']`).count()) === 1);
  await go(page, `${base}/parts/suppliers?q=100200300400599`);
  check("J: the search finds a supplier by its TRN", (await page.locator(`[data-supplier-row='${HUB.id}']`).count()) === 1);
  if (contactOn) {
    await go(page, `${base}/parts/suppliers?q=rahul%20s12`);
    check("J: the search finds a supplier by its contact person", (await page.locator(`[data-supplier-row='${HUB.id}']`).count()) === 1);
  } else console.log("   (contact person search skipped: migration 20261203190000 not applied on this database)");
  await go(page, `${base}/parts/suppliers?filter=no_trn`);
  check("J: VAT registered but no TRN lists the supplier with the red badge", (await page.locator(`[data-supplier-row='${NOTRN.id}'] [data-no-trn]`).count()) === 1 && (await page.locator(`[data-supplier-row='${HUB.id}']`).count()) === 0);
  await go(page, `${base}/parts/suppliers?filter=unpaid`);
  const chip = page.locator(`[data-supplier-row='${HUB.id}'] [data-supplier-unpaid]`);
  check(`J: Unpaid balance lists the supplier with "Unpaid AED x (n)" ("${await text(chip)}")`, (await chip.count()) === 1 && /^Unpaid AED 1,501\.50 \(3\)$/.test(await text(chip)) && (await chip.getAttribute("href"))?.includes("/parts-accounts?tab=payments"));
  check("J: the quick filter counts", /Unpaid balance · \d+/.test(await text(page.locator("[data-supplier-filter='unpaid']"))));
  await page.screenshot({ path: shot("j1-suppliers-unpaid.png"), fullPage: true });
  await go(page, `${base}/parts/orders/${D.id}#paid`);
  check("J: the LPO page has the #paid card the invoice links to", (await page.locator("#paid[data-supplier-pay]").count()) === 1);

  /* ---------------- K. A phone never slides sideways ---------------- */
  const phone = await browserForId(OWNER, { viewport: { width: 390, height: 844 }, touch: true, mobile: true });
  browsers.push(phone);
  for (const t of ["", "?tab=lpos", "?tab=payments", "?tab=problems"]) {
    await go(phone.page, `${PA}${t}`);
    const wide = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`K: 390 px ${t || "(parts lines)"} has no sideways scroll (${wide})`, wide <= 1);
  }
  await phone.page.screenshot({ path: shot("k1-phone-problems.png"), fullPage: true });
} catch (e) {
  check(`no crash (${String(e?.message ?? e).slice(0, 300)})`, false);
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  if (!process.env.KEEP) cleanupDb();
}
process.exit(summary() ? 1 : 0);
