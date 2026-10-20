// Waiting on you urgency (21 October 2026, part 1 section 1.2): red before amber before grey with
// coloured bars and labels, one line per job per task, ages on each line, short texts with the long
// sentence in the tooltip, open by default with the urgent count, and one bell for a red task older
// than 30 minutes (never twice).
//   node --env-file=.env.local tests/browser/test-urgency.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
await sql("update public.quotations set deposit_aed = 20000, responded_at = now() - interval '40 minutes' where job_id = $1 and status = 'approved'", [jobId]);
// An LPO waiting for approval (amber) and a claimed test trip (grey).
const po = (await sql("insert into public.purchase_orders (job_id, number, supplier_name, status, kind, total_cost_aed) values ($1, 'LPO-E2EU', 'E2e Supplier', 'pending_approval', 'main', 14782) returning id", [jobId]))[0];
await sql("insert into public.recovery_trips (job_id, kind, status, driver_name, price_aed) values ($1, 'delivery', 'claimed', 'E2e Driver', 100)", [jobId]);

const acc = await browserFor("accounts", { viewport: { width: 1500, height: 1200 } });
const page = acc.page;
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(2200);
check("open by default with the urgent count", (await page.locator("[data-waiting-panel] details[open]").count()) === 1 && /urgent/.test((await page.locator("[data-waiting-summary]").textContent()) ?? ""));
const urgencies = await page.locator("[data-waiting-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-urgency")));
check("red first, then amber, then grey", urgencies.length >= 3 && urgencies.join(",") === [...urgencies].sort((a, b) => ({ red: 0, amber: 1, grey: 2 })[a] - ({ red: 0, amber: 1, grey: 2 })[b]).join(","), urgencies.join(","));
check("the three classes all present", urgencies.includes("red") && urgencies.includes("amber") && urgencies.includes("grey"));
const labels = ((await page.locator("[data-waiting-panel]").textContent()) ?? "").replace(/\s+/g, " ");
check("the labels read Urgent / Today / When you can", /Urgent/.test(labels) && /Today/.test(labels) && /When you can/i.test(labels));
check("ages on the lines", /waiting \d/.test(labels));
const depRows = page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" });
check("one line per job per task", (await depRows.count()) === 1, String(await depRows.count()));
await page.screenshot({ path: `${shots}/urgency-panel.png` });
await acc.browser.close();

// Short base lines with the long sentence in the tooltip (the owner sees base rows).
const own = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
await own.page.goto(`${base}/dashboard`, { waitUntil: "load" });
await own.page.waitForTimeout(2200);
const baseRow = own.page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" }).first();
check("base rows carry the short line", (await baseRow.count()) >= 1 && /Advance payment,/.test(((await baseRow.textContent()) ?? "")), ((await baseRow.textContent().catch(() => "")) ?? "").slice(0, 120));
const title = (await baseRow.getAttribute("title")) ?? "";
check("the full sentence sits in the tooltip", title.length > 30, title.slice(0, 90));
await own.browser.close();

// The 30-minute red bell, once only: an unbanked cash payment and the unrecorded deposit both ring.
await sql("insert into public.payments (job_id, customer_id, number, method, amount_aed, status, received_at) select id, customer_id, 'RCT-E2EU', 'cash', 900, 'recorded', now() - interval '45 minutes' from public.jobs where id = $1", [jobId]);
const cron = async () => (await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
const r1 = await cron();
check("the cron rings the red bells", Number(r1.redTaskBells) >= 2, JSON.stringify({ redTaskBells: r1.redTaskBells }));
const bells = await sql("select count(*)::int as n from public.notifications where type = 'task_overdue' and (title like '%RCT-E2EU%' or job_id = $1)", [jobId]);
check("the bell notifications exist", (bells[0]?.n ?? 0) >= 2, `rows ${bells[0]?.n}`);
const r2 = await cron();
const bells2 = await sql("select count(*)::int as n from public.notifications where type = 'task_overdue' and (title like '%RCT-E2EU%' or job_id = $1)", [jobId]);
check("a second run never rings twice", bells2[0]?.n === bells[0]?.n, `before ${bells[0]?.n}, after ${bells2[0]?.n} (run2 rang ${r2.redTaskBells})`);

await sql("delete from public.recovery_trips where driver_name = 'E2e Driver'").catch(() => null);
await cleanupDb();
process.exit(summary() ? 1 : 0);
