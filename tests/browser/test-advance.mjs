// The advance payment is a real step (20 October 2026, part 2 section 3): the step bar gains
// ADVANCE PAYMENT between Approval and Parts, the advisor sends the request on WhatsApp with the
// amount, accounts see "Record the deposit", Parts see "Waiting for the deposit", and the editor
// asks "Did you mean to ask for a deposit?" when the note mentions an advance with none set.
//   node --env-file=.env.test.local tests/browser/test-advance.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500, okay = (v) => !!v) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (okay(v)) return v; await sleep(ms); } return null; };

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

/* ============ A. The step, the request, the waiting lists ============ */
await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
await sql("update public.quotations set deposit_aed = 6000 where job_id = $1 and status = 'approved'", [jobId]);

const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1100 } });
const page = adv.page;
await page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
check("A: the step bar has the ADVANCE PAYMENT box", (await page.locator("[data-stage-box=advance]").count()) === 1, String(await page.locator("[data-stage-box=advance]").count()));
check("A: it sits amber (current) while unpaid", (await page.locator("[data-stage-box=advance]").getAttribute("data-state")) === "current");
const card = (await page.locator("[data-stage-card=advance]").textContent().catch(() => "")) ?? "";
check("A: the Advance payment card shows the amount to receive", /AED 6,000 to receive/.test(card), card.slice(0, 160));
check("A: it says accounts record it and Parts wait", /Recorded by accounts or the owner only/.test(card) && /Parts wait/.test(card));
await page.locator("[data-stage-card=advance]").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/advance-step.png` });

// Send the request: the message carries the amount; a payment link can be pasted underneath.
await page.locator("[data-send-deposit-request]").click();
await page.waitForTimeout(600);
const msg = (await page.locator("[data-send-dialog], .fixed.inset-0").last().textContent().catch(() => "")) ?? "";
check("A: the message asks for AED 6,000.00", /6,000\.00/.test(msg), msg.slice(0, 200));
check("A: the paste box for a Pay now link", (await page.locator("[data-deposit-pay-link]").count()) === 1);
await page.fill("[data-deposit-pay-link]", "https://pay.example/e2e");
await page.getByRole("button", { name: /Copy message and link/i }).click();
const stamped = await until(async () => (await sql("select deposit_requested_at from public.jobs where id = $1", [jobId]))[0]?.deposit_requested_at ?? null, 30, 400);
check("A: sending stamps the job", !!stamped);
const note = await sql("select n.id from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'deposit_to_collect' and n.title like 'Deposit request sent%' and n.job_id = $1 and s.role_id = 'accounts'", [jobId]);
check("A: accounts are told the request went out", note.length >= 1, `rows ${note.length}`);
await page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1200);
check("A: the card then shows Request sent", /Request sent/.test((await page.locator("[data-stage-card=advance]").textContent().catch(() => "")) ?? ""));
await adv.browser.close();

// Parts see the wait; accounts see "Record the deposit" as the next step.
const parts = await browserFor("parts", { viewport: { width: 1400, height: 1000 } });
await parts.page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await parts.page.waitForTimeout(1200);
check("A: Parts page shows Waiting for the deposit", /Waiting for the deposit/.test((await parts.page.locator("[data-deposit-wait]").textContent().catch(() => "")) ?? ""));
await parts.page.screenshot({ path: `${shots}/advance-parts-wait.png` });
await parts.browser.close();
const acc = await browserFor("accounts", { viewport: { width: 1400, height: 1000 } });
await acc.page.goto(`${base}/dashboard`, { waitUntil: "load" });
await acc.page.waitForTimeout(2000);
const panel = (await acc.page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "";
check("A: accounts' Waiting on you says the deposit is theirs to record", /Record the deposit|Deposit of AED 6,000 to receive|Deposit not received yet/.test(panel), panel.slice(0, 200));
await acc.browser.close();

// The deposit arrives: the box turns green and the Parts wait lifts.
await sql("insert into public.payments (job_id, customer_id, number, method, amount_aed, status, received_at) select id, customer_id, 'RCT-E2E2', 'cash', 6000, 'recorded', now() from public.jobs where id = $1", [jobId]);
const adv2 = await browserFor("service_advisor", { viewport: { width: 1400, height: 1000 } });
await adv2.page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await adv2.page.waitForTimeout(1500);
check("A: paid in full, the box turns done", (await adv2.page.locator("[data-stage-box=advance]").getAttribute("data-state")) === "done");
check("A: the card says Received in full", /Received in full/.test((await adv2.page.locator("[data-stage-card=advance]").textContent().catch(() => "")) ?? ""));
await adv2.browser.close();

/* ============ B. "Did you mean to ask for a deposit?" ============ */
await cleanupDb();
const seed2 = (await api("/api/e2e/stage", { stage: "quote" })).json;
await sql("update public.part_requests set status = 'done' where job_id = $1", [seed2.jobId]);
await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [seed2.jobId]);
await sql("update public.quotations set customer_note = 'Customer agreed to pay an advance before we order parts' where id = $1", [seed2.quotationId]);
const ed = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
const p2 = ed.page;
await p2.goto(`${base}/jobs/${seed2.jobId}/quote/${seed2.quotationId}`, { waitUntil: "load" });
await p2.waitForTimeout(1500);
await p2.getByRole("button", { name: /^Quotation complete$/ }).click();
// Answer whatever earlier questions fire, in their order, until the deposit one appears.
for (let i = 0; i < 4; i++) {
  await p2.waitForTimeout(900);
  if (await p2.locator("[data-deposit-ask]").count()) break;
  if (await p2.locator("[data-low-profit-ask]").count()) { await p2.locator("[data-low-profit-send]").click(); continue; }
  if (await p2.locator("[data-markup-ask]").count()) { await p2.locator("[data-markup-continue]").click(); continue; }
  if (await p2.locator("[data-parts-ask]").count()) { await p2.locator("[data-parts-leave]").click(); continue; }
}
const askText = (await p2.locator("[data-deposit-ask]").textContent().catch(() => "")) ?? "";
check("B: the note mentioning an advance asks 'Did you mean to ask for a deposit?'", /Did you mean to ask for a deposit\?/.test(askText), askText.slice(0, 160));
await p2.screenshot({ path: `${shots}/deposit-ask.png` });
await p2.locator("[data-deposit-skip]").click();
const done = await until(async () => (await sql("select completed_at, deposit_skipped_at from public.quotations where id = $1", [seed2.quotationId]))[0], 30, 400, (r) => !!r?.completed_at);
check("B: Send without deposit completes and is logged", !!done?.completed_at && !!done?.deposit_skipped_at, JSON.stringify(done));
await ed.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
