// Proof for the payment flow of the night of 15 October 2026 (PART A): sending the proforma with the compulsory
// expected method, Pay now and the pasted link; who may record what; the counter payment to confirm; "Customer says
// paid"; the final confirmation that creates the tax invoice; the owner-only early issue; Pay now through the
// pretend Network International gateway (the dev server must run with NGENIUS_ENV=mock NGENIUS_WEBHOOK_SECRET=e2e-hook);
// the accounts screens. Run against `NGENIUS_ENV=mock NGENIUS_WEBHOOK_SECRET=e2e-hook npx next dev -p 3100`:
//   node --env-file=.env.local tests/browser/test-m.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 18 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const WEBHOOK_KEY = process.env.NGENIUS_WEBHOOK_SECRET ?? "e2e-hook";

let jobId = null;
let proformaId = null;
let proformaNumber = null;
let token = null;

async function seedReady() {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  proformaId = seed.json.invoice?.id ?? null;
  proformaNumber = seed.json.invoice?.number ?? null;
  token = seed.json.invoice?.token ?? null;
  return seed.json;
}

/* ---------------- 1. Sending the proforma: the expected method is compulsory ---------------- */
await section("1 send the proforma", async () => {
  const s = await seedReady();
  check("1: the seed made a proforma", s.invoice?.kind === "proforma", JSON.stringify(s.invoice));
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("1: step 1 is the current step", (await page.locator('[data-step="proforma_sent"][data-state="current"]').count()) === 1);
  check("1: step 2 carries no black button yet", (await page.locator('[data-step="payment"] [data-record-payment]').count()) === 0);
  await page.locator('[data-ready-send="proforma"] button').first().click();
  await page.locator("[data-pay-how]").waitFor({ timeout: 10000 });
  check("1: the window asks how the customer will pay", (await page.locator("[data-expected]").count()) === 5);
  check("1: Continue is off until a method is chosen", await page.locator("[data-pay-continue]").isDisabled());
  await page.locator('[data-expected="transfer"]').click();
  check("1: Continue is on after choosing", !(await page.locator("[data-pay-continue]").isDisabled()));
  await page.locator("[data-pay-continue]").click();
  await page.locator("textarea").first().waitFor({ timeout: 15000 });
  const msg = await page.locator("textarea").first().inputValue();
  check("1: the message carries the proforma link", msg.includes(`/proforma/${token}`), msg.slice(0, 80));
  check("1: Share PDF sits in the window", (await page.locator("[data-share-pdf]").count()) === 1);
  await page.getByRole("button", { name: /Copy message and link/ }).click();
  const sent = await until(async () => (await sql("select sent_at, expected_payment_method from public.invoices where id = $1", [proformaId]))[0]?.sent_at ? (await sql("select sent_at, expected_payment_method from public.invoices where id = $1", [proformaId]))[0] : null, 40, 500);
  check("1: the proforma is marked sent with the expected method", sent?.expected_payment_method === "transfer", JSON.stringify(sent));
  const notif = await until(async () => (await sql("select title from public.notifications where type = 'proforma_sent' and job_id = $1 limit 1", [jobId]))[0], 30, 500);
  check("1: accounts are told with the customer, amount, method and plate", !!notif && /Proforma PRO-\d+ sent: .*AED 945.*expected Bank transfer.*Dubai S 30303/.test(notif.title), notif?.title);
  await browser.close();
  const card = await fetchAs(`/jobs/${jobId}`, "service_advisor");
  const t = plainText(card.text);
  check("1: the job card tile says awaiting payment by bank transfer with Record payment", /data-money-action="record_payment"/.test(card.text) && /Awaiting payment · Bank transfer/.test(t));
  const gate = await fetchAs(`/jobs/${jobId}/gate-out`, "service_advisor");
  check("1: gate-out is blocked while the balance is due", /Gate-out is blocked/i.test(plainText(gate.text)));
});

