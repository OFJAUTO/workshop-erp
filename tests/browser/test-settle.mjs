// Section 2 of 27 October (afternoon): card and payment-link settlements. The fee split is exact to the fils, the
// screen pre-ticks by date and shows the real fee live, the save writes each payment's share, the job's profit
// switches from the estimate to the actual fee, a payment left unsettled past three working days turns amber on
// accounts' Waiting on you, and the monthly close carries the clearing line. Real payments are never touched:
// every row that is not this test's own is unticked before saving. No Zoho call is made (the queued settlement
// row is removed at once).
//   node --env-file=.env.local tests/browser/test-settle.mjs   (dev server)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

// 1. The pure rules.
const rules = await import(pathToFileURL(path.resolve("src/lib/card-settlement-rules.ts")).href);
const split = rules.splitFee([{ id: "a", amount: 1000 }, { id: "b", amount: 2500 }], 80.5);
check("1: the fee splits in proportion (23.00 and 57.50)", split.get("a") === 23 && split.get("b") === 57.5, JSON.stringify([...split]));
const odd = rules.splitFee([{ id: "a", amount: 100 }, { id: "b", amount: 100 }, { id: "c", amount: 100.01 }], 10);
const oddSum = Math.round([...odd.values()].reduce((x, y) => x + y, 0) * 100) / 100;
check("1: the shares always add up to the fee to the fils (the remainder goes to the largest)", oddSum === 10, JSON.stringify([...odd]));
check("1: more received than ticked is refused in words", /more/.test(rules.checkSettlement(1000, 1200).error ?? ""));
check("1: a fee above 6% asks for a second look", !!rules.checkSettlement(1000, 900).askAgain);
check("1: a card payment counts its actual share once settled", rules.feeOf({ method: "card", bank_charge_aed: 22.6, actual_fee_aed: 23, settlement_id: "x" }).fee === 23 && rules.feeOf({ method: "card", bank_charge_aed: 22.6 }).actual === false);

