// Queue 5 of 4 November 2026 (Mathew): ONE "Parts management" menu group - LPOs, Supplier invoices,
// Parts accounts and Suppliers as indented sub-items; opens by itself on its pages with the current
// page highlighted; the main item's badge sums what waits inside; each role sees only its own
// sub-items; the same on the phone's drawer; old addresses keep working.
//   node --env-file=.env.test.local tests/browser/test-partsmenu.mjs   (test server on 3102)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "parts-menu");
fs.mkdirSync(dir, { recursive: true });

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
// Something waiting inside: one LPO for approval, one invoice to collect, one entered and not checked.
await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed) values ('LPO-E2E-PM1', 'main', $1, 'E2E PM SUPPLIER', 'pending_approval', 1000)", [jobId]);
await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ('LPO-E2E-PM2', 'supplier', $1, 'E2E PM SUPPLIER', 'received', 300, 'to_follow')", [jobId]);
await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date) values ('LPO-E2E-PM3', 'supplier', $1, 'E2E PM SUPPLIER', 'received', 200, 'received', 'E2E-PM-9', current_date)", [jobId]);
const [{ n: seeded }] = await sql("select count(*)::int as n from public.purchase_orders where number like 'LPO-E2E-PM%'");
if (seeded !== 3) { console.error(`PO seeds missing: ${seeded} of 3 (the e2e sql route hides insert errors)`); process.exit(1); }

const GROUP = '[data-nav-group="parts-management"]';
const pill = async (scope) => Number((await scope.textContent().catch(() => "")) || 0);

/* ---------- A. Accounts on a computer ---------- */
const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
try {
  await go(acc.page, `${base}/dashboard`);
  const group = acc.page.locator(`aside ${GROUP}`);
  check("A1: the group is in the menu, closed away from its pages", (await group.count()) === 1 && (await group.getAttribute("data-nav-group-open")) === null);
  check("A2: the four are no longer separate top-level items", (await acc.page.locator("aside nav > a", { hasText: "Parts accounts" }).count()) === 0 && (await acc.page.locator("aside nav > a", { hasText: "Suppliers" }).count()) === 0);
  await acc.page.screenshot({ path: path.join(dir, "a1-closed.png") });
  await group.locator("[data-nav-group-toggle]").click();
  check("A3: a tap opens it", (await group.getAttribute("data-nav-group-open")) === "1");
  const labels = await group.locator("[data-nav-sub]").evaluateAll((els) => els.map((e) => e.textContent?.replace(/\d+\+?$/, "").trim()));
  check("A4: accounts see all four, in Mathew's order", JSON.stringify(labels) === JSON.stringify(["LPOs", "Supplier invoices", "Parts accounts", "Suppliers"]), JSON.stringify(labels));
  const groupBadge = await pill(group.locator("[data-nav-group-badge]"));
  const lpoBadge = await pill(group.locator('[data-nav-sub][href="/parts/orders"] span span'));
  const invBadge = await pill(group.locator('[data-nav-sub][href="/supplier-invoices"] span span'));
  check("A5: the main badge is the sum of the sub badges, counting the seeds", groupBadge === lpoBadge + invBadge && lpoBadge >= 1 && invBadge >= 2, `${groupBadge} = ${lpoBadge} + ${invBadge}`);
  await acc.page.screenshot({ path: path.join(dir, "a3-open-badges.png") });

  // The old address still works, the group opens by itself there and the page is highlighted.
  await go(acc.page, `${base}/parts/orders`);
  const group2 = acc.page.locator(`aside ${GROUP}`);
  check("A6: on the LPOs page the group is open by itself", (await group2.getAttribute("data-nav-group-open")) === "1");
  const activeBg = await acc.page.locator('aside [data-nav-sub][href="/parts/orders"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  check("A7: the current page's sub-item is highlighted", /rgb\(255,\s*255,\s*255\)/.test(activeBg), activeBg);
  await acc.page.screenshot({ path: path.join(dir, "a6-open-on-lpos.png") });
  await go(acc.page, `${base}/supplier-invoices`);
  check("A8: the old Supplier invoices address works and opens the group", /supplier-invoices/.test(acc.page.url()) && (await acc.page.locator(`aside ${GROUP}`).getAttribute("data-nav-group-open")) === "1");
} finally {
  await acc.browser.close().catch(() => {});
}

/* ---------- B. The phone's drawer ---------- */
const ph = await browserFor("accounts", { viewport: { width: 390, height: 844 } });
try {
  await go(ph.page, `${base}/dashboard`);
  await ph.page.locator("[data-menu-open]").click();
  const drawerGroup = ph.page.locator(`[data-menu-drawer] ${GROUP}`);
  await drawerGroup.waitFor();
  check("B1: the group is in the phone menu", (await drawerGroup.count()) === 1);
  await drawerGroup.locator("[data-nav-group-toggle]").click();
  check("B2: it opens in the drawer with its sub-items", (await drawerGroup.locator("[data-nav-sub]").count()) === 4);
  await ph.page.screenshot({ path: path.join(dir, "b1-phone-drawer.png") });
} finally {
  await ph.browser.close().catch(() => {});
}

/* ---------- C. A parts login sees only its own sub-items; an advisor has no group ---------- */
const pr = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
try {
  await go(pr.page, `${base}/parts`);
  const g = pr.page.locator(`aside ${GROUP}`);
  await g.locator("[data-nav-group-toggle]").click();
  const partsLabels = await g.locator("[data-nav-sub]").evaluateAll((els) => els.map((e) => e.textContent?.replace(/\d+\+?$/, "").trim()));
  check("C1: parts see LPOs, Supplier invoices and Suppliers - never Parts accounts", JSON.stringify(partsLabels) === JSON.stringify(["LPOs", "Supplier invoices", "Suppliers"]), JSON.stringify(partsLabels));
  await pr.page.screenshot({ path: path.join(dir, "c1-parts-subitems.png") });
} finally {
  await pr.browser.close().catch(() => {});
}
const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
try {
  await go(adv.page, `${base}/dashboard`);
  check("C2: an advisor has no Parts management group at all", (await adv.page.locator(GROUP).count()) === 0);
} finally {
  await adv.browser.close().catch(() => {});
}

cleanupDb();
process.exit(summary() ? 1 : 0);
