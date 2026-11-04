// Fix 1 of 4 November 2026: an Autel scan report reaches the technician's Step 1, always, with no duplicates.
// A: the report arrives BEFORE assignment (J-00979's case) → assigning through /assign places it on Step 1.
// B: the report arrives WHILE the technician is on the page, imported server-side → appears live, no reload.
// C: the same report from a second Autel address is never imported twice; a same-named file for the same car neither.
// D: the five-minute cron's sweep heals a matched scan whose copy was missed.
// Run: node --env-file=.env.test.local tests/browser/test-scans-tech.mjs   (test server on :3102 or dev on :3101/:3100)
import path from "node:path";
import { MANAGER_MECH, api, base, browserForId, cleanupDb, go, here, makeChecks, pickPerson, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 50, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

const VIN = "WBA1234567STAGE01";
const mail = (over = {}) => ({
  from: '"no-reply-eu@auteltech.com" <no-reply-eu@auteltech.com>',
  subject: `Please receive 2021 BMW Vehicle Diagnostic Report (Report ID: MAXIAE2E900001)`,
  text: `Diagnostic report for VIN ${VIN}.`,
  pdfText: `E2E Autel diagnostic report. VIN ${VIN}.`,
  fileName: `2021 BMW Vehicle Diagnostic Report_${VIN}_20261104090001.pdf`,
  messageId: `e2e-scan-a-${Date.now()}`,
  ...over,
});

cleanupDb();

/* ---------------- A. Email first, technician assigned later (J-00979's case) ---------------- */
const seed = await api("/api/e2e/stage", { stage: "assign" });
const jobId = seed.json?.jobId;
const techs = seed.json?.technicians ?? [];
const techId = techs[0]?.id;
if (!jobId || !techId) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }

const a = await api("/api/e2e/mailbox", mail());
check("A1: the email is imported and matched by VIN with no one involved", a.json?.matched === true && a.json?.stored === 1, JSON.stringify(a.json).slice(0, 120));
const scanRows = await sql("select id, status, kind, report_id from public.inbound_scans where job_id = $1", [jobId]);
check("A2: one matched pre-scan record", scanRows.length === 1 && scanRows[0].status === "matched" && scanRows[0].kind === "pre" && scanRows[0].report_id === "MAXIAE2E900001");
const mediaBefore = await sql("select m.id from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id = $1 and m.is_prescan", [jobId]);
check("A3: no inspection yet, so no Step 1 copy yet", mediaBefore.length === 0);

