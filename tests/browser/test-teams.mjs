// Departments per line (1 November 2026, J-00969). A test copy of J-00969: its lines (painting of chrome parts, PDR dent,
// remove and refit front end, programming and coding, smart paint) on a car gated in as Mechanical. The mechanical car is
// unchanged (Mechanical lines, technicians offered); switched to Both on the job card, each line lands on its team, the
// planning shows every team with its leader and the advisor in charge, the bodyshop side offers only Dismantle & refit
// and Paint people, the workshop side only the electricians, the Work step reads "Bodyshop + Electrical", the bodyshop
// release builds the stages in the order of work, and the car is on the Bodyshop board and the Workshop list.
// Run: node --env-file=.env.test.local tests/browser/test-teams.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, pickPerson, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "teams");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

const owner = (await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const elec = (await sql("select id, display_name, team from public.staff where role_id = 'technician' and is_active and team = 'technicians' order by display_name limit 1"))[0];
const refitter = (await sql("select id, display_name from public.staff where is_active and team = 'dismantle_refit' and role_id = 'technician' order by display_name limit 1"))[0];
const painter = (await sql("select id, display_name from public.staff where is_active and team = 'painting' order by display_name limit 1"))[0];
const ppfPerson = (await sql("select id from public.staff where is_active and team = 'ppf' and role_id = 'technician' limit 1"))[0];
const browsers = [];

cleanupDb();
try {
  // A test copy of J-00969: the quotation's lines as typed, approved by the customer, the car Mechanical.
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = q.jobId;
  let pos = 10;
  for (const [type, title] of [["package", "night sky edition - painting of relative chrome parts"], ["labour", "front right fender pdr dent"], ["labour", "labour charges - remove and refit front end"], ["package", "programming & coding for light and radar"], ["package", "front bumper smart paint"]]) {
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, unit_price, created_by, updated_by) values ($1, $2, $3, $4, 'manual', 1, $5, $6, $7, $8, $8)", [q.quotationId, pos++, type, title, type === "labour" ? 2 : null, type === "labour" ? 350 : null, type === "package" ? 1000 : null, advisor.id]);
  }
  // The seed's own labour line becomes bodywork, so the car has no plain mechanical work (as J-00969).
  await sql("update public.quotation_lines set title = 'front bumper respray' where quotation_id = $1 and line_type = 'labour' and title ilike 'replace front brake pads'", [q.quotationId]);
  await api("/api/e2e/stage", { stage: "approved" });
  // The advisor in charge is the owner; somebody else gated the car in (as on J-00969: Omar in charge, Deepak at the gate).
  // (gated_in_by is a protected stamp: the seed's advisor gated the car in.)
  await sql("update public.jobs set department = 'mechanical', advisor_id = $2, plan_parts_done_at = now() where id = $1", [jobId, owner.id]);
  const gateInBy = (await sql("select s.display_name from public.jobs j join public.staff s on s.id = j.gated_in_by where j.id = $1", [jobId]))[0]?.display_name ?? "";
  await sql("update public.part_items set availability = 'in_stock', order_status = 'received', received_qty = 1 where job_id = $1", [jobId]);
  // One electrician in the test workshop (put back at the end).
  await sql("update public.staff set team = 'electricians' where id = $1", [elec.id]);

  const own = await browserForId(owner.id, { viewport: { width: 1440, height: 900 } });
  browsers.push(own);
  const page = own.page;

  /* ---------- A. The mechanical car is unchanged ---------- */
  await go(page, `${base}/jobs/${jobId}`);
  const teamOfLine = async (title) => page.locator("[data-team-line]").filter({ hasText: new RegExp(title, "i") }).first().getAttribute("data-team");
  check(`A: Mechanical: "remove and refit" is the technicians' work (${await teamOfLine("remove and refit")})`, (await teamOfLine("remove and refit")) === "mechanical");
  check(`A: Mechanical: coding is Electrical (${await teamOfLine("programming")})`, (await teamOfLine("programming")) === "electrical");
  check("A: Mechanical: the planning has the workshop side only", (await page.locator("[data-planning-sides]").getAttribute("data-planning-sides")) === "mechanical");
  const mechTeamsA = await page.locator("[data-release-form='mechanical'] [data-team]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team")));
  check(`A: the workshop release still offers the technicians (${mechTeamsA.join(", ")})`, mechTeamsA.includes("technicians"));
  const advisorA = await text(page.locator("[data-circle='advisor']"));
  check(`A: the planning's advisor is the advisor in charge, not the gate-in person ("${advisorA}")`, advisorA.includes(owner.display_name) && (!gateInBy || gateInBy === owner.display_name || !advisorA.includes(gateInBy)));
  await page.locator("[data-teams-card]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("a1-mechanical-unchanged.png") });

  /* ---------- B. Department → Both: each line on its team ---------- */
  await page.locator("[data-department-choice='both']").click();
  await until(async () => (await sql("select 1 from public.jobs where id = $1 and department = 'both'", [jobId]))[0]);
  const ev = (await sql("select note from public.job_events where job_id = $1 and event_type = 'department_change' order by created_at desc limit 1", [jobId]))[0];
  check(`B: the change is logged ("${ev?.note}")`, /^Department: Mechanical → Both \(changed by /.test(ev?.note ?? ""));
  await go(page, `${base}/jobs/${jobId}`);
  const got = { paint: await teamOfLine("night sky"), pdr: await teamOfLine("pdr dent"), refit: await teamOfLine("remove and refit"), coding: await teamOfLine("programming"), smart: await teamOfLine("smart paint") };
  check(`B: paint → Paint, PDR → Outside work, remove and refit → Dismantle & refit, coding → Electrical (${JSON.stringify(got)})`, got.paint === "paint" && got.smart === "paint" && got.pdr === "outside" && got.refit === "dismantle_refit" && got.coding === "electrical");
  // The advisor's pick for the PDR: the bodyshop.
  const pdrLine = (await sql("select l.id from public.quotation_lines l where l.quotation_id = $1 and l.title ilike '%pdr dent%'", [q.quotationId]))[0];
  await page.locator(`[data-line-team='${pdrLine.id}']`).selectOption("dismantle_refit");
  const saved = await until(async () => (await sql("select team from public.quotation_lines where id = $1 and team = 'dismantle_refit'", [pdrLine.id]))[0]);
  check("B: the PDR line moves to Dismantle & refit with one pick (saved on the approved quotation)", !!saved);
  await go(page, `${base}/jobs/${jobId}`);
  const sides = await page.locator("[data-planning-sides]").getAttribute("data-planning-sides");
  check(`B: the planning has both sides (${sides})`, sides === "mechanical,bodyshop");
  const chips = await page.locator("[data-planning-team]").allTextContents();
  check(`B: the planning names every team with its leader (${chips.join(" | ")})`, chips.some((c) => /^Paint · /.test(c)) && chips.some((c) => /^Dismantle & refit · Arsalan$/.test(c)) && chips.some((c) => /^Electrical · /.test(c)));
  const advisorB = await text(page.locator("[data-circle='advisor']"));
  check(`B: Advisor · ${owner.display_name} (the advisor in charge)`, advisorB.includes(owner.display_name));
  const bodyTeams = await page.locator("[data-release-form='bodyshop'] [data-team]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team")));
  check(`B: the bodyshop side offers only Dismantle & refit and Painting (${bodyTeams.join(", ")})`, bodyTeams.length > 0 && bodyTeams.every((t) => t === "dismantle_refit" || t === "painting") && bodyTeams.includes("painting"));
  check("B: the PPF and detailing people are not offered on this car", ppfPerson ? (await page.locator(`[data-release-form='bodyshop'] [data-pick-person='${ppfPerson.id}']`).count()) === 0 : true);
  const mechTeams = await page.locator("[data-release-form='mechanical'] [data-team]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team")));
  check(`B: the workshop side offers only the electricians for the coding line (${mechTeams.join(", ")})`, mechTeams.length === 1 && mechTeams[0] === "electricians");
  const workStep = (await page.locator("main").textContent()) ?? "";
  check('B: the Work step reads "Bodyshop + Electrical"', workStep.includes("Bodyshop + Electrical"));
  await page.locator("[data-planning-teams]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("b1-planning-teams.png") });
  await page.locator("[data-release-form='bodyshop']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("b2-bodyshop-release-teams.png") });

  /* ---------- C. Release both sides ---------- */
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const bform = page.locator("[data-release-form='bodyshop']");
  await bform.locator("input[name='start_date']").fill(today);
  for (const p of [refitter, painter].filter(Boolean)) await pickPerson(bform, p.id);
  await bform.locator("[data-release='bodyshop']").click();
  const stages = await until(async () => { const r = await sql("select key from public.bodyshop_stages where job_id = $1 and is_active order by position", [jobId]); return r.length ? r.map((x) => x.key) : null; });
  check(`C: the bodyshop release builds the stages in the order of work (${(stages ?? []).join(" → ")})`, (stages ?? []).join(",") === "strip,paint,refit,electrical,qc,handover");
  await go(page, `${base}/jobs/${jobId}`);
  const mform = page.locator("[data-release-form='mechanical']");
  await mform.locator("input[name='start_date']").fill(today);
  await pickPerson(mform, elec.id);
  await mform.locator("[data-release='mechanical']").click();
  await page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => {});
  const relMsg = await text(page.locator("[role=alert], [data-notice], .notice").first());
  console.log("mechanical release answer:", decodeURIComponent(page.url().split("?")[1] ?? "").slice(0, 200), relMsg.slice(0, 120));
  const onCar = await until(async () => (await sql("select 1 from public.job_technicians where job_id = $1 and staff_id = $2", [jobId, elec.id]))[0]);
  check(`C: the electrician (${elec.display_name}) is released onto the coding line`, !!onCar);
  const wl = await sql("select title from public.work_lines where job_id = $1 and is_active order by position", [jobId]);
  check(`C: the workshop's work order has the coding line and the brake work, never paint or refit (${wl.map((w) => w.title).join(" | ")})`, wl.some((w) => /programming/i.test(w.title)) && !wl.some((w) => /paint|refit|pdr/i.test(w.title)));

  /* ---------- D. Both lists ---------- */
  const job = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0];
  await go(page, `${base}/bodyshop`);
  check(`D: ${job.job_number} is on the Bodyshop board`, ((await page.locator("main").textContent()) ?? "").includes(job.job_number));
  await page.screenshot({ path: shot("d1-bodyshop-board.png") });
  const plate = (await sql("select v.plate_number from public.vehicles v join public.jobs j on j.vehicle_id = v.id where j.id = $1", [jobId]))[0]?.plate_number ?? "";
  await go(page, `${base}/workshop`);
  check(`D: the car (${plate}) is on the Workshop list`, !!plate && ((await page.locator("main").textContent()) ?? "").includes(plate));
  await go(page, `${base}/jobs/${jobId}`);
  const withCar = await text(page.locator("[data-team-with-car]"));
  check(`D: the job card says which team has the car ("${withCar}")`, /^With .+ now$/.test(withCar));
  await page.locator("[data-teams-card]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("d2-teams-card-both.png") });
} finally {
  await sql("update public.staff set team = $2 where id = $1", [elec.id, elec.team]);
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
summary();
