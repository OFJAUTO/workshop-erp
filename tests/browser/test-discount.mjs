// The advisor discount limit (20 October 2026, part 2 section 5): a % of LABOUR from Settings
// (default 10), the round-off counted toward it; within it the advisor sends himself, above it the
// quotation waits as "Waiting for the owner: discount X% of labour (limit 10%)" with the owner's
// bell, and cannot go out until he approves. The owner is never limited.
//   node --env-file=.env.test.local tests/browser/test-discount.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

async function freshQuote(discountPercent = 0) {
  await cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.part_requests set status = 'done' where job_id = $1", [seed.jobId]);
  await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [seed.jobId]);
  // Labour 600 + part 300 = 900; the labour discount keeps the stored totals consistent, as the save route would.
  const discount = Math.round(600 * discountPercent) / 100;
  const net = 900 - discount;
  await sql(
    "update public.quotations set completed_at = now(), discount_kind = case when $2::numeric > 0 then 'percent' end, discount_value = case when $2::numeric > 0 then $2::numeric end, discount_scope = 'labour', discount_aed = $3, vat_aed = round($4::numeric * 0.05, 2), total_aed = round($4::numeric * 1.05, 2) where id = $1",
    [seed.quotationId, discountPercent, discount, net],
  );
  return seed;
}

/* ---- 1. An 18% labour discount: the quotation waits for the owner. ---- */
let { jobId, quotationId } = await freshQuote(18);
let adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1100 } });
await adv.page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await adv.page.waitForTimeout(1500);
await adv.page.getByRole("button", { name: /^Send quotation$/ }).first().click();
const pend = await until(async () => (await sql("select status, owner_approval_reason as r from public.quotations where id = $1", [quotationId]))[0]?.status === "pending_owner" ? (await sql("select owner_approval_reason as r from public.quotations where id = $1", [quotationId]))[0] : null, 30, 500);
check("1: above the limit the quotation waits for the owner", !!pend, JSON.stringify(pend));
check("1: the reason reads 'discount AED x = n% of labour (limit n%)' (B3: the amount first)", /discount AED [\d,]+\.\d\d( \+ round-off AED [\d,]+\.\d\d)? = \d+(\.\d)?% of labour \(limit \d+%\)/.test(pend?.r ?? ""), pend?.r ?? "");
const bell = await sql("select n.id from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'quote_owner_approval' and n.job_id = $1 and s.role_id = 'owner'", [jobId]);
check("1: the owner's bell rings", bell.length >= 1, `rows ${bell.length}`);
await adv.page.reload({ waitUntil: "load" });
await adv.page.waitForTimeout(1200);
const waitNote = (await adv.page.locator("[data-owner-waiting]").textContent().catch(() => "")) ?? "";
check("1: the page says Waiting for the owner with the figures", /Waiting for the owner: discount AED [\d,]+\.\d\d( \+ round-off AED [\d,]+\.\d\d)? = \d+(\.\d)?% of labour \(limit \d+%\)/.test(waitNote.replace(/\s+/g, " ")), waitNote.slice(0, 160));
await adv.page.screenshot({ path: `${shots}/discount-waiting.png` });
// Still pending: sending again goes nowhere (no token made).
const st0 = (await sql("select status, sent_at from public.quotations where id = $1", [quotationId]))[0];
check("1: it stays pending, nothing went to the customer", st0?.status === "pending_owner" && !st0?.sent_at, JSON.stringify(st0));
await adv.browser.close();

/* ---- 2. The owner approves from his box; the advisor can then send. ---- */
const own = await browserFor("owner", { viewport: { width: 1500, height: 1100 } });
await own.page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await own.page.waitForTimeout(1500);
check("2: the owner's box shows the reason", /discount AED [\d,]+\.\d\d.*% of labour/.test((await own.page.locator("[data-owner-box]").textContent().catch(() => "")) ?? ""));
await own.page.locator("[data-owner-approve]").click();
await own.page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 });
const ok1 = (await sql("select status, owner_approved_at from public.quotations where id = $1", [quotationId]))[0];
check("2: approved back to draft", ok1?.status === "draft" && !!ok1?.owner_approved_at);
await own.browser.close();
adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1100 } });
await adv.page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await adv.page.waitForTimeout(1500);
await adv.page.getByRole("button", { name: /^Send quotation$/ }).first().click();
const tok1 = await until(async () => (await sql("select valid_until from public.quotations where id = $1", [quotationId]))[0]?.valid_until ?? null, 30, 500);
check("2: after the owner's approval the link is made", !!tok1);
await adv.browser.close();

/* ---- 3. A 5% discount sends itself; a big round-off alone also trips the limit. ---- */
({ jobId, quotationId } = await freshQuote(5));
adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1100 } });
await adv.page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await adv.page.waitForTimeout(1500);
await adv.page.getByRole("button", { name: /^Send quotation$/ }).first().click();
const tok2 = await until(async () => (await sql("select valid_until from public.quotations where id = $1", [quotationId]))[0]?.valid_until ?? null, 30, 500);
check("3: a 5% discount goes out without the owner", !!tok2 && (await sql("select status from public.quotations where id = $1", [quotationId]))[0]?.status !== "pending_owner");
await adv.browser.close();

({ jobId, quotationId } = await freshQuote(0));
const q3 = (await sql("select total_aed::numeric as t from public.quotations where id = $1", [quotationId]))[0];
const bigRound = Math.max(10, Math.floor((Number(q3.t) * 0.7) / 10) * 10);
await sql("update public.quotations set rounded_total_aed = $2 where id = $1", [quotationId, bigRound]);
adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1100 } });
await adv.page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await adv.page.waitForTimeout(1500);
await adv.page.getByRole("button", { name: /^Send quotation$/ }).first().click();
const pend3 = await until(async () => (await sql("select status, owner_approval_reason as r from public.quotations where id = $1", [quotationId]))[0]?.status === "pending_owner" ? (await sql("select owner_approval_reason as r from public.quotations where id = $1", [quotationId]))[0] : null, 30, 500);
check("3: the round-off counts toward the limit", !!pend3 && /round-off/.test(pend3?.r ?? ""), pend3?.r ?? "");
await adv.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
