// 17 November 2026, Section 2: ONE SUPPLIER INVOICE FOR SEVERAL LPOs (the AL TAYER case: LPO-00039-1 AED 3,385.20 and
// LPO-00039-3 AED 668.85, both "Invoice missing", one paper for both). Signed in as accounts.
//  A. Entering the invoice: the step "THIS INVOICE ALSO COVERS…" lists the supplier's other open LPOs; ticking one checks
//     the total against the LPOs TOGETHER and saves both, each with its share; both "Invoice missing" clear.
//  B. On the saved invoice: "Add another LPO to this invoice" adds a third LPO; the paper's total is shared again and
//     the invoice goes back to unchecked. The answer shows right there.
//  C. Refused while one of them is already paid.
//  D. The parts desk sees no add button (accounts and the owner only).
// TEST only.  node --env-file=.env.test.local tests/browser/test-s17-2-one-invoice.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-one-invoice";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};
const yesterday = () => new Date(Date.now() + 4 * 3600000 - 86400000).toISOString().slice(0, 10);

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Al Tayer Motors', true, '100000000000003') returning id"))[0].id;
  const mk = async (n, total, minutesAgo) => (await sql(`insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, created_at) values ($1, 'supplier', $2, $3, 'E2E Al Tayer Motors', 'received', $4, 'to_follow', now() - ($5 || ' minutes')::interval) returning id`, [n, JOB, sup, total, String(minutesAgo)]))[0].id;
  const A = await mk("LPO-E2E-39-1", 3224, 30);
  const B = await mk("LPO-E2E-39-3", 637, 20);
  const C = await mk("LPO-E2E-39-4", 100, 10);

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  // A. Enter the invoice on LPO A, ticking B under "This invoice also covers…".
  await go(acc.page, `${base}/supplier-invoices?open=${encodeURIComponent(`follow:${A}`)}`);
  const form = acc.page.locator("[data-si-enter]").first();
  await form.waitFor({ timeout: 30000 });
  const covers = form.locator("[data-also-covers]");
  check("A1: the step \"This invoice also covers…\" lists the supplier's other open LPOs", (await covers.count()) === 1 && (await covers.locator("[data-also-cover]").count()) === 2 && /LPO-E2E-39-3/.test(await covers.textContent()) && /LPO-E2E-39-4/.test(await covers.textContent()));
  await covers.locator('[data-also-cover="LPO-E2E-39-3"] input').check();
  await form.locator("[data-invoice-number]").fill("E2E-ALT-262817");
  await form.locator("[data-invoice-date]").fill(yesterday());
  await form.locator("[data-invoice-amount]").fill("3861");
  const together = await text(acc.page, "[data-also-covers-together]");
  check("A2: the total is checked against the LPOs TOGETHER (no 5% warning at 3,861.00)", /Together: AED 3,861\.00 before VAT/.test(together) && (await form.locator("[data-amount-check]").count()) === 0, together);
  await shots(acc.page, form, "a-this-invoice-also-covers");
  await form.locator("[data-si-enter-save]").click();
  const saved = await until(async () => { const r = await sql("select id, supplier_invoice_status, supplier_invoice_number, supplier_invoice_amount from public.purchase_orders where id = any($1::uuid[]) order by number", [[A, B]]); return r.every((x) => x.supplier_invoice_status === "received") ? r : null; });
  check("A3: both LPOs carry the invoice, each with its share (3,224.00 + 637.00)", !!saved && saved.every((x) => x.supplier_invoice_number === "E2E-ALT-262817") && Number(saved.find((x) => x.id === A).supplier_invoice_amount) === 3224 && Number(saved.find((x) => x.id === B).supplier_invoice_amount) === 637, JSON.stringify(saved));
  const missing = await sql("select count(*)::int as n from public.purchase_orders where id = any($1::uuid[]) and supplier_invoice_status = 'to_follow'", [[A, B]]);
  check("A4: their \"Invoice missing\" is cleared", missing[0]?.n === 0);
  await sleep(800);
  const rowKey = `${sup}|E2EALT262817`;
  await go(acc.page, `${base}/supplier-invoices?open=${encodeURIComponent(rowKey)}`);
  const rowText = await text(acc.page, "[data-si-shares], [data-si-open], main");
  check("A5: Supplier invoices shows ONE invoice covering both LPOs", /LPO-E2E-39-1/.test(rowText) && /LPO-E2E-39-3/.test(rowText));

  // B. Add another LPO to this invoice.
  const add = acc.page.locator("[data-add-lpo]").first();
  await add.waitFor({ timeout: 15000 });
  await add.locator("[data-add-lpo-open]").click();
  await add.locator("[data-add-lpo-pick]").selectOption(C);
  await add.locator("[data-add-lpo-total]").fill("3961");
  await shots(acc.page, add, "b-add-another-lpo");
  await add.locator('[data-confirm-open="add-lpo"]').click();
  await acc.page.locator('[data-confirm-yes-money="add-lpo"]').click();
  const all3 = await until(async () => { const r = await sql("select id, supplier_invoice_status, supplier_invoice_amount, supplier_invoice_checked_at from public.purchase_orders where id = any($1::uuid[])", [[A, B, C]]); return r.every((x) => x.supplier_invoice_status === "received") ? r : null; });
  const amt = (id) => Number(all3?.find((x) => x.id === id)?.supplier_invoice_amount);
  check("B1: LPO-E2E-39-4 joined the invoice; the 3,961.00 is shared by the totals", !!all3 && amt(A) === 3224 && amt(B) === 637 && amt(C) === 100, JSON.stringify(all3));
  check("B2: the invoice is unchecked again (accounts look again)", !!all3 && all3.every((x) => !x.supplier_invoice_checked_at));
  await acc.page.locator("[data-add-lpo-message]").waitFor({ timeout: 20000 });
  check("B3: the answer shows next to the button", /LPO-E2E-39-4 added to invoice E2E-ALT-262817/.test(await text(acc.page, "[data-add-lpo-message]")));
  await shots(acc.page, acc.page.locator("[data-add-lpo]").first(), "b-added-answer");

  // C. Refused while one is paid.
  const D = await mk("LPO-E2E-39-5", 50, 5);
  await sql("update public.purchase_orders set supplier_paid_at = now() where id = $1", [A]);
  await go(acc.page, `${base}/supplier-invoices?open=${encodeURIComponent(rowKey)}&v=2`);
  const add2 = acc.page.locator("[data-add-lpo]").first();
  await add2.locator("[data-add-lpo-open]").click();
  await add2.locator("[data-add-lpo-pick]").selectOption(D);
  await add2.locator("[data-add-lpo-total]").fill("4011");
  await add2.locator('[data-confirm-open="add-lpo"]').click();
  await acc.page.locator('[data-confirm-yes-money="add-lpo"]').click();
  await acc.page.locator("[data-add-lpo-error]").waitFor({ timeout: 20000 });
  check("C1: refused while an LPO of the invoice is paid, in plain words", /already paid/.test(await text(acc.page, "[data-add-lpo-error]")) && (await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [D]))[0]?.supplier_invoice_status === "to_follow");
  await acc.browser.close();

  // D. The parts desk: no add button.
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(parts.page, `${base}/supplier-invoices?open=${encodeURIComponent(rowKey)}`);
  await sleep(1500);
  check("D1: the parts desk sees no \"Add another LPO\" (accounts and the owner only)", (await parts.page.locator("[data-add-lpo-open]").count()) === 0);
  await parts.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
