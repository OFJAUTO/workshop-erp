// 15 November 2026, Section 5: SUPPLIER PAYMENTS - CHOOSE, CONFIRM, CORRECT (the SPAY-00032 case). No payment method is
// pre-selected (the payment cannot be recorded until one is chosen); the question "Pay <supplier> AED <amount> by
// <METHOD> on <date>?" with YES, RECORD and GO BACK AND EDIT; "Correct this payment" (method, date, reference, proof;
// reason required; old values in the history; amount and supplier not editable); a payment already in Zoho is set to be
// taken back and posted again. Signed in as accounts. TEST only.
//   node --env-file=.env.test.local tests/browser/test-supplier-pay-correct.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-15-supplier-pay-correct";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const dubai = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Future Tyres Co', false, null) returning id"))[0].id;
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_path, supplier_invoice_checked_at) values ('LPO-E2E-F1', 'supplier', $1, $2, 'E2E Future Tyres Co', 'received', 80, 'received', 'E2E-FT-32', current_date - 1, 80, now(), 'e2e/invoice.pdf', now()) returning id", [JOB, sup]))[0].id;

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1100 } });
  await go(acc.page, `${base}/parts/orders/${po}`);
  const box = acc.page.locator("[data-supplier-pay-box]").first();
  await box.waitFor({ timeout: 15000 });
  // 1. Nothing pre-selected; the payment cannot be recorded until a method is chosen.
  const checkedNow = await box.locator('[data-pay-method] input[name="method"]:checked').count();
  check("1a: no payment method is pre-selected", checkedNow === 0, String(checkedNow));
  await box.locator("[data-supplier-pay-amount]").fill("80");
  await box.locator("[data-supplier-pay-save]").click();
  await sleep(600);
  check("1b: pressing Record with no method chosen opens no question and records nothing", (await acc.page.locator("[data-confirm-money]").count()) === 0 && (await sql("select count(*)::int as n from public.supplier_payments where supplier_id = $1", [sup]))[0].n === 0);
  for (const [w, h] of [[1440, 1100], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await box.screenshot({ path: path.join(OUT, `1-no-method-preselected-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1100 });

  // 2. The question names the supplier, amount, METHOD and date; GO BACK AND EDIT records nothing.
  await box.locator('[data-pay-method] label').filter({ hasText: /Bank transfer/ }).first().click();
  await box.locator("[data-supplier-pay-save]").click();
  await acc.page.locator("[data-confirm-money]").waitFor({ timeout: 8000 });
  const q = await text(acc.page, "[data-confirm-title]");
  const day = new Date(`${dubai()}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  check("2a: \"Pay E2E Future Tyres Co AED 80.00 by BANK TRANSFER on <today>?\"", q === `Pay E2E Future Tyres Co AED 80.00 by BANK TRANSFER on ${day}?`, q);
  check("2b: the buttons say YES, RECORD and GO BACK AND EDIT", (await text(acc.page, "[data-confirm-yes-money]")) === "YES, RECORD" && (await text(acc.page, "[data-confirm-cancel]")) === "GO BACK AND EDIT");
  for (const [w, h] of [[1440, 1100], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.screenshot({ path: path.join(OUT, `2-confirm-question-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1100 });
  await acc.page.locator("[data-confirm-cancel]").click();
  await sleep(500);
  check("2c: GO BACK AND EDIT: nothing recorded, the form keeps its typing", (await sql("select count(*)::int as n from public.supplier_payments where supplier_id = $1", [sup]))[0].n === 0 && (await box.locator("[data-supplier-pay-amount]").inputValue()) === "80");
  // 3. YES, RECORD (by transfer - the mistake of SPAY-00032).
  await box.locator("[data-supplier-pay-save]").click();
  await acc.page.locator("[data-confirm-yes-money]").click();
  const pay = await until(async () => (await sql("select id, number, method from public.supplier_payments where supplier_id = $1 and status = 'recorded'", [sup]))[0]);
  check("3: recorded by transfer", pay?.method === "transfer", JSON.stringify(pay));

  // 4. Correct this payment: it was cash. Reason required; old values kept; amount and supplier not editable.
  await go(acc.page, `${base}/parts/orders/${po}`);
  const cp = acc.page.locator(`[data-correct-payment="${pay.number}"]`);
  await cp.locator("[data-correct-open]").click();
  check("4a: the correction has no amount or supplier box", (await cp.locator('input[name="amount"], [name="supplier_id"], [name="supplier_name"]').count()) === 0);
  check("4b: the method is not pre-selected in the correction either", (await cp.locator('input[name="method"]:checked').count()) === 0);
  await cp.locator('[data-correct-method] label').filter({ hasText: /Cash/ }).first().click();
  await cp.locator("[data-correct-reason]").fill("It was paid in cash at the counter, not by transfer");
  for (const [w, h] of [[1440, 1100], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await cp.screenshot({ path: path.join(OUT, `3-correct-this-payment-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1100 });
  await cp.locator('[data-confirm-open="correct-payment"]').click();
  await acc.page.locator('[data-confirm-yes-money="correct-payment"]').click();
  const fixed = await until(async () => { const r = (await sql("select method, edit_history from public.supplier_payments where id = $1", [pay.id]))[0]; return r?.method === "cash" ? r : null; });
  const last = (fixed?.edit_history ?? []).at(-1);
  check("4c: corrected to cash", fixed?.method === "cash");
  check("4d: the history keeps who, when, old → new and the reason", last?.changes?.some((c) => c.field === "Method" && c.old === "Bank transfer" && c.new === "Cash") && !!last?.by && !!last?.at && /cash at the counter/.test(last?.remark ?? ""), JSON.stringify(last));
  check("4e: the LPO's paid line follows (method cash)", (await sql("select supplier_paid_method from public.purchase_orders where id = $1", [po]))[0]?.supplier_paid_method === "cash");
  await go(acc.page, `${base}/parts/orders/${po}`);
  check("4f: the correction shows under the payment", /Method Bank transfer → Cash/.test(await text(acc.page, "[data-pay-edit]")));

  // 5. Already in Zoho: the correction sets it to be taken back and posted again (OFJ TEST at the next Sync to Zoho).
  await sql("update public.supplier_payments set zoho_payment_id = 'e2e-zoho-vp-1' where id = $1", [pay.id]);
  await sql("insert into public.zoho_outbox (kind, record_id, status, zoho_id, attempts) values ('supplierpay', $1, 'synced', 'e2e-zoho-vp-1', 1) on conflict (kind, record_id) do update set status = 'synced', zoho_id = 'e2e-zoho-vp-1'", [pay.id]);
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  const cp2 = acc.page.locator(`[data-correct-payment="${pay.number}"]`).first();
  await cp2.locator("[data-correct-open]").click();
  await cp2.locator('[data-correct-method] label').filter({ hasText: /Cash/ }).first().click();
  await cp2.locator("[data-correct-date]").first().fill(new Date(Date.now() + 4 * 3600000 - 86400000).toISOString().slice(0, 10));
  await cp2.locator("[data-correct-reason]").fill("Paid the day before - the slip says so");
  await cp2.locator('[data-confirm-open="correct-payment"]').click();
  await acc.page.locator('[data-confirm-yes-money="correct-payment"]').click();
  const reopened = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'supplierpay' and record_id = $1 and status = 'pending'", [pay.id]))[0]);
  const hist = (await sql("select edit_history from public.supplier_payments where id = $1", [pay.id]))[0]?.edit_history ?? [];
  check("5: in Zoho: the correction is marked to be taken back and posted again (the Zoho row waits for Sync to Zoho)", !!reopened && hist.at(-1)?.zoho === "repost", JSON.stringify(hist.at(-1)));
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.zoho_outbox where kind = 'supplierpay' and record_id in (select id from public.supplier_payments where supplier_name like 'E2E%')").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