// 2. A job with a tax invoice paid by card twice (received yesterday, so pre-ticked today).
const seed = await api("/api/e2e/stage", { stage: "ready" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed", seed); process.exit(1); }
const [job] = await sql("select j.customer_id, j.job_number from public.jobs j where j.id = $1", [jobId]);
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const invNo = `INV-E2ESET-${Date.now().toString().slice(-6)}`;
const [inv] = await sql("insert into public.invoices (number, kind, job_id, customer_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, created_by, updated_by) values ($1, 'tax_invoice', $2, $3, 'issued', now(), 3333.33, 3333.33, 166.67, 3500, $4, $4) returning id", [invNo, jobId, job.customer_id, owner]);
const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
const pay = async (amount, fee, when, invoiceId) => (await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, received_at, received_by, is_deposit, created_by, updated_by) values ($1, $2, $3, 'card', $4, $5, $6, $7, $8, $7, $7) returning id, number", [jobId, invoiceId, job.customer_id, amount, fee, when, owner, !invoiceId]))[0];
const p1 = await pay(1000, 22.6, yesterday, inv.id);
const p2 = await pay(2500, 56.5, yesterday, inv.id);

// 3. The screen, as accounts.
const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1100 } });
try {
  await go(page, `${base}/card-settlements?method=card`);
  await page.waitForSelector("[data-settlement-form]", { timeout: 30000 });
  check("3: both test payments are listed", (await page.locator(`[data-settle-row="${p1.number}"]`).count()) === 1 && (await page.locator(`[data-settle-row="${p2.number}"]`).count()) === 1);
  check("3: payments received before the settlement day come pre-ticked", await page.locator(`[data-settle-tick="${p1.number}"]`).isChecked() && await page.locator(`[data-settle-tick="${p2.number}"]`).isChecked());
  // Never settle a real payment: untick everything that is not this test's own.
  for (const box of await page.locator("[data-settle-tick]").all()) {
    const no = await box.getAttribute("data-settle-tick");
    if (no !== p1.number && no !== p2.number && (await box.isChecked())) await box.uncheck();
  }
  const received = page.locator("[data-settle-received]");
  await received.click();
  await received.pressSequentially("3600");
  await received.blur();
  await sleep(600);
  check("3: more than the ticked total is refused before saving", /more/.test((await page.locator("[data-settle-problem]").textContent().catch(() => "")) ?? "") && (await page.locator("[data-settle-save]").isDisabled()));
  await received.click();
  await received.fill("");
  await received.pressSequentially("3419.50");
  await received.blur();
  await sleep(600);
  check("3: the actual fee shows live (AED 80.50 · 2.30%)", /80\.50 · 2\.30%/.test((await page.locator("[data-settle-fee]").textContent()) ?? ""));
  check("3: each ticked payment shows its share", /23\.00/.test((await page.locator(`[data-settle-row="${p1.number}"] [data-settle-share]`).textContent()) ?? "") && /57\.50/.test((await page.locator(`[data-settle-row="${p2.number}"] [data-settle-share]`).textContent()) ?? ""));
  await page.locator("[data-settle-ref]").fill("E2E statement 4471");
  await page.screenshot({ path: "tests/browser/shots/settle-before.png" });
  await page.locator("[data-settle-save]").click();
  await page.waitForSelector("[data-settle-done]", { timeout: 30000 }).catch(() => null);
  const done = (await page.locator("[data-settle-done]").first().textContent().catch(() => "")) ?? "";
  check("3: the result shows under the button", /STL-\d{5} recorded: 2 payments, bank fee AED 80\.50/.test(done), done);
  await page.screenshot({ path: "tests/browser/shots/settle-after.png" });
} finally {
  await browser.close();
}
const [st] = await sql("select id, number, gross_aed::text, received_aed::text, fee_aed::text from public.card_settlements where statement_ref = 'E2E statement 4471'");
check("4: the settlement is stored (3,500 ticked, 3,419.50 received, 80.50 fee)", st?.gross_aed === "3500.00" && st?.received_aed === "3419.50" && st?.fee_aed === "80.50", JSON.stringify(st));
const shares = await sql("select number, actual_fee_aed::text as fee from public.payments where settlement_id = $1 order by amount_aed", [st?.id ?? "00000000-0000-0000-0000-000000000000"]);
check("4: each payment carries its actual share", shares.length === 2 && shares[0].fee === "23.00" && shares[1].fee === "57.50", JSON.stringify(shares));
const queued = await sql("select id from public.zoho_outbox where kind = 'settlement' and record_id = $1", [st?.id ?? "00000000-0000-0000-0000-000000000000"]);
check("4: the Zoho transfer is queued", queued.length === 1);
// No Zoho call today: the queued row goes before the five-minute sync can pick it up.
await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id = $1", [st?.id ?? "00000000-0000-0000-0000-000000000000"]);
const realTouched = await sql("select count(*)::int as n from public.payments where settlement_id = $1 and job_id is distinct from $2", [st?.id ?? "00000000-0000-0000-0000-000000000000", jobId]);
check("4: no real payment was settled by the test", realTouched[0].n === 0);

// 5. The owner's profit list marks the fee as actual for this job.
const ob = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
try {
  await go(ob.page, `${base}/profit?period=month`);
  await ob.page.waitForSelector("table", { timeout: 30000 });
  const row = ob.page.locator("tr", { hasText: invNo }).first();
  const mark = await row.locator("[data-fee-mark]").getAttribute("data-fee-mark").catch(() => null);
  check("5: the job's bank charge is the actual fee (80.50, marked actual)", mark === "actual" && /8[01]\s*actual/.test((await row.textContent()) ?? ""), `${mark} · ${((await row.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
} finally {
  await ob.browser.close();
}

// 6. A card payment left six working days unsettled turns amber on accounts' Waiting on you.
const old = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
const late = await pay(400, 9.04, old, null);
const ab = await browserFor("accounts", { viewport: { width: 1366, height: 1100 } });
try {
  await go(ab.page, `${base}/dashboard`);
  await ab.page.waitForLoadState("domcontentloaded");
  await sleep(1500);
  const text = (await ab.page.textContent("body")) ?? "";
  check("6: Waiting on you says the card payment is not settled after 3 working days", /card payments? not settled after 3 working days/i.test(text));
  await ab.page.screenshot({ path: "tests/browser/shots/settle-waiting.png" });
  const month = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 7);
  await go(ab.page, `${base}/zoho/close?month=${month}`);
  await sleep(1500);
  const close = (await ab.page.textContent("body")) ?? "";
  check("6: the monthly close carries the clearing line", /Card and payment-link clearing settled/i.test(close));
} finally {
  await ab.browser.close();
}
void late;

cleanupDb();
process.exit(summary() ? 1 : 0);
