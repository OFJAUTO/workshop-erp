// 19 November 2026, Section 1: ZOHO QUEUE - A STOCK BILL AT AED 0.00, AND BILLS THAT DIFFER. Signed in as accounts.
//  A. VEGA, LPO-00089: a stock LPO with its invoice entered but nothing marked received was a bill at AED 0.00; it is
//     now the invoiced lines (AED 16.80), flagged "not marked received".
//  B. A bill that really comes to AED 0.00 is held: "NOT SENT", with the fix on the LPO.
//  C. One supplier invoice over two LPOs (929515897): Zoho's one bill is compared with BOTH - Posted ✓, not "differs".
//  D. A posted bill that differs explains itself (what Zoho holds, the price flag) and "Update Zoho to match the ERP"
//     asks first, then sends it at once.
// TEST only (Zoho is the test stand-in).  node --env-file=.env.test.local tests/browser/test-s19-1-zoho-bills.mjs
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-19-zoho-bills";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

const po = async (number, kind, status, inv, createdAgo = 0) => (await sql(`insert into public.purchase_orders (number, kind, order_type, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, created_at) values ($1, $2, $3, $4, 'E2E Bill Supplier', $5, 0, 'received', $6, $7, now() - ($8 || ' minutes')::interval) returning id`, [number, kind, kind === "stock" ? "stock_parts" : null, SUP, status, inv, today, String(createdAgo)]))[0].id;
const line = async (poId, desc, qty, received, unit, extra = {}) => sql(`insert into public.purchase_order_lines (po_id, position, description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check) values ($1, 1, $2, $3, $4, $5, $6, $7)`, [poId, desc, qty, received, unit, extra.invoiceUnit ?? null, extra.check ?? null]);
const outbox = async (poId, status, result, zohoId = null) => sql(`insert into public.zoho_outbox (kind, record_id, status, zoho_result, zoho_id, synced_at, attempts) values ('bill', $1, $2, $3::jsonb, $4, $5, $6)`, [poId, status, result ? JSON.stringify(result) : null, zohoId, status === "synced" ? new Date(Date.now() - 3600000).toISOString() : null, status === "synced" ? 1 : 0]);

