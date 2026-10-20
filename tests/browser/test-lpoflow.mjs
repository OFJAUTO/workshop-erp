// The LPO flow as the reference hand-off (21 October 2026, part 2 section 2.3): the approver gets an
// amber task; approving shows the R1 confirmation (what happened AND what happens next); every part
// flips to ORDER NOW everywhere (the stale "PO waiting for approval" is dead); Peter gets a RED
// ORDER NOW task with the button to the exact LPO; Mark ordered moves it to Deliveries expected and
// the advisor's job card reads "Parts ordered from <supplier> – arriving <date>"; a refusal tells the
// desk with the reason and the parts return to To order.
//   node --env-file=.env.local tests/browser/test-lpoflow.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
await sql("update public.part_items set supplier = 'E2e Supplier', cost_aed = coalesce(cost_aed, 200), availability = 'to_order', delivery_date = (now() at time zone 'utc' + interval '2 day')::date where job_id = $1 and is_active", [jobId]);

/* Peter sends the LPO for approval. */
const desk = await browserFor("parts", { viewport: { width: 1500, height: 1200 } });
await desk.page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await desk.page.waitForTimeout(1500);
await desk.page.locator("[data-send-lpo]").click();
await desk.page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 });
const main = await until(async () => (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval'", [jobId]))[0] ?? null, 30, 500);
check("the main LPO waits for approval", !!main, JSON.stringify(main));
await desk.browser.close();

/* The owner's task is amber; approving shows the R1 confirmation. */
const own = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
await own.page.goto(`${base}/dashboard`, { waitUntil: "load" });
await own.page.waitForTimeout(2200);
const ownRow = own.page.locator("[data-waiting-row]", { hasText: "LPO waiting for approval" }).first();
check("the approver's task is amber with the button", (await ownRow.count()) >= 1 && (await ownRow.getAttribute("data-urgency")) === "amber");
await own.page.goto(`${base}/parts/orders/${main.id}`, { waitUntil: "load" });
await own.page.waitForTimeout(1200);
await own.page.getByRole("button", { name: /^Approve$/ }).click();
await own.page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 });
const confirm = decodeURIComponent(own.page.url());
check("R1: the approver reads what happened AND what happens next", /approved ✓ — Parts have been asked to order from E2e Supplier \(1 part, AED [\d,]+\)/.test(confirm), confirm.slice(-160));
await own.page.screenshot({ path: `${shots}/lpo-approved-confirm.png` });
await own.browser.close();
const child = (await sql("select id, number, status from public.purchase_orders where job_id = $1 and kind = 'supplier'", [jobId]))[0];
check("the supplier LPO exists approved", child?.status === "approved", JSON.stringify(child));

/* Peter: the RED ORDER NOW task, the bell, and no stale status anywhere. */
const p2 = await browserFor("parts", { viewport: { width: 1500, height: 1200 } });
await p2.page.goto(`${base}/dashboard`, { waitUntil: "load" });
await p2.page.waitForTimeout(2200);
const orderRow = p2.page.locator("[data-waiting-row]", { hasText: "ORDER NOW" }).first();
check("Peter's ORDER NOW task is RED at the top", (await orderRow.count()) >= 1 && (await orderRow.getAttribute("data-urgency")) === "red", String(await orderRow.count()));
check("it names the LPO, the supplier and the count", new RegExp(`ORDER NOW: ${child.number} · E2e Supplier · 1 part`).test(((await orderRow.textContent()) ?? "").replace(/\s+/g, " ")));
await p2.page.screenshot({ path: `${shots}/order-now-task.png` });
const bell = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'po_decided' and n.title like 'ORDER NOW%' and n.job_id = $1 and s.role_id = 'parts'", [jobId]);
check("the bell says ORDER NOW too", (bell[0]?.n ?? 0) >= 1);
await p2.page.goto(`${base}/parts`, { waitUntil: "load" });
await p2.page.waitForTimeout(1500);
const deskText = ((await p2.page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("the desk never says 'PO waiting for approval' after approval", !/PO waiting for approval/.test(deskText));
check("the desk's ORDER NOW section carries the LPO card", (await p2.page.locator(`[data-order-now="${child.number}"]`).count()) === 1);

/* Mark ordered: Deliveries expected + the advisor's job card line. */
await p2.page.goto(`${base}/parts/orders/${child.id}`, { waitUntil: "load" });
await p2.page.waitForTimeout(1200);
await p2.page.getByRole("button", { name: /^Ordered$/ }).first().click();
await p2.page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
const ordered = await until(async () => (await sql("select status, ordered_at from public.purchase_orders where id = $1", [child.id]))[0]?.ordered_at ?? null, 30, 500);
check("Mark ordered lands", !!ordered);
await p2.page.goto(`${base}/dashboard`, { waitUntil: "load" });
await p2.page.waitForTimeout(2000);
check("the ORDER NOW task leaves Peter's list", !/ORDER NOW:/.test(((await p2.page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "")));
await p2.browser.close();
const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
await adv.page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await adv.page.waitForTimeout(1500);
const orderedLine = ((await adv.page.locator("[data-ordered-line]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
check("the advisor's job card reads ordered-from with the arrival", /Parts ordered from E2e Supplier – arriving /.test(orderedLine), orderedLine);
await adv.page.screenshot({ path: `${shots}/job-card-ordered-line.png` });
await adv.browser.close();

/* The refusal: the desk hears the reason; the parts go back to To order. */
await cleanupDb();
const seed2 = (await api("/api/e2e/stage", { stage: "approved" })).json;
await sql("update public.part_items set supplier = 'E2e Supplier', cost_aed = coalesce(cost_aed, 200), availability = 'to_order', delivery_date = (now() at time zone 'utc' + interval '2 day')::date where job_id = $1 and is_active", [seed2.jobId]);
const d2 = await browserFor("parts", { viewport: { width: 1400, height: 1000 } });
await d2.page.goto(`${base}/parts/${seed2.jobId}`, { waitUntil: "load" });
await d2.page.waitForTimeout(1500);
await d2.page.locator("[data-send-lpo]").click();
await d2.page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 });
await d2.browser.close();
const main2 = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval'", [seed2.jobId]))[0];
const o2 = await browserFor("owner", { viewport: { width: 1400, height: 1000 } });
await o2.page.goto(`${base}/parts/orders/${main2.id}`, { waitUntil: "load" });
await o2.page.waitForTimeout(1200);
await o2.page.locator('textarea[name="note"]').fill("Wrong supplier prices");
await o2.page.getByRole("button", { name: /^Refuse$/ }).click();
await o2.page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 });
check("R1 on refusal too", /refused ✓ — Parts have been told/.test(decodeURIComponent(o2.page.url())));
await o2.browser.close();
const refusedBell = await sql("select count(*)::int as n from public.notifications where type = 'po_decided' and title like $1 and body like '%Wrong supplier prices%'", [`${main2.number} refused%`]);
check("the desk hears the refusal with the reason", (refusedBell[0]?.n ?? 0) >= 1);
const back = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and po_id is null and order_status = 'to_order' and is_active", [seed2.jobId]))[0];
check("the parts are back under To order", (back?.n ?? 0) >= 1);

await cleanupDb();
process.exit(summary() ? 1 : 0);