/* ---------------- 2. The advisor records cash at the counter; accounts confirm it ---------------- */
await section("2 counter payment to confirm", async () => {
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("2: the advisor may record cash and card only", (await page.locator("[data-method]").count()) === 2 && (await page.locator('[data-method="cash"]').count()) === 1);
  await page.locator("[data-amount-partial]").click();
  await page.locator("[data-amount-input]").fill("100");
  await page.locator("[data-record-payment]").click();
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const pay = await until(async () => (await sql("select number, method, amount_aed::float as amount, verified_at from public.payments where invoice_id = $1 and status = 'recorded'", [proformaId]))[0], 30, 500);
  check("2: the cash payment is recorded and not yet confirmed", pay?.method === "cash" && pay?.amount === 100 && !pay?.verified_at, JSON.stringify(pay));
  await go(page, `${base}/jobs/${jobId}/invoice`);
  const t = plainText(await page.content());
  check("2: the page shows Part paid with the balance and the counter chip", /Part paid · AED 845 due/.test(t) && /Recorded by advisor, to confirm/.test(t));
  await browser.close();
  const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1366, height: 1200 } });
  await go(ap, `${base}/dashboard`);
  check("2: the accounts dashboard lists the counter payment to confirm", (await ap.locator(`[data-counter-row="${pay?.number}"]`).count()) === 1);
  check("2: the accounts dashboard has the money tiles", (await ap.locator("[data-money-tiles] [data-tile]").count()) === 5);
  await ap.locator(`[data-counter-row="${pay?.number}"] button`).click();
  const confirmed = await until(async () => (await sql("select verified_at from public.payments where number = $1", [pay?.number]))[0]?.verified_at, 30, 500);
  check("2: Confirmed sets the verification", !!confirmed);
  await ab.close();
});

/* ---------------- 3. Customer says paid ---------------- */
await section("3 customer says paid", async () => {
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.locator("[data-customer-says-paid]").click();
  await page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const flagged = await until(async () => (await sql("select customer_says_paid_at from public.invoices where id = $1", [proformaId]))[0]?.customer_says_paid_at, 30, 500);
  check("3: the proforma is flagged customer says paid", !!flagged);
  const notif = await until(async () => (await sql("select title from public.notifications where type = 'customer_says_paid' and job_id = $1 limit 1", [jobId]))[0], 30, 500);
  check("3: accounts are told to check the bank", !!notif && /Customer says paid: Dubai S 30303/.test(notif.title), notif?.title);
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("3: the chip says checking", /Customer says paid, checking/.test(plainText(await page.content())));
  const card = await fetchAs(`/jobs/${jobId}`, "service_advisor");
  check("3: the job card shows the same chip", /Customer says paid, checking/.test(plainText(card.text)));
  await browser.close();
});

