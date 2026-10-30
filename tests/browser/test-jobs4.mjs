// Section 4 proof (23 October 2026, afternoon): "Last ran" for the background jobs. Settings > Background jobs (owner)
// shows each job with "Last ran: 13:05 ✓" and its result; a job that has not run on time turns red and the owner gets
// ONE bell ("Mailbox check hasn't run since 12:30"), checked from the notification poll every screen makes.
// The job rows are shared with the live site: the test only sets times, then puts them back as they were.
//   node --env-file=.env.test.local tests/browser/test-jobs4.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { base, browserFor, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const before = await sql("select key, last_ran_at, last_ok, last_result, late_notified_at, created_at from public.background_jobs");
const mark = (await sql("select now() as t"))[0].t;
const owner = await cookieHeader("owner");
const poll = () => fetch(`${base}/api/notifications`, { headers: { cookie: owner } });
const told = async (like) => (await sql("select title from public.notifications where type = 'background_job_late' and created_at > $1 and title like $2", [mark, like])).map((r) => r.title);
const setJob = (key, minutesAgo, ok, result) => sql("update public.background_jobs set last_ran_at = now() - make_interval(mins => $2), last_ok = $3, last_result = $4, late_notified_at = null where key = $1", [key, minutesAgo, ok, result]);

const { browser, page } = await browserFor("owner", { viewport: { width: 1500, height: 1000 } });
try {
  /* 1. Both jobs on schedule. */
  await setJob("mailbox", 3, true, "0 new · 0 reports filed");
  await setJob("housekeeping", 40, true, "2 approval reminders · 1 quotation expired");
  await go(page, `${base}/settings`);
  const box = page.locator("[data-background-jobs]");
  const mail = box.locator('[data-job="mailbox"]');
  const hk = box.locator('[data-job="housekeeping"]');
  check("1: Settings shows the Background jobs box with both jobs", (await box.count()) === 1 && (await mail.count()) === 1 && (await hk.count()) === 1);
  check("1: 'Last ran: hh:mm ✓' with the result, on schedule (not red)", /Last ran: \d\d:\d\d ✓/.test(await mail.locator("[data-job-last]").textContent()) && /0 new/.test(await mail.locator("[data-job-result]").textContent()) && (await mail.getAttribute("data-job-state")) === "ok" && (await hk.getAttribute("data-job-state")) === "ok");
  await box.screenshot({ path: shot("jobs4-1-on-schedule.png") });

  /* 2. The mailbox check is late (20 minutes): red, and ONE bell for the owner. */
  await setJob("mailbox", 20, true, "0 new · 0 reports filed");
  await sleep(61000); // the Settings page's own bell poll may have just checked (at most once a minute per server)
  await poll();
  const first = await until(async () => { const t = await told("Mailbox check hasn't run since %"); return t.length ? t : null; }, 30, 500);
  check("2: the owner gets 'Mailbox check hasn't run since hh:mm'", !!first && /^Mailbox check hasn't run since \d\d:\d\d$/.test(first[0]), JSON.stringify(first));
  // The LIVE site's own five-minute run writes this shared row: it can land between the bell above and the page
  // below and make the job on-time again. The red line is asserted only while the test's own stale time still stands.
  await sql("update public.background_jobs set last_ran_at = now() - make_interval(mins => 20), late_notified_at = now() where key = 'mailbox'");
  await go(page, `${base}/settings`);
  const staleStands = ((await sql("select (last_ran_at < now() - make_interval(mins => 16)) as stale from public.background_jobs where key = 'mailbox'"))[0] ?? {}).stale === true;
  if (staleStands) {
    check("2: the mailbox line is red and says so", (await mail.getAttribute("data-job-state")) === "late" && /text-red/.test((await mail.getAttribute("class")) ?? "") && /Mailbox check hasn't run since/.test(await mail.locator("[data-job-late]").textContent()));
  } else {
    console.log("NOTE  the live five-minute run refreshed the row mid-test: the red-line look is skipped (the bell above already proved the lateness)");
  }
  await box.screenshot({ path: shot("jobs4-2-mailbox-late.png") });
  await sleep(61000); // the poll checks at most once a minute per server
  await poll();
  await sleep(3000);
  check("2: still only ONE bell after the next check", (await told("Mailbox check hasn't run since %")).length === 1);

  /* 3. The hourly job late (3 hours) tells the owner too; a run clears it. */
  await setJob("housekeeping", 180, true, "Nothing due");
  await sleep(61000);
  await poll();
  const hkTold = await until(async () => { const t = await told("Hourly housekeeping hasn't run since %"); return t.length ? t : null; }, 30, 500);
  check("3: 'Hourly housekeeping hasn't run since …' rings once", !!hkTold && hkTold.length === 1, JSON.stringify(hkTold));
  await setJob("mailbox", 1, false, "Problem: Google refused the sign-in");
  await go(page, `${base}/settings`);
  check("3: a run that failed shows ✗ with its problem in red", (await mail.getAttribute("data-job-state")) === "failed" && /✗/.test(await mail.locator("[data-job-last]").textContent()) && /Google refused/.test(await mail.locator("[data-job-result]").textContent()));
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
  // Put the shared rows back as they were and remove the test bells.
  for (const r of before) await sql("update public.background_jobs set last_ran_at = $2, last_ok = $3, last_result = $4, late_notified_at = $5, created_at = $6 where key = $1", [r.key, r.last_ran_at, r.last_ok, r.last_result, r.late_notified_at, r.created_at]);
  await sql("delete from public.notifications where type = 'background_job_late' and created_at > $1", [mark]);
}
process.exit(summary() ? 1 : 0);
