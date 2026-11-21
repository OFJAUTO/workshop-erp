// The FINAL tax invoice after an advance tax invoice (21 November 2026; case J-01013 / INV-00037 / RCT-00106).
// Three cars on TEST: A) job 10,000.00, advance 8,000.00 invoiced, balance 2,000.00 paid as a "deposit";
// B) the work grew to 12,000.00; C) the work fell to 7,000.00 (below the advance). As accounts: the advance invoice is
// never the job's tax invoice, "Generate the final tax invoice" makes the final one, its PDF prints the three-line
// block, VAT once, the money page and the Invoices row show the job total, the advance, paid and balance.
//   node --env-file=.env.test.local tests/browser/test-final-invoice.mjs    (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { base, browserForId, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const proofDir = path.resolve("docs/proof/2026-11-21-final-invoice");
mkdirSync(proofDir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (url) => {
  const r = await fetch(url);
  if (!r.ok) return `HTTP ${r.status}`;
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText().asText();
  return { text: t.replace(/\s+/g, " "), buf };
};

const accountsRow = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const mm = (await sql("select m.id as make_id, (select id from public.vehicle_models where make_id = m.id limit 1) as model_id from public.vehicle_makes m where exists (select 1 from public.vehicle_models where make_id = m.id) limit 1"))[0];
const browsers = [];

/** One car: an approved quotation of `net` before VAT, an advance tax invoice of `adv`, and optional later money. */
async function seed(tag, n, net, adv, later) {
  const cust = (await sql(`insert into public.customers (customer_type, full_name, phone) values ('individual', $1, $2) returning id`, [`Final Invoice ${tag} E2e`, `+9715000000${80 + n}`]))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'U', $2, $3, $4, 2024, $5) returning id", [cust, `198${n}${n}`, mm.make_id, mm.model_id, `E2EFINALINV00000${n}`]))[0].id;
  const job = (await sql("insert into public.jobs (vehicle_id, customer_id, stage, status, gated_in_by, is_open, advisor_id, created_by, updated_by) values ($1, $2, 'ready', 'ready', $3, true, $3, $3, $3) returning id, job_number", [car, cust, advisor.id]))[0];
  const total = Math.round(net * 1.05 * 100) / 100;
  const q = (await sql("insert into public.quotations (kind, job_id, customer_id, vehicle_id, status, validity_days, vat_percent, total_aed, created_by, updated_by) values ('quotation', $1, $2, $3, 'draft', 7, 5, $4, $5, $5) returning id, number", [job.id, cust, car, total, advisor.id]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, price_per, line_total, created_by, updated_by) values ($1, 1, 'package', 'COMPLETE WORK AS APPROVED', 'manual', 1, $2, 'job', $2, $3, $3)", [q.id, net, advisor.id]);
  await sql("update public.quotations set status = 'approved', responded_at = now(), approver_name = 'E2E' where id = $1", [q.id]);
  const advNet = Math.round((adv / 1.05) * 100) / 100;
  const advVat = Math.round((adv - advNet) * 100) / 100;
  const advInv = (await sql("insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, issued_by, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, deposit_for_quotation_id, issue_reason, created_by, updated_by) values ($1, 'tax_invoice', $2, $3, $4, 'issued', '2026-11-16T09:27:00Z', $5, $6, $7, 0, $7, $8, $9, $10, 'Advance payment against the quotation', $5, $5) returning id, number", [`E2E-INV-ADV${n}`, job.id, cust, car, advisor.id, `e2efinaladv${n}${Date.now()}`, advNet, advVat, adv, q.id]))[0];
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, details, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'ADVANCE PAYMENT', 'VAT included in this amount', 1, $2, $2, $3, $4, 0)", [advInv.id, advNet, advVat, adv]);
  await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, received_at, received_by, status, deposit_invoice_number, deposit_quotation_id, created_by, updated_by) values ($1, $2, $3, 'cash', $4, '2026-11-16T09:22:00Z', $5, 'recorded', $6, $7, $5, $5)", [job.id, advInv.id, cust, adv, accountsRow.id, advInv.number, q.id]);
  if (later) await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, received_at, received_by, status, is_deposit, deposit_quotation_id, created_by, updated_by) values ($1, null, $2, 'cash', $3, now(), $4, 'recorded', true, $5, $4, $4)", [job.id, cust, later, accountsRow.id, q.id]);
  return { job, cust, car, q, advInv, total };
}

