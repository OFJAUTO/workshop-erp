// The owner's list of 8 November 2026, parts 2 to 4 (built 9 November):
//   2. "Urgent" must mean urgent: a passed promised date makes a task red WITH its reason; a far promise does not;
//      the bar reads "N waiting · n urgent".
//   3. Promised date on every approved job: the release window asks for it; the job card says "No promised date yet"
//      and sets it; a change needs a reason, kept in the history.
//   4. The bell only counts what is still open: information never counts, a done task clears itself, a manual one
//      stays until read, and information is read once the panel has shown it.
//   node --env-file=.env.test.local tests/browser/test-nov9.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, makeChecks, sql, go } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const dubai = (days) => new Date(Date.now() + 4 * 3600000 + days * 86400000).toISOString().slice(0, 10);

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;

// ---- 2. Urgent ---------------------------------------------------------------------------------------------------
await sql("update public.jobs set promised_at = $2::date where id = $1", [jobId, dubai(-1)]);
const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
await go(own.page, `${base}/dashboard`);
const row = own.page.locator(`[data-waiting-row][data-waiting-job="${jobId}"]`).first();
await row.waitFor({ timeout: 20000 }).catch(() => null);
check("2: a passed promised date makes the car's task URGENT", (await row.getAttribute("data-urgency")) === "red", String(await row.getAttribute("data-urgency")));
check("2: the reason is on the line", /Promised date passed/.test((await row.locator("[data-urgent-why]").textContent().catch(() => "")) ?? ""));
const header = ((await own.page.locator("[data-waiting-header]").textContent()) ?? "").trim();
check(`2: the bar reads "N waiting · n urgent" (${header})`, /^\d+ waiting · \d+ urgent$/.test(header));
const firstUrg = await own.page.locator("[data-waiting-row]").first().getAttribute("data-urgency");
check("2: urgent items come first", firstUrg === "red");
await sql("update public.jobs set promised_at = $2::date where id = $1", [jobId, dubai(10)]);
await go(own.page, `${base}/dashboard`);
const row2 = own.page.locator(`[data-waiting-row][data-waiting-job="${jobId}"]`).first();
await row2.waitFor({ timeout: 20000 }).catch(() => null);
check("2: a promise ten days away does not make it urgent (it is not old age either)", (await row2.getAttribute("data-urgency")) !== "red" && (await row2.locator("[data-urgent-why]").count()) === 0);

// ---- 3. Promised date ---------------------------------------------------------------------------------------------
await sql("update public.jobs set promised_at = null where id = $1", [jobId]);
await go(own.page, `${base}/jobs/${jobId}`);
check("3: the job card says No promised date yet", await own.page.locator("[data-promised-missing]").isVisible().catch(() => false));
const release = own.page.locator("[data-release-form]").first();
if (await release.count()) check("3: the release window asks for the promised date (required)", (await release.locator("[data-promised-date]").getAttribute("required")) !== null);
const form = own.page.locator("[data-promised-form]");
await form.locator("[data-promised-date]").fill(dubai(5));
check("3: a first date needs no reason", (await form.locator("[data-promise-reason]").count()) === 0);
await form.locator("[data-promised-save]").click();
const saved = await until(async () => ((await sql("select promised_at::text as d from public.jobs where id = $1", [jobId]))[0]?.d === dubai(5) ? 1 : null));
check("3: the promised date is saved", !!saved);
await go(own.page, `${base}/jobs/${jobId}`);
await own.page.locator("[data-promised-box] summary").click();
const form2 = own.page.locator("[data-promised-form]");
await form2.locator("[data-promised-date]").fill(dubai(7));
check("3: changing it asks why", (await form2.locator("[data-promise-reason]").count()) === 1);
await form2.locator("[data-promise-reason]").fill("Parts arrive later");
await form2.locator("[data-promised-save]").click();
const ev = await until(async () => ((await sql("select note from public.job_events where job_id = $1 and event_type = 'promised_date' and note like '%Parts arrive later%'", [jobId]))[0]?.note ?? null));
check("3: the change and its reason are in the history", !!ev && ev.includes(dubai(5)) && ev.includes(dubai(7)), String(ev));
await own.page.screenshot({ path: `${shots}/nov9-promised-date.png` });

// ---- 4. The bell --------------------------------------------------------------------------------------------------
const cookie = await cookieHeader("owner");
const me = (await (await fetch(`${base}/api/notifications`, { headers: { cookie } })).json()).staffId;
await sql("update public.notifications set read_at = now() where staff_id = $1 and read_at is null", [me]);
await sql(`insert into public.notifications (staff_id, type, title, body, job_id, href) values
  ($1, 'scan_received', 'E2E NOV9 scan arrived', 'information', $2, '/scans'),
  ($1, 'job_awaiting_assignment', 'E2E NOV9 assign the car', 'done already', $2, '/assign'),
  ($1, 'owner_approval_needed', 'E2E NOV9 approve', 'manual', $2, '/jobs/' || $2::text)`, [me, jobId]);
const n1 = await (await fetch(`${base}/api/notifications`, { headers: { cookie } })).json();
check("4: information never counts on the badge (2 actions, 1 information)", n1.unread === 2, String(n1.unread));
// The bell clears done tasks at most once a minute per server (and hourly in the clean-up): ask it each time.
const cleared = await until(async () => { await fetch(`${base}/api/notifications`, { headers: { cookie } }); return ((await sql("select read_at is not null as r, cleared_at is not null as c from public.notifications where staff_id = $1 and title = 'E2E NOV9 assign the car'", [me]))[0]?.c ? 1 : null); }, 50, 2000);
check("4: a task already done clears itself (read and cleared)", !!cleared);
const manual = (await sql("select read_at from public.notifications where staff_id = $1 and title = 'E2E NOV9 approve'", [me]))[0];
check("4: a manual action stays until read", manual && manual.read_at === null);
const n2 = await (await fetch(`${base}/api/notifications`, { headers: { cookie } })).json();
check("4: the badge now counts the one open action", n2.unread === 1, String(n2.unread));
await go(own.page, `${base}/dashboard`);
await own.page.locator("button[aria-label^='Notifications']").first().click();
await own.page.locator("[data-bell-panel]").waitFor({ timeout: 10000 });
await own.page.screenshot({ path: `${shots}/nov9-bell.png` });
const seen = await until(async () => ((await sql("select read_at from public.notifications where staff_id = $1 and title = 'E2E NOV9 scan arrived'", [me]))[0]?.read_at ? 1 : null), 20, 500);
check("4: information is read once the panel has shown it", !!seen);
await sql("update public.notifications set read_at = now() where staff_id = $1 and title like 'E2E NOV9%'", [me]);

await own.browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
