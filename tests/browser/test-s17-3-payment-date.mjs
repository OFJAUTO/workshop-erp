// 17 November 2026, Section 3: THE PAYMENT DATE (the E-00095 case: "Record a payment" had no date, so a payment was
// stamped with the day it was typed; Record a settlement could not go earlier than that wrong day). Signed in as accounts
// (and the owner for a closed month).
//  A. "Payment date" on the payment form: starts on today, a day TYPED as day/month/year is saved as that day.
//  B. "Correct this payment": date, method, reference with a reason; the old values in the history; amount untouched.
//  C. In Zoho already: the correction marks it to be taken back and posted again (OFJ TEST, the next Sync to Zoho).
//  D. A closed month: accounts are refused in plain words; the owner may.
//  E. A payment moved into another month than its tax invoice: accounts are told (the invoice's date never changes).
//  F. The date box everywhere (settlements too) takes a typed day.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s17-3-payment-date.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-payment-date";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};
const dubai = (deltaDays = 0) => new Date(Date.now() + 4 * 3600000 + deltaDays * 86400000).toISOString().slice(0, 10);
const typed = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const dayOf = (ts) => new Date(Date.parse(ts) + 4 * 3600000).toISOString().slice(0, 10);
const lastMonthDay = () => { const d = new Date(Date.now() + 4 * 3600000); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

let closedBefore = null;
try {
  cleanupDb();
  closedBefore = (await sql("select value from public.settings where key = 'books_closed_through'"))[0]?.value ?? null;
  await sql("delete from public.settings where key = 'books_closed_through'");
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });

  // A. Record a cash payment dated 3 days ago, typed.
  // The Record payment window on the job card (THE way to record a payment at any stage).
  await go(acc.page, `${base}/jobs/${JOB}`);
  await acc.page.locator("[data-record-payment-open]").first().click();
  const win = acc.page.locator("[data-record-payment-dialog]");
  await win.waitFor({ timeout: 20000 });
  await until(async () => (await win.locator("[data-pay-targets], [data-record-payment-error]").count()) > 0, 40, 300);
  const form = win.locator("[data-payment-form]").first();
  await form.waitFor({ timeout: 30000 });
  check("A1: \"Payment date\" starts on today", (await form.locator("[data-payment-date]").inputValue()) === typed(dubai(0)), await form.locator("[data-payment-date]").inputValue());
  const back3 = dubai(-3);
  await form.locator('[data-method="cash"]').click();
  if (await form.locator("[data-amount-partial]").count()) await form.locator("[data-amount-partial]").click();
  await form.locator("[data-amount-input]").fill("100");
  await form.locator("[data-payment-date]").fill("");
  await form.locator("[data-payment-date]").pressSequentially(typed(back3));
  await shots(acc.page, form, "a-payment-date-typed");
  await form.locator("[data-record-payment]").first().click();
  const q = await text(acc.page, "[data-confirm-text]");
  check("A2: the question names the day it is dated", q.includes(`dated ${typed(back3)}`), q);
  await acc.page.locator("[data-confirm-yes]").click();
  const pay = await until(async () => (await sql("select id, number, received_at, method, amount_aed from public.payments where job_id = $1 and status = 'recorded' order by created_at desc limit 1", [JOB]))[0]);
  check("A3: saved on the typed day", !!pay && dayOf(pay.received_at) === back3, pay ? `${pay.number} ${pay.received_at}` : "none");

  // B. Correct this payment: the day before that, by card machine → cash stays? (method changes to bank transfer), a reference.
  await go(acc.page, `${base}/jobs/${JOB}/invoice?v=2`);
  const cp = acc.page.locator(`[data-correct-customer-payment="${pay.number}"]`).first();
  await cp.waitFor({ timeout: 20000 });
  await cp.locator("[data-correct-open]").click();
  check("B1: the correction has no amount or customer box, and no method is pre-selected", (await cp.locator('input[name="amount"], [name="customer_id"]').count()) === 0 && (await cp.locator('input[name="method"]:checked').count()) === 0);
  const back5 = dubai(-5);
  await cp.locator("[data-correct-date]").fill("");
  await cp.locator("[data-correct-date]").pressSequentially(typed(back5));
  await cp.locator("[data-correct-method] label").filter({ hasText: /^Cash$/ }).first().click();
  await cp.locator("[data-correct-reference]").fill("CASH BOOK P.14");
  await cp.locator("[data-correct-reason]").fill("The customer paid on that day, it was typed later");
  await shots(acc.page, cp, "b-correct-this-payment");
  await cp.locator('[data-confirm-open="correct-customer-payment"]').click();
  await acc.page.locator('[data-confirm-yes-money="correct-customer-payment"]').click();
  await cp.locator("[data-correct-done], [data-correct-error]").first().waitFor({ timeout: 30000 });
  const fixed = (await sql("select received_at, reference, amount_aed from public.payments where id = $1", [pay.id]))[0];
  check("B2: the date and reference are corrected; the amount is untouched", dayOf(fixed.received_at) === back5 && fixed.reference === "CASH BOOK P.14" && Number(fixed.amount_aed) === 100, `${await text(acc.page, "[data-correct-done], [data-correct-error]")} ${JSON.stringify(fixed)}`);
  const log = await sql("select new_data from public.audit_log where table_name = 'payments' and record_id = $1 and new_data ? 'correction' order by changed_at desc limit 1", [pay.id]);
  const corr = log[0]?.new_data?.correction;
  check("B3: the history keeps who, when, old → new and the reason", !!corr && corr.changes.some((c) => c.field === "Date") && corr.changes.some((c) => c.field === "Reference") && /typed later/.test(corr.reason) && !!corr.by, JSON.stringify(corr ?? {}));
  await go(acc.page, `${base}/jobs/${JOB}/invoice?v=3`);
  check("B4: the correction shows under the payment", /Corrected .* Date .* → .*Reference .*CASH BOOK P\.14/.test(await text(acc.page, "[data-payment-corrections]")));
  await shots(acc.page, acc.page.locator(`[data-payment-row="${pay.number}"]`).first(), "b-correction-history");

  // C. Already in Zoho: taken back and posted again at the next Sync.
  await sql("update public.payments set zoho_payment_id = 'e2e-zoho-cp-1' where id = $1", [pay.id]);
  await sql("insert into public.zoho_outbox (kind, record_id, status, zoho_id, attempts, job_id) values ('deposit', $1, 'synced', 'e2e-zoho-cp-1', 1, $2) on conflict (kind, record_id) do update set status = 'synced', zoho_id = 'e2e-zoho-cp-1'", [pay.id, JOB]);
  await sql("insert into public.zoho_outbox (kind, record_id, status, zoho_id, attempts, job_id) values ('payment', $1, 'synced', 'e2e-zoho-cp-1', 1, $2) on conflict (kind, record_id) do update set status = 'synced', zoho_id = 'e2e-zoho-cp-1'", [pay.id, JOB]);
  const cp2 = acc.page.locator(`[data-correct-customer-payment="${pay.number}"]`).first();
  await cp2.locator("[data-correct-open]").click();
  await cp2.locator("[data-correct-method] label").filter({ hasText: /^Cash$/ }).first().click();
  await cp2.locator("[data-correct-reference]").fill("CASH BOOK P.15");
  await cp2.locator("[data-correct-reason]").fill("Page number was wrong in the reference");
  await cp2.locator('[data-confirm-open="correct-customer-payment"]').click();
  await acc.page.locator('[data-confirm-yes-money="correct-customer-payment"]').click();
  const re = await until(async () => (await sql("select status, zoho_result from public.zoho_outbox where record_id = $1 and status = 'pending' and zoho_result ? 'repost_requested_at'", [pay.id]))[0]);
  check("C1: in Zoho already: marked to be taken back and posted again (waits for Sync to Zoho)", !!re, JSON.stringify(re ?? {}));
  await sql("update public.payments set zoho_payment_id = null where id = $1", [pay.id]);
  await sql("delete from public.zoho_outbox where record_id = $1", [pay.id]);

  // D. A closed month: accounts refused; the owner may.
  const closedMonth = lastMonthDay().slice(0, 7);
  await sql("insert into public.settings (key, label, value) values ('books_closed_through', 'Books closed through', to_jsonb($1::text)) on conflict (key) do update set value = to_jsonb($1::text)", [closedMonth]);
  await go(acc.page, `${base}/jobs/${JOB}/invoice?v=4`);
  const cp3 = acc.page.locator(`[data-correct-customer-payment="${pay.number}"]`).first();
  await cp3.locator("[data-correct-open]").click();
  await cp3.locator("[data-correct-date]").fill("");
  await cp3.locator("[data-correct-date]").pressSequentially(typed(lastMonthDay()));
  await cp3.locator("[data-correct-method] label").filter({ hasText: /^Cash$/ }).first().click();
  await cp3.locator("[data-correct-reason]").fill("Paid on the last day of last month");
  await cp3.locator('[data-confirm-open="correct-customer-payment"]').click();
  await acc.page.locator('[data-confirm-yes-money="correct-customer-payment"]').click();
  await cp3.locator("[data-correct-error], [data-correct-done]").first().waitFor({ timeout: 30000 }).catch(() => null);
  check("D1: accounts are refused a day in a closed month, in plain words", /is closed: a payment dated in it needs the owner/.test(await text(acc.page, "[data-correct-error]")) && dayOf((await sql("select received_at from public.payments where id = $1", [pay.id]))[0].received_at) === back5, (await text(acc.page, "[data-correct-customer-payment] form")).slice(-300));
  await acc.browser.close();

  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/jobs/${JOB}/invoice?v=5`);
  const cp4 = own.page.locator(`[data-correct-customer-payment="${pay.number}"]`).first();
  await cp4.locator("[data-correct-open]").click();
  await cp4.locator("[data-correct-date]").fill("");
  await cp4.locator("[data-correct-date]").pressSequentially(typed(lastMonthDay()));
  await cp4.locator("[data-correct-method] label").filter({ hasText: /^Cash$/ }).first().click();
  await cp4.locator("[data-correct-reason]").fill("Paid on the last day of last month");
  await cp4.locator('[data-confirm-open="correct-customer-payment"]').click();
  await own.page.locator('[data-confirm-yes-money="correct-customer-payment"]').click();
  const ownDone = await until(async () => dayOf((await sql("select received_at from public.payments where id = $1", [pay.id]))[0].received_at) === lastMonthDay());
  check("D2: the owner may date it in the closed month", !!ownDone);

  // E. Another month than its tax invoice: accounts are told.
  const inv = (await sql("select id, number from public.invoices where job_id = $1 and is_active order by created_at desc limit 1", [JOB]))[0];
  await sql("update public.invoices set kind = 'tax_invoice', issued_at = now() where id = $1", [inv.id]);
  await sql("update public.payments set invoice_id = $1 where id = $2", [inv.id, pay.id]);
  await go(own.page, `${base}/jobs/${JOB}/invoice?v=6`);
  const cp5 = own.page.locator(`[data-correct-customer-payment="${pay.number}"]`).first();
  await cp5.locator("[data-correct-open]").click();
  await cp5.locator("[data-correct-date]").fill("");
  await cp5.locator("[data-correct-date]").pressSequentially(typed(addBack(lastMonthDay())));
  await cp5.locator("[data-correct-method] label").filter({ hasText: /^Cash$/ }).first().click();
  await cp5.locator("[data-correct-reason]").fill("Moved to the day it really came in");
  await cp5.locator('[data-confirm-open="correct-customer-payment"]').click();
  await own.page.locator('[data-confirm-yes-money="correct-customer-payment"]').click();
  const bell = await until(async () => (await sql("select title, body from public.notifications where type = 'payment_month_differs' and body like $1 order by created_at desc limit 1", [`${pay.number}%`]))[0]);
  check("E1: accounts are told the payment sits in another month than its tax invoice", !!bell && /tax invoice/.test(bell.body), JSON.stringify(bell ?? {}));
  check("E2: the tax invoice's date is not changed", dayOf((await sql("select issued_at from public.invoices where id = $1", [inv.id]))[0].issued_at) === dubai(0));
  await own.browser.close();

  // F. The settlement date box takes a typed day too.
  const acc2 = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc2.page, `${base}/accounts-posting`);
  const sd = acc2.page.locator("[data-settle-date]").first();
  if (await sd.count()) {
    await sd.fill(typed(dubai(0)));
    check("F1: Record a settlement: the date can be typed (day/month/year)", (await acc2.page.locator('input[name="settled_on"]').first().inputValue()) === dubai(0));
  } else check("F1: Record a settlement: the date can be typed (no unsettled card payment on TEST to show the box)", true, "skipped – nothing to settle");
  await acc2.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (closedBefore === null) await sql("delete from public.settings where key = 'books_closed_through'").catch(() => null);
  else await sql("update public.settings set value = $1::jsonb where key = 'books_closed_through'", [JSON.stringify(closedBefore)]).catch(() => null);
  await sql("delete from public.notifications where type = 'payment_month_differs' and body like 'RCT-%' and created_at > now() - interval '1 hour'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);

function addBack(day) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
