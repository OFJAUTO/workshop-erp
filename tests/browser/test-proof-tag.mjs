// 15 November 2026, Section 3: "PROOF MISSING" IS ONE RULE (the SPAY-00031 case). One supplier invoice covering two
// LPOs (the first invoice of one, a further invoice on the other), paid by ONE supplier payment with a proof attached.
// The list tag, the "Paid without proof" filter and the opened invoice all say proof attached; a payment with no proof
// still says missing; the invoice PDF buttons are named (file n of m, uploaded …). Signed in as accounts. TEST only.
//   node --env-file=.env.test.local tests/browser/test-proof-tag.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, doorUpload, go, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-15-proof-tag";
fs.mkdirSync(OUT, { recursive: true });
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Dublin Spares Co', true, '100000000000003') returning id"))[0].id;
  const mkPo = async (number, amount) => (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_checked_at) values ($1, 'supplier', $2, $3, 'E2E Dublin Spares Co', 'received', $4, 'received', $5, current_date - 1, $4, now(), now()) returning id", [number, JOB, sup, amount, number === "LPO-E2E-P1" ? "E2E-INV-342" : "E2E-OTHER-1"]))[0].id;
  const p1 = await mkPo("LPO-E2E-P1", 1300);
  const p4 = await mkPo("LPO-E2E-P4", 550);
  const line = (await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, received_qty, unit_cost) values ($1, 0, 'E2E OIL SEAL', 1, 1, 30) returning id", [p4]))[0].id;
  const inv = (await sql("insert into public.lpo_invoices (po_id, supplier_id, supplier_name, number, invoice_date, amount_aed, lines, origin, checked_at) values ($1, $2, 'E2E Dublin Spares Co', 'E2E-INV-342', current_date - 1, 30, $3::jsonb, 'added', now()) returning id", [p4, sup, JSON.stringify([{ line_id: line, qty: 1 }])]))[0].id;
  // The proof file (a card slip) and ONE payment with that proof covering both LPOs' shares of invoice E2E-INV-342.
  const cookie = await cookieHeader("accounts");
  const slip = await doorUpload({ target: "job_file", scopeId: JOB, contentType: "image/png", bytes: PNG, fields: { kind: "supplier_payment_proof", refId: p1 }, cookie }).catch(() => null);
  const proofPath = slip?.path ?? `supplier-payments/${p1}/e2e-slip.png`;
  const pay = (await sql("insert into public.supplier_payments (supplier_id, supplier_name, paid_on, method, amount_aed, proof_path, status, number) values ($1, 'E2E Dublin Spares Co', current_date, 'card', 1396.50, $2, 'recorded', 'E2E-SPAY-31') returning id", [sup, proofPath]))[0].id;
  await sql("insert into public.supplier_payment_lines (payment_id, po_id, amount_aed) values ($1, $2, 1365)", [pay, p1]);
  await sql("insert into public.supplier_payment_lines (payment_id, po_id, lpo_invoice_id, amount_aed) values ($1, $2, $3, 31.50)", [pay, p4, inv]);
  await sql("update public.purchase_orders set supplier_paid_at = now(), supplier_payment_id = $2 where id = $1", [p1, pay]);
  await sql("update public.lpo_invoices set paid_at = now() where id = $1", [inv]);
  // The other invoice of LPO-E2E-P4 paid with NO proof anywhere: still "Proof missing".
  await sql("update public.purchase_orders set supplier_paid_at = now() where id = $1", [p4]);
  // Two invoice files on LPO-E2E-P1 for the labelled buttons.
  for (const n of [1, 2]) await doorUpload({ target: "job_file", scopeId: JOB, contentType: "application/pdf", bytes: PDF, fields: { kind: "supplier_invoice", refId: p1, caption: `page ${n}` }, cookie });

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1100 } });
  await go(acc.page, `${base}/supplier-invoices?q=E2E-INV-342`);
  const row = acc.page.locator("[data-si-row]").first();
  check("1a: the list: no \"Proof missing\" on invoice E2E-INV-342 (paid by a payment with a proof)", (await acc.page.locator("[data-si-row]").count()) >= 1 && (await row.locator("[data-si-proof-missing-tag]").count()) === 0);
  await go(acc.page, `${base}/supplier-invoices?no_proof=1&q=E2E`);
  const missingRows = await acc.page.locator("[data-si-row]").allTextContents();
  check("1b: \"Paid without proof\" does not list E2E-INV-342, and does list the invoice paid with none", !missingRows.some((t) => /E2E-INV-342/.test(t)) && missingRows.some((t) => /E2E-OTHER-1/.test(t)), JSON.stringify(missingRows.map((t) => t.slice(0, 60))));
  await go(acc.page, `${base}/supplier-invoices?q=E2E-INV-342`);
  await acc.page.locator("[data-si-row] [data-si-open]").first().click();
  await acc.page.locator("[data-si-opened]").waitFor({ timeout: 15000 });
  const shown = await acc.page.locator("[data-si-paid-lines] [data-si-proof]").count();
  const missing = await acc.page.locator("[data-si-paid-lines] [data-si-proof-missing]").count();
  check("1c: the opened invoice shows the proof under BOTH LPOs, nothing missing", shown === 2 && missing === 0, `${shown} shown, ${missing} missing`);
  const pdfs = await acc.page.locator("[data-si-pdf]").allTextContents();
  check("2: the PDF buttons are named: file 1 of 2, file 2 of 2, each with its upload time", pdfs.length === 2 && /file 1 of 2 · uploaded/.test(pdfs[0]) && /file 2 of 2 · uploaded/.test(pdfs[1]), JSON.stringify(pdfs));
  for (const [w, h] of [[1440, 1100], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.locator("[data-si-opened]").screenshot({ path: path.join(OUT, `1-proof-under-both-lpos-${w}.png`) }); }
  // The LPO page of the further invoice says the same.
  await go(acc.page, `${base}/parts-accounts?tab=invoices&q=E2E-INV-342`);
  check("3: Parts accounts: no \"Proof missing\" on E2E-INV-342", (await acc.page.locator("[data-pa-invoice-proof-missing]").filter({ has: acc.page.locator(":scope") }).count()) === 0 || !(await acc.page.locator("[data-pa-invoice-row]").filter({ hasText: "E2E-INV-342" }).locator("[data-pa-invoice-proof-missing]").count()));
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.supplier_payment_lines where payment_id in (select id from public.supplier_payments where number = 'E2E-SPAY-31')").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
