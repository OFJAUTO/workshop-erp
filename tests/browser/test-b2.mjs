// B2 (28 October 2026): team leaders - their own team's queue, people, hand-over with photos and PIN, materials,
// problems to the manager, the after-care check, no prices; the server refuses another team.
// Run against a local dev server: E2E_BASE=http://localhost:3101 npm run test:b2
import path from "node:path";
import fs from "node:fs";
import { api, base, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, sql, submitted, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "b2");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (loc, name) => loc.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => null);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const until = async (fn, tries = 25, ms = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const ARSALAN = (await sql("select id from public.staff where role_id = 'workshop_manager' and department_id = 'bodyshop' and is_active limit 1"))[0]?.id;

// A bodyshop car in its stages (Full PPF, tint, removal) with the E2e leaders; the prep stage (detailing) is running.
const seed = (await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" })).json;
const JOB = seed.jobId;
const P = seed.people;
check("seed: a bodyshop car with its stages", !!JOB && !!P?.detailingLeader && !!P?.ppfLeader);
await sql("update public.staff set team = 'detailing_cleaning' where id = $1", [P.detailingLeader]);
await sql("update public.staff set team = 'ppf' where id = $1", [P.ppfLeader]);
const stages = await sql("select id, key, position from public.bodyshop_stages where job_id = $1 and is_active order by position", [JOB]);
const prep = stages.find((s) => s.key === "prep");
for (const s of stages) {
  if (s.position < prep.position) await sql("update public.bodyshop_stages set status = 'done', done_at = now() where id = $1", [s.id]);
  else if (s.id === prep.id) await sql("update public.bodyshop_stages set status = 'active', started_at = now() where id = $1", [s.id]);
  else await sql("update public.bodyshop_stages set status = 'pending' where id = $1", [s.id]);
}
await sql("insert into public.bodyshop_assignments (job_id, staff_id, section) select $1, $2, 'detailing' where not exists (select 1 from public.bodyshop_assignments where job_id = $1 and staff_id = $2 and removed_at is null)", [JOB, P.detailer]);

// ---------------------------------------------------------------- 1. The detailing leader's day
{
  const { browser, page } = await browserForId(P.detailingLeader, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/home`);
  check("1 a team leader lands on their team's queue", /\/bodyshop\/mine/.test(page.url()), page.url());
  const nav = (await page.locator("aside").textContent()) ?? "";
  check("2 the menu says My team, no Home", /My team/.test(nav) && !/\bHome\b/.test(nav));
  const groups = await page.locator("[data-mine-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-mine-group")));
  check("3 four groups: overdue, ready for us, in progress, waiting", groups.join(",") === "overdue,ready,progress,waiting", groups.join(","));
  const teamNow = page.locator("[data-team-now]");
  check("4 My team now shows the team with the leader marked", (await teamNow.locator(`[data-pick-person="${P.detailingLeader}"]`).count()) === 1 && (await teamNow.locator("[data-leader]").count()) >= 1);
  const car = page.locator(`[data-mine-car="${JOB}"]`).first();
  check("5 the car is in the team's queue", (await car.count()) === 1);
  await shot(page.locator("main"), "1-my-team");
  // Clock me on.
  await car.locator("[data-clock-me='in']").click();
  await submitted(page);
  const clk = await sql("select count(*)::int n from public.bodyshop_clockings where job_id = $1 and staff_id = $2 and ended_at is null", [JOB, P.detailingLeader]);
  check("6 Clock me on puts the leader's own clock on the car", clk[0]?.n === 1);
  check("7 the car moves to In progress", (await page.locator(`[data-mine-car="${JOB}"]`).first().getAttribute("data-in-group")) === "progress");
  // The server refuses another team's person even from a doctored form.
  const chip = page.locator(`[data-mine-car="${JOB}"] [data-staff-mode=chips] form`).first();
  await chip.evaluate((f, other) => { f.querySelector('input[name="staff_id"]').value = other; f.requestSubmit(); }, P.installer);
  await submitted(page);
  check("8 the server refuses a person from another team", /only your own team/i.test(decodeURIComponent(page.url())), decodeURIComponent(page.url()).slice(-120));
  // Problem – needs manager, with a photo.
  await page.locator(`[data-mine-car="${JOB}"] [data-problem-open]`).first().click();
  const dlg = page.locator("[data-problem-dialog]");
  await dlg.locator("[data-problem-text]").fill("Deep scratch on the bonnet under the old film");
  await dlg.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "problem.png", mimeType: "image/png", buffer: png });
  await until(async () => (await sql("select count(*)::int n from public.job_files where job_id = $1 and caption = 'Problem' and removed_at is null", [JOB]))[0]?.n > 0);
  await shot(dlg, "2-problem-dialog");
  await dlg.locator("[data-problem-send]").click();
  await submitted(page);
  const prob = (await sql("select id, photo_path, section from public.bodyshop_problems where job_id = $1 order by created_at desc limit 1", [JOB]))[0];
  check("9 the problem is saved with its photo and the team", !!prob?.id && !!prob.photo_path && prob.section === "detailing", JSON.stringify(prob));
  const told = await until(async () => (await sql("select string_agg(staff_id::text, ',') s from public.notifications where job_id = $1 and type = 'bodyshop_problem'", [JOB]))[0]?.s);
  check("10 the bodyshop manager is told", (told ?? "").includes(ARSALAN), told);
  check("11 My team shows it waiting for the manager", (await page.locator(`[data-mine-car="${JOB}"] [data-mine-problem]`).count()) === 1);
  // The hand-over: no photo = no sign-off; photo + PIN = done, the next team told.
  await page.locator(`[data-mine-car="${JOB}"] [data-stage-handover-open="prep"]`).click();
  const ho = page.locator('[data-stage-handover="prep"]');
  check("12 the hand-over needs a photo first", await ho.locator("[data-stage-handover-send]").isDisabled());
  await ho.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "prep-done.png", mimeType: "image/png", buffer: png });
  await until(async () => (await sql("select count(*)::int n from public.job_files where ref_id = $1 and removed_at is null", [prep.id]))[0]?.n > 0);
  await sleep(800);
  await ho.locator("[data-handover-pin]").fill("9999");
  await shot(ho, "3-handover-dialog");
  await ho.locator("[data-stage-handover-send]").click();
  await submitted(page);
  check("13 a wrong PIN is refused", /not your PIN/i.test(decodeURIComponent(page.url())), decodeURIComponent(page.url()).slice(-80));
  await page.locator(`[data-mine-car="${JOB}"] [data-stage-handover-open="prep"]`).click();
  await page.locator('[data-stage-handover="prep"] [data-handover-pin]').fill("1234");
  await page.locator('[data-stage-handover="prep"] [data-stage-handover-send]').click();
  await submitted(page);
  const st = (await sql("select status, handover_pin_at is not null pin, handover_by from public.bodyshop_stages where id = $1", [prep.id]))[0];
  check("14 photo + PIN: the stage is signed off", st?.status === "done" && st.pin && st.handover_by === P.detailingLeader, JSON.stringify(st));
  const nextUp = (await sql("select key, status from public.bodyshop_stages where job_id = $1 and is_active and status = 'active' and key <> 'handover'", [JOB]))[0];
  check("15 the next team's stage is running", nextUp?.key === "ppf", JSON.stringify(nextUp));
  const ppfTold = await until(async () => (await sql("select count(*)::int n from public.notifications where job_id = $1 and staff_id = $2 and type = 'bodyshop_heads_up'", [JOB, P.ppfLeader]))[0]?.n);
  check("16 the PPF leader is told the car is with them", (ppfTold ?? 0) >= 1);
  // Materials: ceramic is the detailing team's; film is not.
  await go(page, `${base}/bodyshop/${JOB}#materials`);
  check("17 the detailing leader enters ceramic, not film", (await page.locator("[data-ceramic-form]").count()) === 1 && (await page.locator("[data-film-usage]").count()) === 0);
  await page.locator('[data-ceramic-form] input[name="product"]').fill("E2E Ceramic Pro");
  await page.locator('[data-ceramic-form] input[name="batch"]').fill("B-77");
  await page.locator("[data-save-ceramic]").click();
  await submitted(page);
  const cer = (await sql("select kind, product, batch, cost_aed from public.ceramic_usage where job_id = $1", [JOB]))[0];
  check("18 the ceramic is saved and costed for the owner", cer?.product === "E2E Ceramic Pro" && Number(cer.cost_aed) > 0, JSON.stringify(cer));
  const body = (await page.textContent("main")) ?? "";
  check("19 no prices or costs anywhere on the leader's page", !/AED\s*[\d,]/.test(body) && !/\bREAL PROFIT\b/i.test(body));
  await shot(page.locator("#materials"), "4-materials-detailing");
  await browser.close();
}

// ---------------------------------------------------------------- 2. The manager answers; the leader hears it
{
  const { browser, page } = await browserForId(ARSALAN, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/bodyshop/${JOB}#problems`);
  const form = page.locator("[data-problem-answer-form]").first();
  await form.locator('input[name="answer"]').fill("Polish it out before the film; I will tell the advisor");
  await form.locator("button[type=submit]").click();
  await submitted(page);
  await shot(page.locator("#problems"), "5-problem-answered");
  await browser.close();
  const heard = await until(async () => (await sql("select count(*)::int n from public.notifications where job_id = $1 and staff_id = $2 and type = 'bodyshop_problem_answered'", [JOB, P.detailingLeader]))[0]?.n);
  check("20 the leader who raised it hears the answer", (heard ?? 0) >= 1);
}

// ---------------------------------------------------------------- 3. The PPF leader: own stage only, film, after-care
await sql("insert into public.aftercare_checks (job_id, due_date) select $1, current_date + 10 where not exists (select 1 from public.aftercare_checks where job_id = $1)", [JOB]);
{
  const { browser, page } = await browserForId(P.ppfLeader, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/bodyshop/${JOB}`);
  check("21 the PPF leader enters film, not ceramic", (await page.locator("[data-film-usage]").count()) === 1 && (await page.locator("[data-ceramic-form]").count()) === 0);
  check("22 the PPF leader cannot touch strip and refit or the customer's updates", (await page.locator("[data-removed-item] button:not([disabled])").count()) === 0);
  const care = page.locator("#aftercare");
  check("23 the 10-day check card is on the bodyshop page for the PPF leader", (await care.locator("[data-aftercare-open]").count()) === 1);
  await care.locator("[data-aftercare-open]").click();
  const f = care.locator("[data-aftercare-form]");
  for (const box of await f.locator('input[name="point"]').all()) await box.check();
  await f.locator('input[name="pin"]').fill("1234");
  await f.locator("button[type=submit]").first().click();
  await submitted(page);
  const done = (await sql("select done_at is not null d, done_by from public.aftercare_checks where job_id = $1", [JOB]))[0];
  check("24 the PPF leader signs the after-care check with his PIN", done?.d && done.done_by === P.ppfLeader, JSON.stringify(done));
  await go(page, `${base}/bodyshop/rolls`);
  check("25 the rolls page shows no prices to a leader", !/AED/.test((await page.textContent("main")) ?? ""));
  await browser.close();
}
{
  // The paint leader may not sign the after-care check.
  await sql("update public.aftercare_checks set done_at = null, done_by = null where job_id = $1", [JOB]);
  const { browser, page } = await browserForId(P.paintLeader, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/bodyshop/${JOB}`);
  check("26 another team's leader gets no after-care sign-off", (await page.locator("#aftercare [data-aftercare-open]").count()) === 0);
  check("27 nor a hand-over on another team's stage", (await page.locator("[data-stage-handover-open]").count()) === 0);
  await browser.close();
}

// ---------------------------------------------------------------- 4. The server never hands a leader costs or other files
{
  const cookie = await cookieHeader(P.ppfLeader);
  const pm = await fetch(`${base}/api/parts/price-memory?pn=A1673306800`, { headers: { cookie } });
  check("28 price memory (part costs) is refused to a team leader", pm.status === 403, String(pm.status));
  const anyFile = (await sql("select storage_path from public.job_files where job_id = $1 and removed_at is null limit 1", [JOB]))[0]?.storage_path;
  const again = await fetch(`${base}/api/files/register`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jobId: JOB, path: anyFile, kind: "bodyshop_photo" }) });
  check("29 a stored file is never signed again for someone else", !!anyFile && again.status === 403, String(again.status));
  const money = await fetch(`${base}/api/files/register`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ jobId: JOB, path: `${JOB}/x.pdf`, kind: "supplier_invoice" }) });
  check("30 a team leader may add bodyshop photos only", money.status === 403, String(money.status));
}

cleanupDb();
process.exit(summary() ? 1 : 0);
