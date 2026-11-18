// 18 November 2026, Section 2: APPROVALS THAT WAIT TOO LONG (the void of RCT-00062, a duplicate on cheque 019383,
// waited for the owner for days).
//  A. The Approvals page: the age of each item, the oldest first, and the system's duplicate evidence on the void.
//  B. Accounts (who asked): "Waiting for the owner – n days" and "Remind the owner", once a day (Accounts posting).
//  C. The same on the job card (accounts).
//  D. The daily reminder: one a day when anything waited more than 24 hours, a bell to the owner (the test server
//     never sends the email), recorded on the Approvals page.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s18-2-approvals.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-18-approvals-wait";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

let remindersBefore = null;
let lastBefore = null;
const since = new Date().toISOString();
try {
  cleanupDb();
  remindersBefore = (await sql("select value from public.settings where key = 'approval_reminders'"))[0]?.value ?? null;
  lastBefore = (await sql("select value from public.settings where key = 'approvals_reminder_last'"))[0]?.value ?? null;
  await sql("delete from public.settings where key in ('approval_reminders', 'approvals_reminder_last')");
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [JOB]))[0];
  const pro = (await sql("select id from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' and is_active limit 1", [JOB]))[0];
  const accId = (await sql("select id from public.staff where role_id = 'accounts' and is_active and display_name ilike 'e2e%' limit 1"))[0]?.id ?? (await sql("select id from public.staff where role_id = 'accounts' and is_active limit 1"))[0]?.id;
  // The RCT-00062 case: the same cheque recorded twice, the second one asked to be voided two days ago.
  await sql("insert into public.payments (number, customer_id, job_id, invoice_id, vehicle_id, method, amount_aed, status, cheque_number, cheque_bank, cheque_date, cheque_status, cleared_at) values ('E2E-RCT-S2A', $1, $2, $3, $4, 'cheque', 2236.50, 'recorded', '019383', 'ADCB', current_date, 'cleared', now())", [job.customer_id, JOB, pro.id, job.vehicle_id]);
  const dup = (await sql("insert into public.payments (number, customer_id, job_id, invoice_id, vehicle_id, method, amount_aed, status, cheque_number, cheque_bank, cheque_date, cheque_status, void_requested_at, void_request_reason, void_requested_by) values ('E2E-RCT-S2B', $1, $2, $3, $4, 'cheque', 2236.50, 'recorded', '019383', 'ADCB', current_date, 'pending', now() - interval '2 days 3 hours', 'Double Entry', $5) returning id", [job.customer_id, JOB, pro.id, job.vehicle_id, accId]))[0].id;
  const KEY = `void:${dup}`;

  // A. The Approvals page.
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/approvals`);
  const box = own.page.locator(`[data-approval-box="${KEY}"]`);
  await box.waitFor({ timeout: 30000 });
  check("A1: the box shows how long it waited (2 days, red)", /waiting 2 days/.test(await text(box, "[data-approval-age]")), await text(box, "[data-approval-age]"));
  check("A2: the duplicate evidence is on the item", /Cheque 019383 is already recorded: E2E-RCT-S2A AED 2,236\.50.*cleared.*Is this a duplicate\?/.test(await text(box, "[data-approval-evidence]")), await text(box, "[data-approval-evidence]"));
  const head = await text(own.page, "[data-approvals-oldest]");
  check("A3: the page says how old the oldest is, oldest at the top", /oldest has waited/.test(head), head);
  const firstGroup = await own.page.locator("[data-approvals-group]").first().getAttribute("data-approvals-group");
  const ages = await own.page.locator("[data-approvals-group]").evaluateAll((gs) => gs.map((g) => Math.max(...Array.from(g.querySelectorAll("[data-approval-age]")).map((a) => Number(a.getAttribute("data-approval-age")) || 0), 0)));
  check("A4: the group holding the oldest item comes first", ages.length > 0 && ages[0] === Math.max(...ages), `${firstGroup} ${JSON.stringify(ages)}`);
  await shots(own.page, box, "a-approval-age-evidence");

  // B. Accounts posting: waiting words and Remind the owner.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/accounts-posting?tab=cheque`);
  const row = acc.page.locator('[data-bank-row="E2E-RCT-S2B"]');
  await row.waitFor({ timeout: 30000 });
  check("B1: \"Waiting for the owner – 2 days\"", (await text(row, "[data-approval-waiting-age]")) === "Waiting for the owner – 2 days", await text(row, "[data-approval-waiting-age]"));
  await row.locator("[data-approval-remind]").click();
  await row.locator("[data-approval-reminded]").waitFor({ timeout: 30000 });
  check("B2: reminded", /The owner is reminded/.test(await text(row, "[data-approval-reminded]")));
  const bell = await until(async () => (await sql("select title from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'owner' and n.type = 'approvals_waiting' and n.title like 'REMINDER from %' and n.created_at > $1 limit 1", [since]))[0], 20);
  check("B3: the owner gets the reminder with the age", !!bell && /waiting 2 days/.test(bell.title), bell?.title);
  await shots(acc.page, row, "b-remind-the-owner");
  // Once a day: a fresh page says so.
  await go(acc.page, `${base}/accounts-posting?tab=cheque&v=2`);
  const row2 = acc.page.locator('[data-bank-row="E2E-RCT-S2B"]');
  await row2.waitFor({ timeout: 30000 });
  await row2.locator("[data-approval-remind]").click();
  await row2.locator("[data-approval-remind-error]").waitFor({ timeout: 30000 });
  check("B4: only once a day", /Already reminded today/.test(await text(row2, "[data-approval-remind-error]")));

  // C. The job card (accounts): the same waiting words, the button already used today.
  await go(acc.page, `${base}/jobs/${JOB}`);
  const w = acc.page.locator(`[data-approval-waiting="${KEY}"]`);
  await w.waitFor({ timeout: 30000 });
  check("C1: job card: Waiting for the owner – 2 days", /Waiting for the owner – 2 days/.test(await text(w, "[data-approval-waiting-age]")));
  check("C2: job card: the evidence and \"Reminded today\"", /already recorded/.test(await text(w, "[data-approval-evidence]")) && /Reminded today/.test(await text(w, "[data-approval-remind]")));
  await shots(acc.page, w, "c-job-card-waiting");

  // D. The daily reminder.
  const r = (await api("/api/e2e/approvals-reminder", {})).json?.result;
  check("D1: the daily reminder runs when something waited more than 24 hours", !!r && r.count >= 1 && /Test server/.test(r.words), JSON.stringify(r));
  const daily = await until(async () => (await sql("select title from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'owner' and n.type = 'approvals_waiting' and n.title like 'WAITING FOR YOUR APPROVAL:%' and n.created_at > $1 limit 1", [since]))[0], 20);
  check("D2: \"WAITING FOR YOUR APPROVAL: n items, oldest n days\"", !!daily && /^WAITING FOR YOUR APPROVAL: \d+ items?, oldest \d+ days?$/.test(daily.title), daily?.title);
  await go(own.page, `${base}/approvals?v=2`);
  check("D3: the Approvals page records the last daily reminder", (await own.page.locator("[data-approvals-reminder-last]").count()) > 0, await text(own.page, "[data-approvals-reminder-last]"));
  await shots(own.page, own.page.locator("[data-approvals-oldest]"), "d-daily-reminder-record");
  // E. The owner decides: Void it - the item leaves.
  await box.waitFor({ timeout: 30000 }).catch(() => null);
  await own.page.locator(`[data-approval-box="${KEY}"] [data-approval-approve]`).click();
  const voided = await until(async () => (await sql("select status from public.payments where id = $1 and status = 'voided'", [dup]))[0], 40);
  check("E1: approved in one look: the duplicate is voided", !!voided);
  await own.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.notifications where type = 'approvals_waiting' and created_at > $1", [since]).catch(() => null);
  if (remindersBefore === null) await sql("delete from public.settings where key = 'approval_reminders'").catch(() => null);
  else await sql("update public.settings set value = $1::jsonb where key = 'approval_reminders'", [JSON.stringify(remindersBefore)]).catch(() => null);
  if (lastBefore === null) await sql("delete from public.settings where key = 'approvals_reminder_last'").catch(() => null);
  else await sql("update public.settings set value = $1::jsonb where key = 'approvals_reminder_last'", [JSON.stringify(lastBefore)]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
