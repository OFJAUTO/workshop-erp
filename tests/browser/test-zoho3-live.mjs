// Zoho Books phase 3/4, LIVE proof against OFJ TEST: a no-VAT supplier's bill, a vendor credit applied to the
// bill, a customer refund on a credit note, and the daily reconciliation catching a deliberately broken day and
// going green again once it is fixed. Same shape as the earlier live suites: seed through the local dev server,
// drive the LIVE cron with CRON_SECRET, assert from the stored results. The go-live flip itself is NEVER run.
//   node --env-file=.env.test.local tests/browser/test-zoho3-live.mjs   (local dev server, no ZOHO_* values)
import { api, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 16 * 60 * 1000).unref();
const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const CRON = process.env.CRON_SECRET ?? "";
if (!CRON) { console.log("CRON_SECRET missing"); process.exit(1); }
cleanupDb();
// The go-live panel warns when a live test ran in the last 7 days (its documents stay in OFJ TEST).
await sql("update public.settings set value = to_jsonb(now()::text) where key = 'zoho_last_live_test_at'");

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
const STARTED = new Date().toISOString();
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

/* ---------------- (b0) a part merely back with Parts (kept in stock) is never a supplier credit ---------------- */
await section("b0 not a supplier return", async () => {
  const [part] = await sql(
    "insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, po_id, return_status, returned_qty, disposition, disposition_at, not_needed_at) values ($1, 'E2e mount (kept in stock)', 1, 1, 80, $2, 'to_order', $3, 'returned', 1, 'stock', now(), now()) returning id",
    [jobId, `E2e Novat Zoho ${RUN}`, po.id],
  );
  await enqueue("vendorcredit", part.id, jobId);
  const r = await settled("vendorcredit", part.id);
  check("b0: kept in stock = nothing posted (skipped, no Zoho id)", r?.status === "synced" && !r?.zoho_id && /not recorded as returned to the supplier/.test(String(r?.zoho_result?.skipped ?? "")), JSON.stringify(r)?.slice(0, 260));
});

/* ---------------- (b2) a credit recorded BEFORE the supplier's invoice waits for the bill, then applies ---------------- */
await section("b2 credit before the bill", async () => {
  const [po2] = await sql(
    `insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status)
     values ($1, 'supplier', $2, $3, $4, 'received', 300, 'to_follow') returning id, number`,
    [`LPO-E2E9-${RUN}-2`, jobId, supplierId, `E2e Novat Zoho ${RUN}`],
  );
  const [part1] = await sql("select id from public.part_items where job_id = $1 limit 1", [jobId]);
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost) values ($1, $2, 'Wiper motor', 3, 100)", [po2.id, part1.id]);
  const [part] = await sql(
    "insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, po_id, disposition, disposition_note, disposition_at, not_needed_at) values ($1, 'E2e wiper motor (wrong one)', 1, 1, 100, $2, 'to_order', $3, 'returned', 'SCN-B2', now(), now()) returning id",
    [jobId, `E2e Novat Zoho ${RUN}`, po2.id],
  );
  await enqueue("vendorcredit", part.id, jobId);
  await cron();
  // The bill row is made DURING that run, so it gets its first look (and its reason) on the next one.
  await cron();
  const waiting = await row("vendorcredit", part.id);
  check("b2: the credit waits for the bill (nothing posted alone)", waiting?.status === "pending" && /Waiting for the bill of LPO-E2E9-/.test(waiting?.last_error ?? "") && !waiting?.zoho_id, JSON.stringify(waiting)?.slice(0, 220));
  const billRow = await row("bill", po2.id);
  check("b2: the bill joined the queue, waiting for the supplier's invoice", billRow?.status === "pending" && /Waiting for the supplier invoice/.test(billRow?.last_error ?? ""), JSON.stringify(billRow)?.slice(0, 200));
  // The supplier's paper arrives.
  await sql("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = $2, supplier_invoice_date = $3, supplier_invoice_amount = 300, supplier_invoice_at = now() where id = $1", [po2.id, `E2ENV-${RUN}-2`, TODAY]);
  const bill = await settled("bill", po2.id);
  check("b2: the bill posts (300 flat)", bill?.status === "synced" && bill?.zoho_result?.zoho?.total === 300, JSON.stringify(bill)?.slice(0, 220));
  const credit = await settled("vendorcredit", part.id);
  check("b2: the credit then posts AND applies: the bill shows 200 due", credit?.status === "synced" && credit?.zoho_result?.applied_now === 100 && credit?.zoho_result?.bill_balance_after === 200, JSON.stringify(credit?.zoho_result));
});

