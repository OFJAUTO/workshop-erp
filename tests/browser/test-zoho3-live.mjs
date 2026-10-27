// Zoho Books phase 3/4, LIVE proof against OFJ TEST: a no-VAT supplier's bill, a vendor credit applied to the
// bill, a customer refund on a credit note, and the daily reconciliation catching a deliberately broken day and
// going green again once it is fixed. Same shape as the earlier live suites: seed through the local dev server,
// drive the LIVE cron with CRON_SECRET, assert from the stored results. The go-live flip itself is NEVER run.
//   node --env-file=.env.local tests/browser/test-zoho3-live.mjs   (local dev server, no ZOHO_* values)
import { api, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 16 * 60 * 1000).unref();
const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const CRON = process.env.CRON_SECRET ?? "";
if (!CRON) { console.log("CRON_SECRET missing"); process.exit(1); }
cleanupDb();

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
async function cron(params = "") {
  const r = await fetch(`${LIVE}/api/cron/zoho${params}`, { headers: { authorization: `Bearer ${CRON}` }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  console.log(`   cron${params}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return { status: r.status, ...j };
}
const row = async (kind, recordId) => (await sql("select status, last_error, zoho_id, zoho_result from public.zoho_outbox where kind = $1 and record_id = $2", [kind, recordId]))[0] ?? null;
async function settled(kind, recordId, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await row(kind, recordId);
    if (r && r.status !== "pending") return r;
    await cron();
    await sleep(1500);
  }
  return row(kind, recordId);
}
const enqueue = (kind, recordId, jobId = null) => sql("insert into public.zoho_outbox (kind, record_id, job_id) values ($1, $2, $3) on conflict (kind, record_id) do update set status = 'pending', last_error = null, claimed_at = null", [kind, recordId, jobId]);
const RUN = Date.now().toString(36);
const TODAY = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

let jobId = null;
let customerId = null;
let vehicleId = null;
let supplierId = null;
let po = null;

/* ---------------- 0. setup ---------------- */
await section("0 setup", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const [job] = await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]);
  customerId = job.customer_id;
  vehicleId = job.vehicle_id;
  // A supplier who genuinely charges no VAT: switch off, NO TRN.
  const [sup] = await sql("insert into public.suppliers (name, phone, vat_registered) values ($1, '+971500000096', false) returning id", [`E2e Novat Zoho ${RUN}`]);
  supplierId = sup.id;
  check("0: seed ready", !!jobId && !!supplierId, JSON.stringify({ jobId, run: RUN }));
});

/* ---------------- (a) the no-VAT supplier's bill ---------------- */
await section("a no-VAT bill", async () => {
  const [part] = await sql("select id from public.part_items where job_id = $1 limit 1", [jobId]);
  const [poRow] = await sql(
    `insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at)
     values ($1, 'supplier', $2, $3, $4, 'received', 400, 'received', $5, $6, 400, now()) returning id, number`,
    [`LPO-E2E9-${RUN}-1`, jobId, supplierId, `E2e Novat Zoho ${RUN}`, `E2ENV-${RUN}-1`, TODAY],
  );
  po = poRow;
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost) values ($1, $2, 'Used gearbox mount', 2, 200)", [po.id, part.id]);
  await enqueue("bill", po.id, jobId);
  const r = await settled("bill", po.id);
  check("a: the bill posted WITHOUT VAT (400.00 flat, nothing red, no TRN asked)", r?.status === "synced" && r?.zoho_result?.zoho?.net === 400 && r?.zoho_result?.zoho?.vat === 0 && r?.zoho_result?.zoho?.total === 400, JSON.stringify(r)?.slice(0, 350));
});

/* ---------------- (b) a returned part becomes a vendor credit applied to the bill ---------------- */
await section("b vendor credit", async () => {
  const [part] = await sql(
    "insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, po_id, disposition, disposition_note, disposition_at, not_needed_at) values ($1, 'E2e mount (wrong one)', 1, 1, 150, $2, 'to_order', $3, 'returned', 'SCN-' || $4, now(), now()) returning id",
    [jobId, `E2e Novat Zoho ${RUN}`, po.id, RUN],
  );
  await enqueue("vendorcredit", part.id, jobId);
  const r = await settled("vendorcredit", part.id);
  check("b: the vendor credit posted (150.00, no VAT) and applied to the bill", r?.status === "synced" && r?.zoho_result?.zoho?.total === 150 && r?.zoho_result?.applied_now === 150, JSON.stringify(r)?.slice(0, 350));
  check("b: the bill now shows 250.00 due", r?.zoho_result?.bill_balance_after === 250, JSON.stringify(r?.zoho_result));
  const [pt] = await sql("select zoho_vendorcredit_id from public.part_items where id = $1", [part.id]);
  check("b: the vendor-credit id is stored on the part", !!pt?.zoho_vendorcredit_id, JSON.stringify(pt));
});

/* ---------------- (c) a customer refund against a credit note ---------------- */
await section("c customer refund", async () => {
  const [inv] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ($1, 'tax_invoice', $2, $3, $4, $5, 600, 0, 600, 30, 630) returning id, number",
    [`TINV-${RUN}-1`, jobId, customerId, vehicleId, `e2e${RUN}r1`],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, details, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Oil service', '2.0 h', 2, 300, 600, 30, 630, 0)", [inv.id]);
  const [pay] = await sql(
    "insert into public.payments (number, job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, is_deposit, status, received_at) values ($1, $2, $3, $4, 'cash', 630, 0, false, 'recorded', now()) returning id",
    [`TRCT-${RUN}-1`, jobId, inv.id, customerId],
  );
  await enqueue("invoice", inv.id, jobId);
  await enqueue("payment", pay.id, jobId);
  const invRow = await settled("invoice", inv.id);
  await settled("payment", pay.id);
  check("c: the invoice posted and is being paid", invRow?.status === "synced", JSON.stringify(invRow)?.slice(0, 200));
  // The credit note on a PAID invoice stays unapplied - exactly the refund case.
  const [cn] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, credit_of, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, notes) values ($1, 'credit_note', $2, $3, $4, $5, $6, 200, 0, 200, 10, 210, 'Goodwill') returning id, number",
    [`TCN-${RUN}-1`, jobId, customerId, vehicleId, inv.id, `e2e${RUN}r2`],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Goodwill credit', 1, 200, 200, 10, 210, 0)", [cn.id]);
  await enqueue("creditnote", cn.id, jobId);
  const cnRow = await settled("creditnote", cn.id);
  check("c: the credit note posted, fully UNAPPLIED (the invoice was already paid)", cnRow?.status === "synced" && cnRow?.zoho_result?.zoho?.unapplied === 210, JSON.stringify(cnRow)?.slice(0, 300));
  await sql("update public.invoices set refund_paid_at = now(), refund_method = 'transfer', refund_reference = 'E2E TT 55', refund_amount_aed = 210 where id = $1", [cn.id]);
  await enqueue("cnrefund", cn.id, jobId);
  const rf = await settled("cnrefund", cn.id);
  check("c: the refund posted (210.00) and consumed the credit", rf?.status === "synced" && rf?.zoho_result?.refund === 210 && rf?.zoho_result?.cn_unapplied_after === 0, JSON.stringify(rf)?.slice(0, 300));
  const [stored] = await sql("select zoho_refund_id from public.invoices where id = $1", [cn.id]);
  check("c: the refund id is stored", !!stored?.zoho_refund_id, JSON.stringify(stored));
});

/* ---------------- (d) the reconciliation catches a broken day, then goes green ---------------- */
await section("d reconciliation", async () => {
  const base1 = await cron(`?reconcile=${TODAY}`);
  check("d: today reconciles after the seeds (baseline)", base1.ok === true && !!base1.status, JSON.stringify(base1));
  const baseline = base1.status;
  // Break the day: a tax invoice that exists ONLY in the ERP (never queued).
  const [ghost] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ($1, 'tax_invoice', $2, $3, $4, $5, 1000, 0, 1000, 50, 1050) returning id",
    [`TINV-${RUN}-GHOST`, jobId, customerId, vehicleId, `e2e${RUN}gh`],
  );
  const broken = await cron(`?reconcile=${TODAY}`);
  check("d: the broken day turns RED", broken.status === "red", JSON.stringify(broken));
  const [reconRow] = await sql("select status, details from public.zoho_reconciliation where day = $1", [TODAY]);
  const invSection = (reconRow?.details?.sections ?? []).find((s) => s.label === "Tax invoices");
  check("d: the row names the exact difference on tax invoices", reconRow?.status === "red" && invSection?.ok === false && /in the ERP vs .* in Zoho/.test(invSection?.diff ?? ""), JSON.stringify(invSection));
  const bell = (await sql("select id from public.notifications where type = 'zoho_reconciliation' and created_at > now() - interval '10 minutes' limit 1"))[0];
  check("d: the red day rang the bell (owner + accounts)", !!bell, JSON.stringify(bell));
  // Fix it: the ghost posts, the day re-checks.
  await enqueue("invoice", ghost.id, jobId);
  const ghostRow = await settled("invoice", ghost.id);
  check("d: the missing invoice posts on Retry", ghostRow?.status === "synced", JSON.stringify(ghostRow)?.slice(0, 160));
  const fixed = await cron(`?reconcile=${TODAY}`);
  check("d: the day goes back to the baseline once fixed", fixed.status === baseline, `baseline ${baseline}, now ${fixed.status}`);
});

/* ---------------- clean up (today's recon row too: the ERP rows leave, Zoho TEST keeps its documents) ---------------- */
if (process.env.KEEP) {
  console.log("\nKEEP=1: rows stay for screenshots - run npm run test:cleanup and delete today's recon row after.");
  process.exit(summary() ? 1 : 0);
}
await sql("delete from public.zoho_reconciliation where day = $1", [TODAY]).catch(() => null);
await sql("delete from public.notifications where type = 'zoho_reconciliation' and created_at > now() - interval '2 hours'").catch(() => null);
cleanupDb();
process.exit(summary() ? 1 : 0);