let SUP = null;
try {
  cleanupDb();
  await sql("delete from public.zoho_outbox where record_id in (select id from public.purchase_orders where number like 'LPO-E2E-B%')");
  SUP = (await sql("insert into public.suppliers (name, trn, vat_registered) values ('E2E Bill Supplier', '100000000000003', true) returning id"))[0]?.id ?? (await sql("select id from public.suppliers where name = 'E2E Bill Supplier' limit 1"))[0]?.id;
  // A. The VEGA case.
  const a = await po("LPO-E2E-B1", "stock", "ordered", "E2E-CSB08399");
  await line(a, "BOSCH BRAKE FLUID", 1, 0, 16);
  await outbox(a, "pending", null);
  // B. A bill that really is AED 0.00.
  const z = await po("LPO-E2E-B2", "supplier", "received", "E2E-ZERO-1");
  await line(z, "FREE SAMPLE", 1, 1, 0);
  await outbox(z, "pending", null);
  // C. One invoice over two LPOs: Zoho holds the one bill of both.
  const g1 = await po("LPO-E2E-B3", "supplier", "received", "E2E-929515897", 30);
  const g2 = await po("LPO-E2E-B4", "supplier", "received", "E2E-929515897", 10);
  await line(g1, "PARTS ON THE FIRST LPO", 1, 1, 2279.05);
  await line(g2, "PARTS ON THE SECOND LPO", 1, 1, 274.29);
  await outbox(g1, "synced", { bill: "E2E-929515897", lpo: "LPO-E2E-B3", zoho: { net: 2553.34, vat: 127.66, total: 2681, balance: 0 }, erp: { net: 2553.34, vat: 127.66, total: 2681 }, lines: 2 }, "E2E-ZB-1");
  await outbox(g2, "synced", { combined: "On the one bill of LPO-E2E-B3" }, "E2E-ZB-1");
  // D. A posted bill that differs, with a price flag recorded after posting.
  const d = await po("LPO-E2E-B5", "supplier", "received", "E2E-DIFF-1");
  await line(d, "HEADLAMP", 1, 1, 120, { invoiceUnit: 100, check: "accepted" });
  await outbox(d, "synced", { bill: "E2E-DIFF-1", lpo: "LPO-E2E-B5", zoho: { net: 120, vat: 6, total: 126, balance: 126 }, erp: { net: 120, vat: 6, total: 126 }, lines: 1, e2e_stub: "post" }, "E2E-ZB-2");

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/zoho?show=pending&q=E2E-CSB08399`);
  const rowA = acc.page.locator('[data-zoho-row="pending"]').filter({ hasText: "E2E-CSB08399" });
  await rowA.first().waitFor({ timeout: 30000 });
  const aWords = await text(rowA);
  check("A1: the stock bill is the invoiced lines, AED 16.80 - not AED 0.00", /AED 16\.80/.test(aWords) && !/AED 0\.00/.test(aWords), aWords.slice(0, 160));
  await shots(acc.page, rowA.first(), "a-stock-bill-16-80");
  await go(acc.page, `${base}/zoho?show=pending&q=E2E-ZERO-1`);
  const rowZ = acc.page.locator('[data-zoho-row="pending"]').filter({ hasText: "E2E-ZERO-1" });
  await rowZ.first().waitFor({ timeout: 30000 });
  const zWords = await text(rowZ);
  check("B1: a bill at AED 0.00 says NOT SENT before the press", /NOT SENT: The bill comes to AED 0\.00/.test(zWords), zWords.slice(0, 200));
  await shots(acc.page, rowZ.first(), "b-zero-bill-held");

  await go(acc.page, `${base}/zoho?show=synced&q=E2E-929515897`);
  const rowG = acc.page.locator('[data-zoho-row="synced"]').filter({ hasText: "LPO-E2E-B3" }).first();
  await rowG.waitFor({ timeout: 30000 }).catch(() => null);
  const gWords = await text(acc.page.locator('[data-zoho-row="synced"]').filter({ hasText: "E2E-929515897" }));
  check("C1: one invoice over two LPOs: Posted ✓, never \"differs\"", (await acc.page.locator('[data-zoho-row="synced"] [data-zoho-differs]').count()) === 0 && /Posted ✓/.test(gWords), gWords.slice(0, 200));

  await go(acc.page, `${base}/zoho?show=synced&q=E2E-DIFF-1`);
  const rowD = acc.page.locator('[data-zoho-row="synced"]').filter({ hasText: "E2E-DIFF-1" }).first();
  await rowD.waitFor({ timeout: 30000 });
  const why = await text(rowD.locator("[data-zoho-differs-why]"));
  check("D1: Posted · differs explains itself: what Zoho holds against the ERP", /Zoho holds AED 126\.00 \(\+21\.00 against the ERP\)/.test(why), why.slice(0, 300));
  check("D2: and names the change (the price flag)", /Price flag \(LPO-E2E-B5\): HEADLAMP – LPO 120\.00, invoice 100\.00/.test(why));
  await shots(acc.page, rowD, "d-differs-explained");
  await rowD.locator('[data-confirm-open="zoho-update-bill"]').click();
  const q = await text(acc.page.locator("[data-confirm-text]"));
  check("D3: \"Update Zoho to match the ERP\" shows what will happen first", /The ERP's bill now: LPO-E2E-B5 AED 105\.00/.test(q), q.slice(0, 200));
  await shots(acc.page, acc.page.locator('[data-confirm-money="zoho-update-bill"]'), "d-update-zoho-preview");
  await acc.page.locator('[data-confirm-yes-money="zoho-update-bill"]').click();
  const after = await until(async () => { const r = (await sql("select status, zoho_result from public.zoho_outbox where record_id = $1 and kind = 'bill'", [d]))[0]; return r?.status === "synced" && r.zoho_result?.e2e ? r : null; }, 60);
  check("D4: sent at once after the confirmation (posted again)", !!after);
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.zoho_outbox where record_id in (select id from public.purchase_orders where number like 'LPO-E2E-B%')").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
