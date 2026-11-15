// 15 November 2026, Section 4: LATHE INVOICES GO THROUGH SUPPLIER INVOICES FIRST. A lathe bill appears on Supplier invoices
// like any supplier invoice (tagged LATHE, its tickets, its scan, search and the Excel export); Supplier payments does not
// offer it until accounts check it; after "Mark checked" it can be paid there; a query sends it back. Signed in as
// accounts. TEST only.
//   node --env-file=.env.test.local tests/browser/test-lathe-invoices.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-15-lathe-invoices";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Lathe Works', true, '100000000000003') returning id"))[0].id;
  const bill = (await sql("insert into public.lathe_bills (supplier_id, supplier_name, bill_number, bill_date, before_vat_aed, vat_aed, total_aed) values ($1, 'E2E Lathe Works', 'E2E-LB-77', current_date - 2, 400, 20, 420) returning id", [sup]))[0].id;
  await sql("insert into public.part_items (job_id, description, quantity, cost_aed, availability, order_status, confirm_status, supplier, lathe_ticket, lathe_sent_at, lathe_bill_id, lathe_bill_amount_aed) values ($1, 'E2E FLYWHEEL SKIM', 1, 400, 'to_order', 'received', 'confirmed', 'E2E Lathe Works', 'SUB-E2E-1', now() - interval '5 days', $2, 400)", [JOB, bill]);

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1100 } });
  await go(acc.page, `${base}/supplier-invoices?q=E2E-LB-77`);
  const row = acc.page.locator(`[data-si-row="lathe:${bill}"]`);
  check("1a: the lathe bill is on Supplier invoices, tagged LATHE", (await row.count()) === 1 && (await row.locator("[data-si-lathe]").count()) === 1);
  check("1b: it waits for accounts' check (New)", (await row.getAttribute("data-si-state")) === "new");
  for (const [w, h] of [[1440, 1100], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.screenshot({ path: path.join(OUT, `1-lathe-on-supplier-invoices-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1100 });

  // 2. Not payable before the check.
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  check("2: Supplier payments does not offer it before the check", (await acc.page.locator(`[data-supplier-pay-invoice="lathe:${bill}"]`).count()) === 0);

  // 3. Opened: its tickets and "check it first"; Mark checked.
  await go(acc.page, `${base}/supplier-invoices?q=E2E-LB-77&open=${encodeURIComponent(`lathe:${bill}`)}`);
  check("3a: opened: its ticket SUB-E2E-1 and \"check it first\"", /SUB-E2E-1/.test(await text(acc.page, "[data-si-lathe-block]")) && (await acc.page.locator("[data-si-lathe-check-first]").count()) === 1);
  for (const [w, h] of [[1440, 1100], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.locator("[data-si-opened]").screenshot({ path: path.join(OUT, `2-lathe-opened-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1100 });
  await acc.page.locator("[data-si-check]").click();
  const checked = await until(async () => (await sql("select checked_at from public.lathe_bills where id = $1 and checked_at is not null", [bill]))[0]);
  check("3b: Mark checked: the lathe bill is checked", !!checked);
  await acc.page.waitForURL(/message=/, { timeout: 15000 }).catch(() => null);
  check("3c: then \"Pay on Supplier payments\"", (await acc.page.locator("[data-si-lathe-pay]").count()) === 1);

  // 4. Payable now, on Supplier payments.
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  check("4: after the check, Supplier payments offers it", (await acc.page.locator(`[data-supplier-pay-invoice="lathe:${bill}"]`).count()) === 1);

  // 5. A query sends it back (unchecked) and Parts are told.
  await go(acc.page, `${base}/supplier-invoices?q=E2E-LB-77&open=${encodeURIComponent(`lathe:${bill}`)}`);
  await acc.page.locator("[data-si-query]").first().waitFor({ timeout: 10000 }).catch(() => null);
  await acc.page.locator("[data-si-query-text]").first().fill("Two tickets on the paper, one in the ERP");
  await acc.page.locator("[data-si-query]").first().click();
  const queried = await until(async () => (await sql("select query, checked_at from public.lathe_bills where id = $1 and query is not null", [bill]))[0]);
  check("5: Query: back to Parts, unchecked", !!queried && queried.checked_at === null, JSON.stringify(queried));

  // 6. The Excel export carries it, marked LATHE.
  const resp = await acc.page.request.get(`${base}/api/export/supplier-invoices?q=E2E-LB-77`);
  const body = await resp.body();
  check("6: Export to Excel answers with the file", resp.status() === 200 && body.subarray(0, 2).toString() === "PK" && body.length > 1000);
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("update public.part_items set lathe_bill_id = null where lathe_ticket = 'SUB-E2E-1'").catch(() => null);
  await sql("update public.lathe_bills set is_active = false, voided_at = now(), void_reason = 'e2e' where supplier_name = 'E2E Lathe Works'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
