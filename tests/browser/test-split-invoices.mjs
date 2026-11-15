// 15 November 2026, Section 2: SPLIT SUPPLIER INVOICES - each part on exactly one invoice (the LPO-00086-1 case). An LPO
// with three lines, the first invoice for the drive belt and the idler pulley, a further invoice for 4 spark plugs.
// Editing the first invoice shows only ITS lines and their value; "Move to another invoice" moves 2 spark plugs with their
// amount; the running check; the Supplier invoices row of a further invoice edits on its LPO; a part sitting on two
// invoices is never paid twice. Signed in as accounts. TEST only.
//   node --env-file=.env.test.local tests/browser/test-split-invoices.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-15-split-invoices";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Premier Parts Co', true, '100000000000003') returning id"))[0].id;
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_path) values ('LPO-E2E-S1', 'supplier', $1, $2, 'E2E Premier Parts Co', 'received', 556, 'received', 'E2E-INV-542', current_date - 1, 348, now(), 'e2e/invoice.pdf') returning id", [JOB, sup]))[0].id;
  const mk = async (name, qty, cost, i) => {
    const part = (await sql("insert into public.part_items (job_id, description, quantity, received_qty, cost_aed, availability, order_status, po_id, confirm_status, supplier) values ($1, $2, $3, $3, $4, 'to_order', 'received', $5, 'confirmed', 'E2E Premier Parts Co') returning id", [JOB, name, qty, cost, po]))[0].id;
    const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, received_qty, unit_cost) values ($1, $2, $3, $4, $5, $5, $6) returning id", [po, part, i, name, qty, cost]))[0].id;
    await sql("update public.part_items set po_line_id = $2 where id = $1", [part, line]);
    return line;
  };
  const spark = await mk("E2E SPARK PLUG", 4, 52, 0);
  const belt = await mk("E2E DRIVE BELT", 1, 238, 1);
  const idler = await mk("E2E IDLER PULLEY", 1, 110, 2);
  const inv = (await sql("insert into public.lpo_invoices (po_id, supplier_id, supplier_name, number, invoice_date, amount_aed, lines, origin) values ($1, $2, 'E2E Premier Parts Co', 'E2E-INV-546', current_date - 1, 208, $3::jsonb, 'added') returning id", [po, sup, JSON.stringify([{ line_id: spark, qty: 4 }])]))[0].id;

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  await go(acc.page, `${base}/parts/orders/${po}`);
  // 1. Editing the first invoice: only its own lines (belt, idler), never the spark plugs.
  const editLines = await acc.page.locator("[data-si-edit-form] [data-edit-line]").evaluateAll((els) => els.map((e) => e.getAttribute("data-edit-line")));
  check("1a: editing invoice E2E-INV-542 lists only its own lines (no spark plugs)", editLines.length === 2 && editLines.includes(belt) && editLines.includes(idler) && !editLines.includes(spark), JSON.stringify(editLines));
  await acc.page.locator("[data-si-edit]").first().click();
  await acc.page.locator("[data-edit-amount]").fill("348");
  const vs = await text(acc.page, "[data-si-edit-form] [data-invoice-vs-approved]");
  check("1b: its approved value is its own lines (238 + 110 = 348): no difference shown", vs === "", vs);
  check("1c: its total with VAT is its own: 348 + 5% = 365.40", /365\.40/.test(await text(acc.page, "[data-edit-total]")));
  for (const [w, h] of [[1440, 1200], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.locator("[data-si-edit-form]").screenshot({ path: path.join(OUT, `1-edit-first-own-lines-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1200 });

  // 2. The running check.
  await go(acc.page, `${base}/parts/orders/${po}`);
  const words = await text(acc.page, "[data-lpo-invoices-total]");
  check("2a: running check: Invoices total AED 583.80 of the LPO's AED 583.80 ✓", /Invoices total AED 583\.80 of the LPO's AED 583\.80/.test(words) && (await acc.page.locator('[data-lpo-invoices-check="ok"]').count()) === 1, words);
  // The extra invoice's edit lists only its own line.
  await acc.page.locator(`[data-lpo-extra-invoice="E2E-INV-546"] [data-extra-edit] summary`).click();
  const extraLines = await acc.page.locator(`[data-lpo-extra-invoice="E2E-INV-546"] [data-extra-edit] input[type=checkbox]`).count();
  check("2b: editing the further invoice lists only its own line (spark plugs)", extraLines === 1, String(extraLines));

  // 3. Move 2 of the 4 spark plugs from E2E-INV-546 to E2E-INV-542: the amount moves with them (2 × 52 = 104).
  await go(acc.page, `${base}/parts/orders/${po}`);
  const mv = acc.page.locator(`[data-move-line="${spark}"]`);
  await mv.locator("[data-move-open]").click();
  await mv.locator("[data-move-qty]").fill("2");
  await mv.locator('[data-move-to="E2E-INV-542"]').check();
  for (const [w, h] of [[1440, 1200], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.locator("[data-lpo-invoices]").screenshot({ path: path.join(OUT, `2-move-to-another-invoice-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1200 });
  await mv.locator("[data-move-save]").click();
  const after = await until(async () => { const r = (await sql("select amount_aed::float as a, lines from public.lpo_invoices where id = $1", [inv]))[0]; return r && r.a === 104 ? r : null; });
  const first = (await sql("select supplier_invoice_amount::float as a, supplier_invoice_lines as l from public.purchase_orders where id = $1", [po]))[0];
  check("3a: E2E-INV-546 now 2 spark plugs, AED 104", after?.lines?.[0]?.qty === 2 && after?.a === 104, JSON.stringify(after));
  check("3b: E2E-INV-542 takes the 2 spark plugs and AED 104 more (348 → 452)", first?.a === 452 && (first?.l ?? []).some((x) => x.line_id === spark && Number(x.qty) === 2), JSON.stringify(first));
  const hist = (await sql("select changes from public.supplier_invoice_edits where po_id = $1 order by created_at desc limit 1", [po]))[0];
  check("3c: kept in the edit history", /Moved/.test(JSON.stringify(hist?.changes ?? "")) && /E2E-INV-546/.test(JSON.stringify(hist?.changes ?? "")));
  await go(acc.page, `${base}/parts/orders/${po}`);
  check("3d: the running check still adds up after the move", /Invoices total AED 583\.80/.test(await text(acc.page, "[data-lpo-invoices-total]")));

  // 4. On Supplier invoices, the further invoice's row edits on its LPO (never the first invoice's form).
  await go(acc.page, `${base}/supplier-invoices?q=E2E-INV-546`);
  await acc.page.locator("[data-si-row] [data-si-open]").first().click();
  await acc.page.locator("[data-si-edit-on-lpo], [data-si-edit]").first().waitFor({ timeout: 15000 }).catch(() => null);
  check("4: the further invoice's row says \"Edit this invoice (on LPO-E2E-S1)\"", (await acc.page.locator("[data-si-edit-on-lpo]").count()) === 1);

  // 5. A part on two invoices (the old way data could look) shows a warning, and is never paid twice.
  await sql("update public.purchase_orders set supplier_invoice_lines = $2::jsonb where id = $1", [po, JSON.stringify([{ line_id: spark, qty: 4 }, { line_id: belt, qty: 1 }, { line_id: idler, qty: 1 }])]);
  await sql("update public.lpo_invoices set paid_at = now() where id = $1", [inv]);
  await go(acc.page, `${base}/parts/orders/${po}`);
  const warn = await text(acc.page, '[data-lpo-invoices-check="warn"]');
  check("5a: the running check warns: E2E SPARK PLUG is on two invoices", /SPARK PLUG is on two invoices/.test(warn), warn);
  await acc.page.locator("#paid").scrollIntoViewIfNeeded().catch(() => null);
  const box = acc.page.locator("[data-supplier-pay-box]").first();
  await box.locator("[data-supplier-pay-amount]").fill("100");
  await box.locator('[data-pay-method] label').filter({ hasText: /Bank transfer/ }).first().click();
  await box.locator("[data-supplier-pay-save]").click();
  await acc.page.locator("[data-confirm-yes-money]").click({ timeout: 8000 }).catch(() => null);
  await acc.page.locator("[data-supplier-pay-error]").waitFor({ timeout: 20000 }).catch(() => null);
  const refused = await text(acc.page, "[data-supplier-pay-error]");
  check("5b: paying the first invoice is refused: the spark plugs would be paid twice", /SPARK PLUG is on invoice E2E-INV-542 and invoice E2E-INV-546/.test(refused) && (await sql("select count(*)::int as n from public.supplier_payment_lines where po_id = $1", [po]))[0].n === 0, refused);
  await acc.page.locator("[data-supplier-pay-box]").first().screenshot({ path: path.join(OUT, "3-double-pay-refused-1440.png") });

  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
