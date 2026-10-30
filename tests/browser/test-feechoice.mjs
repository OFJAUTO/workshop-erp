// 30 October 2026: the inspection fee is optional and the advisor sets the amount.
//  A  the approval-link window has the required choice: [Inspection fee] (500 · 1,000 · 2,500 or typed) / [No inspection fee].
//  B  a job with AED 1,000: the customer's page shows "AED 1,050.00 including VAT (AED 1,000 + VAT)" in English and Arabic.
//  C  AED 3,000 is refused for an advisor.
//  D  no fee (reason Simple job, "tyre change") as a quick job: the customer's page says nothing about a fee; once
//     approved it goes straight to the quotation (no Inspection stage).
//  E  locked after the customer's approval: the advisor cannot change it; the owner can, with a reason.
//  F  the owner's report "Inspection fees" for the month, per advisor.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-feechoice.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "feechoice");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 15 * 60 * 1000).unref();
const until = async (fn, tries = 80, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
async function finish() {
  cleanupDb();
  for (const [seq, table, col, prefix] of [["quotation_number_seq", "quotations", "number", "Q-"], ["customer_number_seq", "customers", "customer_number", "C-"], ["job_number_seq", "jobs", "job_number", "J-"]]) {
    await sql(`select setval('public.${seq}', greatest(1, coalesce((select max(substring(${col} from 3)::int) from public.${table} where ${col} ~ '^${prefix}[0-9]+$'), 1)))`);
  }
}
const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0];

/** A test car at the approval step: the stage seed (gate-in complete), turned back to before the customer's approval. */
async function jobBeforeApproval() {
  // The seed has fixed ids: a fresh car means the previous section's rows go first (its approval link included).
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const jobId = seed.json.jobId;
  await sql("update public.jobs set first_approval_at = null, status = 'pending_approval', stage = 'approval', advisor_id = $2, inspection_fee_choice = null, inspection_fee_aed = null where id = $1", [jobId, advisor.id]);
  return jobId;
}
async function openLinkWindow(page, jobId) {
  await go(page, `${base}/jobs/${jobId}`);
  await page.getByRole("button", { name: "Create the approval link" }).click();
  await page.locator("[data-fee-choice-box]").waitFor({ timeout: 15000 });
}