/* ---------------- 4. Accounts record the balance by transfer: the final confirmation ---------------- */
await section("4 final confirmation and the tax invoice", async () => {
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("4: accounts may record transfer, cheque and link", (await page.locator("[data-method]").count()) === 3 && (await page.locator('[data-method="transfer"]').count()) === 1);
  check("4: the expected method is pre-selected", (await page.locator('[data-method="transfer"]').getAttribute("aria-pressed")) === "true");
  await page.locator("[data-reference]").fill("12345");
  await page.locator("[data-record-payment]").click();
  await page.locator("[data-confirm-full]").waitFor({ timeout: 10000 });
  const text = plainText(await page.locator("[data-confirm-full]").innerHTML());
  check("4: the confirmation names the amount, the method, the reference and the tax invoice number", /Confirm full payment: AED 845\.00 received by Bank transfer \(ref 12345\)\. This completes the payment and creates tax invoice INV-\d{5}\./.test(text), text.slice(0, 200));
  check("4: the confirmation warns that a tax invoice cannot be cancelled", /can't be cancelled or deleted\. Corrections are only possible by credit note, approved by the owner/.test(text));
  await page.locator("[data-confirm-back]").click();
  check("4: Go back closes the window and records nothing", (await page.locator("[data-confirm-full]").count()) === 0 && (await sql("select count(*)::int as n from public.payments where invoice_id = $1 and method = 'transfer'", [proformaId]))[0]?.n === 0);
  await page.locator("[data-record-payment]").click();
  await page.locator("[data-confirm-yes]").waitFor({ timeout: 10000 });
  await page.locator("[data-confirm-yes]").click();
  const tax = await until(async () => (await sql("select id, number, token, sent_at from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued'", [jobId]))[0], 40, 500);
  check("4: Yes records the payment and creates the tax invoice", !!tax && /^INV-\d{5}$/.test(tax.number), JSON.stringify(tax));
  const pro = (await sql("select converted_to, customer_says_paid_at from public.invoices where id = $1", [proformaId]))[0];
  check("4: the proforma became the tax invoice and the checking flag is cleared", pro?.converted_to === tax?.id && !pro?.customer_says_paid_at);
  const notif = await until(async () => (await sql("select title, body from public.notifications where type = 'invoice_paid' and job_id = $1 limit 1", [jobId]))[0], 30, 500);
  check("4: the advisor is told Paid: plate, amount", !!notif && /^Paid: Dubai S 30303, AED 945\.00$/.test(notif.title), notif?.title);
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("4: step 2 is done, step 3 is current, step 4 waits for the send", (await page.locator('[data-step="payment"][data-state="done"]').count()) === 1 && (await page.locator('[data-step="tax_invoice"][data-state="current"]').count()) === 1 && /After the tax invoice is sent/.test(plainText(await page.content())));
  check("4: no payment form and no payment link box once paid", (await page.locator("[data-record-block]").count()) === 0 && (await page.locator("[data-payment-link-box]").count()) === 0);
  await browser.close();
  const cust = await fetch(`${base}/proforma/${token}`);
  const ct = plainText(await cust.text());
  check("4: the customer's page says Paid, thank you with the tax invoice number", cust.status === 200 && /Paid, thank you/i.test(ct) && ct.includes(tax?.number ?? "INV-?"), ct.slice(0, 120));
  const adv = await fetchAs(`/jobs/${jobId}/invoice`, "service_advisor");
  check("4: the advisor sees Send the tax invoice as the one black button", /data-ready-send="tax_invoice"/.test(adv.text) && /Send the tax invoice/.test(plainText(adv.text)));
  const owner = await fetchAs(`/invoices?show=paid`, "owner");
  check("4: the invoices list shows the car under Paid", (await (async () => (owner.text.match(new RegExp(`data-money-row="${jobId}"`)) ?? []).length)()) === 1);
  const found = await fetchAs(`/invoices?q=30303`, "owner");
  check("4: the search finds the car by plate", new RegExp(`data-money-row="${jobId}"`).test(found.text) && /data-money-filters/.test(found.text));
});

/* ---------------- 5. The owner's early issue is a small link for the owner only ---------------- */
await section("5 owner-only early issue", async () => {
  await seedReady();
  const o = await fetchAs(`/jobs/${jobId}/invoice`, "owner");
  const a = await fetchAs(`/jobs/${jobId}/invoice`, "accounts");
  check("5: the owner sees the early-issue link, accounts do not", /data-issue-early/.test(o.text) && !/data-issue-early/.test(a.text));
  check("5: nobody sees an Issue button in the normal flow", !/Issue the tax invoice now/.test(plainText(a.text)));
});

/* ---------------- 6. Pay now through the pretend gateway ---------------- */
await section("6 pay now", async () => {
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.locator('[data-ready-send="proforma"] button').first().click();
  await page.locator("[data-pay-how]").waitFor({ timeout: 10000 });
  check("6: the Pay now switch is offered (gateway set up)", (await page.locator("[data-pay-now-switch] input").count()) === 1);
  await page.locator('[data-expected="card"]').click();
  await page.locator("[data-pay-now-switch] input").check();
  await page.locator("[data-pay-continue]").click();
  await page.locator("textarea").first().waitFor({ timeout: 15000 });
  const link = await until(async () => (await sql("select id, provider, order_reference, amount_aed::float as amount, url from public.payment_links where invoice_id = $1 and replaced_at is null", [proformaId]))[0], 30, 500);
  check("6: a Network International order is made for the balance", link?.provider === "ngenius" && link?.amount === 945 && /^mock-/.test(link?.order_reference ?? ""), JSON.stringify(link));
  await page.getByRole("button", { name: /Copy message and link/ }).click();
  await until(async () => (await sql("select sent_at from public.invoices where id = $1", [proformaId]))[0]?.sent_at, 30, 500);
  await browser.close();
  // The customer taps Pay now on the proforma page, pays on the pretend page and comes back.
  const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await go(cp, `${base}/proforma/${token}`);
  check("6: the customer's page shows Pay now for a card payment", (await cp.locator('[data-pay-now="card"] button').count()) === 1);
  await cp.locator('[data-pay-now="card"] button').click();
  await cp.waitForURL((u) => /ngenius\/mock/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  check("6: Pay now opens the payment page", /ngenius\/mock/.test(cp.url()), cp.url());
  await cp.locator("[data-mock-pay]").click();
  await cp.waitForURL((u) => /\/proforma\//.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const back = plainText(await cp.content());
  check("6: the customer lands back on the proforma page with the thank-you", /paid=1/.test(cp.url()) && /Thank you, your payment was received/.test(back) && /Paid, thank you/i.test(back), cp.url());
  await cb.close();
  const pay = await until(async () => (await sql("select method, amount_aed::float as amount, bank_charge_aed::float as charge, received_by, reference from public.payments where job_id = $1 and status = 'recorded' and method = 'link'", [jobId]))[0], 30, 500);
  check("6: the payment is recorded as a payment link at 1.75% with nobody behind it", pay?.amount === 945 && pay?.charge === 16.54 && pay?.received_by === null && /N-Genius mock-/.test(pay?.reference ?? ""), JSON.stringify(pay));
  const tax = await until(async () => (await sql("select number from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued'", [jobId]))[0], 30, 500);
  check("6: the tax invoice followed by itself", !!tax);
  const paidLink = (await sql("select paid_at, payment_id, state from public.payment_links where id = $1", [link?.id]))[0];
  check("6: the order is marked paid", !!paidLink?.paid_at && !!paidLink?.payment_id && paidLink?.state === "CAPTURED");
  // The webhook comes a moment later: nothing is recorded twice; a wrong key is refused.
  const hook = await fetch(`${base}/api/pay/ngenius/webhook?key=${WEBHOOK_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventName: "CAPTURED", order: { reference: link?.order_reference } }) });
  const hj = await hook.json().catch(() => ({}));
  check("6: the webhook replay answers ok and records nothing twice", hook.status === 200 && hj.already === true && (await sql("select count(*)::int as n from public.payments where job_id = $1 and status = 'recorded'", [jobId]))[0]?.n === 1, JSON.stringify(hj));
  const bad = await fetch(`${base}/api/pay/ngenius/webhook?key=wrong`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("6: a webhook with the wrong key is refused", bad.status === 401);
});

/* ---------------- 7. The order follows the balance after a part payment ---------------- */
await section("7 pay now follows the balance", async () => {
  await seedReady();
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.locator('[data-ready-send="proforma"] button').first().click();
  await page.locator("[data-pay-how]").waitFor({ timeout: 10000 });
  await page.locator('[data-expected="card"]').click();
  await page.locator("[data-pay-now-switch] input").check();
  await page.locator("[data-pay-continue]").click();
  await page.locator("textarea").first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Copy message and link/ }).click();
  await until(async () => (await sql("select sent_at from public.invoices where id = $1", [proformaId]))[0]?.sent_at, 30, 500);
  const first = (await sql("select id, amount_aed::float as amount from public.payment_links where invoice_id = $1 and replaced_at is null", [proformaId]))[0];
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.locator('[data-method="cash"]').click();
  await page.locator("[data-amount-partial]").click();
  await page.locator("[data-amount-input]").fill("100");
  await page.locator("[data-record-payment]").click();
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const cur = await until(async () => { const r = (await sql("select id, amount_aed::float as amount from public.payment_links where invoice_id = $1 and replaced_at is null and provider = 'ngenius'", [proformaId]))[0]; return r && r.id !== first?.id ? r : null; }, 30, 500);
  check("7: after a cash part payment the order is remade for the balance", first?.amount === 945 && cur?.amount === 845, JSON.stringify({ first, cur }));
  const old = (await sql("select replaced_at from public.payment_links where id = $1", [first?.id]))[0];
  check("7: the old order is marked replaced", !!old?.replaced_at);
  // The pasted link always stays available: pasting one replaces the automatic order.
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.locator("[data-payment-link-box] summary").click();
  await page.locator('[data-payment-link-box] input[name="payment_link_url"]').fill("https://pay.example.test/abc");
  await page.locator("[data-payment-link-box] button[type=submit]").click();
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const manual = await until(async () => (await sql("select provider, url from public.payment_links where invoice_id = $1 and replaced_at is null", [proformaId]))[0], 30, 500);
  check("7: a pasted link replaces the automatic order", manual?.provider === "manual" && manual?.url === "https://pay.example.test/abc", JSON.stringify(manual));
  await browser.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
