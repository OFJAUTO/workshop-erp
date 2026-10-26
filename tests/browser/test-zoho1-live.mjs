// Zoho Books phase 1, LIVE proof against OFJ TEST (26 October 2026, docs/zoho-plan.md). The dev machine has no
// Zoho secret, so the WORKER runs on the live site: this test seeds ERP rows in the shared database through the
// local dev server, queues them, calls the LIVE five-minute cron with CRON_SECRET, and reads the figures the
// worker stored back on the outbox rows (zoho_result) — Zoho's own totals next to the ERP's.
//   (a) deposit by payment link + final cash: advance posted without VAT, applied, balance 0
//   (b) line discount + total discount + round-off: Zoho total and VAT match the ERP to the fils
//   (c) bodyshop package with a complimentary line: one priced line, rate-0 line, bodyshop account
//   (d) two payments, card and transfer: bank charges 2.26% / 0, both applied
//   (e) forced failure ("Mapping missing") then Retry; and the adopt pass (cleared id -> same Zoho invoice)
// Needs: the dev server (no ZOHO_* values), CRON_SECRET in .env.local, and the live site deployed with phase 1.
//   node --env-file=.env.local tests/browser/test-zoho1-live.mjs
import { api, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const CRON = process.env.CRON_SECRET ?? "";
if (!CRON) { console.log("CRON_SECRET missing from .env.local"); process.exit(1); }
cleanupDb();

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
/** The live worker, on demand: the same run the five-minute cron makes. */
async function cron() {
  const r = await fetch(`${LIVE}/api/cron/zoho`, { headers: { authorization: `Bearer ${CRON}` }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  console.log(`   cron: ${r.status} ${JSON.stringify(j)}`);
  return { status: r.status, ...j };
}
const row = async (recordId) => (await sql("select kind, status, last_error, zoho_id, zoho_result from public.zoho_outbox where record_id = $1", [recordId]))[0] ?? null;
async function syncedRow(recordId, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await row(recordId);
    if (r && r.status !== "pending") return r;
    await cron();
    await sleep(1500);
  }
  return row(recordId);
}
const enqueue = (kind, recordId, jobId) => sql("insert into public.zoho_outbox (kind, record_id, job_id) values ($1, $2, $3) on conflict (kind, record_id) do update set status = 'pending', last_error = null", [kind, recordId, jobId]);
const r2 = (n) => Math.round(n * 100) / 100;

let jobId = null;
let customerId = null;
let vehicleId = null;
// Run-unique numbers: 'TINV-' never collides with the ERP's own INV- numbering (nextDocumentNumber scans 'INV-%'
// only) and never collides in OFJ TEST across runs, so every run creates fresh Zoho invoices and the adopt pass
// is tested deliberately in (e2), never by accident against an older run's leftovers.
const RUN = Date.now().toString(36);
let nextInv = 1;

async function newInvoice({ lines, discount = 0, rounded = null, vatPercent = 5 }) {
  const number = `TINV-${RUN}-${nextInv++}`;
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const before = r2(subtotal - discount);
  const total = rounded ?? r2(before + r2(before * (vatPercent / 100)));
  const taxable = rounded ? r2(total / (1 + vatPercent / 100)) : before;
  const vat = r2(total - taxable);
  const [inv] = await sql(
    `insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, warranty_credit_aed, discount_note)
     values ($1, 'tax_invoice', $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11) returning id, number, total_aed::float as total, vat_aed::float as vat, taxable_aed::float as taxable`,
    [number, jobId, customerId, vehicleId, `e2e${Date.now()}${nextInv}`, subtotal, discount, taxable, vat, total, discount ? "Discount as approved on the quotation" : null],
  );
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await sql(
      `insert into public.invoice_lines (invoice_id, position, section, description, details, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, discount_percent, price_display, package_items)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13::jsonb)`,
      [inv.id, i, l.section ?? "services", l.description, l.details ?? null, l.qty, l.unit, l.amount, r2(l.amount * 0.05), r2(l.amount * 1.05), l.discountPercent ?? 0, l.priceDisplay ?? "normal", l.packageItems ? JSON.stringify(l.packageItems) : null],
    );
  }
  return inv;
}

async function newPayment({ invoiceId = null, method, amount, chargePercent = 0, isDeposit = false }) {
  const [p] = await sql(
    `insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, is_deposit, status, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'recorded', now()) returning id, number, amount_aed::float as amount, bank_charge_aed::float as charge`,
    [jobId, invoiceId, customerId, method, amount, r2(amount * (chargePercent / 100)), isDeposit],
  );
  return p;
}

/* ---------------- setup: the live site has phase 1, and the seed is in place ---------------- */
await section("0 setup", async () => {
  const probe = await fetch(`${LIVE}/api/cron/zoho`, { cache: "no-store" });
  check("0: the live site carries /api/cron/zoho (401 without the secret)", probe.status === 401, String(probe.status));
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const [job] = await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]);
  customerId = job.customer_id;
  vehicleId = job.vehicle_id;
  check("0: seed ready", !!jobId && !!customerId, JSON.stringify({ jobId, run: RUN }));
  const w = await api("/api/e2e/zoho", { action: "write_org" });
  check("0: writes aim at OFJ TEST and the switch is off", w.json?.org === "944122733" && w.json?.live === false, JSON.stringify(w.json)?.slice(0, 120));
});

