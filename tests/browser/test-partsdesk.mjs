// The Parts desk rebuilt (21 October 2026, part 2 section 2.4): ORDER NOW at the very top as a big
// card per approved LPO with its own clock (amber then red; red rings the owner once through the
// cron), the sections in order with empty ones hidden, deliveries grouped per supplier with overdue
// in red, grouped lines that expand, no grey explanation sentences (tooltips instead), All cars
// folded at the bottom, and the owner's Parts speed report.
//   node --env-file=.env.local tests/browser/test-partsdesk.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
await sql("update public.part_items set supplier = 'E2e Supplier', cost_aed = coalesce(cost_aed, 200), availability = 'to_order' where job_id = $1 and is_active", [jobId]);
// An approved supplier LPO, approved 2 working hours ago: the card must sit red on top.
const po = (await sql(`insert into public.purchase_orders (job_id, number, supplier_name, status, kind, total_cost_aed, approved_at)
  values ($1, 'LPO-E2ED-1', 'E2e Supplier', 'approved', 'supplier', 200, now() - interval '26 hours') returning id, number`, [jobId]))[0];
await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost) values ($1, 'E2E PART A', 1, 200)", [po.id]);
// An ordered part overdue from another supplier: Deliveries expected groups and reddens it.
await sql(`insert into public.part_items (job_id, description, quantity, supplier, cost_aed, availability, order_status, expected_date)
  select id, 'Overdue widget', 1, 'Slow Trading', 150, 'to_order', 'ordered', (now() - interval '2 day')::date from public.jobs where id = $1`, [jobId]);

const desk = await browserFor("parts", { viewport: { width: 1600, height: 1400 } });
const page = desk.page;
await page.goto(`${base}/parts`, { waitUntil: "load" });
await page.waitForTimeout(2000);

check("ORDER NOW is the first section", (await page.locator("[data-order-now-section]").count()) === 1);
const card = page.locator(`[data-order-now="${po.number}"]`);
check("the big card names the car, the supplier, the count and the money", /ORDER NOW/.test((await card.textContent()) ?? "") && /E2e Supplier/.test((await card.textContent()) ?? "") && /1 part/.test((await card.textContent()) ?? "") && /200\.00/.test((await card.textContent()) ?? ""));
check("its clock is RED after 26 hours", (await card.getAttribute("data-order-tone")) === "red", (await card.getAttribute("data-order-tone")) ?? "");
check("the card carries Copy, PDF and Ordered", (await card.locator("button, a").filter({ hasText: /Copy|PDF|Ordered/ }).count()) >= 3);
const bodyText = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("no grey explanation paragraphs (tooltips instead)", !/What the technician asked for on the report, the moment/.test(bodyText) && !/The approved parts are on the page of the car\. One button/.test(bodyText));
check("deliveries group per supplier with the overdue red", (await page.locator('[data-supplier-group="Slow Trading"]').count()) === 1 && /overdue/.test((await page.locator('[data-supplier-group="Slow Trading"] summary').textContent()) ?? ""));
await page.locator('[data-supplier-group="Slow Trading"] summary').click();
await page.waitForTimeout(300);
check("the group expands into its lines", /Overdue widget/.test((await page.locator('[data-supplier-group="Slow Trading"]').textContent()) ?? "") && /Late · expected/.test((await page.locator('[data-supplier-group="Slow Trading"]').textContent()) ?? ""));
check("All cars folds shut at the bottom", (await page.locator("[data-all-cars-fold]:not([open])").count()) === 1 && (await page.locator("[data-all-cars-summary]").count()) === 1);
check("empty sections are hidden (no 'Nothing to order' filler)", !/Nothing to order/.test(bodyText) && !/No requests waiting/.test(bodyText));
await page.screenshot({ path: `${shots}/parts-desk.png`, fullPage: true });
await desk.browser.close();

// The cron rings the owner ONCE for the red card.
const cron = async () => (await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
const r1 = await cron();
check("the cron saw the overdue order", Number(r1.orderNowOverdue) >= 1, JSON.stringify({ orderNowOverdue: r1.orderNowOverdue }));
const bells = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'task_overdue' and n.title like $1 and s.role_id = 'owner'", [`ORDER NOW overdue · ${po.number}%`]);
check("the owner's bell rang", (bells[0]?.n ?? 0) >= 1);
await cron();
const bells2 = await sql("select count(*)::int as n from public.notifications where type = 'task_overdue' and title like $1", [`ORDER NOW overdue · ${po.number}%`]);
check("never twice", bells2[0]?.n === bells[0]?.n * (bells[0]?.n ? 1 : 0) || bells2[0]?.n === bells[0]?.n, `before ${bells[0]?.n}, after ${bells2[0]?.n}`);

// The Parts speed report: the owner sees it; accounts bounce.
const own = await browserFor("owner", { viewport: { width: 1600, height: 1200 } });
await own.page.goto(`${base}/reports/parts-speed`, { waitUntil: "load" });
await own.page.waitForTimeout(1800);
check("the speed report renders its tables", (await own.page.locator("[data-speed-tables]").count()) === 1 && ((await own.page.locator("[data-over-target]").count()) === 1 || (await own.page.locator("[data-over-target-empty]").count()) === 1));
await own.page.screenshot({ path: `${shots}/parts-speed.png`, fullPage: true });
await own.browser.close();
const jarA = await cookieHeader("accounts");
const rA = await fetch(`${base}/reports/parts-speed`, { headers: { cookie: jarA }, redirect: "manual" });
check("accounts are bounced off the speed report", rA.status >= 300 && rA.status < 400);

await cleanupDb();
process.exit(summary() ? 1 : 0);
