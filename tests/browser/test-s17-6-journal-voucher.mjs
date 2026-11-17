// 17 November 2026, Section 6: THE JOURNAL VOUCHER TAB. Signed in as accounts (the parts desk and an advisor are refused).
//  A. Every charge cost entered on a job arrives as TO RECORD (date, car and job, type, provider, amount, VAT, TRN, who).
//  B. Record one as PAID by a staff member's own money, the amount corrected from the receipt: a voucher JV-…, the job's
//     cost follows (logged), it waits for Zoho; the staff member appears under "To reimburse".
//  C. Pay later: two charges of one provider on one invoice = one unpaid voucher; Record payment posts it.
//  D. Reimburse the staff member. E. A manual voucher (no car). F. Void: the charge goes back to TO RECORD.
//  G. "Delivery" is a fourth type on the job's charges form.
// TEST only (the tables exist on TEST; live waits for the apply).  node --env-file=.env.test.local tests/browser/test-s17-6-journal-voucher.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-journal-voucher";
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
const confirm = async (page, hook) => { await page.locator(`[data-confirm-open="${hook}"]`).first().click(); await page.locator(`[data-confirm-yes-money="${hook}"]`).click(); };

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const mk = async (kind, desc, provider, cost, vat, trn = null) => (await sql("insert into public.charge_lines (job_id, kind, description, provider, cost_aed, cost_vat_aed, supplier_trn, charge_aed) values ($1, $2, $3, $4, $5, $6, $7, 0) returning id", [JOB, kind, desc, provider, cost, vat, trn]))[0].id;
  const FUEL = await mk("fuel", "FUEL – 20 L", "E2E FUEL STATION", 100, 5);
  const REC = await mk("recovery", "RECOVERY – FULL DOWN, ONE WAY", "E2E RECOVERY CO", 400, 20, "100000000000003");
  const DEL = await mk("delivery", "DELIVERY – PARTS COURIER", "E2E RECOVERY CO", 50, 2.5);

  // Refused for the parts desk and an advisor (server).
  for (const role of ["parts", "service_advisor"]) {
    const b = await browserFor(role, { viewport: { width: 1440, height: 1000 } });
    await go(b.page, `${base}/journal-voucher`);
    check(`A0: ${role} is refused the Journal Voucher`, (await b.page.locator("[data-journal-voucher]").count()) === 0);
    await b.browser.close();
  }

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/journal-voucher`);
  await acc.page.locator("[data-jv-to-record]").waitFor({ timeout: 30000 });
  // A.
  const row = await text(acc.page, `[data-jv-row="${REC}"]`);
  check("A1: the charge costs arrive as TO RECORD with type, provider, TRN, car and job, who entered it", (await acc.page.locator(`[data-jv-row="${FUEL}"]`).count()) === 1 && /Recovery charges/.test(row) && /E2E RECOVERY CO/.test(row) && /TRN 100000000000003/.test(row) && /J-/.test(row), row.slice(0, 200));
  await shots(acc.page, acc.page.locator("[data-jv-to-record]").first(), "a-to-record");

  // B. Record the fuel as paid by a staff member, corrected to 90.00.
  await acc.page.locator(`[data-jv-tick="${FUEL}"]`).check();
  await acc.page.locator(`[data-jv-amount="${FUEL}"]`).fill("90");
  check("B1: the correction is shown before recording", /100\.00 → 90\.00/.test(await text(acc.page, `[data-jv-corrected="${FUEL}"]`)));
  const form = acc.page.locator("[data-jv-record-form]");
  await form.locator("[data-jv-paid-by] label").filter({ hasText: /own money/ }).click();
  const staffId = await form.locator("[data-jv-staff] option").nth(1).getAttribute("value");
  await form.locator("[data-jv-staff]").selectOption(staffId);
  await form.locator("[data-jv-reference]").fill("E2E RCPT 77");
  await shots(acc.page, form, "b-record-as-paid");
  await confirm(acc.page, "jv-record");
  await form.locator('[data-jv-done="record"], [data-jv-error="record"]').first().waitFor({ timeout: 30000 });
  const v1 = await until(async () => (await sql("select v.id, v.number, v.paid_by, v.amount_aed, v.vat_aed, v.staff_id from public.journal_vouchers v join public.journal_voucher_lines l on l.voucher_id = v.id where l.charge_line_id = $1 and l.is_active", [FUEL]))[0]);
  check("B2: one voucher JV-…, paid by the staff member, 90.00 + 5.00", !!v1 && /^JV-\d{5}$/.test(v1.number) && v1.paid_by === "staff" && Number(v1.amount_aed) === 90 && v1.staff_id === staffId, `${await text(acc.page, '[data-jv-done="record"], [data-jv-error="record"]')} ${JSON.stringify(v1 ?? {})}`);
  check("B3: the job's cost follows the correction (logged)", Number((await sql("select cost_aed from public.charge_lines where id = $1", [FUEL]))[0].cost_aed) === 90 && (await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'charge_cost_corrected'", [JOB]))[0].n === 1);
  check("B4: it waits for Zoho (OFJ TEST at the next Sync to Zoho)", !!(await until(async () => (await sql("select status from public.zoho_outbox where kind = 'jv' and record_id = $1", [v1.id]))[0])));
  await go(acc.page, `${base}/journal-voucher?v=2`);
  check("B5: it left TO RECORD; the staff member is under To reimburse (AED 95.00)", (await acc.page.locator(`[data-jv-row="${FUEL}"]`).count()) === 0 && /95\.00/.test(await text(acc.page, "[data-jv-reimburse-list]")));

  // C. Pay later: recovery + delivery on one invoice of E2E RECOVERY CO.
  await acc.page.locator(`[data-jv-tick="${REC}"]`).check();
  await acc.page.locator(`[data-jv-tick="${DEL}"]`).check();
  const later = acc.page.locator("[data-jv-later-form]");
  await later.locator("[data-jv-later-number]").fill("E2E-RC-1101");
  await later.locator("[data-jv-later-date]").fill(new Date(Date.now() + 4 * 3600000 - 86400000).toISOString().slice(0, 10));
  await confirm(acc.page, "jv-later");
  await later.locator('[data-jv-done="later"], [data-jv-error="later"]').first().waitFor({ timeout: 30000 });
  const v2 = await until(async () => (await sql("select id, number, status, amount_aed, vat_aed from public.journal_vouchers where provider_invoice_number = 'E2E-RC-1101'"))[0]);
  check("C1: one unpaid voucher for both charges (450.00 + 22.50)", v2?.status === "unpaid" && Number(v2.amount_aed) === 450 && Number(v2.vat_aed) === 22.5 && (await sql("select count(*)::int as n from public.journal_voucher_lines where voucher_id = $1", [v2.id]))[0].n === 2, `${await text(acc.page, '[data-jv-done="later"], [data-jv-error="later"]')} ${JSON.stringify(v2 ?? {})}`);
  await go(acc.page, `${base}/journal-voucher?v=3`);
  const pay = acc.page.locator(`[data-jv-pay="${v2.number}"]`);
  await pay.locator("summary").click();
  await pay.locator("[data-jv-paid-by] label").filter({ hasText: /Bank transfer/ }).click();
  await confirm(acc.page, "jv-pay");
  check("C2: Record payment on it: paid by bank transfer, then it posts", !!(await until(async () => (await sql("select status from public.journal_vouchers where id = $1 and status = 'paid' and paid_by = 'transfer'", [v2.id]))[0])));

  // D. Reimburse.
  await go(acc.page, `${base}/journal-voucher?v=4`);
  const reimb = acc.page.locator("[data-jv-reimburse]").first();
  await reimb.locator("label").filter({ hasText: /^Cash$/ }).click();
  await confirm(acc.page, "jv-reimburse");
  check("D1: the staff member is marked reimbursed", !!(await until(async () => (await sql("select reimbursed_at from public.journal_vouchers where id = $1 and reimbursed_at is not null", [v1.id]))[0])));

  // E. A manual voucher.
  await go(acc.page, `${base}/journal-voucher?v=5`);
  const man = acc.page.locator("[data-jv-manual-form]");
  await man.locator("label").filter({ hasText: /^Other$/ }).first().click();
  await man.locator("[data-jv-manual-description]").fill("E2E stationery for the office");
  await man.locator("[data-jv-manual-amount]").fill("30");
  await man.locator("[data-jv-paid-by] label").filter({ hasText: /Company cash/ }).click();
  await shots(acc.page, man, "e-manual-voucher");
  await confirm(acc.page, "jv-manual");
  const v3 = await until(async () => (await sql("select id, number, kind from public.journal_vouchers where description = 'E2E stationery for the office'"))[0]);
  check("E1: a manual voucher with no car", v3?.kind === "manual");

  // F. Void the fuel voucher: its charge goes back to TO RECORD.
  await go(acc.page, `${base}/journal-voucher?v=6`);
  const vd = acc.page.locator(`[data-jv-void="${v1.number}"]`);
  await vd.locator("summary").click();
  await vd.locator('input[name="reason"]').fill("Recorded twice by mistake");
  await vd.locator('[data-confirm-open="jv-void"]').click();
  await acc.page.locator('[data-confirm-yes-money="jv-void"]').click();
  await until(async () => (await sql("select status from public.journal_vouchers where id = $1 and status = 'void'", [v1.id]))[0]);
  await go(acc.page, `${base}/journal-voucher?v=7`);
  check("F1: voided: the fuel charge is back to TO RECORD", (await acc.page.locator(`[data-jv-row="${FUEL}"]`).count()) === 1);
  await shots(acc.page, acc.page.locator("[data-jv-history]").first(), "f-vouchers");

  // G. Delivery on the job's charges form.
  await go(acc.page, `${base}/jobs/${JOB}`);
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/jobs/${JOB}#charges`);
  const opener = own.page.locator("#charges summary, #charges [data-charges-add], #charges button").filter({ hasText: /Add|charge/i }).first();
  if (await opener.count()) await opener.click().catch(() => null);
  check("G1: \"Delivery\" is a type on the job's charges form", (await own.page.locator('[data-charge-kind="delivery"]').count()) >= 1);
  await own.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
