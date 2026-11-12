// 13 November 2026, Section 4: pay a supplier in advance against an LPO waiting for its invoice. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-4-lpo-advance.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, pageReady, pressYes, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-lpo-advance";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const JOB = "22222222-0000-4000-8000-00000000e303";
const PA = "22222222-0000-4000-8000-00000000e306";
let poId = null;

try {
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "approved" });
  if (st.status !== 200) throw new Error(`stage: ${st.status}`);
  const sup = (await q("select id, name from public.suppliers where is_active and vat_registered and name not ilike 'our stock%' and name not ilike 'ofj%' order by name limit 1"))[0];
  const by = (await q("select created_by from public.part_items where id = $1", [PA]))[0]?.created_by;
  const po = (await q("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, supplier_invoice_status, created_by, updated_by) values ('E2E-LPO-S4', $1, $2, $3, 'supplier', 'ordered', 1192.00, 'none', $4, $4) returning id", [JOB, sup.id, sup.name, by]))[0];
  poId = po.id;
  await q("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, part_item_id, created_by, updated_by) values ($1, 1, 'TRANSMISSION MOUNT', 1, 1192.00, $2, $3, $3)", [poId, PA, by]);
  await q("update public.part_items set po_id = $1, order_status = 'ordered', supplier = $2, expected_date = (now() - interval '2 days')::date where id = $3", [poId, sup.name, PA]);

  // 1. The parts desk: "Supplier needs payment first".
  const p = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await p.page.goto(`${base}/parts/orders/${poId}`, { waitUntil: "domcontentloaded" });
  await pageReady(p.page);
  check("the LPO page has the advance card", (await p.page.locator("[data-lpo-advance-card]").count()) === 1);
  check("the parts desk cannot pay (no Pay in advance)", (await p.page.locator("[data-pay-in-advance]").count()) === 0);
  await p.page.locator("[data-pay-first-note]").fill("special order");
  await p.page.locator("[data-pay-first]").click();
  await until(async () => (await q("select pay_first_at from public.purchase_orders where id = $1", [poId]))[0]?.pay_first_at, 40);
  await p.page.goto(`${base}/parts/orders/${poId}`, { waitUntil: "domcontentloaded" });
  await pageReady(p.page);
  check("the LPO says the supplier needs payment first", (await p.page.locator("[data-pay-first-waiting]").count()) === 1);
  const bell = (await q("select title from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'accounts' and n.title like 'Pay first: E2E-LPO-S4%' limit 1"))[0];
  check("accounts are told (a task)", !!bell, JSON.stringify(bell));

  // 2. Accounts pay in advance from the LPO page.
  const a = await browserFor("accounts", { viewport: { width: 1366, height: 900 } });
  await a.page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  check("accounts' Waiting on you lists the task", /Supplier needs payment first/.test(await txt(a.page.locator("[data-waiting-panel]"))));
  await a.page.goto(`${base}/parts/orders/${poId}`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  await a.page.locator("[data-pay-in-advance]").click();
  const w = a.page.locator("[data-pay-advance-window]");
  await w.waitFor();
  check("the window suggests the LPO total with VAT (1,251.60)", (await w.locator("[data-advance-amount]").inputValue()) === "1251.60", await w.locator("[data-advance-amount]").inputValue());
  check("the window shows the customer's deposit on the job", /Customer deposit on this job/.test(await txt(w.locator("[data-customer-deposit]"))), await txt(w.locator("[data-customer-deposit]")));
  await w.locator("[data-advance-reference]").fill("TT-S4");
  await a.page.screenshot({ path: `${OUT}/s4-pay-in-advance-1366.png` });
  await w.locator("[data-confirm-open='pay-advance']").click();
  await pressYes(a.page);
  await w.locator("[data-pay-advance-done], [role=alert]").first().waitFor({ timeout: 30000 });
  check("the advance is recorded", (await w.locator("[data-pay-advance-done]").count()) === 1, await txt(w));
  const sp = await until(async () => (await q("select number, amount_aed::float8 a, excess_kind, advance_for_po_id from public.supplier_payments where advance_for_po_id = $1", [poId]))[0], 40);
  check("one supplier payment, kept as an advance, for this LPO", sp?.a === 1251.6 && sp.excess_kind === "advance", JSON.stringify(sp));
  const zoho = (await q("select kind, status from public.zoho_outbox where kind = 'supplierpay' and record_id = (select id from public.supplier_payments where advance_for_po_id = $1)", [poId]))[0];
  check("it is queued for Zoho as a supplier advance", zoho?.status === "pending", JSON.stringify(zoho));
  const told = (await q("select title from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'parts' and n.title like 'Paid: confirm the order%' order by n.created_at desc limit 1"))[0];
  check("the parts desk is told: Paid, confirm the order", !!told, JSON.stringify(told));
  await a.page.goto(`${base}/parts/orders/${poId}`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  check("the LPO shows ADVANCE PAID AED 1,251.60", /ADVANCE PAID AED 1,251\.60/.test(await txt(a.page.locator("[data-lpo-advance-paid]"))), await txt(a.page.locator("[data-lpo-advance-paid]")));
  await a.page.screenshot({ path: `${OUT}/s4-advance-paid-1366.png` });
  await a.page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  check("the part is late: 'Advance paid, part not received' for accounts", /Advance paid, part not received/.test(await txt(a.page.locator("[data-waiting-panel]"))));

  // 3. The invoice is entered: one tap applies the advance to it.
  await q("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = 'E2E-INV-S4', supplier_invoice_date = (now())::date, supplier_invoice_amount = 1192.00 where id = $1", [poId]);
  await a.page.setViewportSize({ width: 800, height: 1280 });
  await a.page.goto(`${base}/parts/orders/${poId}`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  check("the LPO offers to apply the advance to the invoice", (await a.page.locator("[data-apply-lpo-advance]").count()) === 1);
  await a.page.screenshot({ path: `${OUT}/s4-apply-advance-800.png` });
  await a.page.locator("[data-apply-lpo-advance]").click();
  const applied = await until(async () => (await q("select count(*)::int n from public.supplier_payment_lines where po_id = $1 and applied_later and is_active", [poId]))[0]?.n >= 1, 40);
  check("applied with one tap (no new payment)", !!applied);
  const paid = await until(async () => { const r = (await q("select supplier_paid_at from public.purchase_orders where id = $1", [poId]))[0]; return r?.supplier_paid_at ? r : null; }, 30);
  check("the LPO is paid", !!paid?.supplier_paid_at, JSON.stringify(paid));
  await p.browser.close();
  await a.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (poId) {
    await api("/api/e2e/sql", { sql: "delete from public.zoho_outbox where kind = 'supplierpay' and record_id in (select id from public.supplier_payments where advance_for_po_id = $1)", params: [poId] }).catch(() => null);
    await api("/api/e2e/sql", { sql: "update public.supplier_payment_lines set is_active = false where payment_id in (select id from public.supplier_payments where advance_for_po_id = $1)", params: [poId] }).catch(() => null);
    await api("/api/e2e/sql", { sql: "update public.supplier_payments set status = 'void', is_active = false where advance_for_po_id = $1", params: [poId] }).catch(() => null);
  }
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