// The workshop manager assigns through the real screen; the scan must land on the new inspection at once.
{
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/assign`);
  await page.locator(`[data-assign-car="${jobId}"]`).click();
  await sleep(500);
  await pickPerson(page, techId);
  await page.getByText("No road test", { exact: true }).click();
  await page.locator("[data-assign-submit]").click();
  await submitted(page);
  await browser.close();
}
const mediaAfter = await until(() => sql("select m.id, m.caption from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id = $1 and m.is_prescan and m.removed_at is null", [jobId]).then((r) => (r.length ? r : null)), 20);
check("A4: assigning placed the report on Step 1 by itself", !!mediaAfter && mediaAfter.length === 1, JSON.stringify(mediaAfter ?? []).slice(0, 120));
const techNote = await sql("select title from public.notifications where staff_id = $1 and title like 'Scan report is on the job%'", [techId]);
check("A5: the technician is told the report is on the job", techNote.length >= 1);

// The technician's tablet: Step 1 shows the report with the read button enabled.
const { browser: tb, page: tp } = await browserForId(techId, { viewport: { width: 800, height: 1280 } });
await go(tp, `${base}/my-jobs/${jobId}`);
check("A6: Step 1 shows the attached report", (await tp.locator("[data-scan-step]").count()) === 1 && /1 attached/i.test((await tp.locator("[data-scan-step]").textContent()) ?? ""));
check("A7: 'I have read the scan report' is enabled", (await tp.locator("[data-scan-read]:not([disabled])").count()) === 1);
await tp.locator("[data-scan-step]").scrollIntoViewIfNeeded();
await tp.screenshot({ path: shot("scans-tech-a-step1.png"), clip: (await tp.locator("[data-scan-step]").boundingBox()) ?? undefined });

/* ---------------- B. A second report arrives while the technician is on the page; everyone else logged out ---------------- */
await tp.evaluate(() => { window.__e2eMark = 42; });
const b = await api("/api/e2e/mailbox", mail({
  subject: "Please receive 2021 BMW Vehicle Diagnostic Report (Report ID: MAXIAE2E900002)",
  fileName: `2021 BMW Vehicle Diagnostic Report_${VIN}_20261104091500.pdf`,
  messageId: `e2e-scan-b-${Date.now()}`,
}));
check("B1: the second report is imported server-side", b.json?.matched === true && b.json?.stored === 1);
const t0 = Date.now();
const appeared = await until(async () => (/2 attached/i.test((await tp.locator("[data-scan-step]").textContent()) ?? "") ? Date.now() - t0 : null));
check("B2: it appears on the tablet by itself (live, no reload)", !!appeared && (await tp.evaluate(() => window.__e2eMark)) === 42, `${appeared ?? "never"} ms`);
await tp.screenshot({ path: shot("scans-tech-b-live.png"), clip: (await tp.locator("[data-scan-step]").boundingBox()) ?? undefined });

/* ---------------- C. Duplicates: the same report from other Autel addresses ---------------- */
const c1 = await api("/api/e2e/mailbox", mail({
  from: '"autelcloudinfo@auteltech.com" <autelcloudinfo@auteltech.com>',
  subject: "Please receive 2021 BMW Vehicle Diagnostic Report (Report ID: MAXIAE2E900002)",
  fileName: `2021 BMW Vehicle Diagnostic Report_${VIN}_20261104091500.pdf`,
  messageId: `e2e-scan-c1-${Date.now()}`,
}));
check("C1: the same Report ID from a second address is skipped as a duplicate", c1.json?.duplicate === true && c1.json?.stored === 0, JSON.stringify(c1.json).slice(0, 120));
const c2 = await api("/api/e2e/mailbox", mail({
  from: '"noreply-ap@auteltech.com" <noreply-ap@auteltech.com>',
  subject: "2021 BMW Vehicle Diagnostic Report with no report id",
  fileName: `2021 BMW Vehicle Diagnostic Report_${VIN}_20261104091500.pdf`,
  messageId: `e2e-scan-c2-${Date.now()}`,
}));
check("C2: the same file for the same car (no Report ID) is skipped too", c2.json?.duplicate === true && c2.json?.stored === 0, JSON.stringify(c2.json).slice(0, 120));
const rows = await sql("select count(*)::int as n from public.inbound_scans where job_id = $1 and is_active", [jobId]);
check("C3: still exactly two scan records on the job", rows[0]?.n === 2);
const mediaCount = await sql("select count(*)::int as n from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id = $1 and m.is_prescan and m.removed_at is null", [jobId]);
check("C4: still exactly two files on Step 1", mediaCount[0]?.n === 2);
const quiet = await sql("select count(*)::int as n from public.inbound_emails where gmail_message_id like 'e2e-scan-c%' and is_active = false");
check("C5: the duplicate emails are filed quietly, never re-read", quiet[0]?.n === 2);

/* ---------------- D. The cron's sweep heals a missed copy ---------------- */
// A matched scan whose Step 1 copy is missing (same stored file, a new name = a new report record).
const [{ storage_path: storedPath }] = await sql("select storage_path from public.inbound_scans where job_id = $1 and is_active order by received_at limit 1", [jobId]);
await sql("insert into public.inbound_scans (storage_path, file_name, subject, from_email, vin, job_id, kind, status, content_type, report_id) values ($1, 'E2E Sweep Report_20261104093000.pdf', 'Autel report', 'no-reply-eu@auteltech.com', $2, $3, 'pre', 'matched', 'application/pdf', 'MAXIAE2E900003')", [storedPath, VIN, jobId]);
const d = await api("/api/e2e/mailbox", { sweep: true });
check("D1: the five-minute sweep attaches the missed report", d.json?.caughtUp === 1, JSON.stringify(d.json).slice(0, 80));
const mediaFinal = await sql("select count(*)::int as n from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id = $1 and m.is_prescan and m.removed_at is null", [jobId]);
check("D2: Step 1 now has the healed report too", mediaFinal[0]?.n === 3);
const d2 = await api("/api/e2e/mailbox", { sweep: true });
check("D3: running the sweep again attaches nothing twice", d2.json?.caughtUp === 0);

// Reading it still works end to end.
await tp.reload();
await tp.locator("[data-scan-read]").click();
const open = await until(async () => (/Scan report read\. The inspection is open\./.test((await tp.textContent("body")) ?? "") ? 1 : null), 30);
check("E1: 'I have read the scan report' opens the inspection", !!open);
await tb.close();

cleanupDb();
process.exit(summary() ? 1 : 0);
