// Commission rules (20 October 2026, part 2 section 4): a pending commission counts as a cost the
// moment it is set, labelled "pending owner approval"; only the owner's decline removes it; and the
// internal box (profit, margin, total cost) moves INSTANTLY on add, approve and decline - no refresh.
//   node --env-file=.env.test.local tests/browser/test-commission.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const { jobId, quotationId } = seed;
await sql("update public.part_requests set status = 'done' where job_id = $1", [jobId]);
await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [jobId]);

const profitOf = async (page) => {
  const t = ((await page.locator("[data-internal-box]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  const m = /Profit before VAT.*?AED ([\d,.]+)/.exec(t);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
const page = adv.page;
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);
const before = await profitOf(page);
check("profit figure read before", before !== null, String(before));

// The advisor adds AED 500 for a middleman: pending, and the box moves at once.
await page.locator("[data-commission-add]").first().click();
await page.locator("[data-commission-who]").click({ clickCount: 3 });
await page.locator("[data-commission-who]").pressSequentially("E2E Rep", { delay: 30 });
await page.locator("[data-commission-amount]").click({ clickCount: 3 });
await page.locator("[data-commission-amount]").pressSequentially("500", { delay: 30 });
await page.locator("[data-commission-save]").click();
await page.waitForTimeout(1000); // no reload, no router.refresh needed
const after = await profitOf(page);
check("INSTANT: profit drops by the commission within a second, no refresh", after !== null && before !== null && Math.abs(before - after - 500) < 0.01, `before ${before}, after ${after}`);
check("the line says Pending owner approval - already counted", /Pending owner approval · already counted in the costs/.test(((await page.locator("[data-commission-pending]").textContent().catch(() => "")) ?? "")));
check("the profit row says counted, pending owner approval", (await page.locator("[data-profit-commission-pending]").count()) === 1 && /counted, pending owner approval/.test((await page.locator("[data-profit-commission-pending]").textContent()) ?? ""));
const row = await until(async () => (await sql("select commission_status as s, commission_aed::numeric as a from public.quotations where id = $1", [quotationId]))[0]?.s === "pending" ? (await sql("select commission_status as s, commission_aed::numeric as a from public.quotations where id = $1", [quotationId]))[0] : null, 20, 400);
check("saved as pending with the amount", row?.s === "pending" && Number(row?.a) === 500, JSON.stringify(row));
await page.locator("[data-internal-box]").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/commission-pending.png` });
await adv.browser.close();

// The owner declines it: the cost leaves the box at once, no refresh.
const own = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
const p2 = own.page;
await p2.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await p2.waitForTimeout(1800);
const withPending = await profitOf(p2);
check("the owner's box counts the pending commission too", withPending !== null && before !== null && Math.abs(before - withPending - 500) < 0.01, `owner sees ${withPending}`);
check("the owner gets the Approve / Decline strip", (await p2.locator("[data-commission-decide]").count()) === 1);
await p2.locator("[data-commission-decline]").click();
await p2.locator("[data-commission-decline-note]").pressSequentially("Not agreed", { delay: 30 });
await p2.locator("[data-commission-decline-send]").click();
await p2.waitForTimeout(1000);
const declined = await profitOf(p2);
check("INSTANT: declining puts the profit back, no refresh", declined !== null && before !== null && Math.abs(declined - before) < 0.01, `declined ${declined}, before ${before}`);
const row2 = await until(async () => (await sql("select commission_status as s from public.quotations where id = $1", [quotationId]))[0]?.s === "declined" ? { s: "declined" } : null, 20, 400);
check("stored as declined", row2?.s === "declined");
await own.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