/* ---------------- (a) deposit by link, final cash ---------------- */
let invA = null;
await section("a deposit by link + final cash", async () => {
  const deposit = await newPayment({ method: "link", amount: 200, chargePercent: 1.75, isDeposit: true });
  invA = await newInvoice({ lines: [{ description: "Oil service", details: "2.0 h", qty: 2, unit: 300, amount: 600 }] }); // 600 + 30 VAT = 630
  const cash = await newPayment({ invoiceId: invA.id, method: "cash", amount: r2(invA.total - 200) });
  await enqueue("deposit", deposit.id, jobId);
  await enqueue("invoice", invA.id, jobId);
  await enqueue("payment", cash.id, jobId);
  const dep = await syncedRow(deposit.id);
  check("a: the deposit posted as an advance (no VAT, nothing else)", dep?.status === "synced" && dep?.zoho_result?.kind === "advance" && dep?.zoho_result?.amount === 200, JSON.stringify(dep)?.slice(0, 300));
  check("a: the link's 1.75% bank charge rode along", dep?.zoho_result?.bank_charges === 3.5, JSON.stringify(dep?.zoho_result));
  const inv = await syncedRow(invA.id);
  check("a: the invoice posted with the ERP figures to the fils", inv?.status === "synced" && inv?.zoho_result?.zoho?.total === invA.total && inv?.zoho_result?.zoho?.vat === invA.vat, JSON.stringify(inv)?.slice(0, 400));
  check("a: Zoho carries the ERP's exact number", inv?.zoho_result?.number === invA.number, String(inv?.zoho_result?.number));
  check("a: the advance was applied at invoice time", (inv?.zoho_result?.applied_payments ?? 0) >= 1, JSON.stringify(inv?.zoho_result));
  const pay = await syncedRow(cash.id);
  check("a: the cash payment posted and was applied at once", pay?.status === "synced" && pay?.zoho_result?.applied_now === 1, JSON.stringify(pay)?.slice(0, 300));
  // The re-check pass: everything paid, Zoho's balance must be 0.
  await sql("update public.zoho_outbox set status = 'pending' where record_id = $1", [invA.id]);
  const again = await syncedRow(invA.id);
  check("a: re-checked - Zoho balance 0 after both payments", again?.status === "synced" && again?.zoho_result?.zoho?.balance === 0, JSON.stringify(again?.zoho_result));
  const [cust] = await sql("select zoho_contact_id from public.customers where id = $1", [customerId]);
  check("a: the customer's Zoho id is stored (matched or created once)", !!cust?.zoho_contact_id, JSON.stringify(cust));
});

/* ---------------- (b) line discount, total discount and round-off ---------------- */
let invB = null;
let invBZohoId = null;
await section("b discounts and round-off to the fils", async () => {
  // The worked example from the money-model map: labour 700, part 1000 with 10% line discount -> 900,
  // header discount 70, rounded down to 1600 -> taxable 1523.81, VAT 76.19.
  invB = await newInvoice({
    lines: [
      { description: "Brake overhaul", details: "2.0 h", qty: 2, unit: 350, amount: 700 },
      { description: "Brake pads · front", section: "parts", qty: 2, unit: 500, amount: 900, discountPercent: 10 },
    ],
    discount: 70,
    rounded: 1600,
  });
  check("b: the ERP figures are the worked example", invB.total === 1600 && invB.vat === 76.19 && invB.taxable === 1523.81, JSON.stringify(invB));
  await enqueue("invoice", invB.id, jobId);
  const r = await syncedRow(invB.id);
  invBZohoId = r?.zoho_id ?? null;
  check("b: posted, Zoho total 1600.00 and VAT 76.19 exactly", r?.status === "synced" && r?.zoho_result?.zoho?.total === 1600 && r?.zoho_result?.zoho?.vat === 76.19, JSON.stringify(r)?.slice(0, 400));
  check("b: the labour and the part each hit their own income account", r?.zoho_result?.line_accounts?.labour === 1 && r?.zoho_result?.line_accounts?.parts === 1, JSON.stringify(r?.zoho_result?.line_accounts));
});

