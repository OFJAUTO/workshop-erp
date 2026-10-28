// B1 (28 October 2026): planning on bodyshop jobs uses the bodyshop team; one shared staff picker everywhere.
// Run against a local dev server: E2E_BASE=http://localhost:3101 npm run test:b1
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, MANAGER_MECH, pickPerson, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "b1");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name, loc) => (loc ?? page).screenshot({ path: path.join(SHOTS, `${name}.png`), ...(loc ? {} : { fullPage: false }) }).catch(() => null);
const ARSALAN = (await sql("select id from public.staff where role_id = 'workshop_manager' and department_id = 'bodyshop' and is_active limit 1"))[0]?.id;
const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

// The E2e bodyshop people (made by the bodyshop seed).
await api("/api/e2e/stage", { stage: "bodyshop", at: "approved" });
const people = Object.fromEntries((await sql("select display_name, id from public.staff where display_name like 'E2e %'")).map((r) => [r.display_name, r.id]));
const PPF_LEADER = people["E2e PPF Leader"], INSTALLER = people["E2e Installer"];
check("test people exist", !!PPF_LEADER && !!INSTALLER && !!ARSALAN);

// ---------------------------------------------------------------- A. a bodyshop-only car
let seed = (await api("/api/e2e/stage", { stage: "bodyshop-plan" })).json;
const JOB = seed.jobId;
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const card = page.locator("#planning");
  check("A1 planning card knows the car is bodyshop only", (await card.getAttribute("data-planning-sides")) === "bodyshop");
  check("A2 the circle says Bodyshop, no Workshop circle", (await card.locator('[data-circle="bodyshop"]').count()) === 1 && (await card.locator('[data-circle="workshop"]').count()) === 0 && /Bodyshop/.test(await card.locator('[data-circle="bodyshop"]').innerText()));
  const form = card.locator('[data-release-form="bodyshop"]');
  check("A3 the button reads Release to bodyshop", (await form.locator('[data-release="bodyshop"]').innerText()).trim() === "Release to bodyshop");
  const sides = await form.locator("[data-side]").evaluateAll((els) => els.map((e) => e.getAttribute("data-side")));
  check("A4 only bodyshop people are offered", sides.length === 1 && sides[0] === "bodyshop", sides.join(","));
  const teams = await form.locator("[data-team]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team")));
  check("A5 grouped by the bodyshop teams", teams.length >= 3 && teams.every((t) => ["dismantle_refit", "ppf", "painting", "detailing_cleaning"].includes(t)), teams.join(","));
  const leadersFirst = await form.locator("[data-team]").evaluateAll((els) => els.every((g) => { const rows = [...g.querySelectorAll("li")]; const firstPlain = rows.findIndex((r) => !r.querySelector("[data-leader]")); return firstPlain === -1 || rows.slice(firstPlain).every((r) => !r.querySelector("[data-leader]")); }));
  check("A6 leaders at the top of each team, marked Leader", leadersFirst && (await form.locator("[data-leader]").count()) >= 3);
  const mechanicNames = (await sql("select display_name from public.staff where role_id = 'technician' and department_id = 'mechanical' and is_active")).map((r) => r.display_name);
  const formText = await form.innerText();
  check("A7 no mechanic in the bodyshop picker", !mechanicNames.some((n) => new RegExp(`\\b${n}\\b`).test(formText)));
  check("A8 Arsalan leads Dismantle & refit", /Arsalan/.test(await form.locator('[data-team="dismantle_refit"]').innerText().catch(() => "")));
  await card.scrollIntoViewIfNeeded();
  await shot(page, "A-bodyshop-only-owner", card);
  await browser.close();
}
{
  // Mert, the mechanical manager, sees no bodyshop release form.
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  check("A9 the workshop manager cannot release the bodyshop car", (await page.locator('[data-release-form="bodyshop"]').count()) === 0 && (await page.locator('[data-release-waiting="bodyshop"]').count()) === 1);
  await browser.close();
}
{
  // The bodyshop page never goes round the release while the car is in planning.
  const { browser, page } = await browserForId(ARSALAN, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/bodyshop/${JOB}`);
  check("A9b no Start the work now during planning, a link to the Planning card instead", (await page.locator("[data-start-work]").count()) === 0 && (await page.locator('a[href$="#planning"]').count()) >= 1);
  await browser.close();
}
{
  // Arsalan releases it to the bodyshop: the PPF leader and the installer.
  const { browser, page } = await browserForId(ARSALAN, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const form = page.locator('[data-release-form="bodyshop"]');
  await form.locator('input[name="start_date"]').fill(today);
  await form.locator(`[data-pick-person="${PPF_LEADER}"]`).click();
  await form.locator(`[data-pick-person="${INSTALLER}"]`).click();
  const busy = form.locator("[data-pick-busy] button").first();
  if (await busy.count()) await busy.click();
  await shot(page, "A-arsalan-ticked", form);
  await form.locator('[data-release="bodyshop"]').click();
  await submitted(page);
  check("A10 released with a message", /Released to the bodyshop/.test(decodeURIComponent(page.url())), page.url().slice(-120));
  const j = (await sql("select status, plan_bodyshop_released_at is not null b, plan_released_at is not null m, plan_bodyshop_start_date::text s, bodyshop_started_at is not null started from public.jobs where id = $1", [JOB]))[0];
  check("A11 the job is in work on the bodyshop stages", j?.status === "in_work" && j.b && j.m && j.started && j.s === today, JSON.stringify(j));
  const stages = await sql("select key, status from public.bodyshop_stages where job_id = $1 and is_active order by position", [JOB]);
  check("A12 stages built from the PACKAGE (PPF with tint, detail, QC, handover)", stages.some((s) => s.key === "ppf") && stages.some((s) => s.key === "qc") && stages[0]?.status === "active", stages.map((s) => s.key).join(","));
  const asg = await sql("select staff_id, section from public.bodyshop_assignments where job_id = $1 and removed_at is null and is_active", [JOB]);
  check("A13 the two people are on the car in the PPF section", asg.length === 2 && asg.every((a) => a.section === "ppf"), JSON.stringify(asg));
  const mech = await sql("select (select count(*) from public.job_technicians where job_id = $1 and is_active and left_at is null)::int t, (select count(*) from public.work_lines where job_id = $1 and is_active)::int w", [JOB]);
  check("A14 no mechanical work order on a bodyshop-only car", mech[0]?.t === 0 && mech[0]?.w === 0, JSON.stringify(mech[0]));
  await go(page, `${base}/jobs/${JOB}#planning`);
  await shot(page, "A-after-release", page.locator("#planning"));
  const onCar = page.locator("[data-on-car]");
  check("A15 the On the car card lists the bodyshop people with their team", (await onCar.locator("[data-on-car-bodyshop]").count()) === 1 && /PPF/.test(await onCar.innerText()));
  await browser.close();
}

// ---------------------------------------------------------------- B. a mixed car
seed = (await api("/api/e2e/stage", { stage: "bodyshop-plan", mixed: true })).json;
const lab = await sql("select count(*)::int n from public.quotation_lines where quotation_id = $1 and is_active and line_type = 'labour'", [seed.quotationId]);
check("B0 the mixed seed has a labour line", lab[0]?.n === 1, JSON.stringify(lab));
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const card = page.locator("#planning");
  check("B1 a mixed car shows the Workshop and the Bodyshop circles", (await card.getAttribute("data-planning-sides")) === "mechanical,bodyshop" && (await card.locator('[data-circle="workshop"]').count()) === 1 && (await card.locator('[data-circle="bodyshop"]').count()) === 1);
  check("B2 the owner sees both release forms", (await card.locator('[data-release-form="mechanical"]').count()) === 1 && (await card.locator('[data-release-form="bodyshop"]').count()) === 1);
  await shot(page, "B-mixed-owner", card);
  await browser.close();
}
let tech = null;
{
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const card = page.locator("#planning");
  check("B3 Mert sees only the workshop form", (await card.locator('[data-release-form="mechanical"]').count()) === 1 && (await card.locator('[data-release-form="bodyshop"]').count()) === 0 && (await card.locator('[data-release-waiting="bodyshop"]').count()) === 1);
  const form = card.locator('[data-release-form="mechanical"]');
  const sides = await form.locator("[data-side]").evaluateAll((els) => els.map((e) => e.getAttribute("data-side")));
  check("B4 the workshop form offers mechanical people only", sides.join(",") === "mechanical", sides.join(","));
  tech = await form.locator("[data-pick-person]").first().getAttribute("data-pick-person");
  await form.locator('input[name="start_date"]').fill(today);
  await form.locator(`[data-pick-person="${tech}"]`).click();
  const busy = form.locator("[data-pick-busy] button").first();
  if (await busy.count()) await busy.click();
  await form.locator('[data-release="mechanical"]').click();
  await submitted(page);
  const j = (await sql("select status, plan_released_at is not null m, plan_bodyshop_released_at is not null b from public.jobs where id = $1", [JOB]))[0];
  check("B5 the mechanical side released alone; bodyshop still to go", j?.status === "in_work" && j.m && !j.b, JSON.stringify(j));
  const wl = await sql("select title from public.work_lines where job_id = $1 and is_active", [JOB]);
  check("B6 the work order carries the labour, never the bodyshop package", wl.length === 1 && /Brake/.test(wl[0].title), wl.map((w) => w.title).join(" | "));
  await browser.close();
}
{
  const { browser, page } = await browserForId(ARSALAN, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const card = page.locator("#planning");
  check("B7 the bodyshop form is still open on the car in work", (await card.locator('[data-release-form="bodyshop"]').count()) === 1 && (await card.locator('[data-circle="workshop"]').getAttribute("data-state")) === "green");
  const form = card.locator('[data-release-form="bodyshop"]');
  await form.locator('input[name="start_date"]').fill(today);
  await form.locator(`[data-pick-person="${PPF_LEADER}"]`).click();
  const busy = form.locator("[data-pick-busy] button").first();
  if (await busy.count()) await busy.click();
  await form.locator('[data-release="bodyshop"]').click();
  await submitted(page);
  const j = (await sql("select status, plan_released_at is not null m, plan_bodyshop_released_at is not null b, bodyshop_started_at is not null s from public.jobs where id = $1", [JOB]))[0];
  check("B8 both sides released, stages running", j?.m && j.b && j.s && j.status === "in_work", JSON.stringify(j));
  await go(page, `${base}/jobs/${JOB}#planning`);
  await shot(page, "B-mixed-after-both", page.locator("#planning"));
  await browser.close();
}
{
  // The mechanics finish first: the car goes to QC only after the bodyshop stages are done (one QC for the whole car).
  await sql("update public.jobs set work_done_at = now() where id = $1", [JOB]);
  await sql("update public.job_technicians set done_at = now() where job_id = $1 and is_active", [JOB]);
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}/work`);
  await page.locator("form button", { hasText: /Confirmed, send to Q|Send to QC anyway/ }).first().click();
  await submitted(page);
  const j = (await sql("select status from public.jobs where id = $1", [JOB]))[0];
  check("B9 a mixed car is not confirmed to QC while its bodyshop stages run", j?.status === "in_work" && /bodyshop side is not finished/i.test(decodeURIComponent(page.url())), decodeURIComponent(page.url()).slice(-160));
  await browser.close();
}

// ---------------------------------------------------------------- D. a mixed car released bodyshop-first
seed = (await api("/api/e2e/stage", { stage: "bodyshop-plan", mixed: true })).json;
{
  const { browser, page } = await browserForId(ARSALAN, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const form = page.locator('[data-release-form="bodyshop"]');
  await form.locator('input[name="start_date"]').fill(today);
  await pickPerson(form, PPF_LEADER);
  await form.locator('[data-release="bodyshop"]').click();
  await submitted(page);
  const j = (await sql("select status, plan_released_at is not null m, plan_bodyshop_released_at is not null b, bodyshop_started_at is not null s from public.jobs where id = $1", [JOB]))[0];
  check("D1 bodyshop first: stages start, the car stays in planning for the mechanics", j?.status === "waiting_parts" && j.b && j.s && !j.m, JSON.stringify(j));
  await browser.close();
}
{
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${JOB}#planning`);
  const form = page.locator('[data-release-form="mechanical"]');
  check("D2 the workshop manager still releases the mechanical side", (await form.count()) === 1);
  const t = await form.locator("[data-pick-person]").first().getAttribute("data-pick-person");
  await form.locator('input[name="start_date"]').fill(today);
  await pickPerson(form, t);
  await form.locator('[data-release="mechanical"]').click();
  await submitted(page);
  const j = (await sql("select status, plan_released_at is not null m, assigned_to = $2 lead from public.jobs where id = $1", [JOB, t]))[0];
  check("D3 then the car is in work, the first ticked technician is the lead", j?.status === "in_work" && j.m && j.lead, JSON.stringify(j));
  await browser.close();
}

