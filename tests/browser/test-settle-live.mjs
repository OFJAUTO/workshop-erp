// Card settlements, LIVE proof against OFJ TEST (27 October 2026): a card payment posts at its FULL amount into the
// card clearing account with NO bank charge, and its settlement posts the transfer clearing -> bank (what arrived)
// plus the actual fee as bank charges, both carrying the settlement number and statement reference. Run it only
// when OFJ TEST's daily call allowance has room (with test:zoho3live). Seeds locally, drives the LIVE cron.
//   node --env-file=.env.local tests/browser/test-settle-live.mjs   (local dev server)
import { api, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const CRON = process.env.CRON_SECRET ?? "";
if (!CRON) { console.log("CRON_SECRET missing"); process.exit(1); }
cleanupDb();
await sql("update public.settings set value = to_jsonb(now()::text) where key = 'zoho_last_live_test_at'");

async function cron() {
  const r = await fetch(`${LIVE}/api/cron/zoho`, { headers: { authorization: `Bearer ${CRON}` }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  console.log(`   cron: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}
const row = async (kind, id) => (await sql("select status, last_error, zoho_id, zoho_result from public.zoho_outbox where kind = $1 and record_id = $2", [kind, id]))[0] ?? null;
async function settled(kind, id, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await row(kind, id);
    if (r && r.status !== "pending") return r;
    await cron();
    await sleep(1500);
  }
  return row(kind, id);
}
const RUN = Date.now().toString(36).toUpperCase();

const seed = await api("/api/e2e/stage", { stage: "ready" });
const jobId = seed.json?.jobId;
const [job] = await sql("select customer_id from public.jobs where id = $1", [jobId]);
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
// A deposit by card (no invoice needed): posts as an unapplied advance into Card machine clearing.
const [p] = await sql("insert into public.payments (job_id, customer_id, method, amount_aed, bank_charge_aed, received_at, received_by, is_deposit, number, created_by, updated_by) values ($1, $2, 'card', 1234.50, 27.90, now() - interval '1 day', $3, true, $4, $3, $3) returning id, number", [jobId, job.customer_id, owner, `TRCT-S${RUN}`]);
await sql("insert into public.zoho_outbox (kind, record_id, job_id) values ('contact', $1, null) on conflict (kind, record_id) do update set status = 'pending', claimed_at = null", [job.customer_id]);
await sql("insert into public.zoho_outbox (kind, record_id, job_id) values ('deposit', $1, $2) on conflict (kind, record_id) do nothing", [p.id, jobId]);
const pr = await settled("deposit", p.id);
check("1: the card payment posted", pr?.status === "synced", JSON.stringify(pr).slice(0, 300));
check("1: at the FULL amount with NO bank charge in Zoho", Number(pr?.zoho_result?.amount) === 1234.5 && Number(pr?.zoho_result?.bank_charges) === 0, JSON.stringify(pr?.zoho_result));

const [st] = await sql("insert into public.card_settlements (number, method, settled_on, payment_count, gross_aed, received_aed, fee_aed, statement_ref, created_by, updated_by) values ($1, 'card', (now() + interval '4 hours')::date, 1, 1234.50, 1206.10, 28.40, $2, $3, $3) returning id, number", [`STL-E${RUN.slice(-4)}`, `E2E stmt ${RUN}`, owner]);
await sql("update public.payments set settlement_id = $1, actual_fee_aed = 28.40 where id = $2", [st.id, p.id]);
await sql("insert into public.zoho_outbox (kind, record_id) values ('settlement', $1)", [st.id]);
const sr = await settled("settlement", st.id);
check("2: the settlement posted", sr?.status === "synced", JSON.stringify(sr).slice(0, 400));
check("2: the transfer clearing -> bank carries what arrived (1,206.10)", !!sr?.zoho_result?.transfer_id && Number(sr?.zoho_result?.received) === 1206.1, JSON.stringify(sr?.zoho_result));
check("2: the actual fee is a bank charges expense (28.40)", !!sr?.zoho_result?.fee_expense_id && Number(sr?.zoho_result?.fee) === 28.4);
check("2: both carry the settlement number and the statement reference", String(sr?.zoho_result?.reference ?? "").includes(st.number) && String(sr?.zoho_result?.reference ?? "").includes(`E2E stmt ${RUN}`));
// Idempotent: a second run adopts, never posts twice.
await sql("update public.card_settlements set zoho_transfer_id = null, zoho_fee_id = null where id = $1", [st.id]);
await sql("update public.zoho_outbox set status = 'pending', claimed_at = null where kind = 'settlement' and record_id = $1", [st.id]);
const again = await settled("settlement", st.id);
check("3: a re-run finds the same transfer and fee (nothing posted twice)", again?.zoho_result?.transfer_id === sr?.zoho_result?.transfer_id && again?.zoho_result?.fee_expense_id === sr?.zoho_result?.fee_expense_id, JSON.stringify(again?.zoho_result));

await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id = $1", [st.id]);
await sql("update public.payments set settlement_id = null where settlement_id = $1", [st.id]);
cleanupDb();
process.exit(summary() ? 1 : 0);