cleanupDb();
try {
  const A = await seed("A", 1, 9523.81, 8000, 2000);
  const B = await seed("B", 2, 11428.57, 8000, null);
  const C = await seed("C", 3, 6666.67, 8000, null);
  check("seed: three jobs at Ready with an advance tax invoice of 8,000.00", !!A.job.id && !!B.job.id && !!C.job.id, `${A.job.job_number} ${B.job.job_number} ${C.job.job_number}`);

  const acc = await browserForId(accountsRow.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(acc);
  const p = acc.page;

  /* ---------- A. 10,000 job, 8,000 advance invoiced, 2,000 paid as a "deposit" ---------- */
  await go(p, `${base}/jobs/${A.job.id}/invoice`);
  const stepState = async (k) => p.locator(`[data-step="${k}"]`).getAttribute("data-state").catch(() => null);
  check("A1: the steps read Proforma > Advance payment > Advance tax invoice > Job done > Final tax invoice > Balance payment > Gate-out", (await p.locator("[data-money-bar] [data-step]").allTextContents()).map((t) => t.replace(/[✓ⓘ\s]+/g, " ").trim()).join(" > ") === "Proforma > Advance payment > Advance tax invoice > Job done > Final tax invoice > Balance payment > Gate-out", (await p.locator("[data-money-bar] [data-step]").allTextContents()).join("|"));
  check("A2: the final tax invoice is the current step (not ticked); gate-out is not open", (await stepState("final_invoice")) === "current" && (await stepState("gate_out")) === "later");
  check("A3: the job total is 10,000.00 and the advance invoiced 8,000.00 (INV-…)", /10,000\.00/.test((await p.locator("[data-job-total]").textContent()) ?? "") && /8,000\.00/.test((await p.locator("[data-advance-invoiced]").textContent()) ?? ""));
  check("A4: no 'Gate out' offer, no 'Tax invoice' tick", !(await p.getByRole("link", { name: "Gate out" }).count()) && (await stepState("final_invoice")) !== "done");
  await p.screenshot({ path: path.join(proofDir, "a1-money-page-before-1440.png"), fullPage: true });
  await p.locator('[data-confirm-open="generate-final"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  const done = await until(async () => (await p.locator("[data-generate-final-done]").count()) ? (await p.locator("[data-generate-final-done]").textContent()) : null, 60, 500);
  check("A5: 'Generate the final tax invoice' answers next to the button", !!done, done ?? ((await p.locator("[data-generate-final-error]").textContent().catch(() => "")) ?? ""));
  const fin = await until(async () => (await sql("select id, number, token, taxable_aed::float as taxable, vat_aed::float as vat, total_aed::float as total from public.invoices where job_id = $1 and kind = 'tax_invoice' and deposit_for_quotation_id is null and status = 'issued' and is_active", [A.job.id]))[0], 40, 500);
  check("A6: the final tax invoice carries the whole job (9,523.81 + VAT 476.19 = 10,000.00)", !!fin && fin.taxable === 9523.81 && fin.vat === 476.19 && fin.total === 10000, JSON.stringify(fin));
  const advRow = (await sql("select converted_to from public.invoices where id = $1", [A.advInv.id]))[0];
  const pays = await sql("select number, invoice_id from public.payments where job_id = $1 and status = 'recorded'", [A.job.id]);
  check("A7: the advance invoice is folded and both payments are on the final tax invoice", !!advRow.converted_to && pays.every((x) => x.invoice_id === fin?.id), JSON.stringify(pays));
  const { text: t, buf } = await pdfText(`${base}/api/pdf/invoice/${fin.token}`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(proofDir, "a-final-tax-invoice.pdf"), buf);
  check("A8: PDF prints TOTAL VALUE OF THE WORK 9,523.81 + VAT 5% 476.19 = 10,000.00", /TOTAL VALUE OF THE WORK 9,523\.81 \+ VAT 5% 476\.19 AED 10,000\.00/i.test(t), t.slice(t.search(/TOTAL VALUE/i) - 10, t.search(/TOTAL VALUE/i) + 260));
  check("A9: PDF prints LESS ADVANCE ALREADY INVOICED – TAX INVOICE E2E-INV-ADV1 (16 NOV 2026) 7,619.05 + VAT 380.95 − 8,000.00", /LESS ADVANCE ALREADY INVOICED – TAX INVOICE E2E-INV-ADV1 \(16 NOV 2026\) 7,619\.05 \+ VAT 380\.95 − AED 8,000\.00/i.test(t));
  check("A10: PDF prints THIS INVOICE TAXABLE 1,904.76 + VAT 95.24 = 2,000.00", /THIS INVOICE TAXABLE 1,904\.76 \+ VAT 95\.24 AED 2,000\.00/i.test(t));
  check("A11: VAT once: 380.95 + 95.24 = 476.19", 380.95 + 95.24 - 476.19 < 0.001 && /95\.24/.test(t));
  check("A12: the advance's own money is not counted again; the 2,000.00 paid closes it", !/LESS ADVANCE PAID/i.test(t) && /Paid .* Cash \(RCT-\d+\) − AED 2,000\.00/i.test(t) && /PAID IN FULL · BALANCE DUE AED 0\.00/i.test(t), t.slice(t.search(/THIS INVOICE/i), t.search(/THIS INVOICE/i) + 220));
  check("A13: amount in words is this invoice (two thousand)", /two thousand/i.test(t) && !/ten thousand dirhams/i.test(t));
  await go(p, `${base}/jobs/${A.job.id}/invoice`);
  check("A14: after: Final tax invoice ticked, Gate-out current", (await stepState("final_invoice")) === "done" && (await stepState("gate_out")) === "current");
  check("A15: the money page shows the final block (this invoice 2,000.00, paid in full)", /2,000\.00/.test((await p.locator('[data-final-value="this"]').textContent()) ?? "") && /0\.00/.test((await p.locator("[data-final-balance]").textContent()) ?? ""));
  await p.screenshot({ path: path.join(proofDir, "a2-money-page-after-1440.png"), fullPage: true });
  await p.setViewportSize({ width: 800, height: 1280 });
  await go(p, `${base}/jobs/${A.job.id}/invoice`);
  await p.screenshot({ path: path.join(proofDir, "a3-money-page-after-800.png"), fullPage: true });
  await p.setViewportSize({ width: 1440, height: 1000 });
  const prof = await until(async () => (await sql("select owner_report from public.jobs where id = $1", [A.job.id]))[0], 2, 100);
  void prof;

  /* ---------- B. the work grew to 12,000.00, nothing more paid ---------- */
  await go(p, `${base}/invoices?q=${encodeURIComponent("U 19822")}`);
  const rowB = p.locator(`[data-money-row="${B.job.id}"]`);
  check("B1: Invoices row (before): job total 12,000, advance invoiced 8,000 named", (await rowB.count()) === 1 && /12,000/.test((await rowB.locator("[data-money-job-total]").textContent()) ?? "") && /8,000/.test((await rowB.locator("[data-money-advance-invoiced]").textContent()) ?? ""), ((await rowB.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 300));
  check("B2: the row never calls the advance the job total ('Advance … paid in full' gone)", !/paid in full/i.test((await rowB.textContent()) ?? "") && /final tax invoice to generate/i.test((await rowB.textContent()) ?? ""));
  await p.screenshot({ path: path.join(proofDir, "b1-invoices-row-1440.png"), fullPage: true });
  await go(p, `${base}/jobs/${B.job.id}/invoice`);
  await p.locator('[data-confirm-open="generate-final"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  await until(async () => (await p.locator("[data-generate-final-done]").count()) > 0, 60, 500);
  const finB = (await sql("select token, total_aed::float as total from public.invoices where job_id = $1 and kind = 'tax_invoice' and deposit_for_quotation_id is null and status = 'issued'", [B.job.id]))[0];
  const tb = (await pdfText(`${base}/api/pdf/invoice/${finB?.token}`)).text;
  check("B3: higher total: THIS INVOICE 3,809.52 + VAT 190.48 = 4,000.00, balance due 4,000.00 (generated before payment)", /THIS INVOICE TAXABLE 3,809\.52 \+ VAT 190\.48 AED 4,000\.00/i.test(tb) && finB?.total === 12000, tb.slice(tb.search(/TOTAL VALUE/i), tb.search(/TOTAL VALUE/i) + 300));
  await go(p, `${base}/jobs/${B.job.id}/invoice`);
  check("B4: the step after the final invoice is the balance payment", (await stepState("final_invoice")) === "done" && (await stepState("balance")) === "current");
  await p.screenshot({ path: path.join(proofDir, "b2-money-page-balance-due-1440.png"), fullPage: true });

  /* ---------- C. the work fell to 7,000.00, below the 8,000.00 advance ---------- */
  await go(p, `${base}/jobs/${C.job.id}/invoice`);
  await p.locator('[data-confirm-open="generate-final"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  await until(async () => (await p.locator("[data-generate-final-done]").count()) > 0, 60, 500);
  const finC = (await sql("select token, total_aed::float as total from public.invoices where job_id = $1 and kind = 'tax_invoice' and deposit_for_quotation_id is null and status = 'issued'", [C.job.id]))[0];
  const tc = (await pdfText(`${base}/api/pdf/invoice/${finC?.token}`)).text;
  check("C1: lower than the advance: THIS INVOICE 0.00 (never negative)", /THIS INVOICE TAXABLE 0\.00 \+ VAT 0\.00 AED 0\.00/i.test(tc) && !/− ?AED -/.test(tc), tc.slice(tc.search(/TOTAL VALUE/i), tc.search(/TOTAL VALUE/i) + 400));
  check("C2: the 1,000.00 above the work is the customer's credit (refund or keep)", /CUSTOMER CREDIT \(REFUND OR KEEP\) incl\. VAT 47\.62 AED 1,000\.00/i.test(tc));
  await go(p, `${base}/jobs/${C.job.id}/invoice`);
  await p.screenshot({ path: path.join(proofDir, "c1-money-page-credit-1440.png"), fullPage: true });

  /* ---------- D. the customer's page shows the same block ---------- */
  const custTok = (await sql("select token from public.invoices where job_id = $1 and kind = 'tax_invoice' and deposit_for_quotation_id is null", [A.job.id]))[0].token;
  await go(p, `${base}/invoice/${custTok}`);
  check("D1: the customer's invoice page shows the three rows", (await p.locator("[data-final-row]").count()) >= 4 && /2,000\.00/.test((await p.locator('[data-final-value="this"]').textContent()) ?? ""));
  await p.setViewportSize({ width: 800, height: 1280 });
  await p.screenshot({ path: path.join(proofDir, "d1-customer-page-800.png"), fullPage: true });

  /* ---------- E. the advance invoice no longer says "VAT included" beside the before-VAT amount ---------- */
  const tAdv = (await pdfText(`${base}/api/pdf/invoice/${(await sql("select token from public.invoices where id = $1", [A.advInv.id]))[0].token}`)).text;
  check("E1: the advance tax invoice PDF has no 'VAT included in this amount'", !/VAT included in this amount/i.test(tAdv) && /7,619\.05/.test(tAdv));
} catch (e) {
  check("no crash", false, String(e?.stack ?? e));
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
