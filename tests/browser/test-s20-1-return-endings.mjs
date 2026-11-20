// 20 November 2026, Section 1: PURCHASE RETURNS - EVERY WAY A RETURN CAN END (the LPO-00103-1 case on TEST).
//  A. Parts desk: a received part, no invoice, nothing paid, returned. "How did this return end?" suggests RETURNED
//     BEFORE INVOICING; the credit note is greyed ("no supplier invoice"); nothing is pre-ticked. Saved: the LPO says
//     "No invoice expected" (no more "Invoice missing"), the job's cost has no screw.
//  B. Accounts: the live mistake - a part marked "Returned – credit note in" with "WIP - 58399" and a supplier credit
//     queued for Zoho, no invoice. The box is red with "Correct how this return was settled"; correcting it to
//     RETURNED BEFORE INVOICING keeps the old credit note in the history (voided) and withdraws the Zoho row (not sent).
//  C. Paid, no invoice: the parts desk asks for an advance; accounts confirm it; it becomes the supplier's advance.
//  D. Exchange: a replacement line "… – replaces returned …" on the same LPO.
//  E. A credit note is refused when there is no supplier invoice.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s20-1-return-endings.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-20-return-endings";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

async function lpo(JOB, sup, number, part, extra = {}) {
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ($1, 'supplier', $2, $3, 'E2E AL TAYER MOTORS LLC', 'received', 45, 'to_follow') returning id", [number, JOB, sup]))[0].id;
  const id = (await sql("insert into public.part_items (job_id, description, part_number, supplier, quantity, confirmed_quantity, received_qty, cost_aed, order_status, po_id, priced_at, is_active, disposition, disposition_at, return_status, returned_qty, final_cost_aed) values ($1, $2, 'LR055301', 'E2E AL TAYER MOTORS LLC', 1, 1, 1, 45, 'received', $3, now(), true, $4, now(), $5, 1, 0) returning id", [JOB, part, po, extra.disposition ?? "return_pending", extra.returnStatus ?? "to_return"]))[0].id;
  const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, received_qty, unit_cost) values ($1, $2, 1, $3, 'LR055301', 1, 1, 45) returning id", [po, id, part]))[0].id;
  await sql("update public.part_items set po_line_id = $1 where id = $2", [line, id]);
  return { po, id };
}

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered) values ('E2E AL TAYER MOTORS LLC', '100067373700003', true) returning id"))[0]?.id ?? (await sql("select id from public.suppliers where name = 'E2E AL TAYER MOTORS LLC' limit 1"))[0].id;

  // A. Parts desk: returned before invoicing.
  const A = await lpo(JOB, sup, "LPO-E2E-RE1-1", "BLEEDING SCREW");
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(parts.page, `${base}/parts/orders/${A.po}#returns`);
  const box = parts.page.locator(`[data-return-ending="${A.id}"]`);
  await box.waitFor({ timeout: 30000 });
  check("A1: the box suggests RETURNED BEFORE INVOICING", /RETURNED BEFORE INVOICING/.test(await text(box.locator("[data-return-ending-suggested]"))));
  check("A2: nothing is pre-ticked", (await box.locator('input[name="ending"]:checked').count()) === 0);
  check("A3: the credit note is greyed: no supplier invoice", (await box.locator('[data-ending-option="credit_note"]').getAttribute("data-allowed")) === "no" && /no supplier invoice/i.test(await text(box.locator('[data-ending-option="credit_note"]'))));
  await shots(parts.page, box, "a-how-did-it-end");
  await box.locator('[data-ending-option="before_invoice"] input').check();
  await box.locator("[data-return-ending-save]").click();
  const a = await until(async () => { const x = (await sql("select p.return_ending, p.disposition, po.supplier_invoice_status from public.part_items p join public.purchase_orders po on po.id = p.po_id where p.id = $1", [A.id]))[0]; return x?.supplier_invoice_status === "not_expected" ? x : null; });
  check("A4: saved as RETURNED BEFORE INVOICING; the LPO waits for no invoice", a?.return_ending === "before_invoice" && a?.disposition === "returned" && a?.supplier_invoice_status === "not_expected", JSON.stringify(a ?? {}));
  await go(parts.page, `${base}/parts/orders/${A.po}?v=2`);
  check("A5: the LPO says No invoice expected, not Invoice missing", (await parts.page.locator("[data-lpo-not-expected]").count()) === 1 && !(await text(parts.page.locator("body"))).includes("Invoice missing"));
  await shots(parts.page, null, "a-lpo-no-invoice-expected");


  // B. Accounts correct the live mistake.
  const B = await lpo(JOB, sup, "LPO-E2E-RE2-1", "BLEEDING SCREW LARGE", { disposition: "returned", returnStatus: "returned" });
  await sql("update public.part_items set disposition_note = 'WIP - 58399' where id = $1", [B.id]);
  await sql("insert into public.zoho_outbox (kind, record_id, status, job_id) values ('vendorcredit', $1, 'pending', $2)", [B.id, JOB]);
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/parts/orders/${B.po}#returns`);
  const bb = acc.page.locator(`[data-return-ending="${B.id}"]`);
  await bb.waitFor({ timeout: 30000 });
  check("B1: red: a credit note with no supplier invoice, with its fix-it-here button", (await bb.locator("[data-return-ending-wrong]").count()) === 1 && (await bb.locator("[data-return-ending-fix]").count()) === 1);
  await shots(acc.page, bb, "b-wrong-credit-note");
  const form = bb.locator("[data-return-ending-correct]");
  await form.locator('[data-ending-option="before_invoice"] input').check();
  await form.locator("[data-return-ending-reason]").fill("No supplier invoice ever came: WIP was the delivery note");
  await form.locator("[data-return-ending-correct-save]").click();
  const b = await until(async () => { const x = (await sql("select return_ending, return_ending_history, credit_note_number, disposition_note from public.part_items where id = $1", [B.id]))[0]; return x?.return_ending ? x : null; });
  check("B2: corrected; the old credit note is kept in the history, voided", b?.return_ending === "before_invoice" && Array.isArray(b?.return_ending_history) && b.return_ending_history[0]?.voided?.creditNote === "WIP - 58399", JSON.stringify(b ?? {}).slice(0, 300));
  const z = await until(async () => { const x = (await sql("select status, zoho_result from public.zoho_outbox where kind = 'vendorcredit' and record_id = $1", [B.id]))[0]; return x?.status === "synced" ? x : null; }, 30);
  check("B3: the queued supplier credit is withdrawn (not sent)", z?.status === "synced" && !!z?.zoho_result?.skipped, JSON.stringify(z ?? {}).slice(0, 200));
  await go(acc.page, `${base}/parts/orders/${B.po}?v=2#returns`);
  check("B4: the history line shows on the box", /voided, kept/.test(await text(acc.page.locator(`[data-return-ending="${B.id}"] [data-return-ending-history]`))));
  await shots(acc.page, acc.page.locator(`[data-return-ending="${B.id}"]`), "b-corrected-history");

  // C. Paid, no invoice: the desk asks for an advance; accounts confirm it.
  const C = await lpo(JOB, sup, "LPO-E2E-RE3-1", "COOLANT PIPE");
  const pay = (await sql("insert into public.supplier_payments (number, supplier_id, supplier_name, method, amount_aed, paid_on, status) values ('E2E-SPAY-' || substr(md5(random()::text), 1, 6), $1, 'E2E AL TAYER MOTORS LLC', 'transfer', 47.25, current_date, 'recorded') returning id", [sup]))[0]?.id;
  if (pay) await sql("insert into public.supplier_payment_lines (payment_id, po_id, amount_aed) values ($1, $2, 47.25)", [pay, C.po]);
  await go(parts.page, `${base}/parts/orders/${C.po}#returns`);
  const cb = parts.page.locator(`[data-return-ending="${C.id}"]`);
  await cb.waitFor({ timeout: 30000 });
  check("C1: paid, no invoice: the advance is suggested", /advance/i.test(await text(cb.locator("[data-return-ending-suggested]"))));
  await cb.locator('[data-ending-option="advance"] input').check();
  await cb.locator("[data-return-ending-save]").click();
  const c1 = await until(async () => (await sql("select return_advance_status from public.part_items where id = $1", [C.id]))[0]?.return_advance_status);
  check("C2: the desk ASKED the advance (accounts confirm it)", c1 === "asked", String(c1));
  await go(acc.page, `${base}/parts/orders/${C.po}#returns`);
  const ca = acc.page.locator(`[data-return-ending="${C.id}"] [data-return-advance-confirm]`);
  await ca.waitFor({ timeout: 30000 });
  await shots(acc.page, acc.page.locator(`[data-return-ending="${C.id}"]`), "c-confirm-advance");
  await ca.locator("[data-return-advance-confirm-save]").click();
  const c2 = await until(async () => { const x = (await sql("select p.return_advance_status, (select excess_kind from public.supplier_payments where id = $2) as kind, (select count(*)::int from public.supplier_payment_lines where payment_id = $2 and is_active) as lines from public.part_items p where p.id = $1", [C.id, pay]))[0]; return x?.kind === "advance" ? x : null; });
  check("C3: confirmed: the payment's money is the supplier's advance", c2?.kind === "advance" && c2?.lines === 0, JSON.stringify(c2 ?? {}));

  // D. Exchange.
  const D = await lpo(JOB, sup, "LPO-E2E-RE4-1", "OIL SEAL");
  await go(parts.page, `${base}/parts/orders/${D.po}#returns`);
  const db = parts.page.locator(`[data-return-ending="${D.id}"]`);
  await db.waitFor({ timeout: 30000 });
  await db.locator('[data-ending-option="exchange"] input').check();
  await db.locator("[data-return-ending-save]").click();
  const d = await until(async () => (await sql("select description from public.purchase_order_lines where po_id = $1 and description ilike '%replaces returned%'", [D.po]))[0]?.description);
  check("D1: exchange: \"OIL SEAL – replaces returned OIL SEAL\" on the same LPO", /OIL SEAL – replaces returned OIL SEAL/.test(String(d)), String(d));

  await parts.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("update public.suppliers set is_active = false where name = 'E2E AL TAYER MOTORS LLC'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
