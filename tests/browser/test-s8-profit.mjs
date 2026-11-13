// 13 November 2026, Section 8: profit on every invoice. A car at Ready with its invoice: the profit box on the invoice
// page and the money page (before VAT minus real costs = AED and %, PROVISIONAL with the worst case or FINAL, expected
// against actual), the visit's profit and the lifetime on the car page, the total on the customer page. Signed in as the
// owner, accounts, the job's advisor (sees it), another advisor and the parts desk (never). The figure is the Profit
// report's (THE calculation). TEST only.
//   node --env-file=.env.test.local tests/browser/test-s8-profit.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, browserForId, cleanupDb, go, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-invoice-profit";
fs.mkdirSync(OUT, { recursive: true });

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const inv = seed.invoice;
  const [mine, other] = await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 2");
  await sql("update public.jobs set advisor_id = $2 where id = $1", [JOB, mine.id]);
  // The proforma becomes the tax invoice (a test number, never in the real INV- run).
  const num = `E2E-INV-${String(Date.now()).slice(-6)}`;
  await sql("update public.invoices set kind = 'tax_invoice', number = $2, status = 'issued', issued_at = now() where id = $1", [inv.id, num]);
  const row = (await sql("select kind, number from public.invoices where id = $1", [inv.id]))[0];
  check("0: the seed's invoice is a tax invoice", row?.kind === "tax_invoice", JSON.stringify(row));
  const { vehicle_id: CAR, customer_id: CUST } = (await sql("select vehicle_id, customer_id from public.jobs where id = $1", [JOB]))[0];

  // 1. The owner: the box on the invoice page.
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/invoices/${inv.id}`);
  const box = own.page.locator("[data-invoice-profit]");
  check("1a: the owner sees the profit box on the invoice", (await box.count()) === 1);
  const amount = Number(await box.locator("[data-profit-amount]").getAttribute("data-profit-amount"));
  const state = await box.getAttribute("data-invoice-profit");
  check("1b: before VAT minus each real cost = profit, with %", (await box.locator("[data-profit-table]").count()) === 1 && (await box.locator("[data-profit-margin]").count()) === 1, `profit ${amount}`);
  check("1c: PROVISIONAL (no payment yet: bank fee estimated) shows the worst case", state === "provisional" && (await box.locator("[data-profit-worst]").count()) === 1 && Number(await box.locator("[data-profit-worst]").getAttribute("data-profit-worst")) <= amount);
  check("1d: expected (the approved quotation) against actual", /Expected [\d,]+\.\d\d · actual/.test((await box.locator("[data-profit-expected]").textContent()) ?? ""), (await box.locator("[data-profit-expected]").textContent()) ?? "");
  await box.screenshot({ path: path.join(OUT, "1-owner-invoice-box-1440.png") });
  await go(own.page, `${base}/jobs/${JOB}/invoice`);
  check("1e: the same box on the job's money page", (await own.page.locator(`[data-invoice-profit] [data-profit-amount="${amount.toFixed(2)}"]`).count()) === 1);
  // THE calculation: the Profit report lists the same figure for this invoice.
  await go(own.page, `${base}/profit`);
  const report = (await own.page.textContent("body")) ?? "";
  // The report prints whole dirhams.
  check("1f: the Profit report shows the same profit (one calculation)", report.includes(num) && report.includes(Math.round(amount).toLocaleString("en-GB")), `${num} ${amount}`);
  // Car page: the visit's profit and the lifetime; customer page: the total.
  await go(own.page, `${base}/vehicles/${CAR}`);
  check("1g: the car page shows the visit's profit and the lifetime", (await own.page.locator("[data-profit-tag='visit']").count()) >= 1 && (await own.page.locator("[data-lifetime-profit]").count()) === 1);
  await own.page.screenshot({ path: path.join(OUT, "1-owner-car-visits-1440.png"), fullPage: true });
  await go(own.page, `${base}/customers/${CUST}`);
  check("1h: the customer page shows the total profit", (await own.page.locator("[data-customer-lifetime-profit]").count()) === 1);

  // 2. FINAL once nothing is estimated: a cash payment in full makes the bank fee known (0).
  const total = Number((await sql("select total_aed::float as t from public.invoices where id = $1", [inv.id]))[0].t);
  await sql("insert into public.payments (invoice_id, job_id, customer_id, method, amount_aed, received_at, status, received_by, created_by, updated_by, number) select $1, $2, $3, 'cash', $4, now(), 'recorded', $5, $5, $5, $6", [inv.id, JOB, CUST, total, mine.id, `E2E-RCT-${String(Date.now()).slice(-6)}`]);
  await go(own.page, `${base}/invoices/${inv.id}`);
  const st2 = await own.page.locator("[data-invoice-profit]").getAttribute("data-invoice-profit").catch(() => null);
  const why2 = (await own.page.locator("[data-profit-why]").textContent().catch(() => "")) ?? "";
  check("2: paid in cash, nothing estimated is left → FINAL (or provisional only for a named reason)", st2 === "final" || (st2 === "provisional" && !/bank charge/.test(why2)), `${st2} ${why2}`);
  await own.browser.close();

  // 3. Accounts and the job's own advisor see it; another advisor and the parts desk never.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/invoices/${inv.id}`);
  check("3a: accounts see the box", (await acc.page.locator("[data-invoice-profit]").count()) === 1);
  await acc.browser.close();
  const adv = await browserForId(mine.id, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(adv.page, `${base}/invoices/${inv.id}`);
  check("3b: the job's own advisor sees the box", (await adv.page.locator("[data-invoice-profit]").count()) === 1);
  await adv.page.screenshot({ path: path.join(OUT, "3-advisor-invoice-800.png"), fullPage: true });
  await go(adv.page, `${base}/vehicles/${CAR}`);
  check("3c: the job's advisor sees the visit's profit, not the car's lifetime", (await adv.page.locator("[data-profit-tag='visit']").count()) >= 1 && (await adv.page.locator("[data-lifetime-profit]").count()) === 0);
  await adv.page.screenshot({ path: path.join(OUT, "3-advisor-car-800.png"), fullPage: true });
  await adv.browser.close();
  const oth = await browserForId(other.id, { viewport: { width: 1440, height: 1000 } });
  await go(oth.page, `${base}/invoices/${inv.id}`);
  const othHtml = await oth.page.content();
  check("3d: another advisor: no box, and the figure is not in the page at all", (await oth.page.locator("[data-invoice-profit]").count()) === 0 && !othHtml.includes("data-profit-amount"));
  await go(oth.page, `${base}/vehicles/${CAR}`);
  check("3e: another advisor: no profit on the car page", (await oth.page.locator("[data-profit-tag]").count()) === 0);
  await oth.browser.close();
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(parts.page, `${base}/invoices/${inv.id}`);
  check("3f: the parts desk never sees it", (await parts.page.locator("[data-invoice-profit]").count()) === 0 && !(await parts.page.content()).includes("data-profit-amount"));
  await parts.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
