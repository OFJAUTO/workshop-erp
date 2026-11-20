// 20 November 2026, Section 3: ROUNDING ON SUPPLIER PAYMENTS - the LPO-00111-2 case on TEST (AL NABOODA, invoice
// 33192428, AED 243.60 = 232.00 + 11.60, paid 243.50 in cash). Signed in as accounts.
//  A. The pay box asks what the AED 0.10 is (ROUNDING / STILL OWED / DISCOUNT FROM THE SUPPLIER), nothing picked.
//  B. ROUNDING closes the invoice: the line keeps 0.10 written off, the LPO is paid; the invoice is not changed.
//  C. Above the limit (AED 5.00 short): rounding is greyed; a discount needs a reason.
//  D. An existing part payment: "Correct this payment" closes what is left as rounding.
//  E. Same-page fixes: an invoice dated before its LPO is flagged; the edit panel's total follows the line prices.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s20-3-rounding.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-20-supplier-rounding";
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
const SUP = "E2E AL NABOODA AUTOMOBILES LLC";

async function lpo(JOB, sup, number, net) {
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_vat_aed, supplier_invoice_path, supplier_invoice_checked_at, received_at) values ($1, 'supplier', $2, $3, $4, 'received', $5, 'received', $6, '2026-10-27', $5, round($5 * 0.05, 2), 'e2e/inv.pdf', now(), now()) returning id", [number, JOB, sup, SUP, net, `E2E-${number}`]))[0].id;
  const id = (await sql("insert into public.part_items (job_id, description, supplier, quantity, confirmed_quantity, received_qty, cost_aed, order_status, po_id, priced_at, is_active) values ($1, 'ENGINE MOUNT', $2, 1, 1, 1, $3, 'received', $4, now(), true) returning id", [JOB, SUP, net, po]))[0].id;
  const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, received_qty, unit_cost) values ($1, $2, 1, 'ENGINE MOUNT', 1, 1, $3) returning id", [po, id, net]))[0].id;
  await sql("update public.part_items set po_line_id = $1 where id = $2", [line, id]);
  return po;
}

