// 13 November 2026, Section 14: PCV valve and fuel injectors in the Engine bay section of the inspection - the
// technician's answers and optional details on the tablet, and an electric car with neither. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-14-pcv-injectors.mjs
import fs from "node:fs";
import { MANAGER_MECH, api, base, browserForId, cleanupDb, go, makeChecks, pickPerson, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-pcv-injectors";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

try {
  cleanupDb();
  // 1. A petrol car: both items are on the checklist with their own answers.
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, technicianId } = seed.json;
  const insp = (await sql("select id from public.inspections where job_id = $1", [jobId]))[0].id;
  const rows = await sql("select item_key, style from public.inspection_items where inspection_id = $1 and item_key in ('engine_bay.pcv_valve','engine_bay.fuel_injectors') order by position", [insp]);
  check("1: the checklist carries PCV valve and Fuel injectors with their answer styles", rows.length === 2 && rows[0].style === "pcv" && rows[1].style === "injector", JSON.stringify(rows));
  await sql("update public.inspections set scan_read_at = now(), status = 'in_progress', started_at = coalesce(started_at, now()) where id = $1", [insp]);
  const t = await browserForId(technicianId, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(t.page, `${base}/my-jobs/${jobId}`);
  const pcv = t.page.locator("#item-engine_bay\\.pcv_valve");
  const inj = t.page.locator("#item-engine_bay\\.fuel_injectors");
  const labels = async (loc) => (await loc.locator("button[aria-pressed]").allTextContents()).map((x) => x.trim());
  check("2: PCV offers OK / Faulty, replace", JSON.stringify((await labels(pcv)).slice(0, 2)) === JSON.stringify(["OK", "Faulty, replace"]), JSON.stringify(await labels(pcv)));
  await pcv.getByRole("button", { name: "Faulty, replace" }).click();
  await pcv.locator("[data-pcv-in-cover]").click();
  check("3: injectors offer OK / Needs service and further check / Replace", JSON.stringify((await labels(inj)).slice(0, 3)) === JSON.stringify(["OK", "Needs service and further check", "Replace"]), JSON.stringify(await labels(inj)));
  await inj.getByRole("button", { name: "Needs service and further check" }).click();
  await inj.locator('[data-cylinder="1"]').click();
  await inj.locator('[data-cylinder="3"]').click();
  await inj.scrollIntoViewIfNeeded();
  await t.page.screenshot({ path: `${OUT}/s14-tablet-800.png` });
  const saved = await until(async () => {
    const m = (await sql("select measurements from public.inspections where id = $1", [insp]))[0]?.measurements ?? {};
    const it = await sql("select item_key, status from public.inspection_items where inspection_id = $1 and item_key in ('engine_bay.pcv_valve','engine_bay.fuel_injectors') order by position", [insp]);
    return m.injector_cylinders === "1,3" && m.pcv_in_valve_cover === "1" && it[0]?.status === "bad" && it[1]?.status === "average" ? { m, it } : null;
  });
  check("4: the answers and the optional details are saved (Faulty, built into the valve cover; needs service, cylinders 1 and 3)", !!saved);
  await t.browser.close();
  const d = await browserForId(technicianId, { viewport: { width: 1440, height: 900 } });
  await go(d.page, `${base}/my-jobs/${jobId}`);
  await d.page.locator("#item-engine_bay\\.fuel_injectors").scrollIntoViewIfNeeded();
  await d.page.screenshot({ path: `${OUT}/s14-desktop-1440.png` });
  await d.browser.close();

  // 5. An electric car: neither item is on its checklist.
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "assign" });
  const aJob = st.json?.jobId ?? "22222222-0000-4000-8000-00000000e303";
  const veh = (await sql("select vehicle_id from public.jobs where id = $1", [aJob]))[0].vehicle_id;
  const before = (await sql("select fuel_type from public.vehicles where id = $1", [veh]))[0]?.fuel_type ?? null;
  await sql("update public.vehicles set fuel_type = 'electric' where id = $1", [veh]);
  const tech = (await sql("select id from public.staff where role_id = 'technician' and is_active order by display_name limit 1"))[0]?.id;
  const m = await browserForId(MANAGER_MECH, { viewport: { width: 800, height: 1280 } });
  await go(m.page, `${base}/assign`);
  await m.page.locator(`[data-assign-car="${aJob}"]`).click();
  await sleep(500);
  await pickPerson(m.page, tech);
  await m.page.getByText("No road test", { exact: true }).click().catch(() => null);
  await m.page.locator("[data-assign-submit]").click();
  await submitted(m.page);
  await m.browser.close();
  const ev = await until(async () => (await sql("select i.id, (select count(*)::int from public.inspection_items x where x.inspection_id = i.id) n, (select count(*)::int from public.inspection_items x where x.inspection_id = i.id and x.item_key in ('engine_bay.pcv_valve','engine_bay.fuel_injectors')) e from public.inspections i where i.job_id = $1", [aJob]))[0], 30);
  check("5: an electric car's checklist has neither PCV nor fuel injectors", !!ev && ev.n > 10 && ev.e === 0, JSON.stringify(ev));
  await sql("update public.vehicles set fuel_type = $2 where id = $1", [veh, before]);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
