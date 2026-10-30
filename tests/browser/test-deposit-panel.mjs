// The RECORD DEPOSIT panel on Waiting on you (21 October 2026, part 1 section 1.1): the button opens
// the whole action in place (no page change), amount pre-filled, five methods, proof required for
// card/transfer, one confirmation, receipt + Send receipt right there, overpay kept as an advance,
// the line leaves the list, Parts and the advisor are told; cash to bank confirms inline with one tap.
//   node --env-file=.env.test.local tests/browser/test-deposit-panel.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
await sql("update public.quotations set deposit_aed = 20000 where job_id = $1 and status = 'approved'", [jobId]);

const acc = await browserFor("accounts", { viewport: { width: 1500, height: 1200 } });
const page = acc.page;
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(2200);
check("the panel is OPEN by default", (await page.locator("[data-waiting-panel] details[open]").count()) === 1);
const rows = page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" });
check("ONE line for the job, not two", (await rows.count()) === 1, String(await rows.count()));
check("it is red (urgent)", (await rows.first().getAttribute("data-urgency")) === "red");
check("it reads Deposit to record with the amount", /Deposit to record.*AED 20,000\.00/.test(((await rows.first().textContent()) ?? "").replace(/\s+/g, " ")));

// The button opens the action right there.
await rows.first().locator("[data-record-deposit-open]").click();
await page.waitForTimeout(500);
check("the panel opens, no page change", (await page.locator("[data-record-deposit-panel]").count()) === 1 && page.url().includes("/dashboard"));
check("header says what was asked", /Deposit requested: AED 20,000\.00/.test((await page.locator("[data-deposit-asked]").textContent()) ?? ""));
check("amount pre-filled", (await page.locator("[data-deposit-amount]").inputValue()) === "20000");

// Card without proof is blocked; the hint says why.
await page.locator("[data-deposit-method=card]").click();
check("card without proof cannot record", (await page.locator("[data-deposit-record]").isDisabled()) === true);
check("the hint says attach the proof", /Attach the proof first/.test((await page.locator("[data-record-deposit-panel]").textContent()) ?? ""));

// Cash, more than asked: the overpay note, the confirmation, the receipt.
await page.locator("[data-deposit-method=cash]").click();
await page.locator("[data-deposit-amount]").click({ clickCount: 3 });
await page.locator("[data-deposit-amount]").pressSequentially("30290", { delay: 25 });
await page.waitForTimeout(300);
const overNote = await until(async () => { const t = ((await page.locator("[data-record-deposit-panel]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " "); return /AED 10,290\.00 more than requested/.test(t) ? t : null; }, 20, 400);
check("overpay note live", !!overNote, (overNote ?? "").slice(0, 120));
await page.screenshot({ path: `${shots}/deposit-panel.png` });
await page.locator("[data-deposit-record]").click();
await page.waitForTimeout(300);
check("one clear confirmation", /Record AED 30,290\.00 by cash as the deposit on Dubai S 30303\?/.test((await page.locator("[data-deposit-confirm]").textContent()) ?? ""));
await page.locator("[data-deposit-confirm-yes]").click();
const done = await until(async () => ((await page.locator("[data-deposit-done]").count()) ? (await page.locator("[data-deposit-done]").textContent()) : null), 30, 500);
check("saved: the receipt number shows with the overpay note", !!done && /RCT-\d+ recorded ✓/.test(done) && /more than requested/.test(done), (done ?? "").slice(0, 160));
await page.screenshot({ path: `${shots}/deposit-done.png` });
const pay = (await sql("select number, amount_aed::numeric as a, method, status, verified_at is not null as v, is_deposit from public.payments where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0];
check("the payment is right in the database", pay?.method === "cash" && Number(pay?.a) === 30290 && pay?.status === "recorded" && pay?.v === true && pay?.is_deposit === true, JSON.stringify(pay));
const notes = await sql("select type, count(*)::int as n from public.notifications where job_id = $1 and type in ('deposit_received','payment_received') group by type", [jobId]);
check("Parts/owner told 'LPO can go' and the advisor told", notes.some((x) => x.type === "deposit_received") && notes.some((x) => x.type === "payment_received"), JSON.stringify(notes));

// Send receipt opens with the ready message.
await page.locator("[data-send-deposit-receipt]").click();
await page.waitForTimeout(400);
const msg = (await page.locator("textarea[readonly]").inputValue().catch(() => "")) ?? "";
check("the receipt message is ready with the amount and a link", /30,290\.00/.test(msg) && /https:\/\//.test(msg), msg.slice(0, 120));
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Done" }).click();
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(2000);
check("the deposit line leaves the list", !/Deposit to record/.test(((await page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "")));

// Inline Confirm & bank: an advisor-recorded cash payment confirms with one tap on the row.
await sql("insert into public.payments (job_id, customer_id, number, method, amount_aed, status, received_at) select id, customer_id, 'RCT-E2EB', 'cash', 500, 'recorded', now() from public.jobs where id = $1", [jobId]);
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(2000);
const bankRow = page.locator("[data-waiting-row]", { hasText: "RCT-E2EB" });
check("the cash-to-bank line is red with an inline button", (await bankRow.count()) === 1 && (await bankRow.getAttribute("data-urgency")) === "red" && (await bankRow.locator("[data-confirm-bank]").count()) === 1);
await bankRow.locator("[data-confirm-bank]").click();
await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 });
check("one tap banks it and stays on the dashboard", page.url().includes("/dashboard"));
const v2 = (await sql("select verified_at is not null as v from public.payments where number = 'RCT-E2EB'"))[0];
check("verified in the database", v2?.v === true);
await acc.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
