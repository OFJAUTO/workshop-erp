// Accounts' WAITING ON YOU shows everything (20 October 2026, part 2 section 1): cash to confirm and
// bank, deposits requested, proformas awaiting payment, LPOs to approve, supplier invoices to follow.
//   node --env-file=.env.test.local tests/browser/test-waiting.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
// A cash deposit in the drawer, a deposit asked for, and a supplier invoice to follow.
await sql("insert into public.payments (job_id, customer_id, number, method, amount_aed, status, received_at) select id, customer_id, 'RCT-E2E1', 'cash', 13550, 'recorded', now() from public.jobs where id = $1", [jobId]);
await sql("update public.quotations set deposit_aed = 20000 where job_id = $1 and status = 'approved'", [jobId]);

const { browser, page } = await browserFor("accounts", { viewport: { width: 1500, height: 1100 } });
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const panel = (await page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "";
check("not 'Nothing waiting'", (await page.locator("[data-waiting-empty]").count()) === 0);
check("the cash deposit is under Waiting on you", /Cash deposit RCT-E2E1 to confirm and bank/.test(panel), panel.slice(0, 120));
check("with the amount", /13,550\.00/.test(panel));
check("the requested deposit shows too", /Deposit to record/.test(panel));

// Open the list for the screenshot.
const summaryEl = page.locator("[data-waiting-summary]");
if (await summaryEl.count()) await summaryEl.click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/accounts-waiting.png` });
// The Confirm & bank button exists on the invoice page and works.
await page.goto(`${base}/jobs/${jobId}/invoice`, { waitUntil: "load" });
await page.waitForTimeout(2000);
const fold = page.getByText("Deposit before the proforma", { exact: false }).first();
if (await fold.count()) await fold.click();
await page.waitForTimeout(400);
check("Confirm & banked button on the deposit", (await page.locator("[data-confirm-deposit]").count()) === 1);
await page.locator("[data-confirm-deposit]").click();
await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 });
const verified = (await sql("select verified_at is not null as v from public.payments where number = 'RCT-E2E1'"))[0];
check("confirming banks it", verified?.v === true);
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const after = (await page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "";
check("after confirming, the cash item leaves the list", !/RCT-E2E1/.test(after));
await browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
