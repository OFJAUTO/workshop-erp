// 18 November 2026, Section 1: CHEQUE PENDING - CLEAR WORDING AND THE TAX INVOICE (J-00493: a cheque of AED 12,600.00
// waiting to clear and the page said "BALANCE DUE AED 12,600.00" in red, with no tax invoice).
//  A. A cheque covering the balance: "COVERED BY CHEQUE – WAITING TO CLEAR" (amber), "Balance once cleared: AED 0.00"
//     on the money page, the invoice page, the job card and the gate-out page. Never red BALANCE DUE.
//  B. A cheque covering part: "Cheque pending AED …" and "Balance due AED …" apart.
//  C. "Issue tax invoice now" (accounts) → the owner approves on the Approvals page → the tax invoice is made.
//  D. The cheque bounces after the tax invoice: the tax invoice stays, accounts and the owner are told.
//  E. The deadline: completed 11 days ago → "TAX INVOICE DUE BY <date>" on the invoice page and the accounts dashboard.
//  F. The setting (accounts): "When the cheque is received" → a cheque recorded on a completed job issues the tax invoice.
//  G. A combined cheque: "This also clears RCT-… (AED …)" before Mark cleared.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s18-1-cheque-pending.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-18-cheque-pending";
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

let settingBefore = null;
let autoBefore = null;
try {
  cleanupDb();
  settingBefore = (await sql("select value from public.settings where key = 'cheque_tax_invoice_when'"))[0]?.value ?? null;
  autoBefore = (await sql("select value from public.settings where key = 'auto_approve'"))[0]?.value ?? null;
  await sql("update public.settings set value = jsonb_set(value, '{on}', 'false') where key = 'auto_approve'");
  await sql("delete from public.settings where key = 'cheque_tax_invoice_when'");
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const job = (await sql("select customer_id, vehicle_id, job_number from public.jobs where id = $1", [JOB]))[0];
  const pro = (await sql("select id, number, total_aed::float as total from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' and is_active and converted_to is null limit 1", [JOB]))[0];
  check("setup: the ready car has its proforma", !!pro, pro?.number);
  const chq = (await sql("insert into public.payments (number, customer_id, job_id, invoice_id, vehicle_id, method, amount_aed, status, cheque_number, cheque_bank, cheque_date, cheque_status) values ('E2E-RCT-S181', $1, $2, $3, $4, 'cheque', $5, 'recorded', '018315', 'Emirates NBD', current_date, 'pending') returning id", [job.customer_id, JOB, pro.id, job.vehicle_id, pro.total]))[0].id;

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  // A. Covered.
  await go(acc.page, `${base}/jobs/${JOB}/invoice`);
  await acc.page.locator("[data-money-summary]").waitFor({ timeout: 30000 });
  const head = await text(acc.page, "[data-money-summary] [data-balance-headline]");
  check("A1: money page: COVERED BY CHEQUE – WAITING TO CLEAR", /COVERED BY CHEQUE – WAITING TO CLEAR/.test(head) && /Balance once cleared: AED 0\.00/.test(head), head);
  check("A2: money page: no red BALANCE DUE", (await acc.page.locator("[data-money-summary] [data-balance-headline]").first().getAttribute("data-balance-headline")) === "covered");
  await shots(acc.page, acc.page.locator("[data-money-summary]"), "a-money-page-covered");
  await go(acc.page, `${base}/invoices/${pro.id}`);
  check("A3: invoice page: covered by cheque", /COVERED BY CHEQUE – WAITING TO CLEAR/.test(await text(acc.page, "[data-balance-headline]")));
  await shots(acc.page, null, "a-invoice-page-covered");
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/jobs/${JOB}`);
  const tile = await text(own.page, "[data-money-tile] [data-paid-so-far]");
  check("A4: job card: Covered by cheque – waiting to clear", /Covered by cheque – waiting to clear/.test(tile) && !/Balance AED/.test(tile), tile);
  await go(own.page, `${base}/jobs/${JOB}/gate-out`);
  const gate = await text(own.page, "[data-gateout-balance]");
  check("A5: gate-out page: covered by cheque", /COVERED BY CHEQUE/.test(gate), gate);
  await shots(own.page, own.page.locator("[data-gateout-balance]").locator("xpath=ancestor::*[contains(@class,'flex-col')][1]"), "a-gate-out-covered");

  // B. Part covered.
  await sql("update public.payments set amount_aed = $1 where id = $2", [Math.round(pro.total * 50) / 100, chq]);
  await go(acc.page, `${base}/jobs/${JOB}/invoice?v=2`);
  await acc.page.locator("[data-money-summary]").waitFor({ timeout: 30000 });
  const pending = await text(acc.page, "[data-money-summary] [data-balance-pending]");
  const due = await text(acc.page, "[data-money-summary] [data-balance-due]");
  check("B1: part: \"Cheque pending AED …\" and \"Balance due AED …\" apart", /^Cheque pending AED/.test(pending) && /^Balance due AED/.test(due), `${pending} | ${due}`);
  await shots(acc.page, acc.page.locator("[data-money-summary]"), "b-money-page-part");
  await sql("update public.payments set amount_aed = $1 where id = $2", [pro.total, chq]);

  // C. Issue tax invoice now → owner approves.
  await go(acc.page, `${base}/jobs/${JOB}/invoice?v=3`);
  const card = acc.page.locator("[data-tax-due]");
  await card.waitFor({ timeout: 30000 });
  check("C1: the card offers Issue tax invoice now (owner approves)", (await card.getAttribute("data-tax-due")) === "covered" && /owner approves/.test(await text(card, "[data-tax-due-issue]")));
  await card.locator("[data-tax-due-note]").fill("Customer needs it for their accounts");
  await shots(acc.page, card, "c-issue-tax-invoice-now");
  await card.locator("[data-tax-due-issue]").click();
  await card.locator("[data-tax-due-answer]").waitFor({ timeout: 30000 });
  check("C2: sent to the owner", /Sent to the owner/.test(await text(card, "[data-tax-due-answer]")));
  await go(own.page, `${base}/approvals`);
  const box = own.page.locator('[data-approvals-group="early_tax"] [data-approval-box]').first();
  await box.waitFor({ timeout: 30000 });
  check("C3: the Approvals page lists it with its reason", /cheque 018315/.test(await text(box, "[data-approval-what]")), await text(box, "[data-approval-what]"));
  await shots(own.page, box, "c-owner-approves");
  await box.locator("[data-approval-approve]").click();
  const tax = await until(async () => (await sql("select number, issue_reason from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued' and is_active", [JOB]))[0], 60);
  check("C4: the tax invoice is made from the proforma", !!tax, tax?.number);
  check("C5: it carries the reason (before the cheque cleared, approved by the owner)", /before the cheque cleared/.test(tax?.issue_reason ?? "") && /approved by/i.test(tax?.issue_reason ?? ""), tax?.issue_reason);

  // D. Bounce after the tax invoice.
  await go(acc.page, `${base}/accounts-posting?tab=cheque`);
  const row = acc.page.locator('[data-bank-row="E2E-RCT-S181"]');
  await row.waitFor({ timeout: 30000 });
  await row.locator('[data-bank-open="bounce"]').click();
  await row.locator('[data-bank-form="bounce"] [data-bank-bounce-note]').fill("Returned by the bank");
  await row.locator('[data-bank-save="bounce"]').click();
  const bounced = await until(async () => (await sql("select status from public.payments where id = $1 and status = 'reversed'", [chq]))[0], 40);
  check("D1: the cheque is reversed", !!bounced);
  const still = (await sql("select count(*)::int as n from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued' and is_active", [JOB]))[0].n;
  check("D2: the tax invoice stays as issued", still === 1);
  const told = await until(async () => (await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.job_id = $1 and n.type = 'cheque_bounced' and s.role_id = 'accounts' and n.body ilike '%stays as issued%'", [JOB]))[0]?.n, 20);
  check("D3: accounts are told the tax invoice stays and the balance is due", (told ?? 0) > 0, String(told));

  // E. Deadline (a fresh car, completed 11 days ago, nothing paid).
  cleanupDb();
  const s2 = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB2 = s2.jobId;
  const jn2 = (await sql("select job_number from public.jobs where id = $1", [JOB2]))[0].job_number;
  await sql("update public.jobs set ready_to_invoice_at = now() - interval '11 days' where id = $1", [JOB2]);
  await sql("update public.invoices set issued_at = now() - interval '11 days' where job_id = $1 and kind = 'proforma'", [JOB2]);
  await go(acc.page, `${base}/jobs/${JOB2}/invoice`);
  const due2 = acc.page.locator("[data-tax-due]");
  await due2.waitFor({ timeout: 30000 });
  const dueDay = new Date(Date.parse(`${dubai(-11)}T12:00:00Z`) + 14 * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
  check("E1: TAX INVOICE DUE BY <14 days from completion> on the invoice page", (await text(due2, "[data-tax-due-words]")) === `TAX INVOICE DUE BY ${dueDay}`, await text(due2, "[data-tax-due-words]"));
  check("E2: warned from day 10", (await due2.getAttribute("data-tax-due-warn")) === "1");
  await shots(acc.page, due2, "e-tax-invoice-due");
  await go(acc.page, `${base}/dashboard`);
  const listRow = acc.page.locator("[data-tax-due-list] [data-tax-due-row]").filter({ hasText: jn2 }).first();
  check("E3: the accounts dashboard lists it", (await acc.page.locator("[data-tax-due-list]").count()) > 0 && (await listRow.count()) > 0);
  if (await acc.page.locator("[data-tax-due-list]").count()) await shots(acc.page, acc.page.locator("[data-tax-due-list]"), "e-dashboard-tax-due");

  // F. The setting: "When the cheque is received" (accounts) → a cheque recorded issues the tax invoice.
  await go(acc.page, `${base}/accounts-posting?tab=cheque`);
  const setBox = acc.page.locator("[data-cheque-tax-when]");
  await setBox.waitFor({ timeout: 30000 });
  check("F1: the setting starts on \"When the cheque clears (as now)\"", await setBox.locator('[data-cheque-tax-option="cleared"]').isChecked());
  await setBox.locator('[data-cheque-tax-option="received"]').check();
  await setBox.locator("[data-cheque-tax-save]").click();
  await setBox.locator("[data-cheque-tax-saved]").waitFor({ timeout: 20000 });
  await shots(acc.page, acc.page.locator("[data-cheque-tax-card]"), "f-setting");
  const stored = (await sql("select value #>> '{}' as v from public.settings where key = 'cheque_tax_invoice_when'"))[0]?.v;
  check("F2: saved as \"received\"", stored === "received", stored);
  const pro2 = (await sql("select id, total_aed::float as total from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' and is_active and converted_to is null limit 1", [JOB2]))[0];
  // Record the cheque through the Record payment window, as accounts do.
  await go(acc.page, `${base}/jobs/${JOB2}`);
  await acc.page.locator("[data-record-payment-open]").first().click();
  const win = acc.page.locator("[data-record-payment-dialog]");
  await win.waitFor({ timeout: 20000 });
  const form = win.locator("[data-payment-form]").first();
  await form.waitFor({ timeout: 30000 });
  await form.locator('[data-method="cheque"]').click();
  if (await form.locator("[data-amount-full]").count()) await form.locator("[data-amount-full]").click();
  else await form.locator("[data-amount-input]").fill(String(pro2.total));
  await form.locator("[data-cheque-number]").fill("018399");
  await form.locator("[data-cheque-bank]").fill("Emirates NBD");
  await form.locator("[data-cheque-date]").fill(dubai(0));
  // A cheque needs its photo (the proof): a tiny picture, sent through the upload door like a real one.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await form.locator('input[type="file"]').first().setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: png });
  await until(async () => await form.locator("[data-record-payment]").first().isEnabled(), 60);
  await form.locator("[data-record-payment]").first().click();
  await acc.page.locator("[data-confirm-yes]").click();
  const tax2 = await until(async () => (await sql("select number, issue_reason from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued' and is_active", [JOB2]))[0], 60);
  check("F3: the tax invoice is issued when the cheque is received", !!tax2 && /when the cheque was received/.test(tax2.issue_reason ?? ""), tax2 ? `${tax2.number} · ${tax2.issue_reason}` : "none");

  // G. A combined cheque names the other receipt before Mark cleared.
  const pay2 = (await sql("select id, number, amount_aed::float as a from public.payments where job_id = $1 and method = 'cheque' and status = 'recorded' order by created_at desc limit 1", [JOB2]))[0];
  const grp = (await sql("insert into public.payment_groups (number, customer_id, method, amount_aed, cheque_number) values ('E2E-CP-S181', $1, 'cheque', $2, '018399') returning id", [job.customer_id, pay2.a + 500]))[0].id;
  const mate = (await sql("insert into public.payments (number, customer_id, method, amount_aed, status, cheque_number, cheque_bank, cheque_date, cheque_status, group_id) values ('E2E-RCT-S182', $1, 'cheque', 500, 'recorded', '018399', 'Emirates NBD', current_date, 'pending', $2) returning id", [job.customer_id, grp]))[0].id;
  await sql("update public.payments set group_id = $1 where id = $2", [grp, pay2.id]);
  await go(acc.page, `${base}/accounts-posting?tab=cheque&v=2`);
  const r2 = acc.page.locator(`[data-bank-row="${pay2.number}"]`);
  await r2.waitFor({ timeout: 30000 });
  await r2.locator('[data-bank-open="clear"]').click();
  const also = await text(r2, "[data-bank-clears-with]");
  check("G1: \"This also clears E2E-RCT-S182 (AED 500.00).\" before the press", also === "This also clears E2E-RCT-S182 (AED 500.00).", also);
  await shots(acc.page, r2, "g-clears-with");
  await sql("update public.payments set group_id = null, status = 'voided' where id = $1", [mate]).catch(() => null);
  await own.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (settingBefore === null) await sql("delete from public.settings where key = 'cheque_tax_invoice_when'").catch(() => null);
  else await sql("update public.settings set value = $1::jsonb where key = 'cheque_tax_invoice_when'", [JSON.stringify(settingBefore)]).catch(() => null);
  if (autoBefore !== null) await sql("update public.settings set value = $1::jsonb where key = 'auto_approve'", [JSON.stringify(autoBefore)]).catch(() => null);
  await sql("update public.payments set group_id = null where number like 'E2E-RCT-S18%'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
