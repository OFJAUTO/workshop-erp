// 30 October 2026: PPF RECHECK as its own visit.
//  A  the PPF CUT choice shows on a real PPF install (a PPF service) and NOT on a typed "PPF RECHECK" line.
//  B  a PPF job delivered 12 days ago: "Book the PPF final check" in WAITING ON YOU.
//  C  gate-in: PPF RECHECK (FREE) linked to the original job, no inspection fee, no estimate, no approval box.
//  D  the PPF team's checklist on the tablet: OK / Needs fixing (+ note, Fixed) / Not on this car, then the hand-over.
//  E  the original job shows the recheck as cost ("Recheck: X h · AED Y") and "Final check done" for the staff.
//  F  the customer's warranty page shows "Final check done on <date> ✓"; a redo shows on Comebacks.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.test.local tests/browser/test-recheck.mjs
import path from "node:path";
import fs from "node:fs";
import { base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "recheck");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 15 * 60 * 1000).unref();
const until = async (fn, tries = 80, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const make = (await sql("select id from public.vehicle_makes where is_active order by name limit 1"))[0].id;
const ppfService = (await sql("select id, name from public.services where bodyshop_kind = 'ppf' and is_active order by name limit 1"))[0];
const leader = (await sql("select id, display_name from public.staff where role_id = 'team_leader' and team = 'ppf' and is_active order by display_name limit 1"))[0] ?? null;
async function finish() {
  cleanupDb();
  for (const [seq, table, col, prefix] of [["estimate_number_seq", "quotations", "number", "E-"], ["quotation_number_seq", "quotations", "number", "Q-"], ["customer_number_seq", "customers", "customer_number", "C-"], ["job_number_seq", "jobs", "job_number", "J-"]]) {
    await sql(`select setval('public.${seq}', greatest(1, coalesce((select max(substring(${col} from 3)::int) from public.${table} where ${col} ~ '^${prefix}[0-9]+$'), 1)))`);
  }
}

try {
  cleanupDb();
  if (!ppfService) throw new Error("No PPF service (bodyshop_kind ppf) in the services list");
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e Recheck Customer', '+971500000095') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id) values ($1, true, 'UAE', 'Dubai', 'R', '95001', $2) returning id", [cust, make]))[0].id;
  // The original PPF job: an approved quotation with a PPF service, delivered 12 days ago, its 10-day check not done.
  const orig = (await sql("insert into public.jobs (vehicle_id, customer_id, department, status, stage, gated_in_by, advisor_id) values ($1, $2, 'bodyshop', 'in_work', 'work', $3, $3) returning id, job_number", [car, cust, owner]))[0];
  const q = (await sql("insert into public.quotations (kind, job_id, customer_id, vehicle_id, status, created_by, updated_by) values ('quotation', $1, $2, $3, 'draft', $4, $4) returning id", [orig.id, cust, car, owner]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, service_id, source_type, quantity, unit_price, line_total, price_per, created_by, updated_by) values ($1, 1, 'package', $2, $3, 'package', 1, 9000, 9000, 'job', $4, $4)", [q.id, ppfService.name, ppfService.id, owner]);
  await sql("update public.quotations set status = 'approved', responded_at = now() - interval '13 days', approver_name = 'E2e Recheck Customer', approved_total_aed = 9450 where id = $1", [q.id]);
  await sql("update public.jobs set status = 'closed', stage = 'ready', is_open = false, gated_out_at = now() - interval '12 days', warranty_token = 'e2erecheck' || md5(random()::text) where id = $1", [orig.id]);
  await sql("insert into public.aftercare_checks (job_id, due_date, created_by, updated_by) values ($1, (now() - interval '2 days')::date, $2, $2)", [orig.id, owner]);

  /* ---------------- A ---------------- */
  const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, $3, $3) returning id", [cust, car, owner]))[0];
  const ppfLine = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, service_id, source_type, quantity, unit_price, price_per, created_by, updated_by) values ($1, 1, 'package', $2, $3, 'package', 1, 9000, 'job', $4, $4) returning id", [est.id, ppfService.name, ppfService.id, owner]))[0];
  const typed = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, price_per, created_by, updated_by) values ($1, 2, 'package', 'PPF RECHECK', 'manual', 1, 0, 'job', $2, $2) returning id", [est.id, owner]))[0];
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(op, `${base}/estimates/${est.id}`);
  check(`A a PPF install (${ppfService.name}) shows the PPF CUT choice; a typed "PPF RECHECK" line does not`, (await op.locator(`#item-line-${ppfLine.id} [data-cut-method]`).count()) === 1 && (await op.locator(`#item-line-${typed.id} [data-cut-method]`).count()) === 0);
  await op.locator(`#item-line-${typed.id}`).scrollIntoViewIfNeeded();
  await op.screenshot({ path: path.join(SHOTS, "A-cut-choice-only-on-install-1440.png") });

  /* ---------------- B ---------------- */
  await go(op, `${base}/dashboard`);
  const waiting = await text(op.locator("[data-waiting-panel]"));
  check(`B WAITING ON YOU: "Book the PPF final check · ${orig.job_number}, delivered …"`, waiting.includes(`Book the PPF final check · ${orig.job_number}`), waiting.slice(0, 200));
  await op.locator("[data-waiting-panel]").screenshot({ path: path.join(SHOTS, "B-waiting-on-you-1440.png") }).catch(() => null);

  /* ---------------- C ---------------- */
  await go(op, `${base}/gate-in/new?vehicle=${car}&visit=recheck`);
  const visit = op.locator('[data-visit-type="recheck"]');
  check(`C gate-in: PPF RECHECK (FREE) chosen, the original ${orig.job_number} offered, no inspection fee`, (await visit.count()) === 1 && (await text(visit)).includes(orig.job_number) && (await op.locator("[data-inspection-fee]").count()) === 0 && (await op.locator("[data-recheck-no-fee]").count()) === 1);
  await visit.scrollIntoViewIfNeeded();
  await op.screenshot({ path: path.join(SHOTS, "C-gate-in-recheck-1440.png") });
  for (const [n, v] of [["arrived_by", "customer_drove"], ["condition", "runs_drives"], ["fuel_level", "half"], ["cleanliness", "clean"], ["dash_cam", "no"], ["major_damage", "no"], ["keys_count", "1"], ["keys_keychain", "no"], ["old_parts_return", "no"]]) await pick(op, n, v);
  await pick(op, "recheck_of", orig.id);
  const addr = op.locator('textarea[name="location_address"]');
  if (await addr.count()) await addr.fill("E2e test address");
  await op.locator('input[name="mileage_display"]').pressSequentially("15000");
  await op.keyboard.press("Tab");
  await op.locator('input[name="requests"]:visible').first().pressSequentially("Free final check");
  await sleep(400);
  await op.getByText("Save and continue to photos and video").click();
  await op.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const rj = (await sql("select id, job_number, job_kind, recheck_of, inspection_fee_aed, department, estimate_id from public.jobs where vehicle_id = $1 and is_open", [car]))[0];
  const link = rj ? (await sql("select recheck_job_id from public.aftercare_checks where job_id = $1", [orig.id]))[0] : null;
  check(`C the visit ${rj?.job_number}: kind recheck, linked to ${orig.job_number}, fee AED 0, bodyshop, no estimate; the original's check points to it`, !!rj && rj.job_kind === "recheck" && rj.recheck_of === orig.id && Number(rj.inspection_fee_aed) === 0 && rj.department === "bodyshop" && !rj.estimate_id && link?.recheck_job_id === rj.id, JSON.stringify(rj));
  await go(op, `${base}/jobs/${rj.id}`);
  check("C the job card: the PPF RECHECK card, no approval, quotation or invoice boxes", (await op.locator("[data-recheck-card]").isVisible()) && !(await op.locator('[data-stage-card="approval"]').isVisible().catch(() => false)) && !(await op.locator('[data-stage-card="quotation"]').isVisible().catch(() => false)));
  await op.screenshot({ path: path.join(SHOTS, "C-recheck-job-card-1440.png") });
  // The gate-in photos are not the point here: the bodyshop manager (the owner) starts the check.
  await go(op, `${base}/bodyshop/${rj.id}`);
  await op.locator("[data-start-work]").click();
  const stage = await until(async () => (await sql("select id, key, section, status from public.bodyshop_stages where job_id = $1", [rj.id]))[0] ?? null);
  check("C one stage: the PPF team's final check (free)", !!stage && stage.key === "recheck" && stage.section === "ppf", JSON.stringify(stage));
  await go(op, `${base}/bodyshop/${rj.id}`);
  check("C the visit has no release sign-off and no customer-update card (nothing is handed back but the checklist)", (await op.locator("[data-signoff-card]").count()) === 0 && (await op.locator("[data-updates-card]").count()) === 0);

  /* ---------------- D ---------------- */
  const { browser: tb, page: tp } = leader ? await (await import("./pw-lib.mjs")).browserForId(leader.id, { viewport: { width: 800, height: 1280 } }) : await browserFor("owner", { viewport: { width: 800, height: 1280 } });
  await go(tp, `${base}/bodyshop/${rj.id}`);
  const list = tp.locator("[data-recheck-checklist]");
  for (const key of ["bubbles", "dust", "alignment", "panels", "screen", "tint"]) await list.locator(`[data-recheck-point="${key}"] [data-recheck-ok]`).click();
  await list.locator('[data-recheck-point="ceramic"] [data-recheck-na]').click();
  await list.locator('[data-recheck-point="edges"] [data-recheck-fix]').click();
  const note = list.locator('[data-recheck-point="edges"] [data-recheck-note]');
  await note.fill("Front bumper edge lifting 2 cm, resealed");
  await note.blur();
  await list.locator('[data-recheck-point="edges"] [data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "edge.png", mimeType: "image/png", buffer: PNG });
  await sleep(1500);
  await list.locator('[data-recheck-point="edges"] [data-recheck-fixed]').click();
  const saved = await until(async () => { const r = (await sql("select findings from public.aftercare_checks where job_id = $1", [orig.id]))[0]; const p = r?.findings?.points ?? {}; return Object.keys(p).length === 8 && p.edges?.fixed_at ? p : null; });
  check(`D the tablet checklist (${leader ? leader.display_name : "owner"}): 8 points answered, Edges and lifting fixed with a note and a photo`, !!saved && saved.edges.status === "fix" && /resealed/.test(saved.edges.note ?? "") && saved.ceramic.status === "na");
  await list.scrollIntoViewIfNeeded();
  await tp.screenshot({ path: path.join(SHOTS, "D-tablet-checklist-800x1280.png"), fullPage: true });
  await tb.close();
  // 70 minutes clocked on the visit by the PPF team.
  await sql("insert into public.bodyshop_clockings (job_id, stage_id, staff_id, started_at, ended_at, minutes, created_by) values ($1, $2, $3, now() - interval '75 minutes', now() - interval '5 minutes', 70, $3)", [rj.id, stage.id, leader?.id ?? owner]);
  // The hand-over by the owner (no PIN): the stage's photo is there already.
  await go(op, `${base}/bodyshop/${rj.id}`);
  await op.locator("[data-stage-handover-open='recheck']").click();
  const dlg = op.locator("[data-stage-handover='recheck']");
  if (await dlg.locator("[data-stage-handover-send]").isDisabled()) await dlg.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "done.png", mimeType: "image/png", buffer: PNG });
  for (let i = 0; i < 40 && (await dlg.locator("[data-stage-handover-send]").isDisabled()); i++) await sleep(300);
  await dlg.locator("[data-stage-handover-send]").click();
  const doneRow = await until(async () => { const r = (await sql("select done_at, redo from public.aftercare_checks where job_id = $1", [orig.id]))[0]; return r?.done_at ? r : null; });
  const visitRow = (await sql("select status, comeback_of from public.jobs where id = $1", [rj.id]))[0];
  check("D handed over: the original's final check is done, the visit is Ready (nothing to invoice), the redo makes it a comeback", !!doneRow && doneRow.redo === true && visitRow.status === "ready" && visitRow.comeback_of === orig.id, JSON.stringify({ doneRow, visitRow }));

  /* ---------------- E ---------------- */
  await go(op, `${base}/jobs/${orig.id}`);
  const cost = await text(op.locator("[data-time-recheck]"));
  check(`E the original job: "${cost.slice(0, 60)}"`, /^Recheck: 1\.2 h · AED [\d,.]+/.test(cost));
  check("E staff see \"Final check done on …\" on the original job", /Final check done on/.test(await text(op.locator("[data-final-check-staff]"))));
  await op.locator("[data-time-recheck]").scrollIntoViewIfNeeded();
  await op.screenshot({ path: path.join(SHOTS, "E-original-job-recheck-cost-1440.png") });

  /* ---------------- F ---------------- */
  const wtok = (await sql("select warranty_token from public.jobs where id = $1", [orig.id]))[0].warranty_token;
  const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 900 }, touch: true });
  await cp.context().clearCookies();
  await go(cp, `${base}/warranty/${wtok}`);
  const wtext = ((await cp.textContent("body")) ?? "").replace(/\s+/g, " ");
  check("F the customer's warranty page: \"Final check done on <date> ✓\", nothing about a check not done", /Final check done on \d{1,2} \w{3} \d{4} ✓/.test(wtext) && !/Not activated|Pending activation/.test(wtext), wtext.slice(0, 160));
  await cp.screenshot({ path: path.join(SHOTS, "F-warranty-final-check-done-420.png"), fullPage: true });
  await cb.close();
  await go(op, `${base}/comebacks`);
  check(`F the redo shows on Comebacks (${rj.job_number})`, ((await op.textContent("main")) ?? "").includes(rj.job_number));
  await ob.close();
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
