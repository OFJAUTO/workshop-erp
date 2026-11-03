// Section 4 of 2 November 2026 (built 3 November): Invoices and payments shows EVERY job with money paid or owed.
// The owner's case: two part payments today (AED 30,000 on J-00969 + AED 8,000) read "Collected today AED 38,000" next to
// "Part paid · 0" and "Awaiting payment AED 0 · 0 cars", because the list was built from invoices only. This proves on the
// TEST database, through the screens as accounts:
//   - the J-00969 copy: an approved car in work, AED 30,000 recorded through the Record payment window, is a row with
//     "Paid so far AED 30,000.00 · Balance AED …", under Part paid, Awaiting payment and Collected today;
//   - a second customer's AED 8,000 twice: as credit not allocated (a row of its own) and as an advance on another job;
//   - a Ready car with a sent proforma part paid, a pending cheque (not counted) and a cheque received yesterday that
//     cleared today (counted today: the collected rule follows the clearing day, like the Zoho reconciliation);
//   - an unpaid tax invoice issued today, a closed job that left owing (a row), a closed job paid yesterday (no row),
//     an open job in inspection with nothing paid (no row);
//   - every tile equals the sum of the list behind its link, the counts match, Collected today equals the SQL sum of
//     today's payments, the accounts dashboard shows the same tiles and groups, the money page and the job card read the
//     same "Paid so far · Balance", and the one money rule gives the same figures one job at a time and all at once.
//   npm run test:s4-moneylist      (test server: E2E_BASE, default the production test server on :3102)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, secret, sleep, pressRecord } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s4-moneylist");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 20 * 60 * 1000).unref();

