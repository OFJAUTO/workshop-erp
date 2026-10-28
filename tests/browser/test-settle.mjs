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
  // 29 October 2026: the bank's own figures in one row - 1,000 + 2,500 by card machine: MSF 21.50 + 53.75 = 75.25,
  // no fee per transaction, VAT 1.08 + 2.69 = 3.77 (the bank rounds the VAT per transaction), net 3,420.98.
  await page.locator("[data-settle-msf]").click();
  await page.locator("[data-settle-msf]").fill("");
  await page.locator("[data-settle-msf]").pressSequentially("75.25");
  await page.locator("[data-settle-msf]").blur();
  await page.locator("[data-settle-txn]").click();
  await page.locator("[data-settle-txn]").fill("");
  await page.locator("[data-settle-txn]").pressSequentially("0");
  await page.locator("[data-settle-txn]").blur();
  await sleep(1300);
  check("3: the VAT is pre-filled as 5% of the fees (3.76), editable", (await page.locator("[data-settle-vat]").inputValue()) === "3.76");
  await page.locator("[data-settle-vat]").click();
  await page.locator("[data-settle-vat]").fill("");
  await page.locator("[data-settle-vat]").pressSequentially("3.77");
  await page.locator("[data-settle-vat]").blur();
  await page.locator("[data-settle-net]").click();
  await page.locator("[data-settle-net]").fill("");
  await page.locator("[data-settle-net]").pressSequentially("3400");
  await page.locator("[data-settle-net]").blur();
  await sleep(1300);
  check("3: figures that do not add up: a red 'AED 20.98 difference' and the button blocked", /AED 20\.98 difference/.test((await page.locator("[data-settle-diff]").textContent().catch(() => "")) ?? "") && (await page.locator("[data-settle-save]").isDisabled()));
  await page.locator("[data-settle-override] input").check();
  await sleep(300);
  check("3: 'Save anyway' still needs the reason in the note", (await page.locator("[data-settle-save]").isDisabled()) && (await page.locator("[data-settle-need-note]").count()) === 1);
  await page.locator("[data-settle-note]").fill("E2E bank kept back a chargeback");
  await sleep(300);
  check("3: with a note the owner or accounts can save anyway", !(await page.locator("[data-settle-save]").isDisabled()));
  await page.screenshot({ path: "tests/browser/shots/settle-difference.png" });
  await page.locator("[data-settle-override] input").uncheck();
  await page.locator("[data-settle-note]").fill("");
  await page.locator("[data-settle-net]").click();
  await page.locator("[data-settle-net]").fill("");
  await page.locator("[data-settle-net]").pressSequentially("3420.98");
  await page.locator("[data-settle-net]").blur();
  await sleep(1300);
  check("3: the figures add up: 3,500 = net + MSF + fee + VAT ✓", /✓/.test((await page.locator("[data-settle-adds]").textContent().catch(() => "")) ?? "") && !(await page.locator("[data-settle-save]").isDisabled()));
  check("3: each ticked payment shows its share (MSF 21.50 + VAT 1.08, MSF 53.75 + VAT 2.69)", /MSF 21\.50 \+ fee 0\.00 \+ VAT 1\.08/.test((await page.locator(`[data-settle-row="${p1.number}"] [data-settle-share]`).textContent()) ?? "") && /MSF 53\.75 \+ fee 0\.00 \+ VAT 2\.69/.test((await page.locator(`[data-settle-row="${p2.number}"] [data-settle-share]`).textContent()) ?? ""));
  await page.locator("[data-settle-ref]").fill("E2E statement 4471");
  await page.screenshot({ path: "tests/browser/shots/settle-before.png" });
  await page.locator("[data-settle-save]").click();
  await page.waitForSelector("[data-settle-done]", { timeout: 30000 }).catch(() => null);
  const done = (await page.locator("[data-settle-done]").first().textContent().catch(() => "")) ?? "";
  check("3: the result shows under the button", /STL-\d{5} recorded: 2 payments, the bank kept AED 79\.02 \(MSF \+ fee AED 75\.25 on the jobs/.test(done), done);
  await page.screenshot({ path: "tests/browser/shots/settle-after.png" });
} finally {
  await browser.close();
}
const [st] = await sql("select id, number, gross_aed::text, received_aed::text, fee_aed::text, msf_aed::text, txn_fee_aed::text, vat_aed::text, difference_aed::text from public.card_settlements where statement_ref = 'E2E statement 4471'");
check("4: the settlement is stored (3,500 ticked, net 3,420.98, MSF 75.25, fee 0, VAT 3.77, no difference)", st?.gross_aed === "3500.00" && st?.received_aed === "3420.98" && st?.fee_aed === "79.02" && st?.msf_aed === "75.25" && st?.txn_fee_aed === "0.00" && st?.vat_aed === "3.77" && st?.difference_aed === "0.00", JSON.stringify(st));
const shares = await sql("select number, actual_fee_aed::text as fee, actual_msf_aed::text as msf, actual_vat_aed::text as vat from public.payments where settlement_id = $1 order by amount_aed", [st?.id ?? "00000000-0000-0000-0000-000000000000"]);
check("4: each payment carries its actual share (cost without VAT; VAT apart)", shares.length === 2 && shares[0].fee === "21.50" && shares[0].vat === "1.08" && shares[1].fee === "53.75" && shares[1].vat === "2.69", JSON.stringify(shares));
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
  check("5: the job's bank charge is the actual MSF + fee without VAT (75.25, marked actual)", mark === "actual" && /75\s*actual/.test((await row.textContent()) ?? ""), `${mark} · ${((await row.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
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

// 7. (28 Oct) A payment taken after the settlement day is greyed out and never counted.
const fresh = await pay(250, 5.65, new Date().toISOString(), null);
const yesterdayDay = new Date(Date.now() + 4 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
const b7 = await browserFor("accounts", { viewport: { width: 1366, height: 1100 } });
try {
  await go(b7.page, `${base}/card-settlements?method=card`);
  await b7.page.waitForSelector("[data-settle-date]", { timeout: 30000 });
  await b7.page.locator("[data-settle-date]").fill(yesterdayDay);
  await sleep(500);
  const tick = b7.page.locator(`[data-settle-tick="${fresh.number}"]`);
  check("7: a payment taken after the settlement date is disabled and unticked", (await tick.isDisabled()) && !(await tick.isChecked()) && (await b7.page.locator(`[data-settle-row="${fresh.number}"] [data-settle-after]`).count()) === 1);
} finally {
  await b7.browser.close();
}

// 8. Voiding a receipt that sits in a settlement is refused in words.
const ob8 = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
try {
  await go(ob8.page, `${base}/invoices/${inv.id}`);
  const det = ob8.page.locator("details", { hasText: "Void this receipt" }).first();
  await det.locator("summary").click();
  await det.locator("textarea, input[name=reason]").first().fill("E2E void check");
  await det.locator("button", { hasText: /^Void$/ }).click();
  await ob8.page.waitForURL(/error=/, { timeout: 20000 }).catch(() => null);
  const body8 = decodeURIComponent(ob8.page.url());
  check("8: voiding a settled receipt is refused (undo the settlement first)", /part of the bank settlement STL-\d{5}/.test(body8), body8.slice(-160));
  const still = await sql("select status from public.payments where id = $1", [p1.id]);
  check("8: the receipt stays recorded", still[0]?.status === "recorded");
} finally {
  await ob8.browser.close();
}

// 9. A closed job's frozen owner report is rebuilt when its card fee changes; undoing the settlement puts the estimate back.
await sql("update public.jobs set is_open = false where id = $1", [jobId]);
const before9 = (await sql("select owner_report_at::text as at from public.jobs where id = $1", [jobId]))[0]?.at ?? null;
const b9 = await browserFor("accounts", { viewport: { width: 1366, height: 1100 } });
try {
  await go(b9.page, `${base}/card-settlements`);
  const row = b9.page.locator(`[data-settle-undo="${st.number}"]`);
  await row.locator("summary").click();
  await row.locator("[data-settle-undo-reason]").fill("E2E wrong amount typed");
  await row.locator("[data-settle-undo-confirm]").click();
  await b9.page.waitForSelector("[data-settle-undone]", { timeout: 20000 }).catch(() => null);
  check("9: Undo answers right there", /undone: its payments are back/.test((await b9.page.locator("[data-settle-undone]").first().textContent().catch(() => "")) ?? ""));
  await b9.page.screenshot({ path: "tests/browser/shots/settle-undo.png" });
} finally {
  await b9.browser.close();
}
const after9 = await sql("select s.is_active, (select count(*)::int from public.payments where settlement_id = s.id) as n, (select count(*)::int from public.payments where id = any($2::uuid[]) and actual_fee_aed is null and settlement_id is null) as cleared from public.card_settlements s where s.id = $1", [st.id, [p1.id, p2.id]]);
check("9: the settlement is undone and both payments are back to the estimate", after9[0]?.is_active === false && after9[0]?.n === 0 && after9[0]?.cleared === 2, JSON.stringify(after9[0]));
const at9 = (await sql("select owner_report_at::text as at from public.jobs where id = $1", [jobId]))[0]?.at ?? null;
check("9: the closed job's owner report was rebuilt", !!at9 && at9 !== before9, `${before9} -> ${at9}`);
const q9 = await sql("select status from public.zoho_outbox where kind = 'settlement' and record_id = $1", [st.id]);
check("9: Zoho is told (the row runs again; unposted = nothing posted)", q9.length === 1, JSON.stringify(q9));
await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id = $1", [st.id]);
await sql("update public.jobs set is_open = true where id = $1", [jobId]);

// 10. The advisor bonus marks a profit whose card fee is still an estimate, and approval asks first.
const [bigInv] = await sql("insert into public.invoices (number, kind, job_id, customer_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, created_by, updated_by) values ($1, 'tax_invoice', $2, $3, 'issued', now(), 20000, 20000, 1000, 21000, $4, $4) returning id", [`INV-E2EBON-${Date.now().toString().slice(-6)}`, jobId, job.customer_id, owner]);
await pay(21000, 474.6, yesterday, bigInv.id);
const ob10 = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
try {
  await go(ob10.page, `${base}/bonus`);
  await ob10.page.waitForLoadState("domcontentloaded");
  await sleep(1500);
  check("10: the bonus row says the card fee is estimated", (await ob10.page.locator("[data-bonus-fee-estimated]").count()) >= 1);
  check("10: approving the period asks first (tick to approve anyway)", (await ob10.page.locator("[data-bonus-estimated-ask] input[required]").count()) === 1);
  await ob10.page.screenshot({ path: "tests/browser/shots/settle-bonus.png" });
} finally {
  await ob10.browser.close();
}

cleanupDb();
process.exit(summary() ? 1 : 0);
