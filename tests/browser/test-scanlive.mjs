// Section 10 proof: a scan report appears on the screens by itself. The technician's Step 1 card, the
// job card line and the scans page all hear a new inbound_scans row live (with a quiet 20 s net), show
// "Scan report received HH:MM ✓", and the read button lights up - with no reload, no scroll jump.
// Run: node --env-file=.env.local tests/browser/test-scanlive.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 50, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "inspection" });
const jobId = seed.json?.jobId;
const inspectionId = seed.json?.inspectionId;
const techId = seed.json?.technicianId;
if (!jobId || !techId) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }

/* ---------------- 1. The technician waits; the scan arrives by itself ---------------- */
const { browser: tb, page: tp } = await browserForId(techId, { viewport: { width: 1024, height: 768 } });
await go(tp, `${base}/my-jobs/${jobId}`);
check("1: the Step 1 scan card waits for the email", (await tp.locator("[data-scan-step]").count()) === 1 && /waiting for the scanner/i.test(((await tp.textContent("body")) ?? "")));
check("1: 'I have read the scan report' starts off", (await tp.locator("[data-scan-read][disabled]").count()) === 1);
await tp.evaluate(() => { window.__e2eMark = 42; });
await tp.locator("[data-scan-step]").scrollIntoViewIfNeeded();

// The mailbox writes two rows; the test writes the same two and starts the clock.
const mediaIns = await sql("insert into public.inspection_media (inspection_id, kind, is_prescan, storage_path, caption) values ($1, 'pdf', true, $2, 'E2e Scan.pdf (email)') returning id", [inspectionId, `${inspectionId}/prescan-e2e.pdf`]);
if (!mediaIns.length) { console.error("prescan media insert failed"); process.exit(1); }
const scan1 = (await sql("insert into public.inbound_scans (storage_path, file_name, subject, from_email, vin, job_id, kind, status) values ('e2e/scan-1.pdf', 'E2e Scan.pdf', 'Autel report', 'scanner@e2e.test', 'WBA1234567STAGE01', $1, 'pre', 'matched') returning id", [jobId]))[0];
const t0 = Date.now();
const appeared = await until(async () => ((await tp.locator("[data-scan-received]").count()) ? Date.now() - t0 : null));
check("2: the report appears by itself with 'Scan report received … ✓'", !!appeared && /Scan report received \d{2}:\d{2} ✓/.test((await tp.locator("[data-scan-received]").textContent()) ?? ""), `${appeared ?? "never"} ms`);
check("2: it came through the live feed, not the 20 s net", !!appeared && appeared < 15000, `${appeared} ms`);
const mark = await tp.evaluate(() => window.__e2eMark);
check("2: no reload and no navigation", mark === 42 && new RegExp(`/my-jobs/${jobId}`).test(tp.url()), `mark=${mark}`);
check("2: the read button lit up by itself", (await tp.locator("[data-scan-read]:not([disabled])").count()) === 1);
await tp.locator("[data-scan-step]").scrollIntoViewIfNeeded();
await tp.screenshot({ path: shot("scan-1-step-card.png"), clip: (await tp.locator("[data-scan-step]").boundingBox()) ?? undefined });

/* ---------------- 2. Reading it opens the inspection ---------------- */
await tp.locator("[data-scan-read]").click();
const open = await until(async () => (/Scan report read\. The inspection is open\./.test(((await tp.textContent("body")) ?? "")) ? 1 : null), 30);
check("3: tapping 'I have read it' opens the inspection", !!open);

/* ---------------- 3. The job card hears the next scan live ---------------- */
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
await go(op, `${base}/jobs/${jobId}`);
check("4: the job card shows the received line", /Scan report received [^·]*\d{2}:\d{2} ✓/.test(((await op.textContent("body")) ?? "").replace(/\s+/g, " ")) && /1 pre/.test(((await op.textContent("body")) ?? "")));
await op.evaluate(() => { window.__e2eMark = 42; });
await sql("insert into public.inbound_scans (storage_path, file_name, subject, vin, job_id, kind, status) values ('e2e/scan-2.pdf', 'E2e Scan 2.pdf', 'Autel report 2', 'WBA1234567STAGE01', $1, 'pre', 'matched')", [jobId]);
const second = await until(async () => (/2 pre/.test(((await op.textContent("body")) ?? "")) ? 1 : null));
check("4: the second report updates the line by itself", !!second && (await op.evaluate(() => window.__e2eMark)) === 42);
await op.locator("[data-scan-line]").scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("scan-2-job-card.png"), clip: (await op.locator('[data-stage-card="report"]').boundingBox()) ?? undefined });

/* ---------------- 4. The scans page hears an unmatched scan live ---------------- */
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1280, height: 900 } });
await go(ap, `${base}/scans`);
await ap.evaluate(() => { window.__e2eMark = 42; });
const scan3 = (await sql("insert into public.inbound_scans (storage_path, file_name, subject, from_email, kind, status) values ('e2e/scan-3.pdf', 'E2e Mystery.pdf', 'Autel report, no VIN', 'scanner@e2e.test', 'pre', 'unmatched') returning id"))[0];
const row3 = await until(async () => ((await ap.locator(`[data-flash-id="${scan3.id}"]`).count()) ? 1 : null));
check("5: an unmatched scan appears in the list by itself", !!row3 && (await ap.evaluate(() => window.__e2eMark)) === 42);
await ap.screenshot({ path: shot("scan-3-scans-page.png"), fullPage: false });

await tb.close(); await ob.close(); await ab.close();
cleanupDb(); // the cleanup SQL also removes e2e/ inbound scans (jobless ones included)
process.exit(summary() ? 1 : 0);
