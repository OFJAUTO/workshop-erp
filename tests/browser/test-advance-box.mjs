// THE PAYMENTS BOX (16 November 2026, Section 2; case E-00082 / PRO-00029 / J-01013): on every estimate and on the
// job it becomes. An advance is recorded from the box with NO proforma (the payment makes the proforma, the receipt
// and the advance tax invoice), more than asked stays as the customer's advance, an advisor gets "Tell accounts", a
// HELD job keeps the money on the estimate, the job card shows the same box, and the final tax invoice PDF prints
// "LESS ADVANCE PAID (INV-…)".
//   node --env-file=.env.test.local tests/browser/test-advance-box.mjs    (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, makeChecks, pressRecord, sleep, sql } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const proofDir = path.resolve("docs/proof/2026-11-16-advance-box");
mkdirSync(proofDir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (url) => {
  const r = await fetch(url);
  if (!r.ok) return `HTTP ${r.status}`;
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText().asText();
  return t.replace(/\s+/g, " ");
};
const dialog = (page) => page.locator("[data-record-payment-dialog]");
async function pay(page, { method, amount }) {
  const d = dialog(page);
  await d.locator(`[data-method="${method}"]`).click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
  await pressRecord(d);
  const done = await until(async () => ((await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null), 50, 500);
  if (!done) console.log("   window says:", (((await d.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ")).slice(-400));
  const words = ((await d.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  await page.keyboard.press("Escape");
  await until(async () => (await dialog(page).count()) === 0, 20, 300);
  return { done, words };
}

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const accountsRow = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const mm = (await sql("select m.id as make_id, (select id from public.vehicle_models where make_id = m.id limit 1) as model_id from public.vehicle_makes m where exists (select 1 from public.vehicle_models where make_id = m.id) limit 1"))[0];
const browsers = [];

cleanupDb();
try {
  await api("/api/e2e/stage", { stage: "assign" });
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'Advance Box E2e', '+971500000097') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'ZA', '90097', $2, $3, 2024, 'E2EADVBOX00000097') returning id", [cust, mm.make_id, mm.model_id]))[0].id;
  const mkEstimate = async (title, total) => {
    const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, vat_percent, total_aed, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, 5, $3, $4, $4) returning id, number", [cust, car, total, advisor.id]))[0];
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', $2, 'manual', 1, 4, 500, 2000, $3, $3)", [est.id, title, advisor.id]);
    await sql("update public.quotations set status = 'approved', responded_at = now(), approver_name = 'E2E' where id = $1", [est.id]);
    return est;
  };
  const e1 = await mkEstimate("E2E ADVANCE BOX ONE", 2100);
  const e2 = await mkEstimate("E2E ADVANCE BOX TWO", 2100);
  check("seed: two accepted estimates (2,100.00 each)", !!e1.number && !!e2.number, `${e1.number}, ${e2.number}`);

  /* ---------- A. Accounts: no proforma, NOT RECEIVED YET, record an advance from the box ---------- */
  const acc = await browserForId(accountsRow.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(acc);
  await go(acc.page, `${base}/estimates/${e1.id}`);
  const box = acc.page.locator('[data-advance-box="estimate"]');
  check("A1: the PAYMENTS box is on the estimate", (await box.count()) === 1);
  check("A2: NOT RECEIVED YET in red, no proforma yet", (await box.locator("[data-advance-not-received]").count()) === 1 && /No proforma yet/.test((await box.textContent()) ?? ""));
  await acc.page.screenshot({ path: path.join(proofDir, "a1-estimate-not-received-1440.png"), fullPage: true });
  await box.locator("[data-record-payment-open]").click();
  await dialog(acc.page).waitFor({ timeout: 20000 });
  const sel = await until(async () => (await dialog(acc.page).locator(`[data-pay-target="est:${e1.id}"]`).count()) ? true : null, 30, 500);
  check("A3: the window offers the estimate itself (no proforma yet)", !!sel);
  const methodPre = await dialog(acc.page).locator('[data-method][aria-pressed="true"], [data-method][data-selected="true"], input[name="method"]:checked').count();
  check("A4: no method is pre-selected", methodPre === 0, String(methodPre));
  const a = await pay(acc.page, { method: "cash", amount: 1000 });
  check("A5: recorded from the box", !!a.done, a.words.slice(0, 200));
  const docs = await until(async () => {
    const r = await sql("select kind, number, total_aed::float as total, issue_reason, converted_to from public.invoices where estimate_id = $1 and is_active order by created_at", [e1.id]);
    return r.some((x) => x.kind === "tax_invoice") ? r : null;
  }, 40, 500);
  check("A6: the payment made a partial proforma of 1,000.00 and the advance tax invoice", !!docs && docs.some((d) => d.kind === "proforma" && d.total === 1000 && /partial/i.test(d.issue_reason ?? "")) && docs.some((d) => d.kind === "tax_invoice" && d.total === 1000), JSON.stringify(docs));
  const rct = (await sql("select number, deposit_invoice_number, deposit_quotation_id from public.payments where invoice_id in (select id from public.invoices where estimate_id = $1) and is_active", [e1.id]))[0];
  check("A7: the receipt is an advance with its tax invoice", !!rct?.number && !!rct?.deposit_invoice_number, JSON.stringify(rct));
  await go(acc.page, `${base}/estimates/${e1.id}`);
  const box2 = acc.page.locator('[data-advance-box="estimate"]');
  check("A8: the box shows the receipt, received, advance fully in", (await box2.getAttribute("data-advance-state")) === "received" && (await box2.locator(`[data-advance-receipt="${rct?.number}"]`).count()) === 1 && (await box2.locator('[data-advance-left="0.00"]').count()) === 1);
  check("A9: the balance of the estimate is 1,100.00", (await box2.locator('[data-advance-balance="1100.00"]').count()) === 1, await box2.locator("[data-advance-balance]").getAttribute("data-advance-balance"));
  await acc.page.screenshot({ path: path.join(proofDir, "a2-estimate-received-1440.png"), fullPage: true });
  await acc.page.setViewportSize({ width: 800, height: 1280 });
  await go(acc.page, `${base}/estimates/${e1.id}`);
  await acc.page.screenshot({ path: path.join(proofDir, "a3-estimate-received-800.png"), fullPage: true });
  await acc.page.setViewportSize({ width: 1440, height: 1000 });

  /* ---------- B. More than the proforma asks: the extra stays as the customer's advance ---------- */
  await go(acc.page, `${base}/estimates/${e2.id}`);
  await acc.page.locator('[data-em-mode="partial"]').click();
  if (await acc.page.locator('[data-em-partial-kind="aed"]').count()) await acc.page.locator('[data-em-partial-kind="aed"]').click();
  await acc.page.locator("[data-em-partial-value]").fill("500");
  await acc.page.locator("[data-em-issue]").click();
  const pro2 = await until(async () => (await sql("select id, number, total_aed::float as total from public.invoices where estimate_id = $1 and kind = 'proforma' and status = 'issued' and is_active", [e2.id]))[0], 40, 500);
  check("B1: a 500.00 proforma was asked", pro2?.total === 500, JSON.stringify(pro2));
  await acc.page.locator("[data-send-message]").waitFor({ timeout: 15000 }).catch(() => {});
  await acc.page.keyboard.press("Escape");
  await go(acc.page, `${base}/estimates/${e2.id}`);
  check("B2: the box names PRO and says NOT RECEIVED YET", (await acc.page.locator(`[data-advance-ask="${pro2?.number}"]`).count()) === 1 && (await acc.page.locator('[data-advance-box="estimate"] [data-advance-not-received]').count()) === 1);
  await acc.page.screenshot({ path: path.join(proofDir, "b1-proforma-asked-1440.png"), fullPage: true });
  await acc.page.locator('[data-advance-box="estimate"] [data-record-payment-open]').click();
  await dialog(acc.page).waitFor({ timeout: 20000 });
  await until(async () => (await dialog(acc.page).locator(`[data-pay-target="inv:${pro2?.id}"]`).count()) ? true : null, 30, 500);
  const b = await pay(acc.page, { method: "cash", amount: 700 });
  check("B3: recorded", !!b.done, b.words.slice(0, 200));
  const extra = await until(async () => (await sql("select number, amount_aed::float as amount from public.payments where customer_id = $1 and invoice_id is null and job_id is null and is_active and notes ilike 'Extra paid on ' || $2 || ' %'", [cust, e2.number]))[0], 30, 500);
  const onPro = (await sql("select coalesce(sum(amount_aed),0)::float as s from public.payments where invoice_id in (select id from public.invoices where estimate_id = $1) and is_active", [e2.id]))[0].s;
  check("B4: 500.00 on the proforma, 200.00 kept as the customer's advance", onPro === 500 && extra?.amount === 200, `${onPro} / ${JSON.stringify(extra)}`);
  await go(acc.page, `${base}/estimates/${e2.id}`);
  check("B5: the box names the extra", (await acc.page.locator('[data-advance-box="estimate"] [data-advance-extra]').count()) === 1 || /kept as the customer/i.test((await acc.page.locator('[data-advance-box="estimate"]').textContent()) ?? ""));

  /* ---------- C. An advisor: Tell accounts, never Record ---------- */
  const adv = await browserForId(advisor.id, { viewport: { width: 800, height: 1280 } });
  browsers.push(adv);
  const e3 = await mkEstimate("E2E ADVANCE BOX THREE", 2100);
  await go(adv.page, `${base}/estimates/${e3.id}`);
  const advBox = adv.page.locator('[data-advance-box="estimate"]');
  check("C1: the advisor sees the box with Tell accounts", (await advBox.locator("[data-payment-report-open]").count()) === 1 && /Tell accounts: payment received/.test((await advBox.textContent()) ?? ""));
  check("C2: the advisor has no Record button in it", (await advBox.locator("[data-record-payment-open]").count()) === 0);
  await adv.page.screenshot({ path: path.join(proofDir, "c1-advisor-tell-accounts-800.png"), fullPage: true });

  /* ---------- D. A HELD job keeps the money on the estimate; a real job shows the box on the job card ---------- */
  const held = (await sql("insert into public.jobs (vehicle_id, customer_id, stage, status, priority, department, gated_in_by, stage_entered_at, is_open, estimate_id, created_by, updated_by) values ($1, $2, 'quote', 'booked', 'normal', 'mechanical', $3, now(), false, $4, $3, $3) returning id, job_number", [car, cust, owner.id, e3.id]))[0];
  await go(acc.page, `${base}/estimates/${e3.id}`);
  check("D1: held job: the box stays on the estimate and says held", (await acc.page.locator('[data-advance-box="estimate"] [data-advance-held]').count()) === 1 && (await acc.page.locator('[data-advance-box="estimate"] [data-record-payment-open]').count()) === 1);
  const d = await (async () => { await acc.page.locator('[data-advance-box="estimate"] [data-record-payment-open]').click(); await dialog(acc.page).waitFor({ timeout: 20000 }); await until(async () => (await dialog(acc.page).locator(`[data-pay-target="est:${e3.id}"]`).count()) ? true : null, 30, 500); return pay(acc.page, { method: "cash", amount: 800 }); })();
  check("D2: recorded on the held car's estimate", !!d.done, d.words.slice(0, 200));
  const heldDocs = await until(async () => (await sql("select count(*)::int as n from public.invoices where estimate_id = $1 and job_id is null and kind = 'tax_invoice' and is_active", [e3.id]))[0].n === 1, 30, 500);
  check("D3: the money stayed on the estimate (not moved onto the held job)", !!heldDocs);
  // The car arrives: the job opens (the same J-number) and the money follows.
  await sql("update public.jobs set status = 'in_inspection', stage = 'inspection', is_open = true where id = $1", [held.id]);
  await go(acc.page, `${base}/estimates/${e3.id}`);
  const link = acc.page.locator('[data-advance-box="estimate"] [data-advance-job-link]');
  check("D4: the estimate says Payments are on J-…", (await link.count()) === 1 && new RegExp(held.job_number).test((await link.textContent()) ?? ""));
  const own = await browserForId(owner.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(own);
  await go(own.page, `${base}/jobs/${held.id}`);
  const jobBox = own.page.locator('[data-advance-box="job"]');
  const rct3 = (await sql("select number from public.payments where invoice_id in (select id from public.invoices where estimate_id = $1) and is_active", [e3.id]))[0]?.number;
  check("D5: the job card shows the same box with the receipt", (await jobBox.count()) === 1 && (await jobBox.locator(`[data-advance-receipt="${rct3}"]`).count()) === 1);
  await own.page.screenshot({ path: path.join(proofDir, "d1-job-card-box-1440.png"), fullPage: true });
  await own.page.setViewportSize({ width: 800, height: 1280 });
  await go(own.page, `${base}/jobs/${held.id}`);
  await own.page.screenshot({ path: path.join(proofDir, "d2-job-card-box-800.png"), fullPage: true });

  /* ---------- E. The final tax invoice: LESS ADVANCE PAID (INV-…) ---------- */
  const tok = `e2eadv${Date.now().toString(36)}`;
  const fin = (await sql("insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, issued_by, created_by, updated_by) values ($1, 'tax_invoice', $2, $3, $4, 'issued', now(), $5, 'itemised', 2000, 0, 2000, 100, 2100, $6, $6, $6) returning id", [`E2E-INV-ADV-${Date.now().toString(36).slice(-4)}`, held.id, cust, car, tok, owner.id]))[0];
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, created_by, updated_by) values ($1, 1, 'services', 'E2E ADVANCE BOX THREE', 1, 2000, 2000, 100, 2100, 0, $2, $2)", [fin.id, owner.id]);
  const advInv = (await sql("select deposit_invoice_number from public.payments where invoice_id in (select id from public.invoices where estimate_id = $1) and is_active", [e3.id]))[0]?.deposit_invoice_number;
  await sql("update public.payments set invoice_id = $1, job_id = $2 where deposit_invoice_number = $3", [fin.id, held.id, advInv]);
  const txt = await pdfText(`${base}/api/pdf/invoice/${tok}`);
  check("E1: the final tax invoice prints LESS ADVANCE PAID (INV-…)", new RegExp(`LESS ADVANCE PAID \\(${advInv}\\)`, "i").test(txt), txt.slice(txt.search(/ADVANCE|Paid/i) - 40, txt.search(/ADVANCE|Paid/i) + 120));
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
