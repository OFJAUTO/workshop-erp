// MONEY FROM THE ESTIMATE, part 1 (4 November 2026; case E-00061 / LARS): a COMPLETE proforma with the
// bill-to block from an approved estimate -> bank transfer recorded -> the full tax invoice issues itself;
// a PARTIAL (50%) proforma -> paid -> the ADVANCE tax invoice (VAT inside, deposit document, never posted
// to Zoho as an invoice); void with a reason; badges and filters on /estimates; the money list's
// "Car not here yet" row; the job-less receipt shows Paid in full and the car.
//   node --env-file=.env.test.local tests/browser/test-estmoney1.mjs    (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserForId, chooseInspectionFee, cleanupDb, go, here, makeChecks, pressRecord, sleep, sql } from "./pw-lib.mjs";

const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "estmoney");
mkdirSync(dir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGNgYGD4z4AGMAXIVQEAvqgD/aXCeBkAAAAASUVORK5CYII=", "base64");
const pdfText = async (url, cookies = "") => {
  const r = await fetch(url, { headers: cookies ? { cookie: cookies } : {} });
  if (!r.ok) return `HTTP ${r.status}`;
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText().asText();
  return t.replace(/\s+/g, " ");
};
const dialog = (page) => page.locator("[data-record-payment-dialog]");
/** The Send window opens a beat after Issue: wait for it, then close it and wait until it is gone. */
const closeSend = async (page) => {
  await page.locator("[data-send-message]").waitFor({ timeout: 15000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await until(async () => (await page.locator("[data-send-message]").count()) === 0, 20, 300);
};

/** The one payment-window helper (mirrors test-payanytime): pick the target, method, amount, proof, Record. */
async function pay(page, { target, method, amount, proof = false, reference = null }) {
  const d = dialog(page);
  if (target) await d.locator(`[data-pay-target="${target}"]`).click();
  await d.locator(`[data-method="${method}"]`).click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
  if (reference && (await d.locator('input[name="reference"]').count())) await d.locator('input[name="reference"]').fill(reference);
  if (proof) {
    const queued = d.locator('[data-job-file-upload] input[type="file"]');
    if (await queued.count()) {
      await queued.first().setInputFiles({ name: "transfer-proof.png", mimeType: "image/png", buffer: png });
      await until(async () => (await d.locator("[data-proof-missing]").count()) === 0, 60, 500);
    } else await d.locator("[data-proof-input]").setInputFiles({ name: "transfer-proof.png", mimeType: "image/png", buffer: png });
  }
  await pressRecord(d);
  const done = await until(async () => ((await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null), 50, 500);
  if (!done) console.log("   window says:", (((await d.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ")).slice(-400));
  return done;
}

const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const accountsRow = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const mm = (await sql("select m.id as make_id, (select id from public.vehicle_models where make_id = m.id limit 1) as model_id from public.vehicle_makes m where exists (select 1 from public.vehicle_models where make_id = m.id) limit 1"))[0];
const browsers = [];

cleanupDb();
try {
  await api("/api/e2e/stage", { stage: "assign" }); // a seed so the shared helpers have their staff rows
  const cust = (await sql("insert into public.customers (customer_type, full_name, company_name, phone, trn) values ('company', 'Lars Petersen E2e', 'E2E LARS TRADING', '+971500000094', null) returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'M', '92978', $2, $3, 2023, 'E2EESTMONEYVIN01X') returning id", [cust, mm.make_id, mm.model_id]))[0].id;
  const mkEstimate = async (title, hours, rate, total) => {
    const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, vat_percent, total_aed, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, 5, $3, $4, $4) returning id, number", [cust, car, total, advisor.id]))[0];
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', $2, 'manual', 1, $3, $4, $5, $6, $6)", [est.id, title, hours, rate, hours * rate, advisor.id]);
    await sql("update public.quotations set status = 'approved', responded_at = now(), approver_name = 'LARS' where id = $1", [est.id]);
    return est;
  };
  // Lines 2,000 net -> VAT 100 -> total 2,100 (the figures the proforma must land on).
  const e1 = await mkEstimate("E2E MAJOR SERVICE", 4, 500, 2100);
  const e2 = await mkEstimate("E2E GEARBOX REPAIR", 4, 500, 2100);
  const seedLines = await sql("select quotation_id, count(*)::int as n from public.quotation_lines where quotation_id in ($1, $2) group by quotation_id", [e1.id, e2.id]);
  check("seed: two accepted estimates with their lines", !!e1.number && !!e2.number && seedLines.length === 2 && seedLines.every((r) => r.n === 1), `${e1.number}, ${e2.number} · lines ${JSON.stringify(seedLines)}`);

  /* ---------- A. COMPLETE proforma with the bill-to block (advisor) ---------- */
  const adv = await browserForId(advisor.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(adv);
  await go(adv.page, `${base}/estimates/${e1.id}`);
  check("A1: the money card is on the estimate page", (await adv.page.locator("[data-em-card]").count()) === 1);
  await adv.page.locator('[data-em-mode="complete"]').click();
  await adv.page.locator("[data-em-billto-company]").fill("E2E LARS TRADING LLC");
  await adv.page.locator("[data-em-billto-trn]").fill("100200300400500");
  await adv.page.locator("[data-em-billto-attention]").fill("Lars Petersen");
  await adv.page.locator("[data-em-billto-po]").fill("PO-7781");
  await adv.page.locator("[data-em-billto-address]").fill("JLT Cluster F, Dubai");
  await adv.page.screenshot({ path: path.join(dir, "a1-create-complete.png"), fullPage: true });
  await adv.page.locator("[data-em-issue]").click();
  const pro1 = await until(async () => (await sql("select id, number, token, total_aed::float as total, (bill_to->>'company') as co, (bill_to->>'po_number') as po, valid_until::text as vu, issue_reason from public.invoices where estimate_id = $1 and kind = 'proforma' and is_active", [e1.id]))[0], 20, 500);
  if (!pro1) console.log("   card says:", ((await adv.page.locator("[data-em-error]").textContent().catch(() => "")) ?? "(no error shown)") || "(no error shown)", "|", ((await adv.page.locator("[data-em-card]").textContent().catch(() => "")) ?? "").slice(0, 300));
  check("A2: the proforma is saved with the bill-to and valid-until", !!pro1 && pro1.total === 2100 && pro1.co === "E2E LARS TRADING LLC" && pro1.po === "PO-7781" && !!pro1.vu && /complete/i.test(pro1.issue_reason ?? ""), JSON.stringify(pro1));
  if (!pro1) throw new Error("no proforma - stopping early");
  const pro1Lines = await sql("select description, amount_aed::float as net, vat_aed::float as vat from public.invoice_lines where invoice_id = $1 and is_active", [pro1.id]);
  check("A3: the proforma carries the estimate's own line", pro1Lines.length === 1 && pro1Lines[0].net === 2000 && pro1Lines[0].vat === 100, JSON.stringify(pro1Lines));
  check("A4: the send window opened with the filled message", await until(async () => /Send proforma/i.test((await adv.page.textContent("body")) ?? ""), 20, 300));
  await adv.page.screenshot({ path: path.join(dir, "a2-send-dialog.png") });
  await closeSend(adv.page);
  const custPage = await fetch(`${base}/proforma/${pro1.token}`).then((r) => r.text());
  check("A5: the customer page shows the reference, valid-until and bill-to", new RegExp(e1.number).test(custPage) && /Valid until/i.test(custPage) && /E2E LARS TRADING LLC/i.test(custPage) && /100200300400500/.test(custPage) && /PO-7781/.test(custPage));
  const proPdf = await pdfText(`${base}/api/pdf/invoice/${pro1.token}`);
  check("A6: the PDF reads PROFORMA INVOICE with the bill-to and the not-a-tax-invoice words", /PROFORMA INVOICE/i.test(proPdf) && /E2E LARS TRADING LLC/i.test(proPdf) && /TRN 100200300400500/i.test(proPdf) && /PO-7781/.test(proPdf) && /not a tax invoice/i.test(proPdf), proPdf.slice(0, 160));
  check("A7: the page shows Proforma sent – unpaid", await until(async () => { await adv.page.reload({ waitUntil: "load" }); return (await adv.page.locator('[data-em-badge="Proforma sent – unpaid"]').count()) === 1; }, 5, 800));

  /* ---------- B. Bank transfer recorded -> the FULL tax invoice issues itself ---------- */
  const acc = await browserForId(accountsRow.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(acc);
  await go(acc.page, `${base}/estimates/${e1.id}`);
  await acc.page.locator("[data-record-payment-open]").first().click();
  await dialog(acc.page).waitFor({ timeout: 15000 });
  await until(async () => (await dialog(acc.page).locator("[data-pay-targets]").count()) > 0, 40, 300);
  check("B1: the window offers the estimate's proforma by itself", (await dialog(acc.page).locator(`[data-pay-target="inv:${pro1.id}"]`).count()) === 1);
  const rct1 = await pay(acc.page, { target: `inv:${pro1.id}`, method: "transfer", amount: 2100, proof: true, reference: "TRF-E2E-61" });
  check("B2: the transfer is recorded", !!rct1, rct1 ?? "no receipt");
  const tax1 = await until(async () => (await sql("select id, number, token, total_aed::float as total, converted_from, deposit_for_quotation_id, (bill_to->>'company') as co from public.invoices where estimate_id = $1 and kind = 'tax_invoice' and is_active", [e1.id]))[0]);
  check("B3: the FULL tax invoice issued itself from the paid proforma", !!tax1 && tax1.total === 2100 && tax1.converted_from === pro1.id && !tax1.deposit_for_quotation_id && tax1.co === "E2E LARS TRADING LLC", JSON.stringify(tax1));
  const moved = await sql("select count(*)::int as n from public.payments where invoice_id = $1 and is_active", [tax1.id]);
  const closed = (await sql("select converted_to from public.invoices where id = $1", [pro1.id]))[0];
  check("B4: the payment moved onto it and the proforma is closed", moved[0].n === 1 && closed.converted_to === tax1.id);
  const zoho1 = await sql("select kind from public.zoho_outbox where record_id = $1", [tax1.id]);
  check("B5: the tax invoice joined the Zoho outbox (manual sync sends it)", zoho1.some((z) => z.kind === "invoice"), JSON.stringify(zoho1));
  const pay1 = (await sql("select id, token from public.payments where invoice_id = $1 limit 1", [tax1.id]))[0];
  const rcpt = await pdfText(`${base}/api/pdf/receipt/${pay1.id}?p=${pay1.token}`);
  check("B6: the job-less receipt shows PAID IN FULL and the car", /Paid in full/i.test(rcpt) && /92978/.test(rcpt), rcpt.slice(0, 200));
  check("B7: the estimate page reads Prepaid", await until(async () => { await go(acc.page, `${base}/estimates/${e1.id}`); return (await acc.page.locator('[data-em-badge="Prepaid"]').count()) === 1; }, 5, 800));
  await acc.page.screenshot({ path: path.join(dir, "b1-prepaid.png"), fullPage: true });
  const taxPdf = await pdfText(`${base}/api/pdf/invoice/${tax1.token}`);
  check("B8: the tax invoice PDF carries TAX INVOICE, the reference and the customer's TRN", /TAX INVOICE/i.test(taxPdf) && new RegExp(e1.number).test(taxPdf) && /TRN 100200300400500/i.test(taxPdf), taxPdf.slice(0, 160));

  /* ---------- C. PARTIAL 50%: void first (with a reason), then paid -> ADVANCE tax invoice ---------- */
  await go(adv.page, `${base}/estimates/${e2.id}`);
  await adv.page.locator('[data-em-mode="partial"]').click();
  await adv.page.locator('[data-em-partial-kind="percent"]').click();
  await adv.page.locator("[data-em-partial-value]").pressSequentially("50", { delay: 15 });
  await adv.page.locator("[data-em-issue]").click();
  const pro2a = await until(async () => (await sql("select id, number, total_aed::float as total from public.invoices where estimate_id = $1 and kind = 'proforma' and status = 'issued' and is_active", [e2.id]))[0]);
  check("C1: the partial proforma is half the bill (VAT inside)", !!pro2a && pro2a.total === 1050, JSON.stringify(pro2a));
  await closeSend(adv.page);
  // Void it (owner/accounts only): the advisor has no Void button; accounts void with a reason.
  await go(adv.page, `${base}/estimates/${e2.id}`);
  check("C2: the advisor has no Void button", (await adv.page.locator("[data-em-void]").count()) === 0);
  await go(acc.page, `${base}/estimates/${e2.id}`);
  await acc.page.locator("[data-em-void]").click();
  await acc.page.locator("[data-em-void-reason]").fill("Wrong amount, reissuing");
  await acc.page.locator("[data-em-void-save]").click();
  const voided = await until(async () => (await sql("select status, issue_reason from public.invoices where id = $1 and status = 'cancelled'", [pro2a.id]))[0]);
  check("C3: the unpaid proforma is voided with the reason (logged)", !!voided && /Wrong amount/.test(voided.issue_reason ?? ""));
  // Re-issue 50% and pay it: the ADVANCE tax invoice follows by itself.
  await go(acc.page, `${base}/estimates/${e2.id}`);
  await acc.page.locator('[data-em-mode="partial"]').click();
  await acc.page.locator('[data-em-partial-kind="percent"]').click();
  await acc.page.locator("[data-em-partial-value]").pressSequentially("50", { delay: 15 });
  await acc.page.locator("[data-em-issue]").click();
  const pro2 = await until(async () => (await sql("select id, number, total_aed::float as total from public.invoices where estimate_id = $1 and kind = 'proforma' and status = 'issued' and is_active and converted_to is null", [e2.id]))[0]);
  check("C4: the partial proforma is out again", !!pro2 && pro2.total === 1050);
  await closeSend(acc.page);
  await acc.page.locator("[data-record-payment-open]").first().click();
  await dialog(acc.page).waitFor({ timeout: 15000 });
  await until(async () => (await dialog(acc.page).locator("[data-pay-targets]").count()) > 0, 40, 300);
  const rct2 = await pay(acc.page, { target: `inv:${pro2.id}`, method: "transfer", amount: 1050, proof: true, reference: "TRF-E2E-62" });
  check("C5: the 50% transfer is recorded", !!rct2);
  const tax2 = await until(async () => (await sql("select id, number, total_aed::float as total, taxable_aed::float as taxable, vat_aed::float as vat, deposit_for_quotation_id, issue_reason from public.invoices where estimate_id = $1 and kind = 'tax_invoice' and is_active", [e2.id]))[0]);
  check("C6: the ADVANCE tax invoice issued itself, VAT inside the amount", !!tax2 && tax2.total === 1050 && tax2.taxable === 1000 && tax2.vat === 50 && tax2.deposit_for_quotation_id === e2.id && /Advance payment against/i.test(tax2.issue_reason ?? ""), JSON.stringify(tax2));
  const adv2Lines = await sql("select description from public.invoice_lines where invoice_id = $1", [tax2.id]);
  check("C7: its one line names the estimate", adv2Lines.length === 1 && new RegExp(`ADVANCE PAYMENT AGAINST ESTIMATE ${e2.number}`).test(adv2Lines[0].description));
  const zoho2 = await sql("select kind from public.zoho_outbox where record_id = $1 and kind = 'invoice'", [tax2.id]);
  check("C8: the advance invoice is NEVER posted to Zoho as an invoice (the money is the advance)", zoho2.length === 0);
  check("C9: the estimate page reads Part paid", await until(async () => { await go(acc.page, `${base}/estimates/${e2.id}`); return (await acc.page.locator('[data-em-badge^="Part paid"]').count()) === 1; }, 5, 800));
  await acc.page.screenshot({ path: path.join(dir, "c1-part-paid-advance.png"), fullPage: true });

  /* ---------- D. The Estimates list badges + filters; the money list row ---------- */
  await go(adv.page, `${base}/estimates`);
  check("D1: the list shows Prepaid and Part paid badges", (await adv.page.locator('[data-em-list-badge="Prepaid"]').count()) >= 1 && (await adv.page.locator('[data-em-list-badge^="Part paid"]').count()) >= 1);
  check("D2: the list rows carry Paid X of Y", (await adv.page.locator("[data-em-list-paid]").count()) >= 2);
  await adv.page.screenshot({ path: path.join(dir, "d1-list-badges.png"), fullPage: true });
  await go(adv.page, `${base}/estimates?money=prepaid`);
  check("D3: the Prepaid filter keeps the prepaid one only", (await adv.page.locator(`[data-estimate-row="${e1.number}"]`).count()) >= 1 && (await adv.page.locator(`[data-estimate-row="${e2.number}"]`).count()) === 0);
  await go(adv.page, `${base}/estimates?money=part_paid`);
  check("D4: the Part paid filter keeps the half-paid one only", (await adv.page.locator(`[data-estimate-row="${e2.number}"]`).count()) >= 1 && (await adv.page.locator(`[data-estimate-row="${e1.number}"]`).count()) === 0);
  await go(acc.page, `${base}/invoices`);
  const estRow = acc.page.locator(`[data-money-row="estimate:${e2.id}"]`);
  check("D5: Invoices and payments shows the car-not-here row", (await estRow.count()) === 1 && /Car not here yet/.test((await estRow.textContent()) ?? ""), ((await estRow.textContent().catch(() => "")) ?? "").slice(0, 120));
  check("D6: the e1 row (paid in full) is on the list too", (await acc.page.locator(`[data-money-row="estimate:${e1.id}"]`).count()) === 1);
  await acc.page.screenshot({ path: path.join(dir, "d2-money-list.png"), fullPage: true });

  /* ---------- E. The advisor's payment link on the estimate (/p/ page, car not here yet) ---------- */
  // The advance proforma became its tax invoice: a NEW partial proforma for part of the rest carries the link.
  await go(adv.page, `${base}/estimates/${e2.id}`);
  await adv.page.locator('[data-em-mode="partial"]').click();
  await adv.page.locator('[data-em-partial-kind="aed"]').click();
  await adv.page.locator("[data-em-partial-value]").pressSequentially("800", { delay: 15 });
  await adv.page.locator("[data-em-issue]").click();
  const pro3 = await until(async () => (await sql("select id, number, total_aed::float as total from public.invoices where estimate_id = $1 and kind = 'proforma' and status = 'issued' and is_active and converted_to is null", [e2.id]))[0]);
  check("E0: a new partial proforma for the rest is out", !!pro3 && pro3.total === 800, JSON.stringify(pro3));
  await closeSend(adv.page);
  await go(adv.page, `${base}/estimates/${e2.id}`);
  await adv.page.locator("[data-em-paylink]").click();
  await adv.page.locator("[data-em-paylink-amount]").fill("");
  await adv.page.locator("[data-em-paylink-amount]").pressSequentially("300", { delay: 15 });
  await adv.page.locator("[data-em-paylink-go]").click();
  check("E1: the link message is prepared with the amount", await until(async () => /payment link|Pay here/i.test((await adv.page.locator("[data-send-message]").textContent().catch(() => "")) ?? ""), 30, 400));
  const linkMsg = (await adv.page.locator("[data-send-message]").textContent()) ?? "";
  // A /p/ page shortens under the generic /m/ prefix (19 October: payment GATEWAY links are never shortened; ours is the page).
  const short = (linkMsg.match(/https:\/\/\S+\/(p|m|d)\/\S+/) ?? [])[0] ?? null;
  check("E2: the message carries OUR short link and AED 300.00", !!short && /300\.00/.test(linkMsg), linkMsg.slice(0, 160));
  await closeSend(adv.page);
  const req = (await sql("select token, amount_aed::float as amount, estimate_id, invoice_id from public.payment_requests where estimate_id = $1 and is_active", [e2.id]))[0];
  check("E3: the request belongs to the estimate and its proforma", !!req && req.amount === 300 && req.invoice_id === pro3.id, JSON.stringify(req));
  const pPage = await fetch(`${base}/p/${req.token}`).then((r) => r.text());
  check("E4: the /p/ page names the estimate, the amount and the bank details", new RegExp(e2.number).test(pPage) && /300\.00/.test(pPage) && /IBAN|Account/i.test(pPage));

  /* ---------- F. The advisor's "Payment received – send to accounts" on the estimate ---------- */
  await go(adv.page, `${base}/estimates/${e2.id}`);
  check("F1: the advisor has the report button", (await adv.page.locator("[data-payment-report-open]").count()) >= 1);
  await adv.page.locator("[data-payment-report-open]").first().click();
  const rd = adv.page.locator("[data-payment-report-dialog]");
  await rd.waitFor({ timeout: 15000 });
  await rd.locator("[data-report-amount]").fill("500");
  await rd.locator('[data-report-method="transfer"]').click();
  await rd.locator('input[type="file"]').setInputFiles({ name: "transfer-slip.png", mimeType: "image/png", buffer: png });
  check("F2: the slip arrives through the estimate's own place", await until(async () => !(await rd.locator("[data-report-send]").isDisabled()), 60, 500));
  await rd.locator("[data-report-send]").click();
  check("F3: sent to accounts", await until(async () => (await rd.locator("[data-report-sent]").count()) > 0, 40, 500));
  const rep = (await sql("select id, estimate_id, job_id, status, amount_aed::float as amount, proof_path from public.payment_reports where estimate_id = $1 and is_active", [e2.id]))[0];
  check("F4: the report sits on the ESTIMATE with its slip", !!rep && rep.job_id === null && rep.status === "waiting" && rep.amount === 500 && /estimate-reports\//.test(rep.proof_path ?? ""), JSON.stringify(rep));
  const bell = await sql("select n.href from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'payment_reported' and s.role_id = 'accounts' and n.href like $1 order by n.created_at desc limit 1", [`/estimates/${e2.id}%`]);
  check("F5: accounts' bell opens the estimate with the window", bell.length === 1 && bell[0].href.includes(`pay-report=${rep.id}`));
  // Accounts open it from the bell: the window offers ONLY the estimate's proforma, pre-filled with the report.
  await go(acc.page, `${base}${bell[0].href}`);
  const d6 = dialog(acc.page);
  await d6.waitFor({ timeout: 15000 });
  await until(async () => (await d6.locator("[data-pay-targets]").count()) > 0, 40, 300);
  check("F6: the window opens on the report with the proforma as the one target", (await d6.locator(`[data-pay-target="inv:${pro3.id}"]`).count()) === 1);
  console.log("   report keys:", await d6.getAttribute("data-report-keys"));
  await acc.page.screenshot({ path: path.join(dir, "f1-report-window.png") });
  const rct3 = await pay(acc.page, { method: "transfer", amount: 500, reference: "TRF-E2E-63" });
  check("F7: the reported transfer is recorded", !!rct3);
  const repDone = await until(async () => (await sql("select status, payment_id from public.payment_reports where id = $1 and status = 'recorded'", [rep.id]))[0]);
  check("F8: the report is closed by its receipt", !!repDone && !!repDone.payment_id);
  const advBell = await sql("select count(*)::int as n from public.notifications where staff_id = $1 and type = 'payment_report_recorded' and title like $2", [advisor.id, `%${e2.number}%`]);
  check("F9: the advisor hears Recorded ✓ with the estimate named", (advBell[0]?.n ?? 0) >= 1);

  /* ---------- G. THE CAR ARRIVES: every document and payment follows it onto the job ---------- */
  // The calendar's Prepaid chip first (the car is booked-like: paid money, not here yet).
  const beforeDocs = await sql("select id from public.invoices where customer_id = $1 and job_id is null and is_active", [cust]);
  check("G0: before gate-in every document is job-less", beforeDocs.length >= 4, `${beforeDocs.length} docs`);
  const appt = (await sql("insert into public.appointments (customer_id, vehicle_id, kind, reason, starts_at, duration_minutes, advisor_id, created_by, updated_by) values ($1, $2, 'car_drop', 'Prepaid work as estimated', now() + interval '1 day', 30, $3, $3, $3) returning id", [cust, car, advisor.id]))[0];
  await go(adv.page, `${base}/calendar/${appt.id}`);
  const prepaidLine = ((await adv.page.locator("[data-booking-prepaid]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("G0b: the booking shows Prepaid with the estimates named", /AED 3,650\.00/.test(prepaidLine) && new RegExp(e1.number).test(prepaidLine), prepaidLine.slice(0, 140));
  await adv.page.screenshot({ path: path.join(dir, "g0-booking-prepaid.png") });
  await go(adv.page, `${base}/gate-in/new?vehicle=${car}`);
  for (const [n2, v2] of [["arrived_by", "customer_drove"], ["condition", "runs_drives"], ["fuel_level", "half"], ["cleanliness", "clean"], ["dash_cam", "no"], ["major_damage", "no"], ["keys_count", "1"], ["keys_keychain", "no"], ["old_parts_return", "no"], ["department", "mechanical"]]) await pick(adv.page, n2, v2);
  const addr = adv.page.locator('textarea[name="location_address"]');
  if (await addr.count()) await addr.fill("E2e money carry address");
  await adv.page.locator('input[name="mileage_display"]').pressSequentially("18000");
  await adv.page.keyboard.press("Tab");
  await adv.page.locator('input[name="requests"]:visible').first().pressSequentially("As per the prepaid estimates");
  check("G1: both estimates are ticked to carry over", (await adv.page.locator('input[name="carry_estimate"]:checked').count()) >= 2);
  await chooseInspectionFee(adv.page, 1000);
  await sleep(400);
  await adv.page.getByText("Save and continue to photos and video").click();
  await adv.page.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const job = (await sql("select id, job_number from public.jobs where vehicle_id = $1 and is_open", [car]))[0];
  check("G2: the job opened", !!job, JSON.stringify(job));
  const movedDocs = await until(async () => { const r = await sql("select kind, number, deposit_for_quotation_id is not null as adv, job_id from public.invoices where customer_id = $1 and is_active", [cust]); return r.length && r.every((d) => d.job_id === job.id) ? r : null; });
  check("G3: EVERY proforma and tax invoice moved onto the job", !!movedDocs, JSON.stringify((movedDocs ?? []).map((d) => `${d.number}:${d.job_id === job.id}`)));
  const movedPays = await sql("select count(*)::int as n, coalesce(sum(amount_aed), 0)::float as total from public.payments where customer_id = $1 and job_id = $2 and is_active", [cust, job.id]);
  check("G4: the payments follow the car (AED 3,650 on the job)", movedPays[0].n === 3 && movedPays[0].total === 3650, JSON.stringify(movedPays[0]));
  const carryEvent = await sql("select note from public.job_events where job_id = $1 and event_type = 'payment' and note like 'Estimate money carried over%'", [job.id]);
  check("G5: the job history says the money carried over", carryEvent.length === 1 && /already paid/.test(carryEvent[0].note), (carryEvent[0]?.note ?? "").slice(0, 160));
  // The job card: Paid so far stands from the first minute.
  await go(adv.page, `${base}/jobs/${job.id}`);
  const jobBody = ((await adv.page.textContent("body")) ?? "").replace(/\s+/g, " ");
  check("G6: the job card shows the money already paid", /3,650\.00|Paid so far/i.test(jobBody));
  await adv.page.screenshot({ path: path.join(dir, "g1-job-card-carried.png"), fullPage: true });
  // The estimates are carried: their money rows leave the Invoices list, the estimate card points at the job.
  await go(acc.page, `${base}/invoices`);
  check("G7: the car-not-here rows are gone (the job's own rows carry it now)", (await acc.page.locator(`[data-money-row="estimate:${e1.id}"], [data-money-row="estimate:${e2.id}"]`).count()) === 0);
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