async function pay(page, poId, amount, visit) {
  await go(page, `${base}/parts/orders/${poId}?v=${visit}#paid`);
  const box = page.locator("[data-supplier-pay-box]");
  await box.waitFor({ timeout: 30000 });
  await sleep(1500);
  for (const other of await box.locator("[data-supplier-pay-invoice]").all()) {
    const key = await other.getAttribute("data-supplier-pay-invoice");
    const cb = other.locator("input[type=checkbox]");
    if (key === poId) await cb.check(); else if (await cb.isChecked()) await cb.uncheck();
  }
  const amt = box.locator("[data-supplier-pay-amount]");
  await amt.click();
  await amt.evaluate((el) => el.select());
  await amt.pressSequentially(String(amount), { delay: 40 });
  await page.keyboard.press("Tab");
  await sleep(1200);
  await box.locator('input[name="method"][value="cash"]').evaluate((el) => el.click()).catch(() => null);
  return box;
}

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered) values ($1, '100236820600003', true) returning id", [SUP]))[0]?.id ?? (await sql("select id from public.suppliers where name = $1 limit 1", [SUP]))[0].id;
  await sql("update public.settings set value = '1'::jsonb where key = 'supplier_rounding_limit_aed'");
  const A = await lpo(JOB, sup, "LPO-E2E-RD1-2", 232);
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });

  // E1. The invoice dated 27 Oct is before its LPO (today): flagged on the LPO.
  await go(acc.page, `${base}/parts/orders/${A}`);
  check("E1: the invoice dated before its LPO is flagged", (await acc.page.locator("[data-invoice-before-lpo]").count()) === 1);

  // A. 243.50 against 243.60.
  let box = await pay(acc.page, A, "243.50", 1);
  const short = box.locator("[data-supplier-pay-short]");
  await short.waitFor({ timeout: 15000 });
  check("A1: the box asks what the AED 0.10 is", /AED 0\.10 less than/.test(await text(short)) && (await short.locator("[data-pay-diff]").count()) === 3);
  check("A2: nothing is pre-picked", (await short.locator('input[name="diff_kind"]:checked').count()) === 0);
  await shots(acc.page, box, "a-what-is-the-difference");
  await short.locator('[data-pay-diff="rounding"] input').check();
  await box.locator("[data-supplier-pay-save]").click();
  await acc.page.locator("[data-confirm-yes-money]").click({ timeout: 8000 });
  const b = await until(async () => { const x = (await sql("select l.amount_aed::float8 as paid, l.write_off_aed::float8 as off, l.write_off_kind as kind, po.supplier_paid_at is not null as closed, po.supplier_invoice_amount::float8 as inv from public.supplier_payment_lines l join public.purchase_orders po on po.id = l.po_id where l.po_id = $1 and l.is_active", [A]))[0]; return x?.closed ? x : null; });
  check("B1: ROUNDING closes the invoice: 243.50 paid, 0.10 written off, the invoice unchanged", b?.paid === 243.5 && b?.off === 0.1 && b?.kind === "rounding" && b?.inv === 232, JSON.stringify(b ?? {}));

  // C. Five dirhams short: rounding greyed.
  const C = await lpo(JOB, sup, "LPO-E2E-RD2-2", 232);
  box = await pay(acc.page, C, "238.60", 2);
  const cs = box.locator("[data-supplier-pay-short]");
  await cs.waitFor({ timeout: 15000 });
  check("C1: above the limit rounding is greyed", (await cs.locator('[data-pay-diff="rounding"]').getAttribute("data-allowed")) === "no");
  await cs.locator('[data-pay-diff="discount"] input').check();
  check("C2: a discount asks for its reason", (await cs.locator("[data-pay-diff-reason]").getAttribute("required")) !== null);
  await shots(acc.page, box, "c-above-the-limit");

  // D. An existing part payment closed as rounding through Correct this payment.
  const D = await lpo(JOB, sup, "LPO-E2E-RD3-2", 232);
  const pid = (await sql("insert into public.supplier_payments (number, supplier_id, supplier_name, method, amount_aed, paid_on, status) values ('E2E-SPAY-RD' || substr(md5(random()::text), 1, 5), $1, $2, 'cash', 243.40, current_date, 'recorded') returning id", [sup, SUP]))[0].id;
  await sql("insert into public.supplier_payment_lines (payment_id, po_id, amount_aed) values ($1, $2, 243.40)", [pid, D]);
  await go(acc.page, `${base}/parts/orders/${D}?v=3#paid`);
  await acc.page.locator("[data-correct-open]").first().click();
  const cd = acc.page.locator("[data-close-difference]");
  await cd.waitFor({ timeout: 15000 });
  await shots(acc.page, cd, "d-correct-this-payment-close");
  await cd.locator('[data-close-diff="rounding"] input').check();
  await cd.locator('[data-confirm-open="close-difference"]').click();
  await acc.page.locator('[data-confirm-yes-money="close-difference"]').click({ timeout: 8000 });
  const d = await until(async () => { const x = (await sql("select l.write_off_aed::float8 as off, po.supplier_paid_at is not null as closed from public.supplier_payment_lines l join public.purchase_orders po on po.id = l.po_id where l.payment_id = $1", [pid]))[0]; return x?.closed ? x : null; });
  check("D1: Correct this payment closes the 0.20 left as rounding", d?.off === 0.2, JSON.stringify(d ?? {}));

  // E2. The edit panel's total follows the line prices (no before-VAT total typed).
  await sql("update public.purchase_orders set supplier_invoice_amount = null, supplier_invoice_vat_aed = null where id = $1", [C]);
  await go(acc.page, `${base}/parts/orders/${C}?v=4`);
  await acc.page.locator("[data-si-edit]").first().click();
  const form = acc.page.locator("[data-si-edit-form]").first();
  const price = form.locator('[data-edit-line] input').first();
  await price.fill("232");
  await sleep(300);
  check("E2: the edit panel calculates the total as prices are typed (not AED 0.00)", /Total with VAT: AED 243\.60/.test(await text(form.locator("[data-edit-total]"))), await text(form.locator("[data-edit-total]")));
  await shots(acc.page, form, "e-edit-total");
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("update public.suppliers set is_active = false where name = $1", [SUP]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
