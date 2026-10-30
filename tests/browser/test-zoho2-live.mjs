// Zoho Books phase 2, LIVE proof against OFJ TEST (26 October 2026): vendors, supplier bills with the courier line
// and the scan attached, "invoice to follow" held back, vendor payments settling two bills, a credit note applied
// to a phase 1 invoice, commission and recovery-month expenses with their proofs, forced failure + Retry, and the
// never-twice adopt pass. Same shape as test-zoho1-live: seed in the shared DB through the local dev server, drive
// the LIVE five-minute cron with CRON_SECRET, assert from zoho_outbox.zoho_result.
//   node --env-file=.env.test.local tests/browser/test-zoho2-live.mjs   (local dev server, no ZOHO_* values)
import { api, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 16 * 60 * 1000).unref();
const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const CRON = process.env.CRON_SECRET ?? "";
if (!CRON) { console.log("CRON_SECRET missing from .env.local"); process.exit(1); }
cleanupDb();
// The go-live panel warns when a live test ran in the last 7 days (its documents stay in OFJ TEST).
await sql("update public.settings set value = to_jsonb(now()::text) where key = 'zoho_last_live_test_at'");

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
async function cron() {
  const r = await fetch(`${LIVE}/api/cron/zoho`, { headers: { authorization: `Bearer ${CRON}` }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  console.log(`   cron: ${r.status} ${JSON.stringify(j)}`);
  return { status: r.status, ...j };
}
const row = async (kind, recordId) => (await sql("select kind, status, last_error, zoho_id, zoho_result from public.zoho_outbox where kind = $1 and record_id = $2", [kind, recordId]))[0] ?? null;
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
const r2 = (n) => Math.round(n * 100) / 100;
const RUN = Date.now().toString(36);
const TODAY = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

// A tiny but real PDF for the attachments.
const PDF = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n`);
async function putFile(path, buf, contentType) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": contentType, "x-upsert": "true" },
    body: buf,
  });
  return r.ok;
}

let jobId = null;
let customerId = null;
let vehicleId = null;
let supplierId = null;
let po1 = null;
let po2 = null;

/* ---------------- 0. setup ---------------- */
await section("0 setup", async () => {
  const probe = await fetch(`${LIVE}/api/cron/zoho`, { cache: "no-store" });
  check("0: the live cron answers 401 without the secret", probe.status === 401, String(probe.status));
  const w = await api("/api/e2e/zoho", { action: "write_org" });
  check("0: writes aim at OFJ TEST, switch off, the new mapping groups are stored", w.json?.org === "944122733" && w.json?.live === false && !!w.json?.map?.purchases && !!w.json?.map?.expense, JSON.stringify(w.json?.map ?? {}).slice(0, 220));
  const g = await api("/api/e2e/zoho", { action: "write_to_real" });
  check("0 (h): a write at the REAL book is refused by the guard", g.json?.refused === true, JSON.stringify(g.json).slice(0, 160));
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const [job] = await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]);
  customerId = job.customer_id;
  vehicleId = job.vehicle_id;
  const [sup] = await sql(
    "insert into public.suppliers (name, phone, email, trn) values ($1, '+971500000099', 'e2e@example.com', '100000000000099') returning id",
    [`E2e Zoho Supplier ${RUN}`],
  );
  supplierId = sup.id;
  check("0: seed ready", !!jobId && !!supplierId, JSON.stringify({ jobId, supplierId, run: RUN }));
});

/* ---------------- (a) a bill with parts, a courier line, a price flag and the scan attached ---------------- */
await section("a supplier bill to the fils", async () => {
  const [part] = await sql("select id from public.part_items where job_id = $1 limit 1", [jobId]);
  const scanPath = `${jobId}/e2e-supinv-${RUN}.pdf`;
  check("a: the scan uploaded to the bucket", await putFile(scanPath, PDF, "application/pdf"));
  const [po] = await sql(
    `insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at)
     values ($1, 'supplier', $2, $3, $4, 'received', 1700, 'received', $5, $6, 1700, now()) returning id, number`,
    [`LPO-E2E9-${RUN}-1`, jobId, supplierId, `E2e Zoho Supplier ${RUN}`, `E2EINV-${RUN}-1`, TODAY],
  );
  po1 = po;
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost) values ($1, $2, 'Brake pads front', 2, 500)", [po.id, part.id]);
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost, invoice_unit_cost, invoice_check) values ($1, $2, 'Oil filter', 1, 200, 210, 'accepted')", [po.id, part.id]);
  await sql("insert into public.supplier_charges (job_id, supplier_id, supplier_name, description, amount_aed, po_id) values ($1, $2, $3, 'COURIER CHARGE', 490, $4)", [jobId, supplierId, `E2e Zoho Supplier ${RUN}`, po.id]);
  await sql("insert into public.job_files (job_id, kind, ref_id, storage_path, content_type) values ($1, 'supplier_invoice', $2, $3, 'application/pdf')", [jobId, po.id, scanPath]);
  await enqueue("bill", po.id, jobId);
  const r = await settled("bill", po.id);
  // Parts at the INVOICE's figures: 2×500 + 1×210 = 1210, courier 490 -> net 1700, VAT 85, total 1785.
  check("a: the bill posted with the ERP figures to the fils", r?.status === "synced" && r?.zoho_result?.zoho?.net === 1700 && r?.zoho_result?.zoho?.vat === 85 && r?.zoho_result?.zoho?.total === 1785, JSON.stringify(r)?.slice(0, 400));
  check("a: the scan is attached and the price flag rides in the notes", r?.zoho_result?.attached === true && r?.zoho_result?.price_flags === 1, JSON.stringify(r?.zoho_result));
  const [sup] = await sql("select zoho_vendor_id from public.suppliers where id = $1", [supplierId]);
  check("a: the vendor id is stored on the supplier", !!sup?.zoho_vendor_id, JSON.stringify(sup));
  const [poRow] = await sql("select zoho_bill_id from public.purchase_orders where id = $1", [po.id]);
  check("a: the bill id is stored on the LPO", !!poRow?.zoho_bill_id, JSON.stringify(poRow));
});

/* ---------------- (b) invoice to follow: held back, then posted once entered ---------------- */
await section("b invoice to follow", async () => {
  const [part] = await sql("select id from public.part_items where job_id = $1 limit 1", [jobId]);
  const [po] = await sql(
    `insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status)
     values ($1, 'supplier', $2, $3, $4, 'received', 300, 'to_follow') returning id, number`,
    [`LPO-E2E9-${RUN}-2`, jobId, supplierId, `E2e Zoho Supplier ${RUN}`],
  );
  po2 = po;
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost) values ($1, $2, 'Wiper blades', 2, 150)", [po.id, part.id]);
  await enqueue("bill", po.id, jobId);
  await cron();
  const held = await row("bill", po.id);
  check("b: a to-follow invoice is NOT pushed (waits in plain words)", held?.status === "pending" && /Waiting for the supplier invoice/.test(held?.last_error ?? ""), JSON.stringify(held)?.slice(0, 200));
  await sql("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = $2, supplier_invoice_date = $3, supplier_invoice_amount = 300, supplier_invoice_at = now() where id = $1", [po.id, `E2EINV-${RUN}-2`, TODAY]);
  const r = await settled("bill", po.id);
  check("b: once entered, the bill posts (300 + 15 VAT)", r?.status === "synced" && r?.zoho_result?.zoho?.net === 300 && r?.zoho_result?.zoho?.total === 315, JSON.stringify(r)?.slice(0, 300));
});

/* ---------------- (c) payments settle both bills ---------------- */
await section("c supplier payments on two bills", async () => {
  await sql("update public.purchase_orders set supplier_paid_at = now(), supplier_paid_reference = 'E2E TT 123' where id = any(array[$1, $2]::uuid[])", [po1.id, po2.id]);
  await enqueue("billpayment", po1.id, jobId);
  await enqueue("billpayment", po2.id, jobId);
  const p1 = await settled("billpayment", po1.id);
  check("c: the first bill is settled in full (1,785.00, balance 0)", p1?.status === "synced" && p1?.zoho_result?.amount === 1785 && p1?.zoho_result?.bill_balance_after === 0, JSON.stringify(p1)?.slice(0, 300));
  const p2 = await settled("billpayment", po2.id);
  check("c: the second bill is settled too (315.00, balance 0)", p2?.status === "synced" && p2?.zoho_result?.amount === 315 && p2?.zoho_result?.bill_balance_after === 0, JSON.stringify(p2)?.slice(0, 300));
});

/* ---------------- (d) a credit note applied to a phase 1 invoice ---------------- */
let invD = null;
await section("d credit note against an invoice", async () => {
  const token = `e2e${RUN}cn`;
  const [inv] = await sql(
    `insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, warranty_credit_aed)
     values ($1, 'tax_invoice', $2, $3, $4, $5, 600, 0, 600, 30, 630, 0) returning id, number`,
    [`TINV-${RUN}-1`, jobId, customerId, vehicleId, token],
  );
  invD = inv;
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, details, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Oil service', '2.0 h', 2, 300, 600, 30, 630, 0)", [inv.id]);
  await enqueue("invoice", inv.id, jobId);
  const invRow = await settled("invoice", inv.id);
  check("d: the invoice posted (630.00)", invRow?.status === "synced" && invRow?.zoho_result?.zoho?.total === 630, JSON.stringify(invRow)?.slice(0, 250));
  const [cnRow] = await sql(
    `insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, credit_of, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, warranty_credit_aed, notes)
     values ($1, 'credit_note', $2, $3, $4, $5, $6, 200, 0, 200, 10, 210, 0, 'Credit against ${"TINV-" + RUN + "-1"}: goodwill') returning id, number`,
    [`TCN-${RUN}-1`, jobId, customerId, vehicleId, invD.id, `e2e${RUN}cn2`],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Goodwill credit', 1, 200, 200, 10, 210, 0)", [cnRow.id]);
  await enqueue("creditnote", cnRow.id, jobId);
  const r = await settled("creditnote", cnRow.id);
  check("d: the credit note posted with the same CN number and totals (210.00 with VAT)", r?.status === "synced" && r?.zoho_result?.number === `TCN-${RUN}-1` && r?.zoho_result?.zoho?.total === 210, JSON.stringify(r)?.slice(0, 350));
  check("d: it is applied to the invoice - balance 630 -> 420", r?.zoho_result?.applied_total === 210 && r?.zoho_result?.invoice_balance_after === 420, JSON.stringify(r?.zoho_result));
  // The invoice's own re-check must now count the credit (expected balance 420, not 630).
  await sql("update public.zoho_outbox set status = 'pending', claimed_at = null where kind = 'invoice' and record_id = $1", [invD.id]);
  const again = await settled("invoice", invD.id);
  check("d: the invoice re-check counts the credit note (balance 420, still green)", again?.status === "synced" && again?.zoho_result?.zoho?.balance === 420, JSON.stringify(again?.zoho_result));
});

/* ---------------- (e) commission expense with the voucher attached ---------------- */
await section("e commission expense", async () => {
  const [v] = await sql(
    "insert into public.commission_payments (recipient, method, paid_on, amount_aed, paid_by, created_by, updated_by) select 'E2e Payee Zoho', 'transfer', $1, 350, id, id, id from public.staff where role_id = 'owner' and is_active limit 1 returning id, number",
    [TODAY],
  );
  const proofPath = `commission-payments/${v.id}/e2e-proof-${RUN}.pdf`;
  check("e: the voucher proof uploaded", await putFile(proofPath, PDF, "application/pdf"));
  await sql("update public.commission_payments set proof_path = $2 where id = $1", [v.id, proofPath]);
  await enqueue("commission", v.id);
  const r = await settled("commission", v.id);
  check("e: the expense posted (350.00) with the proof attached", r?.status === "synced" && r?.zoho_result?.amount === 350 && r?.zoho_result?.receipt === true, JSON.stringify(r)?.slice(0, 300));
  check("e: the voucher number is the reference", r?.zoho_result?.voucher === v.number && /^CPV-\d{5}$/.test(v.number), v.number);
});

/* ---------------- (f) recovery month expense with the trip list attached ---------------- */
await section("f recovery month expense", async () => {
  const month = TODAY.slice(0, 7);
  const who = `E2e Recovery LLC ${RUN}`;
  await sql("insert into public.recovery_trips (job_id, kind, company, location_details, status, price_aed, paid_month, delivered_at) values ($1, 'delivery', $2, 'E2e pin', 'paid', 150, $3, now()), ($1, 'pickup', $2, 'E2e pin', 'paid', 100, $3, now())", [jobId, who, month]);
  const [p] = await sql(
    "insert into public.recovery_payouts (who, month, total_aed, trip_count, paid_at) values ($1, $2, 250, 2, now()) returning id",
    [who, month],
  );
  await enqueue("recovery", p.id);
  const r = await settled("recovery", p.id);
  check("f: one expense for the month (250.00) with the Excel attached", r?.status === "synced" && r?.zoho_result?.amount === 250 && r?.zoho_result?.receipt === true && r?.zoho_result?.trips === 2, JSON.stringify(r)?.slice(0, 300));
});

/* ---------------- (g) forced failure + Retry, and never twice ---------------- */
await section("g forced failure and the adopt pass", async () => {
  const [stored] = await sql("select value from public.settings where key = 'zoho_account_map'");
  const broken = JSON.parse(JSON.stringify(stored.value));
  delete broken.expense.commission;
  await sql("update public.settings set value = $1::jsonb where key = 'zoho_account_map'", [JSON.stringify(broken)]);
  let v;
  try {
    [v] = await sql(
      "insert into public.commission_payments (recipient, method, paid_on, amount_aed, paid_by, created_by, updated_by) select 'E2e Payee Zoho', 'cash', $1, 120, id, id, id from public.staff where role_id = 'owner' and is_active limit 1 returning id, number",
      [TODAY],
    );
    await enqueue("commission", v.id);
    const fail = await settled("commission", v.id);
    check("g: the broken mapping fails in plain words, nothing half-posted", fail?.status === "failed" && /Mapping missing: Sales commissions/.test(fail?.last_error ?? ""), JSON.stringify(fail)?.slice(0, 250));
  } finally {
    // The mapping is LIVE production state: it goes back whatever happens above.
    await sql("update public.settings set value = $1::jsonb where key = 'zoho_account_map'", [JSON.stringify(stored.value)]);
  }
  await sql("update public.zoho_outbox set status = 'pending', last_error = null, claimed_at = null where kind = 'commission' and record_id = $1", [v.id]);
  const ok = await settled("commission", v.id);
  check("g: Retry posts it once (120.00)", ok?.status === "synced" && ok?.zoho_result?.amount === 120, JSON.stringify(ok)?.slice(0, 250));
  // Never twice: wipe the stored bill id and run again - the worker must ADOPT the existing bill, same id.
  const [before] = await sql("select zoho_bill_id from public.purchase_orders where id = $1", [po1.id]);
  await sql("update public.purchase_orders set zoho_bill_id = null where id = $1", [po1.id]);
  await sql("update public.zoho_outbox set status = 'pending', zoho_id = null, claimed_at = null where kind = 'bill' and record_id = $1", [po1.id]);
  const adopted = await settled("bill", po1.id);
  check("g: with the stored id wiped, the worker ADOPTED the existing bill (same id, no second copy)", adopted?.status === "synced" && !!adopted?.zoho_id && adopted?.zoho_id === before?.zoho_bill_id, `before ${before?.zoho_bill_id} after ${adopted?.zoho_id}`);
});

/* ---------------- clean up (the ERP side; OFJ TEST keeps its test documents) ---------------- */
if (process.env.KEEP) {
  console.log("\nKEEP=1: the rows stay for screenshots - run npm run test:cleanup after.");
  process.exit(summary() ? 1 : 0);
}
cleanupDb();
process.exit(summary() ? 1 : 0);
