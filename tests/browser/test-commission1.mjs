// Evening section 1 proof: ONE commission per job. The clean-up left J-00859 with a single paid
// commission (the three copies are logged tombstones) and removed the test names; a revision CARRIES
// the commission to the new version; an estimate's commission moves onto the job's quotation when the
// estimate becomes it; the commissions page shows one row per job, with who added it.
// Run: node --env-file=.env.test.local tests/browser/test-commission1.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

cleanupDb();

/* ---------------- 1. The live clean-up ---------------- */
// J-00859 and its history were real data; "Clear test data" (22 October 2026) removed them. Those checks only run while it exists.
const has859 = (await sql("select 1 from public.jobs where job_number = 'J-00859'")).length > 0;
if (!has859) console.log("SKIP J-00859 checks: the job was removed by Clear test data (22 October 2026)");
const j859 = await sql("select q.number, q.version, q.commission_to, q.commission_aed::text as aed, q.commission_paid_at is not null as paid, s.display_name as set_by from public.quotations q join public.jobs j on j.id = q.job_id left join public.staff s on s.id = q.commission_set_by where j.job_number = 'J-00859' and q.is_active and q.commission_to is not null");
if (has859) check("1: J-00859 carries exactly ONE commission (the paid one), 1,500 once - not 6,000", j859.length === 1 && j859[0].paid && Number(j859[0].aed) === 1500 && j859[0].set_by === "Adarsh", JSON.stringify(j859));
const tomb = await sql("select count(*)::int as n from public.quotation_events where event_type = 'commission_superseded' and note like '%one commission per job%'");
if (has859) check("1: the removed duplicates are logged", (tomb[0]?.n ?? 0) >= 3, JSON.stringify(tomb));
const junk = await sql("select count(*)::int as n from public.quotations where is_active and commission_to in ('Wdwdwd', 'Dwdw')");
const people = await sql("select value::text as v from public.settings where key = 'commission_people'");
check("1: the test names are gone from the data and the one-tap list", junk[0].n === 0 && !/wdwdwd|dwdw/i.test(people[0]?.v ?? ""), people[0]?.v?.slice(0, 120));
const noSetBy = await sql("select count(*)::int as n from public.quotations where is_active and commission_to is not null and commission_set_by is null");
check("1: every commission records who added it", noSetBy[0].n === 0);

/* ---------------- 2. The commissions page: one row per job, no estimates ---------------- */
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 950 } });
await go(op, `${base}/commissions`);
const body = ((await op.textContent("body")) ?? "").replace(/\s+/g, " ");
if (has859) check("2: one J-00859 row only, in Paid", (await op.locator('[data-commission-row="Q-00043"]').count()) === 1 && (await op.locator('[data-commissions-paid] [data-commission-row="Q-00043"]').count()) === 1);
check("2: no test names, no bare estimates, no 'added by ?'", !/Wdwdwd|Dwdw/.test(body) && !/E-00009/.test(body) && !/added by \?/.test(body));
await op.screenshot({ path: shot("com1-1-commissions-page.png"), fullPage: true });

/* ---------------- 3. A revision CARRIES the commission ---------------- */
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
await sql("update public.quotations set commission_to = 'E2e Rami', commission_kind = 'aed', commission_value = 300, commission_aed = 300, commission_status = 'approved', commission_set_by = $2, commission_set_at = now(), status = 'sent', sent_at = now(), sent_by = $2 where id = $1", [qid, advisor]);
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1366, height: 950 } });
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
await ap.locator("[data-revise-bar]").first().click();
const v2 = await until(async () => (await sql("select id, commission_to, commission_aed::text as aed, commission_status, commission_set_by from public.quotations where number = (select number from public.quotations where id = $1) and kind = 'quotation' and version = 2", [qid]))[0]);
check("3: the new version carries the commission whole", !!v2 && v2.commission_to === "E2e Rami" && Number(v2.aed) === 300 && v2.commission_status === "approved" && v2.commission_set_by === advisor, JSON.stringify(v2 ?? {}));
const v1 = (await sql("select commission_to, commission_aed::text as aed, commission_status from public.quotations where id = $1", [qid]))[0];
check("3: the old version keeps only a tombstone", v1.commission_to === null && Number(v1.aed) === 0 && v1.commission_status === "superseded", JSON.stringify(v1));
const carried = await sql("select count(*)::int as n from public.quotation_events where quotation_id = $1 and event_type = 'commission_carried'", [qid]);
check("3: the carry is logged", (carried[0]?.n ?? 0) === 1);

/* ---------------- 4. Belt and braces: a stray second commission never shows twice ---------------- */
await sql("insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, token, vat_percent, commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, created_by, updated_by) select 'quotation', 'Q-E2E-X1', 1, job_id, customer_id, vehicle_id, 'draft', 'e2e-comx-tok', 5, 'E2e Other', 'aed', 200, 200, 'approved', $2, now(), $2, $2 from public.quotations where id = $1", [qid, advisor]);
await go(op, `${base}/commissions`);
const seedRows = await op.locator('[data-commission-row="Q-STAGE-1"], [data-commission-row="Q-E2E-X1"]').count();
check("4: the page shows ONE commission for the job even with a stray second row", seedRows === 1, `${seedRows}`);

/* ---------------- 5. An estimate's commission moves over when it becomes the job's quotation ---------------- */
await sql("update public.quotations set status = 'cancelled', is_active = false where job_id = $1 and kind = 'quotation'", [jobId]);
const est = (await sql("insert into public.quotations (kind, number, version, customer_id, vehicle_id, status, token, vat_percent, commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, created_by, updated_by) select 'estimate', 'E-E2E-9', 1, customer_id, vehicle_id, 'approved', 'e2e-est-tok', 5, 'E2e Rami', 'aed', 400, 400, 'approved', $2, now(), $2, $2 from public.jobs where id = $1 returning id", [jobId, advisor]))[0];
await sql("update public.jobs set estimate_id = $2 where id = $1", [jobId, est.id]);
await go(ap, `${base}/jobs/${jobId}`);
await ap.getByText("Start quotation", { exact: true }).first().click();
const newQ = await until(async () => (await sql("select id, number, commission_to, commission_aed::text as aed, commission_status from public.quotations where job_id = $1 and kind = 'quotation' and status = 'draft' and commission_to is not null", [jobId]))[0]);
check("5: the job's new quotation carries the estimate's commission", !!newQ && newQ.commission_to === "E2e Rami" && Number(newQ.aed) === 400 && newQ.commission_status === "approved", JSON.stringify(newQ ?? {}));
const estAfter = (await sql("select commission_to, commission_status from public.quotations where id = $1", [est.id]))[0];
check("5: the estimate keeps only a tombstone and never lists again", estAfter.commission_to === null && estAfter.commission_status === "superseded", JSON.stringify(estAfter));

await ab.close(); await ob.close();
cleanupDb();
await sql("update public.quotations set commission_to = null, commission_kind = null, commission_value = null, commission_aed = 0, commission_status = null, commission_set_by = null, commission_set_at = null where number in ('Q-E2E-X1', 'E-E2E-9') or commission_to like 'E2e %'").catch(() => null);
process.exit(summary() ? 1 : 0);