// ---------------------------------------------------------------- C. the other pickers and the small fixes
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/workshop-load`);
  const teams = await page.locator("[data-staff-picker] [data-team]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team")));
  check("C1 Workshop load shows both sides through the shared picker", (await page.locator('[data-staff-mode="view"]').count()) === 1 && teams.includes("technicians") && teams.includes("ppf"), teams.join(","));
  await shot(page, "C-workshop-load");
  const j493 = (await sql("select id from public.jobs where job_number = 'J-00493'"))[0]?.id;
  if (j493) {
    await go(page, `${base}/jobs/${j493}`);
    const partsBox = page.locator('[data-stage-card="parts"]');
    check("C2 a job with no parts says No parts needed ✓", (await partsBox.locator("[data-no-parts]").count()) === 1 && !/Not started/.test(await partsBox.innerText()), (await partsBox.innerText()).slice(0, 120));
    const html = await page.content();
    check("C3 the customer request reads PPF, never Ppf", /\bPPF\b/.test(html) && !/>\s*Ppf\s*</.test(html));
    await shot(page, "C-j493-parts", partsBox);
  }
  await go(page, `${base}/parts/stock`);
  const groups = await page.locator('select[name="technician"] optgroup').evaluateAll((els) => els.map((e) => e.getAttribute("label")));
  check("C4 stock issue lists people by team, leaders included", groups.length >= 2 && (await page.locator('select[name="technician"] option', { hasText: "(leader)" }).count()) >= 1, groups.join(","));
  await browser.close();
}

await sql("update public.jobs set is_open = false where id = $1", [JOB]).catch(() => null);
cleanupDb();
process.exit(summary() ? 1 : 0);