try {
  cleanupDb();
  /* ---------------- A + B ---------------- */
  const job1 = await jobBeforeApproval();
  for (const [w, h] of [[1440, 900], [800, 1280]]) {
    const { browser, page } = await browserForId(advisor.id, { viewport: { width: w, height: h }, touch: w < 1100 });
    await openLinkWindow(page, job1);
    const box = page.locator("[data-fee-choice-box]");
    check(`A ${w}x${h}: the approval-link window asks Inspection fee / No inspection fee (required)`, (await box.locator('[data-fee-choice="fee"]').count()) === 1 && (await box.locator('[data-fee-choice="none"]').count()) === 1 && /required/.test(await text(box)));
    await box.locator('[data-fee-choice="fee"]').click();
    check(`A ${w}x${h}: quick buttons AED 500 · 1,000 · 2,500 and a typed amount`, (await box.locator("[data-fee-chip]").count()) === 3 && (await box.locator("[data-fee-amount]").count()) === 1);
    await box.locator('[data-fee-chip="1000"]').click();
    check(`A ${w}x${h}: "The customer sees: AED 1,050.00 including VAT (AED 1,000 + VAT)"`, /AED 1,050\.00 including VAT \(AED 1,000 \+ VAT\)/.test(await text(box.locator("[data-fee-total]"))));
    await page.screenshot({ path: path.join(SHOTS, `A-approval-link-fee-${w}x${h}.png`) });
    if (w === 800) {
      await page.getByRole("button", { name: "Create link" }).click();
      await until(async () => (await sql("select count(*)::int as n from public.approval_requests where job_id = $1", [job1]))[0].n > 0);
    }
    await browser.close();
  }
  const req1 = (await sql("select token, inspection_fee_aed, no_fee, inspection_fee_notice, inspection_fee_notice_ar from public.approval_requests where job_id = $1 order by created_at desc limit 1", [job1]))[0];
  const j1 = (await sql("select inspection_fee_choice, inspection_fee_aed from public.jobs where id = $1", [job1]))[0];
  check("B the job and its link carry the fee: AED 1,000 before VAT", j1.inspection_fee_choice === "fee" && Number(j1.inspection_fee_aed) === 1000 && Number(req1.inspection_fee_aed) === 1000 && req1.no_fee === false, JSON.stringify(j1));
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 900 }, touch: true });
    await page.context().clearCookies();
    await go(page, `${base}/approve/${req1.token}`);
    const notice = await text(page.locator("[data-fee-notice]"));
    check('B the customer\'s page: "an inspection fee of AED 1,050.00 including VAT (AED 1,000 + VAT) will apply" in English and Arabic', /inspection fee of AED 1,050\.00 including VAT \(AED 1,000 \+ VAT\) will apply/.test(notice) && /1,050\.00/.test(req1.inspection_fee_notice_ar ?? "") && /[؀-ۿ]/.test(notice), notice.slice(0, 220));
    await page.locator("[data-fee-notice]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "B-customer-page-fee-420.png"), fullPage: true });
    await browser.close();
  }

  /* ---------------- C ---------------- */
  const job2 = await jobBeforeApproval();
  {
    const { browser, page } = await browserForId(advisor.id, { viewport: { width: 1440, height: 900 } });
    await openLinkWindow(page, job2);
    const box = page.locator("[data-fee-choice-box]");
    await box.locator('[data-fee-choice="fee"]').click();
    await box.locator("[data-fee-amount]").fill("3000");
    const inline = await text(box.locator("[data-fee-range-error]"));
    await page.getByRole("button", { name: "Create link" }).click();
    await sleep(1500);
    const made = (await sql("select count(*)::int as n from public.approval_requests where job_id = $1", [job2]))[0].n;
    check(`C AED 3,000 is refused for an advisor: "${inline.slice(0, 80)}…", no link made`, /above the maximum/.test(inline) && made === 0, inline);
    await page.screenshot({ path: path.join(SHOTS, "C-3000-refused-1440.png") });

    /* ---------------- D ---------------- */
    await box.locator('[data-fee-choice="none"]').click();
    await box.locator('[data-no-fee-reason="simple_job"]').click();
    await box.locator("[data-no-fee-note]").fill("tyre change");
    await box.locator('[data-inspection-type="quick"]').click();
    await page.screenshot({ path: path.join(SHOTS, "D-no-fee-quick-job-1440.png") });
    await page.getByRole("button", { name: "Create link" }).click();
    await until(async () => (await sql("select count(*)::int as n from public.approval_requests where job_id = $1", [job2]))[0].n > 0);
    await browser.close();
  }
  const req2 = (await sql("select token, no_fee, inspection_fee_notice from public.approval_requests where job_id = $1 order by created_at desc limit 1", [job2]))[0];
  const j2 = (await sql("select inspection_fee_choice, no_fee_reason, no_fee_note, inspection_type from public.jobs where id = $1", [job2]))[0];
  check("D the job: no fee, Simple job (\"tyre change\"), quick job; the link carries no fee", j2.inspection_fee_choice === "none" && j2.no_fee_reason === "simple_job" && j2.no_fee_note === "tyre change" && j2.inspection_type === "quick" && req2.no_fee === true && req2.inspection_fee_notice === null, JSON.stringify(j2));
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 900 }, touch: true });
    await page.context().clearCookies();
    await go(page, `${base}/approve/${req2.token}`);
    const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    check("D the customer's page says nothing about an inspection fee", (await page.locator("[data-fee-notice]").count()) === 0 && !/inspection fee/i.test(body));
    await page.screenshot({ path: path.join(SHOTS, "D-customer-page-no-fee-420.png"), fullPage: true });
    await page.locator('input[name="agree"]').check();
    await page.locator('input[name="approver_name"]').fill("E2e Customer");
    await page.getByRole("button", { name: "Approve" }).click();
    await until(async () => !!(await sql("select first_approval_at from public.jobs where id = $1", [job2]))[0].first_approval_at);
    await browser.close();
  }
  const after = (await sql("select status, stage from public.jobs where id = $1", [job2]))[0];
  check("D approved: the quick job goes straight to the quotation (no Inspection stage)", after.status === "pending_quote" && after.stage === "quote", JSON.stringify(after));
  {
    const { browser, page } = await browserForId(advisor.id, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${job2}`);
    const badge = await text(page.locator("[data-fee-badge]"));
    const steps = await text(page.locator("[data-stage-track], [data-stage-bar]").first());
    check(`D the job card: "${badge}" and Start quotation open without an inspection`, /No inspection fee · quick job/.test(badge) && (await page.getByRole("button", { name: "Start quotation" }).count()) === 1, steps.slice(0, 120));
    await page.screenshot({ path: path.join(SHOTS, "D-job-card-quick-1440.png") });
    await page.getByRole("button", { name: "Start quotation" }).click();
    const toQuote = await page.waitForURL(/\/quote\//, { timeout: 30000 }).then(() => true).catch(() => false);
    check("D Start quotation works on the quick job (no inspection report)", toQuote);
    /* ---------------- E ---------------- */
    await go(page, `${base}/jobs/${job2}`);
    check("E locked after the customer's approval: the advisor has no fee choice, the badge says locked", (await page.locator("[data-owner-fee-change]").count()) === 0 && /locked/.test(await text(page.locator("[data-fee-badge]"))));
    await browser.close();
  }
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${job2}`);
    const ch = page.locator("[data-owner-fee-change]");
    await ch.locator("summary").click();
    await ch.locator('[data-fee-choice="fee"]').click();
    await ch.locator('[data-fee-chip="500"]').click();
    await ch.locator("[data-owner-fee-reason]").fill("Customer asked for a full check after all");
    await ch.getByRole("button", { name: "Save the change" }).click();
    const changed = await until(async () => { const r = (await sql("select inspection_fee_choice, inspection_fee_aed from public.jobs where id = $1", [job2]))[0]; return r.inspection_fee_choice === "fee" && Number(r.inspection_fee_aed) === 500 ? r : null; });
    const ev = await sql("select note from public.job_events where job_id = $1 and event_type = 'inspection_fee' order by created_at desc limit 1", [job2]);
    check("E the owner changes it after approval, with the reason logged", !!changed && /Reason: Customer asked for a full check after all/.test(ev[0]?.note ?? ""), ev[0]?.note ?? "");
    /* ---------------- F ---------------- */
    await go(page, `${base}/reports/inspection-fees`);
    const row = await text(page.locator(`[data-fee-row="${advisor.display_name}"]`));
    // The advisor's real cars this month count too: the expected figures come from the jobs, by the report's own rules.
    const withFee = "(inspection_fee_choice = 'fee' or (inspection_fee_choice is distinct from 'none' and coalesce(inspection_fee_aed, 0) > 0))";
    const exp = (await sql(`select count(*) filter (where ${withFee})::int as n, coalesce(sum(inspection_fee_aed) filter (where ${withFee}), 0)::numeric(12,2)::text as total,
        bool_or(id = $2 and inspection_fee_choice = 'fee' and inspection_fee_aed = 500) as test_car
      from public.jobs where coalesce(advisor_id, gated_in_by) = $1 and job_kind <> 'loose'
        and gated_in_at >= (date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')`, [advisor.id, job2]))[0];
    const total = Number(exp.total).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check(`F the owner's report: ${advisor.display_name} - ${exp.n} cars with a fee, AED ${total} (the test car's AED 500 among them)`, exp.test_car === true && row.includes(`${advisor.display_name}${exp.n}AED ${total}`) && (await page.locator("[data-fee-totals]").count()) === 1, row.slice(0, 200));
    await page.screenshot({ path: path.join(SHOTS, "F-owner-report-1440.png"), fullPage: true });
    await browser.close();
  }
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
