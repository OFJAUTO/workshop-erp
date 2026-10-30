// The Commissions page (21 October 2026, part 1 section 1.7): accounts and the owner only; Pending →
// Approved-to-pay → Paid; the owner approves, rejects or edits; accounts mark Paid ONLY once the
// customer's tax invoice is settled (otherwise the exact reason shows); payable ones sit amber on
// Mathew's Waiting on you; the month exports as .xlsx.
//   node --env-file=.env.test.local tests/browser/test-commissions-page.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const { jobId, quotationId } = seed;
// A pending commission from the advisor.
await sql("update public.quotations set commission_to = 'E2E Rep', commission_kind = 'aed', commission_value = 500, commission_aed = 500, commission_status = 'pending', commission_set_at = now() where id = $1", [quotationId]);

// Advisors cannot open the page at all.
const adv = await browserFor("service_advisor", { viewport: { width: 1400, height: 1000 } });
await adv.page.goto(`${base}/commissions`, { waitUntil: "load" });
await adv.page.waitForTimeout(800);
check("advisors are bounced off the page", !adv.page.url().includes("/commissions"));
await adv.browser.close();

// The owner sees it pending and approves.
const own = await browserFor("owner", { viewport: { width: 1500, height: 1100 } });
await own.page.goto(`${base}/commissions`, { waitUntil: "load" });
await own.page.waitForTimeout(1500);
check("the pending section lists it with recipient, job, plate and amount", /E2E Rep/.test((await own.page.locator("[data-commissions-pending]").textContent().catch(() => "")) ?? "") && /Dubai S 30303/.test((await own.page.locator("[data-commissions-pending]").textContent()) ?? "") && /AED 500\.00/.test((await own.page.locator("[data-commissions-pending]").textContent()) ?? ""));
await own.page.screenshot({ path: `${shots}/commissions-page.png` });
await own.page.locator('[data-commission-row="Q-STAGE-1"] [data-approve-commission]').click();
await own.page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 });
const st = await until(async () => (await sql("select commission_status as s from public.quotations where id = $1", [quotationId]))[0]?.s === "approved" ? true : null, 20, 400);
check("the owner's Approve lands", !!st);
await own.browser.close();

// Accounts: not payable while the invoice is unpaid, with the exact reason.
const acc = await browserFor("accounts", { viewport: { width: 1500, height: 1100 } });
await acc.page.goto(`${base}/commissions`, { waitUntil: "load" });
await acc.page.waitForTimeout(1500);
const why = (await acc.page.locator('[data-commission-row="Q-STAGE-1"] [data-pay-blocked-why]').textContent().catch(() => "")) ?? "";
check("accounts see exactly why it cannot be paid yet", /Not payable yet/.test(why) && /No tax invoice yet|still owes/.test(why), why);
check("no Mark paid button while unpaid", (await acc.page.locator('[data-pay-commission="Q-STAGE-1"]').count()) === 0);

// The customer settles (a paid tax invoice lands on the job); now it is payable, on Waiting too.
await sql(`insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, token, subtotal_aed, taxable_aed, vat_aed, total_aed)
  select 'INV-E2EC', 'tax_invoice', id, customer_id, vehicle_id, 'issued', 'e2ec-token-0001', 900, 900, 45, 945 from public.jobs where id = $1`, [jobId]);
await sql(`insert into public.payments (job_id, invoice_id, customer_id, number, method, amount_aed, status, received_at)
  select j.id, i.id, j.customer_id, 'RCT-E2EC', 'cash', 945, 'recorded', now() from public.jobs j join public.invoices i on i.job_id = j.id and i.number = 'INV-E2EC' where j.id = $1`, [jobId]);
await acc.page.goto(`${base}/dashboard`, { waitUntil: "load" });
await acc.page.waitForTimeout(2000);
const panel = ((await acc.page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
check("the payable commission sits amber on Waiting on you", /Commission to pay \(Q-STAGE-1\)/.test(panel) && /E2E Rep/.test(panel), panel.slice(0, 220));
await acc.page.goto(`${base}/commissions`, { waitUntil: "load" });
await acc.page.waitForTimeout(1500);
await acc.page.locator('[data-pay-commission="Q-STAGE-1"] summary').click();
await acc.page.locator('[data-pay-commission="Q-STAGE-1"] select[name="method"]').selectOption('transfer');
await acc.page.locator('[data-pay-commission="Q-STAGE-1"] input[name="note"]').fill('Ref TT-9');
await acc.page.locator('[data-pay-commission="Q-STAGE-1"] [data-pay-commission-save]').click();
await acc.page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 });
const paid = (await sql("select commission_paid_at is not null as p, commission_paid_method as m, commission_paid_note as n from public.quotations where id = $1", [quotationId]))[0];
check("Paid with the method and note", paid?.p === true && paid?.m === "transfer" && /TT-9/.test(paid?.n ?? ""), JSON.stringify(paid));
check("it moved to the Paid section", /Paid .*transfer/.test(((await acc.page.locator("[data-commissions-paid]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ")));
await acc.page.screenshot({ path: `${shots}/commissions-paid.png` });

// The .xlsx export answers for accounts.
const jar = await cookieHeader("accounts");
const x = await fetch(`${base}/api/export/commissions`, { headers: { cookie: jar } });
check("the month exports as .xlsx", x.status === 200 && (x.headers.get("content-type") ?? "").includes("spreadsheetml"));
await acc.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
