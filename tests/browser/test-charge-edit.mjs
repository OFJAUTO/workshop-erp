// EDIT A CHARGE AFTER IT IS SAVED (21 November 2026, Section 1; real case J-01030 "DELIVERY CHARGES - SHANGAI GLOBAL
// AUTO PARTS"). On TEST: an advisor corrects an internal charge (wording, provider from the supplier list); a charge the
// customer agreed on the check-in keeps its wording and price locked; a charge recorded in a Journal Voucher keeps its
// cost locked for the advisor, and accounts change it - the voucher follows. Every change is in the history.
//   node --env-file=.env.test.local tests/browser/test-charge-edit.mjs    (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { base, browserForId, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const proofDir = path.resolve("docs/proof/2026-11-21-charge-edit");
mkdirSync(proofDir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const accountsRow = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const mm = (await sql("select m.id as make_id, (select id from public.vehicle_models where make_id = m.id limit 1) as model_id from public.vehicle_makes m where exists (select 1 from public.vehicle_models where make_id = m.id) limit 1"))[0];
const browsers = [];

cleanupDb();
try {
  const sup = (await sql("insert into public.suppliers (name, trn) values ('E2E SHANGHAI GLOBAL AUTO SPARE PARTS', '104139533400003') on conflict ((lower(name))) do update set trn = excluded.trn returning id"))[0];
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'Charge Edit E2e', '+971500000091') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'C', '91091', $2, $3, 2024, 'E2ECHARGEEDIT0091') returning id", [cust, mm.make_id, mm.model_id]))[0].id;
  const job = (await sql("insert into public.jobs (vehicle_id, customer_id, stage, status, gated_in_by, is_open, advisor_id, created_by, updated_by) values ($1, $2, 'work', 'in_work', $3, true, $3, $3, $3) returning id, job_number", [car, cust, advisor.id]))[0];
  const mk = async (desc, extra = "") => (await sql(`insert into public.charge_lines (job_id, kind, description, cost_aed, charge_aed, free, free_status, created_by, updated_by${extra ? ", agreed_at" : ""}) values ($1, 'delivery', $2, 40, 0, true, 'approved', $3, $3${extra ? ", now()" : ""}) returning id`, [job.id, desc, advisor.id]))[0].id;
  const internal = await mk("DELIVERY CHARGES - SHANGAI GLOBAL AUTO PARTS");
  const agreed = await mk("RECOVERY AGREED E2E", "agreed");
  const onJv = await mk("DELIVERY ON VOUCHER E2E");
  const v = (await sql("insert into public.journal_vouchers (kind, status, paid_by, paid_on, expense_type, description, amount_aed, vat_aed, created_by, updated_by) values ('charge', 'paid', 'cash', current_date, 'delivery', 'E2E delivery voucher', 40, 0, $1, $1) returning id, number", [accountsRow.id]))[0];
  await sql("insert into public.journal_voucher_lines (voucher_id, charge_line_id, job_id, amount_aed, vat_aed, created_by, updated_by) values ($1, $2, $3, 40, 0, $4, $4)", [v.id, onJv, job.id, accountsRow.id]);
  check("seed: one job with three saved charges (internal, agreed on the check-in, on a voucher)", !!job.id && !!v.number, `${job.job_number} ${v.number}`);

  /* ---------- A. The advisor corrects the internal charge ---------- */
  const adv = await browserForId(advisor.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(adv);
  const p = adv.page;
  await go(p, `${base}/jobs/${job.id}#charges`);
  const editOf = (id) => p.locator(`[data-charge-edit="${id}"]`);
  check("A1: every saved charge has an Edit button", (await p.locator("[data-charge-edit-open]").count()) === 3);
  await editOf(internal).locator("[data-charge-edit-open]").click();
  check("A2: the internal charge says everything can change", (await editOf(internal).locator("[data-charge-edit-internal]").count()) === 1);
  await editOf(internal).locator("[data-charge-edit-description]").fill("DELIVERY CHARGES - SHANGHAI GLOBAL AUTO SPARE PARTS");
  await editOf(internal).locator('[data-provider-name="charge-edit"]').fill("E2E SHANGHAI GLOBAL AUTO SPARE PARTS");
  await sleep(200);
  check("A3: the provider is picked from the supplier list and its TRN fills in by itself", (await editOf(internal).locator('[data-provider-known="charge-edit"]').count()) === 1 && (await editOf(internal).locator('[data-provider-trn="charge-edit"]').inputValue()) === "104139533400003");
  await editOf(internal).locator("[data-charge-edit-note]").fill("Name corrected from the bill");
  await p.screenshot({ path: path.join(proofDir, "a1-edit-window-1440.png"), fullPage: true });
  await editOf(internal).locator('[data-confirm-open="charge-edit"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  const doneA = await until(async () => (await editOf(internal).locator("[data-charge-edit-done]").count()) ? await editOf(internal).locator("[data-charge-edit-done]").textContent() : null, 60, 500);
  check("A4: saved, the answer inside the Edit window", !!doneA, doneA ?? (await editOf(internal).locator("[data-charge-edit-error]").textContent().catch(() => "")));
  const rowA = (await sql("select description, provider, supplier_id, supplier_trn, note, jsonb_array_length(edit_history) as n from public.charge_lines where id = $1", [internal]))[0];
  check("A5: the wording, provider (supplier record) and note are saved", rowA.description === "DELIVERY CHARGES - SHANGHAI GLOBAL AUTO SPARE PARTS" && rowA.supplier_id === sup.id && rowA.supplier_trn === "104139533400003" && rowA.note === "Name corrected from the bill", JSON.stringify(rowA));
  check("A6: the change is in the charge's history and the job's history", rowA.n === 1 && (await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'charge_edited'", [job.id]))[0].n === 1);
  await go(p, `${base}/jobs/${job.id}#charges`);
  await editOf(internal).locator("[data-charge-edit-open]").click();
  check("A7: the history shows who, old and new", /SHANGAI GLOBAL AUTO PARTS → DELIVERY CHARGES - SHANGHAI/i.test((await editOf(internal).locator("[data-charge-history]").textContent()) ?? ""));

  /* ---------- B. Agreed on the check-in: wording and price locked ---------- */
  await editOf(agreed).locator("[data-charge-edit-open]").click();
  check("B1: agreed on the check-in: the customer's wording and price are locked, provider and cost still open", (await editOf(agreed).locator("[data-charge-edit-customer-locked]").count()) === 1 && (await editOf(agreed).locator("[data-charge-edit-description]").count()) === 0 && (await editOf(agreed).locator("[data-charge-edit-cost]").count()) === 1);
  await editOf(agreed).locator("[data-charge-edit-cost]").fill("55");
  await editOf(agreed).locator('[data-confirm-open="charge-edit"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  await until(async () => (await editOf(agreed).locator("[data-charge-edit-done]").count()) > 0, 60, 500);
  check("B2: its internal cost is corrected", Number((await sql("select cost_aed from public.charge_lines where id = $1", [agreed]))[0].cost_aed) === 55);

  /* ---------- C. On a Journal Voucher: the advisor cannot change the cost; accounts can, the voucher follows ---------- */
  await editOf(onJv).locator("[data-charge-edit-open]").click();
  check("C1: on a voucher, the cost is locked for the advisor (names the voucher)", (await editOf(onJv).locator("[data-charge-edit-cost-locked]").count()) === 1 && new RegExp(v.number).test((await editOf(onJv).locator("[data-charge-edit-cost-locked]").textContent()) ?? ""));
  await p.setViewportSize({ width: 800, height: 1280 });
  await p.screenshot({ path: path.join(proofDir, "c1-advisor-cost-locked-800.png"), fullPage: true });
  const acc = await browserForId(accountsRow.id, { viewport: { width: 1440, height: 1000 } });
  browsers.push(acc);
  const q = acc.page;
  await go(q, `${base}/jobs/${job.id}#charges`);
  const ed = q.locator(`[data-charge-edit="${onJv}"]`);
  await ed.locator("[data-charge-edit-open]").click();
  await ed.locator("[data-charge-edit-cost]").fill("45");
  await ed.locator('[data-confirm-open="charge-edit"]').click();
  await q.locator("[data-confirm-yes-money]").click();
  const doneC = await until(async () => (await ed.locator("[data-charge-edit-done]").count()) ? await ed.locator("[data-charge-edit-done]").textContent() : null, 60, 500);
  check("C2: accounts change the cost; the answer names the voucher", !!doneC && new RegExp(`${v.number} follows`).test(doneC), doneC ?? "");
  const vNow = await until(async () => { const r = (await sql("select amount_aed::float as a from public.journal_vouchers where id = $1", [v.id]))[0]; return r.a === 45 ? r : null; }, 20, 500);
  const lNow = (await sql("select amount_aed::float as a from public.journal_voucher_lines where voucher_id = $1 and is_active", [v.id]))[0];
  check("C3: the job's cost, the voucher line and the voucher total move together (45.00)", !!vNow && lNow.a === 45 && Number((await sql("select cost_aed from public.charge_lines where id = $1", [onJv]))[0].cost_aed) === 45);
  await q.screenshot({ path: path.join(proofDir, "c2-accounts-voucher-follows-1440.png"), fullPage: true });

  /* ---------- D. The server refuses a locked change even if the screen were bypassed ---------- */
  await sql("update public.charge_lines set agreed_at = now() where id = $1", [internal]);
  await go(p, `${base}/jobs/${job.id}#charges`);
  await editOf(internal).locator("[data-charge-edit-open]").click();
  await editOf(internal).locator('input[name="description"]').evaluate((el) => { el.value = "CHANGED BEHIND THE SCREEN"; });
  await editOf(internal).locator('[data-confirm-open="charge-edit"]').click();
  await p.locator("[data-confirm-yes-money]").click();
  const err = await until(async () => (await editOf(internal).locator("[data-charge-edit-error]").count()) ? await editOf(internal).locator("[data-charge-edit-error]").textContent() : null, 40, 500);
  check("D1: a locked field changed behind the screen is refused by the server in words", !!err && /locked/i.test(err), err ?? "");
} catch (e) {
  check("no crash", false, String(e?.stack ?? e));
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