/** SQL that stops the test on an error (the shared helper hides them). */
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const ID = (n) => `22222222-0000-4000-8000-00000000e9${n}`;
const tok = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const aed = (n) => `AED ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round(n * 100) / 100;
const text = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const dialog = (page) => page.locator("[data-record-payment-dialog]");

/** In the open Record payment window: target, note, method, a part amount, Record + Yes; returns the receipt number. */
async function pay(page, { method = "cash", amount, note = null, target = null }) {
  const d = dialog(page);
  await until(async () => (await d.locator("[data-pay-targets], [data-record-payment-error]").count()) > 0, 40, 300);
  if (target) await d.locator(`[data-pay-target="${target}"]`).click();
  if (note) await d.locator("[data-pay-for]").fill(note);
  await d.locator(`[data-method="${method}"]`).click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
  await pressRecord(d);
  const done = await until(async () => (await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
  if (!done) console.log("   window says:", (await text(d)).slice(-400));
  return done;
}

/** Every row on a money list page, as its data hooks give it. */
const rowsOn = (page) => page.$$eval("[data-money-list] [data-money-row]", (els) => els.map((e) => ({ key: e.getAttribute("data-money-row"), kind: e.getAttribute("data-money-kind"), total: e.getAttribute("data-money-total"), paid: Number(e.getAttribute("data-money-paid")), balance: e.getAttribute("data-money-balance") === "" ? null : Number(e.getAttribute("data-money-balance")), today: Number(e.getAttribute("data-money-today")), todayCount: Number(e.getAttribute("data-money-today-count")), taxToday: (e.getAttribute("data-money-tax-today") ?? "").split(",").filter(Boolean), text: (e.textContent ?? "").replace(/\s+/g, " ") })));
const tile = async (page, label) => {
  const t = page.locator(`[data-money-tiles] [data-tile="${label}"]`).first();
  return { amount: Number((await t.getAttribute("data-tile-amount")) || 0), count: Number((await t.getAttribute("data-tile-count")) || 0), href: await t.getAttribute("href"), text: await text(t) };
};
const chipCount = async (page, key) => Number(((await text(page.locator(`[data-money-filters] [data-filter="${key}"]`))).match(/·\s*(\d+)/) ?? [])[1] ?? -1);

const accounts = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
const page = accounts.page;

try {
  cleanupDb();
  /* ---------------- Seeds (TEST database only) ---------------- */
  const OWNER = (await q("select id::text as id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const ADVISOR = (await q("select id::text as id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0].id;
  // 1. The J-00969 copy: the stage seed's approved car in work, its approved quotation made large enough for an AED 30,000 advance.
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const C1 = seed.jobId;
  await q("update public.quotations set status = 'draft' where job_id = $1 and status = 'approved'", [C1]);
  await q("update public.quotation_lines set hours = 120 where quotation_id in (select id from public.quotations where job_id = $1) and line_type = 'labour'", [C1]);
  await q("update public.quotations set status = 'approved' where job_id = $1 and status = 'draft'", [C1]);
  await q("update public.jobs set status = 'in_work', stage = 'work' where id = $1", [C1]);
  const make = (await q("select make_id::text as m from public.vehicles where id = (select vehicle_id from public.jobs where id = $1)", [C1]))[0].m;

  const customer = (n, name, phone) => q("insert into public.customers (id, customer_type, full_name, phone, created_by, updated_by) values ($1, 'individual', $2, $3, $4, $4)", [ID(n), name, phone, OWNER]);
  const car = (n, cust, plate) => q("insert into public.vehicles (id, customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, model_year, created_by, updated_by) values ($1, $2, 'UAE', 'Dubai', 'S', $3, true, $4, 2022, $5, $5)", [ID(n), ID(cust), plate, make, OWNER]);
  const job = (n, cust, veh, status, open, extra = "") => q(`insert into public.jobs (id, vehicle_id, customer_id, stage, status, priority, department, gated_in_by, first_approval_at, stage_entered_at, is_open, created_by, updated_by${extra ? ", inspection_fee_due" : ""}) values ($1, $2, $3, $4, $5, 'normal', 'mechanical', $6, now(), now(), $7, $8, $8${extra ? ", true" : ""})`, [ID(n), ID(veh), ID(cust), ["closed", "ready", "pending_payment"].includes(status) ? "ready" : status === "in_inspection" ? "inspection" : "work", status, ADVISOR, open, OWNER]);
  /** An approved quotation with one labour line (hours × AED 300). */
  const approved = async (n, jobN, cust, veh, hours) => {
    await q("insert into public.quotations (id, kind, number, version, job_id, customer_id, vehicle_id, status, token, created_by, updated_by) values ($1, 'quotation', $2, 1, $3, $4, $5, 'draft', $6, $7, $7)", [ID(n), `Q-S4-${n}`, ID(jobN), ID(cust), ID(veh), tok(), ADVISOR]);
    await q("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, urgency, created_by, updated_by) values ($1, 0, 'labour', 'S4 TEST LABOUR', 'manual', 1, $2, 300, 'urgent', $3, $3)", [ID(n), hours, ADVISOR]);
    await q("update public.quotations set status = 'approved', responded_at = now() where id = $1", [ID(n)]);
  };
  /** A document straight in the TEST database (numbers outside the real PRO-/INV- runs, so no real number is used). */
  const doc = (n, kind, jobN, cust, veh, total, { issued = "now()", sent = true } = {}) => q(`insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, sent_at, issued_by, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, 'issued', ${issued}, $7, 'itemised', $8, 0, $8, $9, $10, ${sent ? issued : "null"}, $11, $11, $11)`, [ID(n), `E2E-${kind === "proforma" ? "PRO" : "INV"}-${n}`, kind, ID(jobN), ID(cust), ID(veh), tok(), r2(total / 1.05), r2(total - total / 1.05), total, OWNER]);
  const payment = (jobId, invoiceId, cust, amount, { method = "cash", received = "now()", cheque = null } = {}) =>
    q(`insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by${cheque ? ", cheque_number, cheque_bank, cheque_date, cheque_status, cleared_at" : ""}) values ($1, $2, $3, $4, $5, $6, 'recorded', $7, $7, $7, ${received}, now(), $7${cheque ? `, '445566', 'Emirates NBD', current_date, '${cheque}', ${cheque === "cleared" ? "now()" : "null"}` : ""}) returning number`, [jobId, invoiceId, cust, method, amount, !invoiceId, OWNER]);

  // 2. Customer B: AED 8,000 as credit not allocated (through the window, below) and AED 8,000 as an advance on job J2.
  await customer("a1", "E2E S4 SECOND CUSTOMER", "+971500000941");
  await car("a2", "a1", "94101");
  await car("a4", "a1", "94102");
  await q("update public.vehicles set vin = 'E2ES4VINTEST00A41' where id = $1", [ID("a4")]);
  await job("a3", "a1", "a4", "in_work", true);
  await approved("a5", "a3", "a1", "a4", 40); // 12,000 + VAT = 12,600
  const advJ2 = (await payment(ID("a3"), null, ID("a1"), 8000, { method: "transfer" }))[0].number;
  // 3. A Ready car, proforma sent, part paid today; a cheque pending (not counted) and one received yesterday, cleared today.
  await customer("b1", "E2E S4 READY CUSTOMER", "+971500000942");
  await car("b2", "b1", "94201");
  await job("b3", "b1", "b2", "ready", true);
  await approved("b4", "b3", "b1", "b2", 10); // 3,000 + VAT = 3,150
  await doc("b5", "proforma", "b3", "b1", "b2", 3150);
  const proPay = (await payment(ID("b3"), ID("b5"), ID("b1"), 1000))[0].number;
  await payment(ID("b3"), ID("b5"), ID("b1"), 500, { method: "cheque", cheque: "pending" });
  const clearedCheque = (await payment(ID("b3"), ID("b5"), ID("b1"), 600, { method: "cheque", cheque: "cleared", received: "now() - interval '1 day'" }))[0].number;
  // 4. An unpaid tax invoice issued today.
  await customer("c1", "E2E S4 TAX CUSTOMER", "+971500000943");
  await car("c2", "c1", "94301");
  await job("c3", "c1", "c2", "pending_payment", true);
  await approved("c4", "c3", "c1", "c2", 7); // 2,100 + VAT = 2,205
  await doc("c5", "tax_invoice", "c3", "c1", "c2", 2205);
  // Review of 3 November: a second tax invoice on the same car today (a declined-work charge invoice beside it), a little older.
  await doc("c6", "tax_invoice", "c3", "c1", "c2", 105, { issued: "now() - interval '5 seconds'" });
  // 5. A closed job that left owing (invoice and its part payment two days ago), and a closed job paid in full yesterday.
  await customer("d1", "E2E S4 LEFT OWING", "+971500000944");
  await car("d2", "d1", "94401");
  await job("d3", "d1", "d2", "closed", false);
  await approved("d4", "d3", "d1", "d2", 10);
  await doc("d5", "tax_invoice", "d3", "d1", "d2", 3150, { issued: "now() - interval '2 days'" });
  await payment(ID("d3"), ID("d5"), ID("d1"), 1000, { received: "now() - interval '2 days'" });
  await customer("e1", "E2E S4 PAID YESTERDAY", "+971500000945");
  await car("e2", "e1", "94501");
  await job("e3", "e1", "e2", "closed", false);
  await approved("e4", "e3", "e1", "e2", 5);
  await doc("e5", "tax_invoice", "e3", "e1", "e2", 1575, { issued: "now() - interval '1 day'" });
  await payment(ID("e3"), ID("e5"), ID("e1"), 1575, { received: "now() - interval '1 day'" });
  // 6. An open car in inspection with its fee due and nothing paid: not a money row.
  await car("f2", "e1", "94601");
  await job("f3", "e1", "f2", "in_inspection", true, "fee");
  // 7. Review of 3 November: a closed job whose tax invoice (AED 3,150, three days ago) had a credit note of AED 1,050 and
  //    the customer paid the AED 2,100 left: nothing is owed, so it is never in Awaiting or Part paid.
  await customer("71", "E2E S4 CREDIT NOTE", "+971500000946");
  await car("72", "71", "94701");
  await job("73", "71", "72", "closed", false);
  await approved("74", "73", "71", "72", 10);
  await doc("75", "tax_invoice", "73", "71", "72", 3150, { issued: "now() - interval '3 days'" });
  await q("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, credit_of, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, issued_by, created_by, updated_by) values ($1, 'E2E-CN-76', 'credit_note', $2, $3, $4, $5, 'issued', now() - interval '2 days', $6, 'itemised', 1000, 0, 1000, 50, 1050, $7, $7, $7)", [ID("76"), ID("73"), ID("71"), ID("72"), ID("75"), tok(), OWNER]);
  await payment(ID("73"), ID("75"), ID("71"), 2100, { received: "now() - interval '2 days'" });
  check("seeds: seven jobs and seven documents (one a credit note) in the TEST database", (await q("select count(*)::int as n from public.jobs where id::text like '22222222-0000-4000-8000-00000000e9%'"))[0].n === 7 && (await q("select count(*)::int as n from public.invoices where id::text like '22222222-0000-4000-8000-00000000e9%'"))[0].n === 7);

  /* ---------------- A. The owner's AED 30,000 through the Record payment window, and B's AED 8,000 credit ---------------- */
  await go(page, `${base}/jobs/${C1}`);
  await page.locator("[data-money-tile] [data-record-payment-open]").first().click();
  await dialog(page).waitFor();
  const target = await dialog(page).locator('[data-pay-target][aria-pressed="true"]').getAttribute("data-pay-target").catch(() => null);
  check("A: the window offers the car in work as the place for the money (an advance on the job)", target === `job:${C1}`, String(target));
  const advC1 = await pay(page, { method: "cash", amount: 30000 });
  check("A: AED 30,000 recorded on the J-00969 copy as an advance", !!advC1 && (await q("select job_id::text as j, invoice_id from public.payments where number = $1", [advC1 ?? "-"]))[0]?.j === C1, String(advC1));
  await dialog(page).locator("[data-record-payment-finish]").click().catch(() => null);
  await go(page, `${base}/customers/${ID("a1")}`);
  await page.locator("[data-record-payment-open]").first().click();
  await dialog(page).waitFor();
  const credit = await pay(page, { method: "cash", amount: 8000, target: "credit", note: "Advance for the paint job next week" });
  check("A: AED 8,000 saved on the second customer's account (not allocated)", !!credit && !(await q("select job_id from public.payments where number = $1", [credit ?? "-"]))[0]?.job_id, String(credit));
  await dialog(page).locator("[data-record-payment-finish]").click().catch(() => null);

  const c1Money = (await q("select coalesce(sum(l.hours * l.labour_rate), 0)::float8 as net from public.quotation_lines l join public.quotations q on q.id = l.quotation_id where q.job_id = $1 and q.status = 'approved' and l.is_active and l.line_type = 'labour'", [C1]))[0].net;
  void c1Money;

  /* ---------------- B. The list: every job with money paid or owed ---------------- */
  await go(page, `${base}/invoices`);
  const all = await rowsOn(page);
  const byKey = new Map(all.map((r) => [r.key, r]));
  const c1 = byKey.get(C1);
  check("B: the J-00969 copy is a row (advance before the proforma)", !!c1 && c1.kind === "job" && c1.paid === 30000 && c1.balance !== null && c1.balance > 0, JSON.stringify(c1 ?? {}).slice(0, 200));
  check("B: its row reads 'Paid so far AED 30,000.00 · Balance AED …' and the chip 'Advance AED 30,000'", !!c1 && c1.text.includes("Paid so far AED 30,000.00") && c1.text.includes(`Balance ${aed(c1.balance)}`) && c1.text.includes("Advance AED 30,000"), c1?.text.slice(0, 300));
  check("B: and 'Today AED 30,000.00' on it", !!c1 && c1.today === 30000 && c1.text.includes("Today AED 30,000.00"));
  const creditRow = byKey.get(`credit:${ID("a1")}`);
  check("B: the second customer's credit is a row of its own (Credit · not allocated, AED 8,000)", !!creditRow && creditRow.kind === "credit" && creditRow.paid === 8000 && creditRow.balance === null && creditRow.today === 8000 && /Credit · not allocated/.test(creditRow.text), JSON.stringify(creditRow ?? {}).slice(0, 200));
  check("B: the credit row opens the customer's money", (await page.locator(`[data-money-row="credit:${ID("a1")}"] [data-money-row-open]`).getAttribute("href")) === `/customers/${ID("a1")}#money`);
  const j2 = byKey.get(ID("a3"));
  check("B: the advance on the second customer's other job is a row: Paid so far AED 8,000.00 · Balance AED 4,600.00", !!j2 && j2.paid === 8000 && j2.balance === 4600 && j2.text.includes("Paid so far AED 8,000.00") && j2.text.includes("Balance AED 4,600.00"), JSON.stringify(j2 ?? {}).slice(0, 240));
  const j3 = byKey.get(ID("b3"));
  check("B: the Ready car's sent proforma, part paid: AED 1,600 counted (1,000 today + the cheque cleared today), the pending cheque clearing", !!j3 && j3.paid === 1600 && j3.balance === 1550 && j3.text.includes("cheque AED 500.00 clearing"), JSON.stringify(j3 ?? {}).slice(0, 260));
  check("B: its 'today' is AED 1,600 in 2 payments (the cheque received yesterday counts on the day it cleared)", !!j3 && j3.today === 1600 && j3.todayCount === 2, JSON.stringify({ today: j3?.today, n: j3?.todayCount }));
  const j4 = byKey.get(ID("c3"));
  check("B: the unpaid tax invoice is a row: Paid so far AED 0.00 · Balance AED 2,205.00, issued today", !!j4 && j4.paid === 0 && j4.balance === 2205 && j4.taxToday.includes(`E2E-INV-c5`), JSON.stringify(j4 ?? {}).slice(0, 220));
  const j5 = byKey.get(ID("d3"));
  check("B: the closed job that left owing is a row (AED 2,150 due) and says 'Left owing', not a green 'Released'", !!j5 && j5.balance === 2150 && j5.paid === 1000 && j5.text.includes("Left owing · AED 2,150 due"), JSON.stringify(j5 ?? {}).slice(0, 220));
  // Review of 3 November: a car that left paid in full stays on the list without dates for 30 days (Paid, Tax invoices,
  // Released), with a balance of nothing, so it counts in no tile; the hint under the chips says so.
  const e3 = byKey.get(ID("e3"));
  check("B: the closed job paid in full yesterday is still on the list (paid in full, nothing due)", !!e3 && e3.balance === 0 && e3.paid === 1575 && e3.text.includes("Paid in full"), JSON.stringify(e3 ?? {}).slice(0, 200));
  check("B: the hint under the chips says what the list holds and how to find older ones", /last 30 days\. For older ones, search or enter dates\./.test(await text(page.locator("[data-money-list-hint]"))));
  const g3 = byKey.get(ID("73"));
  check("B: the closed job with a credit note is paid in full: AED 3,150 less AED 2,100 paid less the AED 1,050 credit note", !!g3 && g3.balance === 0 && g3.paid === 2100 && g3.text.includes("credit note AED 1,050.00 off") && g3.text.includes("Paid in full") && !/Left owing/.test(g3.text), JSON.stringify(g3 ?? {}).slice(0, 260));
  check("B: the open car in inspection with nothing paid is not on the list", !byKey.has(ID("f3")));
  await page.screenshot({ path: shot("1-invoices-and-payments-all.png"), fullPage: false });
  await page.locator(`[data-money-row="${C1}"]`).screenshot({ path: shot("2-advance-row-j00969-copy.png") });

  /* ---------------- C. Part paid includes the advances; Awaiting = every balance due ---------------- */
  const partCount = await chipCount(page, "part");
  await go(page, `${base}/invoices?show=part`);
  const part = await rowsOn(page);
  const partKeys = new Set(part.map((r) => r.key));
  check("C: Part paid lists the J-00969 copy, the other job's advance, the part-paid proforma and the car that left owing", [C1, ID("a3"), ID("b3"), ID("d3")].every((k) => partKeys.has(k)), [...partKeys].join(","));
  check("C: Part paid never lists the unpaid invoice, the credit, the car paid yesterday or the credit-noted one", !partKeys.has(ID("c3")) && !partKeys.has(`credit:${ID("a1")}`) && !partKeys.has(ID("e3")) && !partKeys.has(ID("73")));
  check(`C: the Part paid chip counts its list (${partCount})`, partCount === part.length, `${partCount} vs ${part.length}`);
  await page.screenshot({ path: shot("3-part-paid-filter.png"), fullPage: false });

  await go(page, `${base}/invoices`);
  const awaitingTile = await tile(page, "Awaiting payment");
  const todayTile = await tile(page, "Collected today");
  const taxTile = await tile(page, "Tax invoices today");
  await page.locator("[data-money-tiles]").screenshot({ path: shot("4-tiles.png") });
  check("C: the tiles link to the lists that make them", awaitingTile.href === "/invoices?show=awaiting" && todayTile.href === "/invoices?show=today" && taxTile.href === "/invoices?show=tax_today", `${awaitingTile.href} ${todayTile.href} ${taxTile.href}`);
  await go(page, `${base}${awaitingTile.href}`);
  const awaiting = await rowsOn(page);
  const awaitingSum = r2(awaiting.reduce((a, r) => a + (r.balance ?? 0), 0));
  check(`C: Awaiting payment tile (${aed(awaitingTile.amount)}, ${awaitingTile.count} cars) = the sum of the balances listed behind it`, Math.abs(awaitingTile.amount - awaitingSum) < 0.005 && awaitingTile.count === awaiting.length, `${awaitingTile.amount} vs ${awaitingSum} · ${awaitingTile.count} vs ${awaiting.length}`);
  check("C: Awaiting payment holds every seeded balance (in work with an advance, proforma sent, tax invoice unpaid, left owing)", [C1, ID("a3"), ID("b3"), ID("c3"), ID("d3")].every((k) => awaiting.some((r) => r.key === k)) && !awaiting.some((r) => r.kind === "credit"));
  check("C: and never a car that left paid in full, nor one whose credit note covers what was left", !awaiting.some((r) => r.key === ID("e3") || r.key === ID("73")));
  check("C: the tile says the cars and splits due now / work in progress", /\d+ cars?( \+ \d+ pending charges?)? · AED [\d,]+ due now · AED [\d,]+ work in progress/.test(awaitingTile.text), awaitingTile.text);

  /* ---------------- D. Collected today: tile = list = SQL (rule B) ---------------- */
  const todayStart = new Date(`${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}T00:00:00+04:00`).toISOString();
  const sqlToday = async () => (await q("select coalesce(sum(amount_aed), 0)::float8 as s, count(*)::int as n from public.payments where is_active and status = 'recorded' and ((method <> 'cheque' and received_at >= $1) or (method = 'cheque' and cheque_status = 'cleared' and coalesce(cleared_at, received_at) >= $1))", [todayStart]))[0];
  await go(page, `${base}${todayTile.href}`);
  let today = await rowsOn(page);
  let s = await sqlToday();
  let listToday = r2(today.reduce((a, r) => a + r.today, 0));
  // Another suite on the shared TEST database may record a payment meanwhile: read once more before judging.
  if (Math.abs(listToday - s.s) > 0.005) { await go(page, `${base}${todayTile.href}`); today = await rowsOn(page); s = await sqlToday(); listToday = r2(today.reduce((a, r) => a + r.today, 0)); }
  const todayTile2 = await tile(page, "Collected today");
  check(`D: Collected today tile (${aed(todayTile2.amount)}) = SQL sum of today's payments (${aed(s.s)}) = the sum of 'today' on its list (${aed(listToday)})`, Math.abs(todayTile2.amount - s.s) < 0.005 && Math.abs(listToday - s.s) < 0.005);
  check(`D: the counts match: ${todayTile2.count} payments on the tile, ${s.n} in the database, ${today.reduce((a, r) => a + r.todayCount, 0)} on the list`, todayTile2.count === s.n && today.reduce((a, r) => a + r.todayCount, 0) === s.n);
  check("D: today's list holds the AED 30,000, both AED 8,000 and the Ready car's money; not the car paid yesterday", [C1, `credit:${ID("a1")}`, ID("a3"), ID("b3")].every((k) => today.some((r) => r.key === k)) && !today.some((r) => r.key === ID("e3") || r.key === ID("d3")));
  check("D: the chip 'Collected today' counts its rows", (await chipCount(page, "today")) === today.length);
  check(`D: the list's heading sums it (${await text(page.locator("[data-money-list-sum]"))})`, (await text(page.locator("[data-money-list-sum]"))).includes(aed(listToday)));
  await page.screenshot({ path: shot("5-collected-today-filter.png"), fullPage: false });
  check("D: the pending cheque is not collected, the cheque cleared today is (receipt numbers)", !!clearedCheque && !!proPay && !!advJ2);

  /* ---------------- E. Tax invoices today: tile = list = SQL ---------------- */
  await go(page, `${base}${taxTile.href}`);
  const taxRows = await rowsOn(page);
  const sqlTax = (await q("select count(*)::int as n from public.invoices where is_active and status = 'issued' and kind = 'tax_invoice' and deposit_for_quotation_id is null and issued_at >= $1", [todayStart]))[0].n;
  const taxTile2 = await tile(page, "Tax invoices today");
  check(`E: Tax invoices today tile (${taxTile2.count}) = SQL count (${sqlTax}) = the invoices on its list`, taxTile2.count === sqlTax && taxRows.reduce((a, r) => a + r.taxToday.length, 0) === sqlTax && taxRows.some((r) => r.key === ID("c3")));
  // Review of 3 November: one car with two tax invoices today - the heading and the chip count invoices, as the tile does.
  const taxHeading = await text(page.locator("[data-money-list-sum]"));
  check(`E: the list's heading says the tile's number of tax invoices (${taxHeading})`, taxHeading.startsWith(`${sqlTax} tax invoice`) && (taxRows.length === sqlTax || taxHeading.includes(`on ${taxRows.length} car`)), taxHeading);
  check("E: the chip 'Tax invoices today' counts the invoices too", (await chipCount(page, "tax_today")) === sqlTax);
  const c3Line = await text(page.locator(`[data-money-row="${ID("c3")}"] [data-money-tax-today-line]`));
  check("E: the car with two shows both numbers", c3Line.includes("E2E-INV-c5") && c3Line.includes("E2E-INV-c6"), c3Line);

  /* ---------------- F. Every chip counts its own list ---------------- */
  await go(page, `${base}/invoices`);
  const keys = await page.$$eval("[data-money-filters] [data-filter]", (els) => els.map((e) => e.getAttribute("data-filter") ?? ""));
  let chipsOk = true;
  const chipNotes = [];
  for (const k of keys) {
    const n = await chipCount(page, k);
    const p2 = await accounts.context.newPage();
    await p2.goto(`${base}/invoices${k ? `?show=${k}` : ""}`, { waitUntil: "load" });
    const listedRows = await rowsOn(p2);
    // "Tax invoices today" counts invoices (one car may have two), every other chip counts rows.
    const listed = k === "tax_today" ? listedRows.reduce((a, r) => a + r.taxToday.length, 0) : listedRows.length;
    await p2.close();
    if (n !== listed) { chipsOk = false; chipNotes.push(`${k || "all"} ${n}/${listed}`); }
  }
  check(`F: every chip's count is the length of its list (${keys.length} chips)`, chipsOk, chipNotes.join(" "));

  /* ---------------- G. The accounts dashboard: the same list and tiles, grouped ---------------- */
  await go(page, `${base}/dashboard`);
  const dAwait = await tile(page, "Awaiting payment");
  const dToday = await tile(page, "Collected today");
  check("G: the dashboard's tiles are the same figures", Math.abs(dAwait.amount - awaitingTile.amount) < 0.005 && dAwait.count === awaitingTile.count && Math.abs(dToday.amount - todayTile2.amount) < 0.005);
  const inGroup = async (g, key) => (await page.locator(`[data-awaiting-group="${g}"] [data-money-row="${key}"]`).count()) === 1;
  check("G: groups: the J-00969 copy and the other advance under 'In work, advance received'", (await inGroup("wip_advance", C1)) && (await inGroup("wip_advance", ID("a3"))));
  check("G: the sent proforma, the unpaid tax invoice and the car that left owing under 'Due now'", (await inGroup("due_now", ID("b3"))) && (await inGroup("due_now", ID("c3"))) && (await inGroup("due_now", ID("d3"))));
  check("G: 'Every advance' links to the advance list", (await page.locator("[data-advances-link]").getAttribute("href")) === "/invoices?show=advance");
  check("G: cars that left paid in full stay off the dashboard (they are on Invoices and payments)", (await page.locator(`[data-money-row="${ID("e3")}"], [data-money-row="${ID("73")}"]`).count()) === 0);
  check("G: no pending charge is a row on the dashboard (the owner's rule of 31 October)", (await page.locator('[data-money-kind="charge"]').count()) === 0);
  // The Awaiting heading plus the pending-charges line add up to the tile.
  const dHead = await text(page.locator("[data-awaiting-payment] > :first-child"));
  const dLine = (await page.locator("[data-pending-charges-line]").count()) ? await text(page.locator("[data-pending-charges-line]")) : "";
  const whole = (s) => Number(((s.match(/AED ([\d,]+)/) ?? [])[1] ?? "0").replace(/,/g, ""));
  check(`G: the dashboard's Awaiting heading (${dHead}) plus its pending-charges line (${dLine || "none"}) make the tile`, Math.abs(whole(dHead) + whole(dLine) - Math.round(dAwait.amount)) <= 1, `${whole(dHead)} + ${whole(dLine)} vs ${dAwait.amount}`);
  await page.screenshot({ path: shot("6-accounts-dashboard.png"), fullPage: true });

  /* ---------------- H. One rule on the job card, the money page and the customer page ---------------- */
  await go(page, `${base}/jobs/${C1}`);
  const cardLine = await text(page.locator("[data-money-tile] [data-paid-so-far]"));
  check("H: the job card says the same: Paid so far AED 30,000.00 · Balance", cardLine.includes("Paid so far AED 30,000.00") && cardLine.includes(`Balance ${aed(c1?.balance ?? -1)}`), cardLine);
  check("H: and its chip reads 'Advance AED 30,000 · AED … to pay'", /Advance AED 30,000 · AED [\d,]+ to pay/.test(await text(page.locator("[data-money-tile]"))));
  await go(page, `${base}/jobs/${C1}/invoice`);
  const figures = await text(page.locator("[data-money-figures]"));
  check("H: the money page's Paid so far and Balance due follow the same rule", /Paid so far\s*AED 30,000\.00/.test(figures) && new RegExp(`Balance due\\s*${aed(c1?.balance ?? -1).replace(/[.]/g, "\\.")}`).test(figures), figures);
  check("H: and the money page's chip reads 'Advance AED 30,000'", /Advance AED 30,000/.test(await text(page.locator("header, [data-page-header]").first())) || /Advance AED 30,000/.test(await text(page.locator("body"))));
  await go(page, `${base}/customers/${ID("a1")}`);
  const custLine = await text(page.locator(`[data-customer-job-money="${ID("a3")}"] [data-paid-so-far]`));
  check("H: the customer page's line is the same words (Paid so far AED 8,000.00 · Balance AED 4,600.00)", custLine.includes("Paid so far AED 8,000.00") && custLine.includes("Balance AED 4,600.00"), custLine);
  await go(page, `${base}/jobs/${ID("73")}/invoice`);
  const g3Money = `${await text(page.locator("[data-money-figures]"))} | ${await text(page.locator("[data-credit-note-off]").first())}`;
  check("H: the credit-noted car's money page says Paid in full and names the credit note taken off", /Balance due\s*Paid in full/.test(g3Money) && /Credit notes AED 1,050\.00 taken off/.test(g3Money), g3Money);

  /* ---------------- J. History by dates keeps to its dates ---------------- */
  const dubaiDay = (offset) => new Date(Date.now() + 4 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  await go(page, `${base}/invoices?from=${dubaiDay(-2)}&to=${dubaiDay(-2)}`);
  const ranged = new Set((await rowsOn(page)).map((r) => r.key));
  check("J: the dates list holds the invoice issued on that day (the car that left owing)", ranged.has(ID("d3")), [...ranged].join(","));
  check("J: and nothing that only had money or a tax invoice today (the J-00969 copy, today's tax invoice)", !ranged.has(C1) && !ranged.has(ID("c3")) && !ranged.has(ID("a3")));

  /* ---------------- K. The search keeps what it found (mobile, VIN) ---------------- */
  await go(page, `${base}/invoices?q=${encodeURIComponent("0500000941")}`);
  const byPhone = new Set((await rowsOn(page)).map((r) => r.key));
  check("K: a search by the customer's mobile lists that customer's job and credit, nobody else's", byPhone.has(ID("a3")) && byPhone.has(`credit:${ID("a1")}`) && !byPhone.has(C1) && !byPhone.has(ID("b3")), [...byPhone].join(","));
  await go(page, `${base}/invoices?q=E2ES4VINTEST00A41`);
  const byVin = new Set((await rowsOn(page)).map((r) => r.key));
  check("K: a search by the car's VIN lists its job", byVin.has(ID("a3")) && !byVin.has(C1), [...byVin].join(","));
  await page.screenshot({ path: shot("7-search-by-mobile-and-vin.png"), fullPage: false });

  /* ---------------- I. The one money rule, one job at a time and all at once ---------------- */
  const mc = await fetch(`${base}/api/e2e/money-check`, { method: "POST", headers: { "content-type": "application/json", "x-e2e-secret": secret }, body: JSON.stringify({ mode: "batch" }) }).then((r) => r.json());
  check(`I: every job's draft and money are the same one at a time and all at once (${mc.jobs} jobs, ${mc.withLines} with lines)`, mc.differences === 0 && mc.jobs >= 6, JSON.stringify(mc.diffs ?? []).slice(0, 300));
} catch (e) {
  check("no crash", false, String(e?.stack ?? e).slice(0, 600));
} finally {
  await accounts.browser.close().catch(() => null);
  // KEEP=1 leaves the seeded rows for a look by hand (run the clean-up afterwards: npm run test:cleanup).
  if (!process.env.KEEP) cleanupDb();
}
process.exit(summary() ? 1 : 0);
