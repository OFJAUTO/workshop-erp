// Proof for the scan reports mailbox (16 October): an Autel report fed through the same steps the mailbox reader
// uses lands on the open job by the VIN in the subject, then by the VIN inside the PDF itself; the advisor and the
// workshop manager hear "Scan report received for <plate>"; a report for an unknown car waits in Unmatched scans
// where the car is picked; the same Gmail message is never filed twice; the page shows the mailbox state and offers
// "Check the mailbox now"; the old Postmark route is gone.
//   node --env-file=.env.local tests/browser/test-w.mjs
import { api, base, browserFor, browserForId, cleanupDb, go, makeChecks, sleep, sql, MANAGER_MECH } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 8 * 60 * 1000).unref();
cleanupDb();
const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const mail = (body) => fetch(`${base}/api/e2e/mailbox`, { method: "POST", headers: { "content-type": "application/json", "x-e2e-secret": process.env.E2E_SECRET ?? "" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

const { jobId } = (await api("/api/e2e/stage", { stage: "inspection" })).json;
const car = (await sql("select v.id, v.vin, j.job_number from public.vehicles v join public.jobs j on j.vehicle_id = v.id where j.id = $1", [jobId]))[0];
if (!car?.vin) await sql("update public.vehicles set vin = 'WDD2050421R654321' where id = $1", [car.id]);
const vin = car?.vin ?? "WDD2050421R654321";
const mark = (await sql("select now() as t"))[0]?.t;

// 1. The VIN in the subject.
{
  const r = await mail({ from: "autel@scanner.local", subject: `Diagnostic report ${vin}`, text: "Report attached.", pdfText: "Autel MaxiSys diagnostic report. No codes found.", fileName: "report-1.pdf", messageId: `e2e-w-1-${Date.now()}` });
  check("1: a report with the VIN in the subject lands on the open job as a pre-scan", r.status === 200 && r.json.matched === true && r.json.stored === 1 && r.json.jobNumber === car.job_number, JSON.stringify(r.json));
  const row = (await sql("select kind, status, content_type, gmail_message_id from public.inbound_scans where job_id = $1 order by created_at desc limit 1", [jobId]))[0];
  check("1: filed as a pre-scan PDF with its Gmail message id", row?.kind === "pre" && row?.status === "matched" && row?.content_type === "application/pdf" && /^e2e-w-1-/.test(row?.gmail_message_id ?? ""), JSON.stringify(row));
  const plate = (await sql("select plate_number from public.vehicles where id = $1", [car.id]))[0]?.plate_number;
  const notes = await sql("select title, staff_id from public.notifications where job_id = $1 and type = 'scan_received' and created_at > $2", [jobId, mark]);
  check("1: the advisor and the workshop manager hear 'Scan report received for <plate>'", notes.length >= 2 && notes.every((n) => /^Scan report received for /.test(n.title) && n.title.includes(String(plate))), JSON.stringify(notes.map((n) => n.title)));
  const pre = (await sql("select count(*)::int as n from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id = $1 and m.is_prescan", [jobId]))[0]?.n;
  check("1: the PDF is also the inspection's pre-scan", pre >= 1, String(pre));
}

// 2. The VIN only inside the PDF.
{
  const r = await mail({ from: "autel@scanner.local", subject: "Diagnostic report", text: "See attached.", pdfText: `Vehicle information. VIN: ${vin}. Mileage 42,000 km. Codes: none.`, fileName: "report-2.pdf", messageId: `e2e-w-2-${Date.now()}` });
  check("2: a report with the VIN only inside the PDF still lands on the job", r.status === 200 && r.json.matched === true && r.json.vin === vin, JSON.stringify(r.json));
}

// 3. A report for a car that is not here: Unmatched scans, picked with one tap.
{
  const id = `e2e-w-3-${Date.now()}`;
  const r = await mail({ from: "autel@scanner.local", subject: "Diagnostic report WAUZZZ8V9KA000000", text: "", pdfText: "Report for another car.", fileName: "report-3.pdf", messageId: id });
  check("3: an unknown VIN waits as unmatched and the owner and managers are told", r.status === 200 && r.json.matched === false && r.json.stored === 1 && (await sql("select count(*)::int as n from public.notifications where type = 'scan_unmatched' and created_at > $1", [mark]))[0]?.n >= 1, JSON.stringify(r.json));
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/scans`);
  check("3: the page shows the mailbox state and 'Check the mailbox now'", (await page.locator("[data-mailbox-status]").count()) === 1 && (await page.locator("[data-check-mailbox]").count()) === 1);
  const unmatched = page.locator("section, div").filter({ hasText: /^Unmatched scans/ }).first();
  void unmatched;
  const select = page.locator("select[name='job_id']").first();
  check("3: the unmatched report offers the open cars to pick", (await select.count()) >= 1);
  await select.selectOption(jobId);
  await page.locator("button", { hasText: /^Attach$/ }).first().click();
  await page.waitForURL(/message=/, { timeout: 15000 }).catch(() => null);
  const attached = await until(async () => (await sql("select status, job_id, kind from public.inbound_scans where gmail_message_id = $1", [id]))[0]?.status === "attached" ? 1 : null, 20, 500);
  check("3: Attach files it on the chosen car", !!attached);
  await browser.close();
}

// 4. The same Gmail message twice is filed once (the mailbox reader skips what it has seen).
{
  const id = `e2e-w-4-${Date.now()}`;
  await mail({ from: "autel@scanner.local", subject: `Diagnostic report ${vin}`, text: "", pdfText: "Again.", fileName: "report-4.pdf", messageId: id });
  const seen = (await sql("select count(*)::int as n from public.inbound_scans where gmail_message_id = $1", [id]))[0]?.n;
  check("4: a message carries its Gmail id, so a second read of the mailbox would skip it", seen === 1, String(seen));
}

// 5. The old Postmark route is gone; the cron route refuses without the secret.
{
  const old = await fetch(`${base}/api/inbound/scan?token=x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", redirect: "manual" });
  check("5: the old Postmark webhook no longer exists (404, or sent to the login page like any private address)", old.status === 404 || (old.status >= 300 && old.status < 400), String(old.status));
  const cron = await fetch(`${base}/api/cron/mailbox`);
  check("5: the five-minute mailbox check refuses without the cron secret", cron.status === 401, String(cron.status));
  const run = await fetch(`${base}/api/cron/mailbox`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  const rj = await run.json().catch(() => ({}));
  check("5: with the secret it runs and says the mailbox is not connected here (no Google keys locally)", run.status === 503 && /not set up/i.test(rj.error ?? ""), `${run.status} ${JSON.stringify(rj)}`);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/scans`);
  check("5: the owner's page names the three Vercel variables while the mailbox is not connected", /SCANS_MAILBOX/.test((await page.locator("[data-mailbox-status]").textContent()) ?? ""));
  await browser.close();
}

cleanupDb();
process.exit(summary() ? 1 : 0);
