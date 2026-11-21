// JOURNAL VOUCHER: provider and invoice details when recording as paid (21 November 2026, Section 2; real case
// "PARKING CARD DELIVERED TO CUSTOMER VIA PORTER" 34.10 on J-01016 and the Nabooda delivery 50.00 on J-00343).
// On TEST as accounts: per ticked charge the provider (from the supplier list, TRN fills in), invoice number and date;
// "Same invoice for all ticked"; the 5% VAT check with its fix button; VAT refused without a TRN; "Ask <advisor> for
// the receipt"; the voucher keeps it all, the list shows it with "No receipt", the Excel export carries the columns.
//   node --env-file=.env.test.local tests/browser/test-jv-provider.mjs    (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { base, browserForId, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const proofDir = path.resolve("docs/proof/2026-11-21-jv-provider");
mkdirSync(proofDir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const accountsRow = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const mm = (await sql("select m.id as make_id, (select id from public.vehicle_models where make_id = m.id limit 1) as model_id from public.vehicle_makes m where exists (select 1 from public.vehicle_models where make_id = m.id) limit 1"))[0];
const browsers = [];

cleanupDb();
try {
  const sup = (await sql("insert into public.suppliers (name, trn) values ('E2E PORTER TECHNOLOGIES FZCO', '100487643700003') on conflict ((lower(name))) do update set trn = excluded.trn returning id"))[0];
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'Jv Provider E2e', '+971500000092') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'J', '92092', $2, $3, 2024, 'E2EJVPROVIDER0092') returning id", [cust, mm.make_id, mm.model_id]))[0].id;
  const job = (await sql("insert into public.jobs (vehicle_id, customer_id, stage, status, gated_in_by, is_open, advisor_id, created_by, updated_by) values ($1, $2, 'work', 'in_work', $3, true, $3, $3, $3) returning id, job_number", [car, cust, advisor.id]))[0];
  const mk = async (kind, desc, cost) => (await sql("insert into public.charge_lines (job_id, kind, description, cost_aed, charge_aed, free, free_status, created_by, updated_by) values ($1, $2, $3, $4, 0, true, 'approved', $5, $5) returning id", [job.id, kind, desc, cost, advisor.id]))[0].id;
  const A = await mk("other", "E2E PARKING CARD DELIVERED TO CUSTOMER VIA PORTER", 34.1);
  const B = await mk("delivery", "E2E DELIVERY - PARTS PICK-UP FROM AL NABOODA AUDI", 50);
  const C = await mk("other", "E2E SHOP ITEM NO TRN", 20);
  check("seed: three charges to record, none with a receipt photo", !!A && !!B && !!C, job.job_number);

  const acc = await browserForId(accountsRow.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(acc);
  const p = acc.page;
  await go(p, `${base}/journal-voucher`);
  const row = (id) => p.locator(`[data-jv-row="${id}"]`);

  /* ---------- A. Ask the advisor for the receipt ---------- */
  check("A1: a row with no receipt photo offers 'Ask <advisor> for the receipt'", (await row(C).locator("[data-jv-ask-receipt-send]").count()) === 1 && new RegExp(`Ask ${advisor.display_name}`).test((await row(C).locator("[data-jv-ask-receipt-send]").textContent()) ?? ""));
  await row(C).locator("[data-jv-ask-receipt-send]").click();
  const asked = await until(async () => (await row(C).locator("[data-jv-ask-done]").count()) ? await row(C).locator("[data-jv-ask-done]").textContent() : null, 40, 500);
  check("A2: the answer shows on the row", !!asked, asked ?? "");
  const bell = await until(async () => (await sql("select title, href from public.notifications where staff_id = $1 and type = 'charge_receipt_asked' order by created_at desc limit 1", [advisor.id]))[0], 20, 500);
  check("A3: the advisor who entered it gets the reminder, linking to the job's charges", !!bell && /Receipt needed/.test(bell.title) && bell.href === `/jobs/${job.id}#charges`, JSON.stringify(bell));

  /* ---------- B. Tick two charges: provider, invoice, TRN fills in, same invoice for all, 5% check ---------- */
  await row(A).locator(`[data-jv-tick="${A}"]`).check();
  await row(B).locator(`[data-jv-tick="${B}"]`).check();
  check("B1: ticking a charge opens its own provider and invoice fields", (await p.locator(`[data-jv-bill="${A}"]`).count()) === 1 && (await p.locator(`[data-jv-bill="${B}"]`).count()) === 1);
  await p.locator(`[data-provider-name="jv-${A}"]`).fill("E2E PORTER TECHNOLOGIES FZCO");
  await sleep(200);
  check("B2: a known provider's TRN fills in by itself", (await p.locator(`[data-provider-trn="jv-${A}"]`).inputValue()) === "100487643700003");
  await p.locator(`[data-jv-bill-number="${A}"]`).fill("E2E-PORTER-7781");
  await p.locator(`[data-jv-bill-date="${A}"]`).fill("2026-11-20");
  await p.locator(`[data-jv-vat="${A}"]`).fill("2.00");
  check("B3: VAT that is not 5% of the amount is warned, with a fix button", (await p.locator(`[data-jv-vat-warning="${A}"]`).count()) === 1);
  await p.locator(`[data-jv-vat-fix="${A}"]`).click();
  check("B4: 'Use 5%' puts 1.71 (5% of 34.10)", (await p.locator(`[data-jv-vat="${A}"]`).inputValue()) === "1.71" && (await p.locator(`[data-jv-vat-warning="${A}"]`).count()) === 0);
  await p.locator("[data-jv-same-invoice]").click();
  await sleep(200);
  check("B5: 'Same invoice for all ticked' copies the provider and invoice to the other charge", (await p.locator(`[data-provider-name="jv-${B}"]`).inputValue()) === "E2E PORTER TECHNOLOGIES FZCO" && (await p.locator(`[data-jv-bill-number="${B}"]`).inputValue()) === "E2E-PORTER-7781");
  await p.screenshot({ path: path.join(proofDir, "b1-record-as-paid-fields-1440.png"), fullPage: true });
  const form = p.locator("[data-jv-record-form]");
  check("B6: 'Who paid it?' is not pre-selected", (await form.locator('input[name="paid_by"]:checked').count()) === 0);
  await form.locator("[data-jv-paid-by] label").filter({ hasText: /Company cash/ }).click();
  await form.locator('[data-confirm-open="jv-record"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  await form.locator('[data-jv-done="record"], [data-jv-error="record"]').first().waitFor({ timeout: 40000 });
  const vs = await until(async () => { const r = await sql("select v.number, v.provider, v.provider_trn, v.provider_invoice_number, v.provider_invoice_date::text as d, v.supplier_id, v.no_receipt, v.vat_aed::float as vat, v.amount_aed::float as amount from public.journal_vouchers v join public.journal_voucher_lines l on l.voucher_id = v.id where l.charge_line_id = any($1::uuid[]) and l.is_active order by v.number", [[A, B]]); return r.length === 2 ? r : null; }, 40, 500);
  check("B7: one voucher per charge, each with provider, TRN, invoice number and date, the supplier record", !!vs && vs.every((v) => v.provider === "E2E PORTER TECHNOLOGIES FZCO" && v.provider_trn === "100487643700003" && v.provider_invoice_number === "E2E-PORTER-7781" && v.d === "2026-11-20" && v.supplier_id === sup.id), JSON.stringify(vs) + " " + ((await form.locator('[data-jv-done="record"], [data-jv-error="record"]').first().textContent()) ?? ""));
  check("B8: recorded without a receipt = tagged 'No receipt'; the VAT kept (1.71 reclaimable)", !!vs && vs.every((v) => v.no_receipt === true) && vs.some((v) => v.vat === 1.71));
  check("B9: the charge keeps the same provider record", (await sql("select supplier_id from public.charge_lines where id = $1", [A]))[0].supplier_id === sup.id);

  /* ---------- C. VAT with no TRN is refused, with the fix on the row ---------- */
  await go(p, `${base}/journal-voucher?v=2`);
  await row(C).locator(`[data-jv-tick="${C}"]`).check();
  await p.locator(`[data-provider-name="jv-${C}"]`).fill("E2E CORNER SHOP NO TRN");
  await p.locator(`[data-jv-vat="${C}"]`).fill("1.00");
  check("C1: VAT without a TRN is flagged with 'record it with no VAT'", (await p.locator(`[data-jv-vat-no-trn="${C}"]`).count()) === 1);
  const form2 = p.locator("[data-jv-record-form]");
  await form2.locator("[data-jv-paid-by] label").filter({ hasText: /Company cash/ }).click();
  await form2.locator('[data-confirm-open="jv-record"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  const refused = await until(async () => (await form2.locator('[data-jv-error="record"]').count()) ? await form2.locator('[data-jv-error="record"]').textContent() : null, 40, 500);
  check("C2: the server refuses VAT without the provider's TRN, in words", !!refused && /TRN/.test(refused), refused ?? "");
  await p.locator(`[data-jv-vat-fold="${C}"]`).click();
  check("C3: the fix button moves the VAT into the amount (21.00, VAT 0.00)", (await p.locator(`[data-jv-amount="${C}"]`).inputValue()) === "21.00" && (await p.locator(`[data-jv-vat="${C}"]`).inputValue()) === "0.00");
  await p.setViewportSize({ width: 800, height: 1280 });
  await p.screenshot({ path: path.join(proofDir, "c1-no-trn-fix-800.png"), fullPage: true });
  await p.setViewportSize({ width: 1440, height: 1000 });

  /* ---------- D. The voucher list and the Excel export ---------- */
  await go(p, `${base}/journal-voucher?v=3`);
  const vrow = p.locator(`[data-jv-voucher="${vs?.[0]?.number}"]`);
  check("D1: the voucher list shows provider, TRN, invoice and the 'No receipt' tag", (await vrow.locator("[data-jv-tag-no-receipt]").count()) === 1 && /E2E-PORTER-7781/.test((await vrow.locator("[data-jv-voucher-bill]").textContent()) ?? "") && /TRN 100487643700003/.test((await vrow.textContent()) ?? ""));
  await vrow.scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(proofDir, "d1-voucher-list-1440.png"), fullPage: true });
  const res = await p.request.get(`${base}/api/export/journal-vouchers`);
  const buf = await res.body();
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const headers = ws.getRow(1).values.join("|");
  const flat = [];
  ws.eachRow((r) => flat.push(r.values.join("|")));
  check("D2: the Excel export has Provider, Provider TRN, Invoice number, Invoice date and Receipt columns, filled", res.status() === 200 && /Provider TRN/.test(headers) && /Invoice number/.test(headers) && /Invoice date/.test(headers) && flat.some((l) => /E2E-PORTER-7781/.test(l) && /No receipt/.test(l)), headers);
} catch (e) {
  check("no crash", false, String(e?.stack ?? e));
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
