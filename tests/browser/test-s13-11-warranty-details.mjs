// 13 November 2026, Section 11: warranty card details - entered once at the stage by the team leader (or the manager),
// the metres feed the film cost, the job card names what is still missing and who enters it, the Labels batch boxes
// fill themselves, and a car with no advisor in charge cannot be assigned. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-11-warranty-details.mjs
import fs from "node:fs";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, go, makeChecks, pickPerson, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-warranty-details";
fs.mkdirSync(OUT, { recursive: true });
const txt = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
let rollId = null;

try {
  cleanupDb();
  const bs = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
  const jobId = bs.json?.jobId;
  const people = bs.json?.people ?? {};
  if (!jobId) throw new Error(`seed: ${bs.status} ${JSON.stringify(bs.json).slice(0, 200)}`);
  const jobNumber = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number;

  // 1. The job card names each missing detail and who enters it.
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(o.page, `${base}/jobs/${jobId}`);
  const waiting = o.page.locator('[data-warranty-waiting="ppf"]');
  check("1: the job card says the PPF details are missing and who enters them", (await waiting.count()) === 1 && /PPF and tint leader/i.test(await txt(waiting)), await txt(waiting));
  check("1: 'Enter now' opens the bodyshop stage", ((await o.page.locator("[data-warranty-enter-now]").first().getAttribute("href")) ?? "").includes(`/bodyshop/${jobId}`));
  await waiting.scrollIntoViewIfNeeded().catch(() => null);
  await o.page.screenshot({ path: `${OUT}/s11-job-card-missing-1440.png` });

  // 2. The PPF leader enters the roll (one tap on an open roll) and the metres used: kept once, the film cost follows.
  rollId = (await sql("insert into public.film_rolls (kind, name, length_m, price_aed) values ('film', 'E2E-PPF-ROLL', 15, 9000) returning id"))[0]?.id;
  const stages = await sql("select key, position from public.bodyshop_stages where job_id = $1 and is_active order by position", [jobId]);
  const ppfPos = stages.find((s) => s.key === "ppf")?.position;
  await sql("update public.bodyshop_stages set status = 'done', done_at = now() where job_id = $1 and is_active and position < $2 and status <> 'done'", [jobId, ppfPos]);
  await sql("update public.bodyshop_stages set status = 'active', started_at = now() where job_id = $1 and is_active and key = 'ppf'", [jobId]);
  const l = await browserForId(people.ppfLeader, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(l.page, `${base}/bodyshop/${jobId}#stages`);
  const form = l.page.locator('[data-stage-warranty-form="ppf"]');
  const chip = form.locator('[data-warranty-roll-pick="E2E-PPF-ROLL"]');
  check("2: the open film roll is a one-tap choice", (await chip.count()) >= 1);
  if (await chip.count()) await chip.first().click();
  else await form.locator('[data-warranty-roll="ppf:"]').pressSequentially("E2E-PPF-ROLL");
  await form.locator('[data-warranty-roll="tint:"]').pressSequentially("E2E-TINT-11");
  await form.locator('[data-warranty-metres="ppf:"]').fill("3.5");
  await form.scrollIntoViewIfNeeded();
  await l.page.screenshot({ path: `${OUT}/s11-stage-form-800.png` });
  await form.locator('[data-stage-warranty-save="ppf"]').click();
  await submitted(l.page);
  await l.browser.close();
  const entry = (await sql("select roll_batch from public.warranty_entries where job_id = $1 and product = 'ppf' and is_active", [jobId]))[0];
  check("2: the roll is kept on the warranty entry", entry?.roll_batch === "E2E-PPF-ROLL", JSON.stringify(entry));
  const use = (await sql("select metres::float as m from public.film_usage where job_id = $1 and roll_id = $2 and is_active", [jobId, rollId]))[0];
  check("2: the metres used are recorded on that roll (film cost of the job)", use?.m === 3.5, JSON.stringify(use));

  // 3. Entered once: the Labels batch box fills itself from the warranty entry.
  await go(o.page, `${base}/stickers?tab=warranty&car=${encodeURIComponent(jobNumber)}`);
  const box = o.page.locator(`[data-warranty-car="${jobId}"] [data-warranty-batch="ppf-film"]`);
  check("3: the PPF label's batch box is filled from the warranty entry", (await box.count()) === 1 && (await box.inputValue()) === "E2E-PPF-ROLL", (await box.count()) ? await box.inputValue() : "no box");
  await o.page.screenshot({ path: `${OUT}/s11-labels-batch-1440.png` });
  await go(o.page, `${base}/jobs/${jobId}`);
  check("3: the job card no longer lists the PPF details as missing", (await o.page.locator('[data-warranty-waiting="ppf"]').count()) === 0);

  // 4. No advisor in charge: the car cannot be assigned; set it and it can.
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "assign" });
  const aJob = st.json?.jobId ?? "22222222-0000-4000-8000-00000000e303";
  const gate = (await sql("select id from public.staff where role_id = 'gate_in' and is_active limit 1"))[0]?.id;
  const tech = (await sql("select id from public.staff where role_id = 'technician' and is_active order by display_name limit 1"))[0]?.id;
  const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0]?.id;
  // The advisor in charge pointed at someone who is not an advisor (a technician) = "not set" (gated_in_by is a protected stamp).
  const NOADV = aJob;
  await sql("update public.jobs set advisor_id = $2 where id = $1", [aJob, tech]);
  await go(o.page, `${base}/jobs/${NOADV}`);
  check("4: the job card shows 'Advisor in charge: not set' in red", (await o.page.locator("[data-advisor-missing]").count()) === 1);
  await o.page.screenshot({ path: `${OUT}/s11-no-advisor-1440.png` });
  const assign = async (jid) => {
    const m = await browserForId(MANAGER_MECH, { viewport: { width: 800, height: 1280 } });
    await go(m.page, `${base}/assign`);
    await m.page.locator(`[data-assign-car="${jid}"]`).click();
    await sleep(500);
    await pickPerson(m.page, tech);
    await m.page.getByText("No road test", { exact: true }).click().catch(() => null);
    await m.page.locator("[data-assign-submit]").click();
    await submitted(m.page);
    const url = decodeURIComponent(m.page.url()).replace(/\+/g, " ");
    await m.page.screenshot({ path: `${OUT}/s11-assign-${url.includes("error=") ? "refused" : "done"}-800.png` });
    await m.browser.close();
    return url;
  };
  const refused = await assign(NOADV);
  check("4: assigning is refused while no advisor is in charge, in plain words", /Advisor in charge is not set/.test(refused), refused.slice(-160));
  await sql("update public.jobs set advisor_id = null where id = $1", [aJob]);
  const done = await assign(aJob);
  check("4: a car whose advisor gated it in is assigned as before", !/error=/.test(done) && !!(await sql("select assigned_to from public.jobs where id = $1", [aJob]))[0]?.assigned_to, done.slice(-160));
  await o.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (rollId) await sql("update public.film_rolls set is_active = false where id = $1", [rollId]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
