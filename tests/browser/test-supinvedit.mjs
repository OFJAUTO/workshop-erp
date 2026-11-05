// SUPPLIER INVOICE EDIT (5 November 2026, the Gargash case LPO-00037-2 / J-00969): the owner and accounts
// edit an entered invoice's number, date, per-line costs, before-VAT amount and VAT with a COMPULSORY remark.
// Who/when/old → new are kept and shown on the LPO and the invoice row; the invoice goes back to UNCHECKED;
// the typed VAT flows to the row totals, the supplier balance and the "Paid to supplier" figure; the part
// costs flow to the job (profit); a paid LPO shows the difference owed; a posted Zoho bill turns red "fix by
// hand"; parts never see the button and the server refuses them too.
// Run: node --env-file=.env.test.local tests/browser/test-supinvedit.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserForId, cleanupDb, confirmMoney, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "supinvedit");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const desk = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const acc = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1500, h = 1400) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };

cleanupDb();
try {
  // ---------- Seed: the Gargash shape. LPO approved at 12,228.30; invoice entered at the same figure and CHECKED. ----------
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E GARGASH', '100300500700900', true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E GARGASH')", [owner.id]);
  const sup = (await sql("select id, name from public.suppliers where name ilike 'E2E GARGASH'"))[0];
  const po = (await sql(
    "insert into public.purchase_orders (job_id, number, supplier_id, supplier_name, status, kind, total_cost_aed, approved_at, ordered_at, received_at, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_path, supplier_invoice_checked_at) values ($1, 'LPO-E2EGG-2', $2, $3, 'received', 'supplier', 12228.30, now(), now(), now(), 'received', 'SI-26-001', $4, 12228.30, now(), 'e2e/si-26-001.png', now()) returning id, number",
    [jobId, sup.id, sup.name, today],
  ))[0];
  const mkLine = async (name, qty, unit, pos) => {
    const part = (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, supplier, cost_aed, availability, order_status, confirm_status, po_id, received_qty, created_by, updated_by) values ($1, $2, $3, $3, $4, $5, 'to_order', 'received', 'confirmed', $6, $3, $7, $7) returning id", [jobId, name, qty, sup.name, unit, po.id, desk.id]))[0];
    const line = (await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, received_qty, part_item_id, position) values ($1, $2, $3, $4, $3, $5, $6) returning id", [po.id, name, qty, unit, part.id, pos]))[0];
    await sql("update public.part_items set po_line_id = $1 where id = $2", [line.id, part.id]);
    return { lineId: line.id, partId: part.id };
  };
  const grille = await mkLine("E2E RADIATOR GRILLE", 1, 8000, 1);
  const moulding = await mkLine("E2E GRILLE MOULDING", 2, 2114.15, 2);
  const partCost = async () => (await sql("select coalesce(sum(coalesce(final_cost_aed, cost_aed) * coalesce(confirmed_quantity, quantity)), 0)::numeric(14,2) as c from public.part_items where id = any($1)", [[grille.partId, moulding.partId]]))[0].c;

  /* ---------- A. Accounts open the LPO: the button is there; figures agree so no Approved→Invoiced line yet ---------- */
  const accB = await open(acc.id);
  const page = accB.page;
  await go(page, `${base}/parts/orders/${po.id}`);
  check("A: accounts see the Edit invoice button in the Record box", (await page.locator("[data-si-edit]").count()) === 1);
  check("A: no Approved → Invoiced line while the figures agree", (await page.locator("[data-invoice-vs-approved]").count()) === 0);

  /* ---------- B. The Gargash edit: line costs down, amount 11,684.82, VAT 584.24, remark ---------- */
  await page.locator("[data-si-edit]").click();
  await page.locator("[data-si-edit-form]").waitFor({ timeout: 10000 });
  check("B: the form is prefilled with the entered invoice", (await page.locator("[data-edit-number]").inputValue()) === "SI-26-001" && (await page.locator("[data-edit-amount]").inputValue()) === "12228.30");
  const priceBox = (lineId) => page.locator(`[data-edit-line="${lineId}"] input`);
  // React-19 controlled money boxes: type like a person (fill can miss them), then give React a beat.
  const typeInto = async (loc, value) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(value, { delay: 10 }); };
  await priceBox(grille.lineId).fill("7600.00");
  await priceBox(moulding.lineId).fill("2042.41");
  await typeInto(page.locator("[data-edit-amount]"), "11684.82");
  await typeInto(page.locator("[data-edit-vat]"), "584.24");
  const live = await until(async () => { const t = await text(page.locator("[data-invoice-vs-approved]")); return t.includes("(−543.48)") ? t : null; }, 20, 300);
  check(`B: the form shows "Approved 12,228.30 → Invoiced 11,684.82 (−543.48)" live (${live})`, live === "Approved 12,228.30 → Invoiced 11,684.82 (−543.48)");
  check("B: the live total with VAT is 12,269.06", !!(await until(async () => (await text(page.locator("[data-edit-total]"))).includes("12,269.06"), 20, 300)));
  check("B: VAT 584.24 is 5%: no warning", (await page.locator("[data-vat-warning]").count()) === 0);
  await page.locator("[data-edit-remark]").fill("Supplier's final invoice is less than the quoted prices");
  await page.screenshot({ path: shot("b1-edit-form.png"), fullPage: true });
  await page.locator("[data-edit-save]").click();
  await page.waitForURL(/message=/, { timeout: 20000 });
  const msg = decodeURIComponent(page.url().split("message=")[1] ?? "").replace(/\+/g, " ");
  check(`B: the answer counts the changes ("${msg.slice(0, 90)}")`, /Invoice edited and sent back to UNCHECKED for accounts \(4 changes recorded\)/.test(msg));
  const row = (await sql("select supplier_invoice_amount::text as a, supplier_invoice_vat_aed::text as v, supplier_invoice_checked_at is null as unchecked from public.purchase_orders where id = $1", [po.id]))[0];
  check("B: amount 11,684.82 and VAT 584.24 stored; back to UNCHECKED", row?.a === "11684.82" && row?.v === "584.24" && row?.unchecked === true);
  const hist = (await sql("select remark, changes, paid_difference_aed from public.supplier_invoice_edits where po_id = $1 order by created_at", [po.id]))[0];
  check("B: the history row keeps the remark and old → new per field", /final invoice/i.test(hist?.remark ?? "") && JSON.stringify(hist?.changes ?? []).includes('"old":"12,228.30"') && JSON.stringify(hist?.changes ?? []).includes('"new":"11,684.82"') && hist?.paid_difference_aed === null);
  check("B: the part costs follow (job cost down by 543.48: 12,228.30 → 11,684.82)", String(await partCost()) === "11684.82");
  await go(page, `${base}/parts/orders/${po.id}`);
  check("B: the Record box reads the typed VAT (… + VAT 584.24 = 12269.06)", ((await page.locator("body").textContent()) ?? "").includes("+ VAT 584.24 = 12269.06"));
  check(`B: "Approved 12,228.30 → Invoiced 11,684.82 (−543.48)" on the LPO page`, (await text(page.locator("[data-invoice-vs-approved]"))).includes("(−543.48)"));
  const histLine = await text(page.locator("[data-invoice-edit-history]"));
  check(`B: the edit history shows who, the remark and old → new (${histLine.slice(0, 120)})`, histLine.includes("Before VAT: 12,228.30 → 11,684.82") && /final invoice/i.test(histLine));
  await page.screenshot({ path: shot("b2-lpo-after-edit.png"), fullPage: true });

  /* ---------- C. The Supplier invoices row: typed VAT in the totals, the button, the history; Mark checked queues the bill ---------- */
  await go(page, `${base}/supplier-invoices?open=${encodeURIComponent(`${sup.id}|SI26001`)}`);
  const opened = page.locator("[data-si-opened]");
  await opened.waitFor({ timeout: 15000 });
  const totals = await text(opened.locator("p").filter({ hasText: "Before VAT" }));
  check(`C: the row totals use the typed VAT (${totals.slice(0, 90)})`, totals.includes("11,684.82") && totals.includes("VAT AED 584.24") && totals.includes("12,269.06"));
  check("C: Approved → Invoiced on the invoice row", (await text(opened.locator("[data-si-vs-approved]"))).includes("(−543.48)"));
  check("C: the Edit button and the history are on the invoice too", (await opened.locator("[data-si-edit]").count()) === 1 && (await text(opened.locator("[data-invoice-edit-history]"))).includes("11,684.82"));
  await page.screenshot({ path: shot("c1-invoice-row.png"), fullPage: true });
  await opened.locator("[data-si-check]").click();
  const bill = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'bill' and record_id = $1", [po.id]))[0]);
  check("C: Mark checked after the edit queues the Zoho bill (fresh figures)", !!bill);

  /* ---------- D. Paid to supplier at the typed VAT: AED 12,269.06 ---------- */
  await go(page, `${base}/parts/orders/${po.id}#paid`);
  await page.locator('[data-confirm-open="supplier-paid"]').click();
  const payWords = await text(page.locator('[data-confirm-money="supplier-paid"] [data-confirm-text]'));
  check(`D: "Paid to supplier" pays the invoice's own total (${payWords.slice(0, 110)})`, payWords.includes("12,269.06") && payWords.includes("11,684.82 + VAT 584.24"));
  await page.screenshot({ path: shot("d1-pay-confirm.png") });
  await page.locator('[data-confirm-yes-money="supplier-paid"]').click();
  const paid = await until(async () => (await sql("select supplier_paid_at from public.purchase_orders where id = $1 and supplier_paid_at is not null", [po.id]))[0]);
  check("D: the payment is recorded", !!paid);

  /* ---------- E. Edit AFTER payment: the VAT warning never blocks; the difference is owed, the payment untouched ---------- */
  await go(page, `${base}/parts/orders/${po.id}`);
  await page.locator("[data-si-edit]").click();
  await page.locator("[data-si-edit-form]").waitFor({ timeout: 10000 });
  check("E: the form says the payment will not change", (await page.locator("[data-edit-paid-note]").count()) === 1);
  await typeInto(page.locator("[data-edit-vat]"), "700");
  check("E: VAT off 5% warns in amber but never blocks", !!(await until(async () => (await text(page.locator("[data-vat-warning]"))).includes("you can still save"), 20, 300)));
  await page.screenshot({ path: shot("e1-vat-warning.png") });
  await typeInto(page.locator("[data-edit-amount]"), "11700.00");
  await typeInto(page.locator("[data-edit-vat]"), "585.00");
  await page.locator("[data-edit-remark]").fill("Supplier reissued the invoice a little higher");
  await page.locator("[data-edit-save]").click();
  await page.waitForURL(/message=/, { timeout: 20000 });
  const msg2 = decodeURIComponent(page.url().split("message=")[1] ?? "").replace(/\+/g, " ");
  check(`E: the paid difference is named, the payment untouched ("${msg2.slice(0, 160)}")`, /is owed AED 15\.94 more/.test(msg2) && /recorded payment is untouched/.test(msg2));
  const after = (await sql("select supplier_paid_at is not null as paid, supplier_invoice_checked_at is null as unchecked from public.purchase_orders where id = $1", [po.id]))[0];
  check("E: still paid (never reversed by an edit), and back to UNCHECKED again", after?.paid === true && after?.unchecked === true);
  const diffRow = (await sql("select paid_difference_aed::text as d from public.supplier_invoice_edits where po_id = $1 and paid_difference_aed is not null", [po.id]))[0];
  check("E: the history keeps the owed difference (+15.94)", diffRow?.d === "15.94");
  await go(page, `${base}/parts/orders/${po.id}`);
  check("E: the owed difference shows in the history on screen", (await text(page.locator("[data-invoice-edit-history]"))).includes("supplier is owed AED 15.94 more"));

  /* ---------- F. A bill already in Zoho turns red "fix by hand" when the figures change ---------- */
  await sql("update public.zoho_outbox set status = 'synced', zoho_id = 'e2e-bill-1' where kind = 'bill' and record_id = $1", [po.id]);
  await sql("update public.purchase_orders set zoho_bill_id = 'e2e-bill-1' where id = $1", [po.id]);
  await page.locator("[data-si-edit]").click();
  await page.locator("[data-si-edit-form]").waitFor({ timeout: 10000 });
  await typeInto(page.locator("[data-edit-amount]"), "11684.82");
  await typeInto(page.locator("[data-edit-vat]"), "584.24");
  await page.locator("[data-edit-remark]").fill("Putting the correct reissued figures back");
  await page.locator("[data-edit-save]").click();
  await page.waitForURL(/message=/, { timeout: 20000 });
  const flagged = await until(async () => (await sql("select status, last_error as w from public.zoho_outbox where kind = 'bill' and record_id = $1 and status = 'failed'", [po.id]))[0]);
  check(`F: the posted bill turns red for the accountant ("${(flagged?.w ?? "").slice(0, 80)}")`, /changed after its bill reached Zoho/.test(flagged?.w ?? ""));

  /* ---------- G. Parts never see it and the server refuses them; a short remark is refused by the server ---------- */
  // The form's own fields (the server action's id travels in them), harvested from the accounts page.
  await go(page, `${base}/parts/orders/${po.id}`);
  await page.locator("[data-si-edit]").click();
  await page.locator("[data-si-edit-form]").waitFor({ timeout: 10000 });
  const fields = await page.evaluate(() => [...document.querySelector("[data-si-edit-form]").elements].filter((e) => e.name).map((e) => [e.name, e.value]));
  const partsB = await open(desk.id);
  await go(partsB.page, `${base}/parts/orders/${po.id}`);
  check("G: the parts desk never sees the Edit button", (await partsB.page.locator("[data-si-edit]").count()) === 0);
  const replay = (p, overrides) =>
    p.evaluate(async ({ url, fields, overrides }) => {
      const fd = new FormData();
      const done = new Set();
      for (const [k, v] of fields) { fd.append(k, k in overrides && !done.has(k) ? overrides[k] : v); done.add(k); }
      const r = await fetch(url, { method: "POST", body: fd });
      return r.url;
    }, { url: `${base}/parts/orders/${po.id}`, fields, overrides });
  const asParts = decodeURIComponent(await replay(partsB.page, { edit_remark: "Forced by the test" })).replace(/\+/g, " ");
  check(`G: the server refuses the parts desk ("${asParts.split("error=")[1]?.slice(0, 60) ?? asParts.slice(-60)}")`, asParts.includes("Only the owner and accounts can edit a supplier invoice"));
  const unchangedByParts = (await sql("select supplier_invoice_amount::text as a from public.purchase_orders where id = $1", [po.id]))[0];
  check("G: nothing changed from that refused try", unchangedByParts?.a === "11684.82");
  const shortRemark = decodeURIComponent(await replay(page, { edit_remark: "abc" })).replace(/\+/g, " ");
  check("G: a short remark is refused by the server (every edit is recorded)", shortRemark.includes("Say WHY in the remark"));
  check("G: the remark box itself is compulsory on screen", (await page.locator("[data-edit-remark][required]").count()) === 1);
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  await sql("delete from public.zoho_outbox where record_id in (select id from public.purchase_orders where number like 'LPO-E2EGG-%')").catch(() => {});
  cleanupDb();
  summary();
}
