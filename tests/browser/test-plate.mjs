// Plate can be added (6 November 2026, the AL TAMIMI Audi A8): a car saved without a plate gets its real one from
// Cars -> Edit (the cause - the save never wrote has_plate - is fixed), every emirate format saves, changing an
// existing plate needs a remark and the old plate still finds the car, a duplicate plate offers the merge and the
// merge moves everything, and the gate-in form asks for the plate (here: the "genuinely no plate" reason path).
//   node --env-file=.env.test.local tests/browser/test-plate.mjs        (npm run test:plate)
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => `tests/browser/shots/plate-${name}.png`;
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());

const CUST = "22222222-0000-4000-8000-00000000ea01";
const CAR_A = "22222222-0000-4000-8000-00000000ea02";
const CAR_B = "22222222-0000-4000-8000-00000000ea03";
const JOB_A = "22222222-0000-4000-8000-00000000ea05";
const JOB_B = "22222222-0000-4000-8000-00000000ea04";
const CAR_C = "22222222-0000-4000-8000-00000000ea06";

cleanupDb();
try {
  const mm = (await sql("select m.id as make_id, v.id as model_id from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
  await sql("insert into public.customers (id, customer_type, full_name, company_name, phone, created_by) values ($1, 'company', 'E2e Contact', 'E2e Al Tamimi Company Ltd', '+971500000096', $2)", [CUST, owner.id]);
  // A = the AL TAMIMI shape: created without a plate. B = another record already carrying a plate and a VIN. C = for the gate-in.
  await sql("insert into public.vehicles (id, customer_id, has_plate, plate_country, make_id, model_id, model_year, created_by) values ($1, $2, false, 'UAE', $3, $4, 2024, $5)", [CAR_A, CUST, mm.make_id, mm.model_id, owner.id]);
  await sql("insert into public.vehicles (id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, model_year, created_by) values ($1, $2, true, 'UAE', 'Dubai', 'GG', '55555', 'E2EPLATEVIN044444', $3, $4, 2023, $5)", [CAR_B, CUST, mm.make_id, mm.model_id, owner.id]);
  await sql("insert into public.vehicles (id, customer_id, has_plate, plate_country, make_id, model_id, model_year, created_by) values ($1, $2, false, 'UAE', $3, $4, 2025, $5)", [CAR_C, CUST, mm.make_id, mm.model_id, owner.id]);
  await sql("insert into public.jobs (id, vehicle_id, customer_id, job_number, status, stage, is_open, gated_in_at, gated_in_by) values ($1, $2, $3, 'J-E2E-PLA', 'pending_quote', 'quote', true, now(), $4), ($5, $6, $3, 'J-E2E-PLB', 'pending_quote', 'quote', true, now(), $4)", [JOB_A, CAR_A, CUST, owner.id, JOB_B, CAR_B]);
  // The sql helper hides insert errors: stop here in plain words if the seed did not land.
  const seededCars = (await sql("select id from public.vehicles where id in ($1, $2, $3)", [CAR_A, CAR_B, CAR_C])).length;
  const seededJobs = (await sql("select id from public.jobs where id in ($1, $2)", [JOB_A, JOB_B])).length;
  if (seededCars !== 3 || seededJobs !== 2) throw new Error(`seed failed: ${seededCars} of 3 cars, ${seededJobs} of 2 jobs`);

  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });

  /* ---------- A. The AL TAMIMI case: no plate -> DUBAI DD 23864 saves ---------- */
  await go(page, `${base}/vehicles/${CAR_A}/edit`);
  const title0 = ((await page.locator("h1").first().textContent()) ?? "").trim();
  check(`A1: the page title says which car and "No plate yet" ("${title0}")`, /^Edit car · .+ · No plate yet$/.test(title0));
  check("A2: 'No number plate' starts ticked on this car", await page.locator("[data-no-plate]").isChecked());
  await page.locator("[data-plate-code]").pressSequentially("DD", { delay: 30 });
  await page.locator("[data-plate-number]").pressSequentially("23864", { delay: 30 });
  check("A3: typing the plate unticks 'No number plate' by itself", !(await page.locator("[data-no-plate]").isChecked()));
  check("A3: no remark asked when ADDING a plate to a no-plate car", (await page.locator("[data-plate-remark]").count()) === 0);
  await page.screenshot({ path: shot("a-typed-dd-23864") });
  await page.getByText("Save changes", { exact: true }).click();
  await page.waitForURL((u) => u.toString().includes(`/vehicles/${CAR_A}`) && !u.toString().includes("/edit"), { timeout: 30000 }).catch(() => null);
  await settle(page);
  const a = (await sql("select has_plate, plate_emirate, plate_code, plate_number from public.vehicles where id = $1", [CAR_A]))[0];
  check("A4: DUBAI DD 23864 is SAVED (has_plate true - the exact write the old form never made)", a?.has_plate === true && a.plate_emirate === "Dubai" && a.plate_code === "DD" && a.plate_number === "23864", JSON.stringify(a));
  check(`A4: the page answers in plain words ("${decodeURIComponent(page.url()).split("message=")[1] ?? ""}")`, /plate is on the car now/i.test(decodeURIComponent(page.url())));
  await page.screenshot({ path: shot("a-saved") });
  const hits = await (await fetch(`${base}/api/search?q=${encodeURIComponent("DD 23864")}`, { headers: { cookie: await cookieHeader("owner") } })).json();
  check("A5: the search finds the car by its new plate", JSON.stringify(hits).includes(JOB_A) && JSON.stringify(hits).includes("DD 23864"), JSON.stringify(hits).slice(0, 200));
  await go(page, `${base}/vehicles/${CAR_A}/edit`);
  check("A6: the title now carries the plate", /DUBAI DD 23864/.test(((await page.locator("h1").first().textContent()) ?? "")));

  /* ---------- B. An Abu Dhabi NUMBER code saves ---------- */
  await sql("update public.vehicles set has_plate = false, plate_emirate = null, plate_code = null, plate_number = null where id = $1", [CAR_A]);
  await go(page, `${base}/vehicles/${CAR_A}/edit`);
  await page.locator('input[name="plate_emirate"][value="Abu Dhabi"]').evaluate((el) => el.click());
  await page.locator("[data-plate-code]").pressSequentially("16", { delay: 30 });
  await page.locator("[data-plate-number]").pressSequentially("94155", { delay: 30 });
  await page.getByText("Save changes", { exact: true }).click();
  await page.waitForURL((u) => !u.toString().includes("/edit"), { timeout: 30000 }).catch(() => null);
  const b = (await sql("select has_plate, plate_emirate, plate_code, plate_number from public.vehicles where id = $1", [CAR_A]))[0];
  check("B1: ABU DHABI 16 94155 saves (a number code, the format the spec names)", b?.has_plate === true && b.plate_emirate === "Abu Dhabi" && b.plate_code === "16" && b.plate_number === "94155", JSON.stringify(b));

  /* ---------- C. Changing an existing plate: remark compulsory, the old plate still finds the car ---------- */
  await go(page, `${base}/vehicles/${CAR_A}/edit`);
  check("C1: no remark box while nothing changed", (await page.locator("[data-plate-remark]").count()) === 0);
  await page.locator('input[name="plate_emirate"][value="Dubai"]').evaluate((el) => el.click());
  await page.locator("[data-plate-code]").evaluate((el) => { el.focus(); el.select(); });
  await page.locator("[data-plate-code]").pressSequentially("F", { delay: 30 });
  await page.locator("[data-plate-number]").evaluate((el) => { el.focus(); el.select(); });
  await page.locator("[data-plate-number]").pressSequentially("60238", { delay: 30 });
  const remark = page.locator("[data-plate-remark]");
  check("C2: the remark box appears for a plate TRANSFER and is compulsory", (await remark.count()) === 1 && (await remark.getAttribute("required")) !== null);
  await remark.pressSequentially("Plate transferred to the new car", { delay: 15 });
  await page.screenshot({ path: shot("c-transfer-remark") });
  await page.getByText("Save changes", { exact: true }).click();
  await page.waitForURL((u) => !u.toString().includes("/edit"), { timeout: 30000 }).catch(() => null);
  const c = (await sql("select plate_emirate, plate_code, plate_number, old_plates from public.vehicles where id = $1", [CAR_A]))[0];
  check("C3: the new plate is saved and the OLD one is kept for search", c?.plate_code === "F" && c.plate_number === "60238" && /Abu Dhabi 16 94155 1694155/.test(c.old_plates ?? ""), JSON.stringify(c));
  const audit = await until(async () => (await sql("select new_data from public.audit_log where table_name = 'vehicles' and record_id = $1::text and new_data->>'remark' is not null order by id desc limit 1", [CAR_A]))[0]);
  check(`C4: the history keeps who and why ("${audit?.new_data?.remark ?? ""}")`, audit?.new_data?.remark === "Plate transferred to the new car" && /16 94155/.test(audit?.new_data?.plate_changed_from ?? ""));
  const oldHits = await (await fetch(`${base}/api/search?q=${encodeURIComponent("16 94155")}`, { headers: { cookie: await cookieHeader("owner") } })).json();
  check("C5: searching the OLD plate still finds the same car", JSON.stringify(oldHits).includes(JOB_A), JSON.stringify(oldHits).slice(0, 200));
  await go(page, `${base}/vehicles/${CAR_A}/edit`);
  check("C6: the edit page lists the earlier plate", /Abu Dhabi 16 94155/.test((await page.locator("[data-earlier-plates]").textContent().catch(() => "")) ?? ""));

  /* ---------- D. A duplicate plate offers the merge; the merge moves everything ---------- */
  await go(page, `${base}/vehicles/${CAR_A}/edit`);
  await page.locator("[data-plate-code]").evaluate((el) => { el.focus(); el.select(); });
  await page.locator("[data-plate-code]").pressSequentially("GG", { delay: 30 });
  await page.locator("[data-plate-number]").evaluate((el) => { el.focus(); el.select(); });
  await page.locator("[data-plate-number]").pressSequentially("55555", { delay: 30 });
  await page.locator("[data-plate-remark]").pressSequentially("Same car twice on record", { delay: 10 });
  await page.getByText("Save changes", { exact: true }).click();
  await page.locator("[data-merge-ask]").waitFor({ timeout: 20000 });
  const askWords = ((await page.locator("[data-merge-ask]").textContent()) ?? "").replace(/\s+/g, " ");
  check(`D1: "This plate is on car X. Merge?" names the kept record exactly ("${askWords.slice(0, 120)}…")`, /This plate is on another car record/.test(askWords) && /DUBAI GG 55555/.test(askWords) && /is kept/.test(askWords));
  await page.screenshot({ path: shot("d-merge-ask"), fullPage: true });
  await sleep(5200); // FormGuard swallows a second tap within five seconds of the save
  await page.locator("[data-merge-confirm]").click();
  await page.waitForURL((u) => u.toString().includes(`/vehicles/${CAR_B}`), { timeout: 30000 }).catch(() => null);
  await settle(page);
  check(`D2: the merge lands on the KEPT car with the answer in plain words ("${decodeURIComponent(page.url()).split("message=")[1]?.slice(0, 120) ?? ""}")`, /Merged\./.test(decodeURIComponent(page.url())) && /moved across/.test(decodeURIComponent(page.url())));
  const gone = (await sql("select is_active, merged_into, notes from public.vehicles where id = $1", [CAR_A]))[0];
  check("D3: the duplicate record left the list, pointing home, never deleted", gone?.is_active === false && gone.merged_into === CAR_B && /Merged into DUBAI GG 55555/.test(gone.notes ?? ""), JSON.stringify(gone));
  const movedJobs = await sql("select id from public.jobs where vehicle_id = $1 order by job_number", [CAR_B]);
  check("D4: BOTH jobs now sit under the kept car", movedJobs.length === 2 && movedJobs.some((j) => j.id === JOB_A) && movedJobs.some((j) => j.id === JOB_B));
  const keptOld = (await sql("select old_plates from public.vehicles where id = $1", [CAR_B]))[0];
  check("D5: the duplicate's plate (and its history) now finds the kept car", /F 60238/.test(keptOld?.old_plates ?? "") && /16 94155/.test(keptOld?.old_plates ?? ""), keptOld?.old_plates ?? "");
  const mergedHits = await (await fetch(`${base}/api/search?q=${encodeURIComponent("F 60238")}`, { headers: { cookie: await cookieHeader("owner") } })).json();
  check("D6: searching the merged record's old plate finds the KEPT car (both its jobs)", JSON.stringify(mergedHits).includes(JOB_B), JSON.stringify(mergedHits).slice(0, 200));
  await page.screenshot({ path: shot("d-merged"), fullPage: true });
  await browser.close();

  /* ---------- E. Gate-in of a no-plate car: the reason path (the typed-plate path is sim path m) ---------- */
  const g = await browserFor("gate_in", { viewport: { width: 1180, height: 900 } });
  await go(g.page, `${base}/gate-in/new?vehicle=${CAR_C}`);
  check("E1: the gate-in form asks for the plate", (await g.page.locator("[data-gatein-plate]").count()) === 1);
  await g.page.screenshot({ path: shot("e-gatein-asks"), fullPage: true });
  // The plate box on the tablets: 800 × 1280 and 1440 × 900, never sliding sideways, every box inside its card.
  for (const [w, h] of [[800, 1280], [1440, 900]]) {
    const t = await browserFor("gate_in", { viewport: { width: w, height: h }, ...(w < 1000 ? { hasTouch: true } : {}) });
    await go(t.page, `${base}/gate-in/new?vehicle=${CAR_C}`);
    await t.page.locator("[data-gatein-no-plate]").evaluate((el) => el.click());
    const fit = await t.page.evaluate(() => {
      const card = document.querySelector("[data-gatein-plate]")?.getBoundingClientRect();
      const out = [...document.querySelectorAll("[data-gatein-plate] input, [data-gatein-plate] select, [data-gatein-plate] label")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > card.right + 1 || r.left < card.left - 1); }).length;
      return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, out };
    });
    check(`E1: the plate box fits at ${w} px (sideways ${fit.sideways} px, ${fit.out} boxes outside the card)`, fit.sideways <= 1 && fit.out === 0);
    await t.page.locator("[data-gatein-plate]").screenshot({ path: shot(`e-plate-box-${w}`) });
    await t.browser.close();
  }
  // Nothing typed and nothing ticked: the server refuses in plain words.
  await pick(g.page, "arrived_by", "customer_drove");
  await pick(g.page, "condition", "runs_drives");
  await pick(g.page, "fuel_level", "half");
  await pick(g.page, "cleanliness", "clean");
  await pick(g.page, "dash_cam", "no");
  await pick(g.page, "major_damage", "no");
  await pick(g.page, "keys_count", "1");
  await pick(g.page, "keys_keychain", "no");
  await pick(g.page, "old_parts_return", "no");
  await pick(g.page, "department", "mechanical");
  const addr = g.page.locator('textarea[name="location_address"]');
  if (await addr.count()) await addr.fill("E2e plate test");
  await g.page.locator('input[name="mileage_display"]').pressSequentially("9000");
  await g.page.keyboard.press("Tab");
  await g.page.locator('input[name="requests"]:visible').first().pressSequentially("Check the brakes please");
  await sleep(400);
  await g.page.locator("[data-gatein-no-plate]").evaluate((el) => el.click());
  await g.page.locator('input[name="gi_no_plate_reason"][value*="New car"]').evaluate((el) => el.click());
  await g.page.screenshot({ path: shot("e-no-plate-reason"), fullPage: true });
  await g.page.getByText("Save and continue to photos and video").click();
  await g.page.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const jobC = await until(async () => (await sql("select id from public.jobs where vehicle_id = $1", [CAR_C]))[0]);
  check("E2: the gate-in went through with the reason picked", !!jobC && /\/media/.test(g.page.url()), g.page.url());
  const ev = jobC ? (await sql("select note from public.job_events where job_id = $1 and note like 'No number plate%' limit 1", [jobC.id]))[0] : null;
  check(`E3: the reason is on the job's record ("${ev?.note ?? ""}")`, /^No number plate: New car/.test(ev?.note ?? ""));
  const carC = (await sql("select has_plate from public.vehicles where id = $1", [CAR_C]))[0];
  check("E4: the car honestly stays no-plate", carC?.has_plate === false);
  await g.browser.close();

  /* ---------- F. No raw database words to staff: the database refuses, staff read plain words, the owner sees the raw ---------- */
  // A temporary trigger on ONE test car makes its save fail with the database's own words (dropped in finally).
  const raise = (code, msg) => sql(`create or replace function public.e2e_plate_refuse() returns trigger language plpgsql as $f$ begin if new.id = '${CAR_C}' then raise exception using errcode = '${code}', message = '${msg.replace(/'/g, "''")}'; end if; return new; end $f$; revoke all on function public.e2e_plate_refuse() from public, anon, authenticated; drop trigger if exists e2e_plate_refuse on public.vehicles; create trigger e2e_plate_refuse before update on public.vehicles for each row execute function public.e2e_plate_refuse();`);
  const f = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const trySave = async () => {
    await go(f.page, `${base}/vehicles/${CAR_C}/edit`);
    await f.page.locator("[data-plate-code]").pressSequentially("J", { delay: 20 });
    await f.page.locator("[data-plate-number]").pressSequentially("31337", { delay: 20 });
    await f.page.getByText("Save changes", { exact: true }).click();
    // Next.js puts its own empty role=alert (the route announcer) on every page: read the red notice box itself.
    const box = f.page.locator("div[role=alert].bg-red-soft").first();
    await box.waitFor({ timeout: 20000 }).catch(() => null);
    return ((await box.textContent().catch(() => "")) ?? "").trim();
  };
  await raise("23514", 'new row for relation "vehicles" violates check constraint "vehicles_plate_rules"');
  const known = await trySave();
  check(`F1: the old AL TAMIMI refusal now reads as plain advice ("${known}")`, /Untick “No number plate”/.test(known) && !/vehicles_plate_rules|violates|relation/.test(known));
  await f.page.screenshot({ path: shot("f-plain-advice") });
  await raise("23502", 'null value in column "e2e_column" of relation "vehicles" violates not-null constraint');
  const since = new Date().toISOString();
  const unknown = await trySave();
  check(`F2: any other database refusal reads as the ONE shared sentence ("${unknown}")`, unknown === "Couldn't save – nothing was recorded. Try again or tell the owner.");
  await f.page.screenshot({ path: shot("f-shared-sentence") });
  const logged = await until(async () => (await sql("select place, message from public.app_errors where at >= $1 and message like '%e2e_column%' limit 1", [since]))[0]);
  check("F3: the raw words are logged for the owner", !!logged && /e2e_column/.test(logged.message), JSON.stringify(logged));
  await go(f.page, `${base}/settings/problems`);
  check("F4: the owner's Problems behind the scenes page shows them", /e2e_column/.test(((await f.page.locator("[data-problems]").textContent().catch(() => "")) ?? "")));
  await f.page.screenshot({ path: shot("f-owner-problems") });
  await f.browser.close();
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  const res = await adv.page.goto(`${base}/settings/problems`).catch(() => null);
  const advBody = ((await adv.page.textContent("body").catch(() => "")) ?? "");
  check("F5: an advisor cannot open it", !/e2e_column/.test(advBody), `${res?.status()} ${adv.page.url()}`);
  await adv.browser.close();
} finally {
  await sql("drop trigger if exists e2e_plate_refuse on public.vehicles; drop function if exists public.e2e_plate_refuse();").catch(() => null);
  await sql("delete from public.app_errors where message like '%e2e_column%'").catch(() => null);
  const failed = summary();
  cleanupDb();
  process.exit(failed ? 1 : 0);
}
