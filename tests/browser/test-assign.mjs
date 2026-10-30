// The To-assign rebuild (21 October 2026, section 6): cars on the LEFT, ONE team-grouped assign panel
// on the RIGHT (never repeated per car), server-enforced sides, bodyshop cars with no road test and no
// mechanical inspection, a clear confirmation and the car leaving the list.
//   node --env-file=.env.test.local tests/browser/test-assign.mjs
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, freeTech, makeChecks, sleep, sql, pickPerson } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const until = async (fn, tries = 30, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "assign" })).json;
const jobId = seed.jobId;
const techId = await freeTech(null, "mechanical");

// A bodyshop car waiting too (the seeded job's twin, re-pointed): the owner sees both sides.
const bodyJob = (await sql(`insert into public.jobs (job_number, vehicle_id, customer_id, status, stage, department, is_open, gated_in_at, gated_in_by, first_approval_at, stage_entered_at)
  select 'J-E2EBS1', vehicle_id, customer_id, 'pending_inspection', stage, 'bodyshop', true, now(), gated_in_by, now(), now() from public.jobs where id = $1 returning id`, [jobId]))[0];
const gi = await sql(`insert into public.gate_ins (job_id, arrived_by, condition, fuel_level, battery_percent, cleanliness, dash_cam, major_damage, wheels_required, damage_note, mileage, mileage_unit, keys_count, keys_keychain, customer_requests, is_complete, created_by)
  select $1, arrived_by, condition, fuel_level, battery_percent, cleanliness, dash_cam, major_damage, wheels_required, damage_note, mileage, mileage_unit, keys_count, keys_keychain, customer_requests, true, created_by from public.gate_ins where job_id = $2 returning id`, [bodyJob.id, jobId]);
const media = await sql(`insert into public.gate_in_media (job_id, kind, storage_path, uploaded_by, created_by)
  select $1, kind, storage_path || '#e2ebs-' || id, uploaded_by, created_by from public.gate_in_media where job_id = $2 and removed_at is null returning id`, [bodyJob.id, jobId]);
if (!gi.length || !media.length) { console.log("SEED PROBLEM: gate-in clone", gi.length, "media", media.length); }

/* ---- The mechanical manager: his side only, one panel, road test, assign works. ---- */
{
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1500, height: 1200 } });
  await page.goto(`${base}/assign`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  check("the board renders: cars left, panel right", (await page.locator("[data-assign-board]").count()) === 1 && (await page.locator("[data-assign-panel]").count()) === 1);
  check("the manager sees his mechanical car", (await page.locator(`[data-assign-car="${jobId}"]`).count()) === 1);
  check("the bodyshop car is NOT on the mechanical manager's list (server side-filter)", (await page.locator(`[data-assign-car="${bodyJob.id}"]`).count()) === 0);
  const panels = await page.locator("[data-team]").count();
  const cards = await page.locator("[data-assign-car]").count();
  check("the team list appears ONCE (panel), not under every car", panels >= 1 && (await page.locator("[data-assign-form]").count()) === 1, `teams ${panels}, cars ${cards}`);
  await page.locator(`[data-assign-car="${jobId}"]`).click();
  await page.waitForTimeout(500);
  check("teams grouped under headers (Technicians...)", /TECHNICIANS/i.test(((await page.locator("[data-assign-panel]").innerText()) ?? "")));
  check("road test chips for a mechanical car", (await page.locator("[data-assign-panel]").getByText("Road test first").count()) === 1);
  await pickPerson(page, techId);
  await page.getByText("No road test", { exact: true }).click();
  await page.screenshot({ path: `${shots}/assign-board.png`, fullPage: true });
  await page.locator("[data-assign-submit]").click();
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
  await page.waitForTimeout(1500);
  check("a clear confirmation after assigning — R1", /Assigned to/i.test(decodeURIComponent(page.url())), decodeURIComponent(page.url()).slice(-120));
  check("the car left the To-assign list", (await page.locator(`[data-assign-car="${jobId}"]`).count()) === 0);
  await page.screenshot({ path: `${shots}/assign-confirmed.png`, fullPage: true });
  await browser.close();
  const j = (await sql("select status, assigned_to from public.jobs where id = $1", [jobId]))[0];
  check("assigned and in Pending inspection", j?.assigned_to === techId && j?.status === "pending_inspection", JSON.stringify(j));
  const told = await until(async () => (await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'job_assigned'", [jobId]))[0]?.n, 20, 400);
  check("the technician got the task — R2/R3", (told ?? 0) >= 1);
}

/* ---- The owner on the bodyshop car: no road test, no mechanical inspection, bodyshop board row. ---- */
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
  await page.goto(`${base}/assign`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  check("the owner sees the bodyshop car", (await page.locator(`[data-assign-car="${bodyJob.id}"]`).count()) === 1);
  await page.locator(`[data-assign-car="${bodyJob.id}"]`).click();
  await page.waitForTimeout(500);
  check("bodyshop car: NO road test buttons", (await page.locator("[data-no-roadtest]").count()) === 1 && (await page.locator("[data-assign-panel]").getByText("Road test first").count()) === 0);
  const bodyTeams = ((await page.locator("[data-assign-panel]").innerText()) ?? "").replace(/\s+/g, " ");
  check("bodyshop teams shown (PPF / Dismantle & refit / ...)", /(PPF|DISMANTLE|PAINT|DETAILING)/i.test(bodyTeams), bodyTeams.slice(0, 160));
  await page.screenshot({ path: `${shots}/assign-bodyshop.png`, fullPage: true });
  const anyBody = page.locator("[data-pick-person]").first();
  if (await anyBody.count()) {
    await pickPerson(page, null);
    await page.locator("[data-assign-submit]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
    await sleep(1500);
    const insp = (await sql("select count(*)::int as n from public.inspections where job_id = $1", [bodyJob.id]))[0];
    const road = (await sql("select count(*)::int as n from public.road_tests where job_id = $1", [bodyJob.id]))[0];
    const bAssign = (await sql("select count(*)::int as n from public.bodyshop_assignments where job_id = $1 and removed_at is null", [bodyJob.id]))[0];
    check("no mechanical inspection, no road test row", (insp?.n ?? 0) === 0 && (road?.n ?? 0) === 0, JSON.stringify({ insp, road }));
    check("the person lands on the bodyshop board too", (bAssign?.n ?? 0) >= 1);
    const st = (await sql("select status from public.jobs where id = $1", [bodyJob.id]))[0];
    check("never Pending road test for a bodyshop car", st?.status !== "pending_road_test", st?.status);
  } else {
    check("a bodyshop person exists to assign (teams set on the Team page)", false, "no bodyshop people listed");
  }
  await browser.close();
}

await cleanupDb();
await sql("delete from public.notifications where job_id in (select id from public.jobs where job_number = 'J-E2EBS1')").catch(() => null);
process.exit(summary() ? 1 : 0);