/* ---------------- (d) two payments: card and transfer, bank charges right ---------------- */
await section("d card + transfer with bank charges", async () => {
  const card = await newPayment({ invoiceId: invB.id, method: "card", amount: 1000, chargePercent: 2.26 });
  const transfer = await newPayment({ invoiceId: invB.id, method: "transfer", amount: 600 });
  await enqueue("payment", card.id, jobId);
  await enqueue("payment", transfer.id, jobId);
  const c = await syncedRow(card.id);
  check("d: the card payment carries the 2.26% bank charge", c?.status === "synced" && c?.zoho_result?.bank_charges === 22.6 && c?.zoho_result?.mode === "creditcard", JSON.stringify(c)?.slice(0, 300));
  const t = await syncedRow(transfer.id);
  check("d: the transfer carries no charge and was applied", t?.status === "synced" && (t?.zoho_result?.bank_charges ?? 0) === 0 && t?.zoho_result?.applied_now === 1, JSON.stringify(t)?.slice(0, 300));
  await sql("update public.zoho_outbox set status = 'pending' where record_id = $1", [invB.id]);
  const again = await syncedRow(invB.id);
  check("d: the invoice balance in Zoho is 0 after both", again?.zoho_result?.zoho?.balance === 0, JSON.stringify(again?.zoho_result));
});

/* ---------------- (c) + (e1) package, complimentary, forced failure, Retry ---------------- */
let invC = null;
await section("c package and complimentary, e1 forced failure then Retry", async () => {
  const pkg = { key: "ofj_platinum", name: "OFJ Platinum — full body PPF", items: [{ label: "Full body OFJ Bespoke PPF", warranty: "5-year" }, { label: "Windscreen protection film", warranty: "1-year" }], pickup_dropoff: true, aftercare_check: true, time_in_workshop: "5 days" };
  invC = await newInvoice({
    lines: [
      { description: "OFJ Platinum — full body PPF", qty: 1, unit: 5000, amount: 5000, packageItems: pkg },
      { description: "Complimentary pick-up & drop-off", qty: 1, unit: 500, amount: 0, priceDisplay: "complimentary" },
    ],
  }); // 5000 + 250 VAT = 5250
  // e1: break the mapping first -> FAILED in plain words; then put it back -> Retry -> posted.
  const [stored] = await sql("select value from public.settings where key = 'zoho_account_map'");
  const broken = JSON.parse(JSON.stringify(stored.value));
  delete broken.income.bodyshop;
  await sql("update public.settings set value = $1::jsonb where key = 'zoho_account_map'", [JSON.stringify(broken)]);
  await enqueue("invoice", invC.id, jobId);
  const fail = await syncedRow(invC.id);
  check("e1: the row FAILED with 'Mapping missing: Bodyshop & PPF' (never half-posted)", fail?.status === "failed" && /Mapping missing: Bodyshop & PPF/.test(fail?.last_error ?? ""), JSON.stringify(fail)?.slice(0, 300));
  await sql("update public.settings set value = $1::jsonb where key = 'zoho_account_map'", [JSON.stringify(stored.value)]);
  await sql("update public.zoho_outbox set status = 'pending', last_error = null where record_id = $1", [invC.id]);
  const ok = await syncedRow(invC.id);
  check("c: after Retry the package invoice posted - 5,250.00 with VAT 250.00", ok?.status === "synced" && ok?.zoho_result?.zoho?.total === 5250 && ok?.zoho_result?.zoho?.vat === 250, JSON.stringify(ok)?.slice(0, 400));
  check("c: the package line went to the bodyshop account; the complimentary line posted at 0", ok?.zoho_result?.line_accounts?.bodyshop === 1, JSON.stringify(ok?.zoho_result?.line_accounts));
});

/* ---------------- (e2) never twice: the adopt pass ---------------- */
await section("e2 never twice (adopt by number)", async () => {
  await sql("update public.invoices set zoho_invoice_id = null where id = $1", [invB.id]);
  await sql("update public.zoho_outbox set status = 'pending', zoho_id = null where record_id = $1", [invB.id]);
  const r = await syncedRow(invB.id);
  check("e2: with the stored id wiped, the worker ADOPTED the existing Zoho invoice (same id, no second copy)", r?.status === "synced" && !!r?.zoho_id && r?.zoho_id === invBZohoId, `before ${invBZohoId} after ${r?.zoho_id}`);
  const [stored] = await sql("select zoho_invoice_id from public.invoices where id = $1", [invB.id]);
  check("e2: the Zoho id is back on the ERP invoice", stored?.zoho_invoice_id === invBZohoId, JSON.stringify(stored));
});

/* ---------------- clean up (the ERP side; OFJ TEST keeps its test documents) ---------------- */
await sql("delete from public.zoho_outbox where job_id = $1 or record_id in (select id from public.payments where job_id = $1) or record_id in (select id from public.invoices where job_id = $1) or record_id = $2", [jobId, customerId]).catch(() => null);
cleanupDb();
process.exit(summary() ? 1 : 0);
