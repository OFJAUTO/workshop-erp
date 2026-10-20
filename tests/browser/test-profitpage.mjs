// Profit per invoice, the mock-up layout (21 October 2026, part 1 section 1.8): owner only (server
// enforced), the four figures, the where-the-money-went bar, the table with provisional dots and
// margin pills, sort and filters, row breakdown, total row, Excel export.
//   node --env-file=.env.local tests/browser/test-profitpage.mjs
import { browserFor, base, cleanupDb, cookieHeader, makeChecks } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

await cleanupDb();

// Accounts are bounced (server-enforced owner-only).
const acc = await browserFor("accounts", { viewport: { width: 1400, height: 1000 } });
await acc.page.goto(`${base}/profit`, { waitUntil: "load" });
await acc.page.waitForTimeout(800);
check("accounts are bounced off /profit", !acc.page.url().includes("/profit"));
await acc.browser.close();
const jarA = await cookieHeader("accounts");
const xA = await fetch(`${base}/api/export/profit`, { headers: { cookie: jarA } });
check("the export refuses accounts too", xA.status === 403);

// The owner's page: KPIs, the bar, the table, the mock-up details.
const own = await browserFor("owner", { viewport: { width: 1600, height: 1200 } });
const page = own.page;
await page.goto(`${base}/profit?period=60`, { waitUntil: "load" });
await page.waitForTimeout(2000);
check("the four figures are there", (await page.locator("[data-profit-kpis] > *").count()) === 4);
const kpiText = ((await page.locator("[data-profit-kpis]").textContent()) ?? "").replace(/\s+/g, " ");
check("revenue, job costs, profit with margin, daily target", /Revenue \(before VAT\)/i.test(kpiText) && /Job costs/i.test(kpiText) && /% margin/.test(kpiText) && /Daily target/i.test(kpiText) && /Month: (ahead|behind) by/.test(kpiText), kpiText.slice(0, 200));
check("the where-the-money-went bar with the legend in AED", (await page.locator("[data-money-went]").count()) === 1 && /Parts AED [\d,]+/.test(((await page.locator("[data-money-went]").textContent()) ?? "").replace(/\s+/g, " ")));
const tableText = ((await page.locator("[data-profit-table]").textContent()) ?? "").replace(/\s+/g, " ");
check("the table has the mock-up columns", /Invoice/.test(tableText) && /Revenue/.test(tableText) && /Margin/.test(tableText) && /Total/.test(tableText));
check("margin pills are on", (await page.locator("[data-margin-pill]").count()) >= 1);
check("hours sit grey next to labour", /\(\d+(\.\d)? h\)/.test(tableText));
check("the subtitle explains the provisional dot", /provisional = supplier invoices still to come/.test(((await page.textContent("body")) ?? "")));
await page.screenshot({ path: `${shots}/profit-page.png`, fullPage: true });

// A row's car opens the breakdown.
const firstCar = page.locator("[data-profit-row] details summary").first();
if (await firstCar.count()) {
  await firstCar.click();
  await page.waitForTimeout(400);
  check("the row opens into the breakdown", (await page.locator("[data-profit-breakdown]:visible").count()) >= 1);
} else check("the row opens into the breakdown (no rows in range)", true, "no invoices in the window");

// Filters and sort answer.
await page.goto(`${base}/profit?period=60&filter=provisional`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const provRows = await page.locator("[data-profit-row]").count();
const provDots = await page.locator("[data-profit-row] [data-provisional-dot]").count();
check("the Provisional filter keeps only dotted rows", provRows === provDots, `${provRows} rows, ${provDots} dots`);
await page.goto(`${base}/profit?period=60&sort=profit&dir=desc`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const profits = await page.locator("[data-profit-row] td:nth-child(9)").allTextContents();
const nums = profits.map((t) => Number(t.replace(/[^\d.-]/g, "")) || 0);
check("sorting by profit orders the rows", nums.every((v, i) => i === 0 || nums[i - 1] >= v), nums.slice(0, 5).join(","));

// The Excel export answers for the owner.
const jarO = await cookieHeader("owner");
const xO = await fetch(`${base}/api/export/profit`, { headers: { cookie: jarO } });
check("the owner's Excel export answers", xO.status === 200 && (xO.headers.get("content-type") ?? "").includes("spreadsheetml"));
await own.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