/* ---------------- (b3) a supplier payment adopted after a crash reports its OWN amount ---------------- */
await section("b3 supplier payment adopt", async () => {
  // Paid by CASH from the account the mapping names for cash, with a proof (the mapping is put back exactly after).
  const [mapRow] = await sql("select value from public.settings where key = 'zoho_account_map'");
  const mapBefore = mapRow?.value ?? {};
  await sql("update public.settings set value = $1::jsonb where key = 'zoho_account_map'", [JSON.stringify({ ...mapBefore, paidFromBy: { ...(mapBefore.paidFromBy ?? {}), cash: "Petty Cash" } })]);
  const proofPath = `supplier-payments/${po.id}/e2e-proof.pdf`;
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${proofPath}`, { method: "POST", headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/pdf", "x-upsert": "true" }, body: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n") });
  let paid = null;
  try {
    await sql("update public.purchase_orders set supplier_paid_at = now(), supplier_paid_reference = 'E2E-PAY', supplier_paid_method = 'cash', supplier_paid_proof_path = $2 where id = $1", [po.id, proofPath]);
    await enqueue("billpayment", po.id, jobId);
    paid = await settled("billpayment", po.id);
  } finally {
    await sql("update public.settings set value = $1::jsonb where key = 'zoho_account_map'", [JSON.stringify(mapBefore)]);
  }
  check("b3: the payment settles the bill after the credit (250, not 400)", paid?.status === "synced" && paid?.zoho_result?.amount === 250 && paid?.zoho_result?.bill_balance_after === 0, JSON.stringify(paid?.zoho_result));
  check("b3: it posts as CASH from the cash account the mapping names", paid?.zoho_result?.mode === "cash" && paid?.zoho_result?.paid_from === "Petty Cash", JSON.stringify(paid?.zoho_result));
  check("b3: the proof went to Zoho (on the payment, or on the bill it settles)", /^attached/.test(String(paid?.zoho_result?.proof ?? "")), String(paid?.zoho_result?.proof));
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${proofPath}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } }).catch(() => null);
  // A run that died after creating the payment: the stored id and the result are gone, the row is pending again.
  await sql("update public.purchase_orders set zoho_billpayment_id = null where id = $1", [po.id]);
  await sql("update public.zoho_outbox set status = 'pending', zoho_id = null, zoho_result = null, last_error = null, claimed_at = null where kind = 'billpayment' and record_id = $1", [po.id]);
  const adopted = await settled("billpayment", po.id);
  check("b3: the retry ADOPTS the payment and records its own amount (250, never the bill's 400)", adopted?.status === "synced" && adopted?.zoho_result?.amount === 250 && adopted?.zoho_id === paid?.zoho_id, JSON.stringify({ first: paid?.zoho_id, again: adopted?.zoho_id, result: adopted?.zoho_result }));
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

/* ---------------- (e) children of an invoice that was closed "Done by hand" never wait forever ---------------- */
await section("e children of a hand-closed invoice", async () => {
  const [inv] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ($1, 'tax_invoice', $2, $3, $4, $5, 400, 0, 400, 20, 420) returning id, number",
    [`TINV-${RUN}-H`, jobId, customerId, vehicleId, `e2e${RUN}hh`],
  );
  // The accountant settled it by hand in Zoho: the row is closed with no Zoho id in the ERP.
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, synced_at, zoho_result) values ('invoice', $1, $2, 'synced', now(), $3::jsonb)", [inv.id, jobId, JSON.stringify({ manual: true, name: "E2e", at: new Date().toISOString(), note: "E2e: entered by hand" })]);
  const [cn] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, credit_of, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ($1, 'credit_note', $2, $3, $4, $5, $6, 100, 0, 100, 5, 105) returning id",
    [`TCN-${RUN}-H`, jobId, customerId, vehicleId, inv.id, `e2e${RUN}hc`],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'E2e credit', 1, 100, 100, 5, 105, 0)", [cn.id]);
  await enqueue("creditnote", cn.id, jobId);
  const cnRow = await settled("creditnote", cn.id);
  check("e: a credit note on it turns red with the by-hand words (no endless wait)", cnRow?.status === "failed" && /settled by hand in Zoho/.test(cnRow?.last_error ?? "") && !cnRow?.zoho_id, JSON.stringify(cnRow)?.slice(0, 260));
  const [pay] = await sql(
    "insert into public.payments (number, job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, is_deposit, status, received_at) values ($1, $2, $3, $4, 'cash', 420, 0, false, 'recorded', now()) returning id",
    [`TRCT-${RUN}-H`, jobId, inv.id, customerId],
  );
  await enqueue("payment", pay.id, jobId);
  const payRow = await settled("payment", pay.id);
  check("e: a payment on it still POSTS (real money), unapplied, and shows red for the by-hand application", payRow?.status === "failed" && !!payRow?.zoho_id && payRow?.zoho_result?.amount === 420 && /Posted unapplied: TINV-.*settled by hand/.test(payRow?.last_error ?? ""), JSON.stringify(payRow)?.slice(0, 300));
});

/* ---------------- (d) the reconciliation catches a broken day, then goes back once fixed ---------------- */
// On a test day Zoho TEST already holds documents whose ERP rows earlier suites cleaned away, so the day's
// baseline may be red by itself. The proof is therefore count-based: breaking the day moves the ERP count up by
// one against the same Zoho count; posting the missing invoice moves Zoho up by one too, back to the baseline gap.
await section("d reconciliation", async () => {
  const invSectionOf = async () => {
    const [r] = await sql("select status, details from public.zoho_reconciliation where day = $1", [TODAY]);
    return { status: r?.status, s: (r?.details?.sections ?? []).find((x) => x.label === "Tax invoices") };
  };
  const base1 = await cron(`?reconcile=${TODAY}`);
  check("d: today reconciles after the seeds (baseline)", base1.ok === true && ["green", "red"].includes(base1.status), JSON.stringify(base1));
  const base = await invSectionOf();
  const gap0 = (base.s?.zoho?.count ?? 0) - (base.s?.erp?.count ?? 0);
  // A test day is red by itself (Zoho TEST keeps what earlier cleanups removed from the ERP), and a day that is
  // ALREADY red rings nothing new. So the day is marked green first: turning red must then ring exactly once.
  await sql("update public.zoho_reconciliation set status = 'green' where day = $1", [TODAY]);
  const bells = async () => Number((await sql("select count(*)::int as n from public.notifications where type = 'zoho_reconciliation' and title like $1 and created_at >= $2", [`%${TODAY}`, STARTED]))[0]?.n ?? 0);
  const bellsBefore = await bells();
  // Break the day: a tax invoice that exists ONLY in the ERP (never queued).
  const [ghost] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ($1, 'tax_invoice', $2, $3, $4, $5, 1000, 0, 1000, 50, 1050) returning id",
    [`TINV-${RUN}-GHOST`, jobId, customerId, vehicleId, `e2e${RUN}gh`],
  );
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Ghost service', 1, 1000, 1000, 50, 1050, 0)", [ghost.id]);
  const broken = await cron(`?reconcile=${TODAY}`);
  const after = await invSectionOf();
  check("d: the broken day is RED with the ERP one invoice ahead", broken.status === "red" && after.status === "red" && (after.s?.erp?.count ?? 0) === (base.s?.erp?.count ?? 0) + 1 && (after.s?.zoho?.count ?? 0) === (base.s?.zoho?.count ?? 0), JSON.stringify({ base: base.s, after: after.s }));
  check("d: the row names the exact difference on tax invoices", after.s?.ok === false && /in the ERP vs .* in Zoho/.test(after.s?.diff ?? ""), JSON.stringify(after.s));
  const [orgRow] = await sql("select details->>'org' as org, details->>'orgLabel' as label from public.zoho_reconciliation where day = $1", [TODAY]);
  check("d: the day is compared against the book that owns it (OFJ TEST)", orgRow?.org === "944122733" && orgRow?.label === "OFJ TEST", JSON.stringify(orgRow));
  const bellsRed = await bells();
  check("d: turning red rang the bell (owner + accounts)", bellsRed > bellsBefore, `${bellsBefore} -> ${bellsRed}`);
  await cron(`?reconcile=${TODAY}`);
  check("d: still red on a re-check: no second bell (one per red episode)", (await bells()) === bellsRed, `${bellsRed} -> ${await bells()}`);
  // Fix it: the missing invoice posts, the day re-checks and the gap returns to the baseline.
  await enqueue("invoice", ghost.id, jobId);
  const ghostRow = await settled("invoice", ghost.id);
  check("d: the missing invoice posts on Retry", ghostRow?.status === "synced", JSON.stringify(ghostRow)?.slice(0, 160));
  const fixed = await cron(`?reconcile=${TODAY}`);
  const done = await invSectionOf();
  const gap1 = (done.s?.zoho?.count ?? 0) - (done.s?.erp?.count ?? 0);
  check("d: the gap goes back to the baseline once fixed", fixed.ok === true && gap1 === gap0, `gap before ${gap0}, after ${gap1} (status ${fixed.status})`);
});

/* ---------------- clean up ---------------- */
// The ERP rows leave; Zoho TEST keeps its documents, so a test day's books genuinely differ. The recon row STAYS
// (re-checked after the cleanup so it tells the truth, and tomorrow's automatic check sees red → red: no new
// bell); only the bells this run caused are removed.
if (process.env.KEEP) {
  console.log("\nKEEP=1: rows stay for screenshots - run npm run test:cleanup after.");
  process.exit(summary() ? 1 : 0);
}
cleanupDb();
await cron(`?reconcile=${TODAY}`);
// Only the bells this run caused (today's title, created since it started) leave; a real one never does.
await sql("delete from public.notifications where type = 'zoho_reconciliation' and title like $1 and created_at >= $2", [`%${TODAY}`, STARTED]).catch(() => null);
process.exit(summary() ? 1 : 0);
