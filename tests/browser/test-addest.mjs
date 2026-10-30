// 30 October 2026: additional estimates were blocked.
//  A  a customer with one car and an open estimate, picked the way an advisor does it (type the name, choose the
//     car, Start): the question names THE CAR's estimate ("This car already has an open estimate: E-… · AED … ·
//     sent …") with Open and Make an additional estimate, and Make an additional estimate creates one (it used to
//     do nothing: the car box was reset by the browser behind the window). At 1440x900 and 800x1280.
//  B  a customer with two cars, an estimate on the first: an estimate for the SECOND car asks nothing.
//  C  (REAL_ESTIMATE=E-00035) the real customer's car: the question with that estimate's details, then the additional
//     estimate is made and removed again at the end (rows deleted, numbering put back).
//  D  the car page and the customer page list every estimate with its versions; the customer's copy and the PDF of
//     the additional one read "ADDITIONAL ESTIMATE – in addition to E-…"            (needs the 30 Oct migration)
//  E  a gate-in carries BOTH open estimates over: Start quotation makes two quotations on the job, ORIGINAL and
//     ADDITIONAL, each with its estimate's lines; the money line counts every approved one (needs the migration)
//   E2E_BASE=http://localhost:3101 node --env-file=.env.test.local tests/browser/test-addest.mjs   (ONLY=A,B,… for some)
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { base, browserFor, chooseInspectionFee, cleanupDb, go, here, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "addest");
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY ?? "A,B,C,D,E").split(",");
const want = (s) => ONLY.includes(s);
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 15 * 60 * 1000).unref();
const until = async (fn, tries = 80, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

const maxE = Number((await sql("select coalesce(max(substring(number from 3)::int), 0) as n from public.quotations where number ~ '^E-[0-9]+$'"))[0].n);
const maxQ = Number((await sql("select coalesce(max(substring(number from 3)::int), 0) as n from public.quotations where number ~ '^Q-[0-9]+$'"))[0].n);
const realMade = []; // estimates made on a REAL customer in section C, deleted at the end
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0].id;
const make = (await sql("select id from public.vehicle_makes where is_active order by name limit 1"))[0].id;

async function finish() {
  // Rows made on a real customer go for good (the no-delete rule is set aside for this one statement), then the numbering is put back.
  if (realMade.length) {
    const file = path.join(os.tmpdir(), `addest-real-${process.pid}.sql`);
    const ids = realMade.map((id) => `'${id}'`).join(", ");
    fs.writeFileSync(file, `begin;\nset local session_replication_role = replica;\ndelete from public.quotation_lines where quotation_id in (${ids});\ndelete from public.quotation_events where quotation_id in (${ids});\ndelete from public.short_links where url like '%/quote/%' and url in (select 'https://erp.ofjauto.com/quote/' || token from public.quotations where id in (${ids}) and token is not null);\ndelete from public.quotations where id in (${ids});\ncommit;\n`);
    try { console.log("real rows removed:", execSync(`node --env-file=.env.test.local scripts/db-sql.mjs "${file}"`, { cwd: projectRoot, encoding: "utf8" }).trim().split("\n").join(" | ")); } catch (e) { console.log("REAL ROWS NOT REMOVED", realMade, String(e.message).slice(0, 200)); }
    fs.rmSync(file, { force: true });
  }
  cleanupDb();
  await sql("select setval('public.estimate_number_seq', greatest(1, coalesce((select max(substring(number from 3)::int) from public.quotations where number ~ '^E-[0-9]+$'), 1)))");
  await sql("select setval('public.quotation_number_seq', greatest(1, coalesce((select max(substring(number from 3)::int) from public.quotations where number ~ '^Q-[0-9]+$'), 1)))");
  // The test customers and the test gate-in used real customer and job numbers: given back too.
  await sql("select setval('public.customer_number_seq', greatest(1, coalesce((select max(substring(customer_number from 3)::int) from public.customers where customer_number ~ '^C-[0-9]+$'), 1)))");
  await sql("select setval('public.job_number_seq', greatest(1, coalesce((select max(substring(job_number from 3)::int) from public.jobs where job_number ~ '^J-[0-9]+$'), 1)))");
  console.log(`numbering back: E max ${maxE}, Q max ${maxQ} before the run`);
}

/** A test customer (cleaned up by its phone) with the given number of cars. */
async function testCustomer(name, phone, plates) {
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', $1, $2) returning id", [name, phone]))[0].id;
  const cars = [];
  for (const p of plates) cars.push((await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id) values ($1, true, 'UAE', 'Dubai', 'Z', $2, $3) returning id", [cust, p, make]))[0].id);
  return { cust, cars };
}
async function openEstimate(cust, car, status = "sent", total = 6615) {
  const r = (await sql(`insert into public.quotations (kind, customer_id, vehicle_id, status, token, validity_days, sent_at, valid_until, total_aed, created_by, updated_by) values ('estimate', $1, $2, $3, 'e2eaddest' || floor(random()*1e9)::text, 7, ${status === "draft" ? "null" : "now()"}, now() + interval '6 days', $4, $5, $5) returning id, number`, [cust, car, status, total, advisor]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', 'E2e brake service', 'manual', 1, 2, 350, 700, $2, $2)", [r.id, advisor]);
  return r;
}

/** The advisor's path: type the customer, choose the car, Start the estimate. */
async function startFor(page, custLabel, carId) {
  await go(page, `${base}/estimates/new`);
  const box = page.locator('[data-customer-car-chooser] input[type="text"]').first();
  await box.click();
  await box.pressSequentially(custLabel, { delay: 20 });
  await page.getByRole("button", { name: new RegExp(custLabel) }).first().click();
  await page.locator("[data-vehicle-select]").selectOption(carId);
  await page.locator('[data-start-form="estimate"] > div > button[type="submit"]').first().click();
}
const estimatesOf = async (car) => Number((await sql("select count(*)::int as n from public.quotations where kind = 'estimate' and vehicle_id = $1 and is_active and deleted_at is null", [car]))[0].n);

try {
  cleanupDb();
  /* ---------------- A ---------------- */
  if (want("A")) {
    for (const [w, h, name, phone] of [[1440, 900, "computer", "+971500000081"], [800, 1280, "tablet", "+971500000082"]]) {
      const t = await testCustomer(`E2e Natalie ${name}`, phone, [`8${w}`]);
      const est = await openEstimate(t.cust, t.cars[0]);
      const { browser, page } = await browserFor("service_advisor", { viewport: { width: w, height: h }, touch: w < 1100 });
      await startFor(page, `E2e Natalie ${name}`, t.cars[0]);
      const dlg = page.locator("[data-estimate-duplicate]");
      const shown = await dlg.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      const words = await text(dlg);
      check(`A ${name}: after the CAR is chosen, the question names that car's estimate: "This car already has an open estimate: ${est.number} · AED 6,615.00 · sent …"`, shown && words.includes(`This car already has an open estimate: ${est.number} · AED 6,615.00 · sent `) && !/usually a mistake/i.test(words), words.slice(0, 200));
      check(`A ${name}: two ways forward - [Open ${est.number}] and [Make an additional estimate]`, (await page.locator("[data-estimate-open-existing]").textContent()) === `Open ${est.number}` && ((await page.locator("[data-estimate-open-existing]").getAttribute("href")) ?? "").endsWith(est.id) && (await page.locator("[data-estimate-additional]").isVisible()));
      // The car box behind the window is still the chosen car (the browser reset it before 30 October).
      check(`A ${name}: the car box behind the window still holds the chosen car`, (await page.locator("[data-vehicle-select]").inputValue()) === t.cars[0]);
      await page.screenshot({ path: path.join(SHOTS, `A-question-${w}x${h}.png`) });
      const before = await estimatesOf(t.cars[0]);
      await page.locator("[data-estimate-additional]").click();
      const moved = await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}/.test(u.toString()) && !u.toString().includes(est.id), { timeout: 30000 }).then(() => true).catch(() => false);
      const after = await estimatesOf(t.cars[0]);
      const newId = (page.url().match(/estimates\/([0-9a-f-]{36})/) ?? [])[1];
      const ev = newId ? await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'estimate_additional'", [newId]) : [];
      check(`A ${name}: [Make an additional estimate] creates it at once and opens it`, moved && after === before + 1 && ev.length === 1 && ev[0].note.includes(`in addition to ${est.number}`), `${before} → ${after} · ${ev[0]?.note ?? ""}`);
      await page.screenshot({ path: path.join(SHOTS, `A-additional-made-${w}x${h}.png`) });
      // And again: a third one on purpose works the same (every time).
      await startFor(page, `E2e Natalie ${name}`, t.cars[0]);
      await dlg.waitFor({ timeout: 20000 });
      const lines = await page.locator("[data-estimate-dup-line]").count();
      await page.locator("[data-estimate-additional]").click();
      await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      check(`A ${name}: asked again, the window lists both open estimates and the next additional one is made too`, lines === 2 && (await until(async () => (await estimatesOf(t.cars[0])) === before + 2)) === true, `${lines} lines`);
      // "Choose another car" closes the window without making anything.
      await startFor(page, `E2e Natalie ${name}`, t.cars[0]);
      await dlg.waitFor({ timeout: 20000 });
      await page.locator("[data-estimate-dup-close]").click();
      check(`A ${name}: "Choose another car" closes the window and makes nothing`, (await dlg.count()) === 0 && (await estimatesOf(t.cars[0])) === before + 2);
      await browser.close();
    }
  }

  /* ---------------- B ---------------- */
  if (want("B")) {
    for (const [w, h, phone] of [[1440, 900, "+971500000083"], [800, 1280, "+971500000084"]]) {
      const t = await testCustomer(`E2e Twocars ${w}`, phone, [`83${w}1`, `83${w}2`]);
      await openEstimate(t.cust, t.cars[0]);
      const { browser, page } = await browserFor("service_advisor", { viewport: { width: w, height: h }, touch: w < 1100 });
      const before = await estimatesOf(t.cars[1]);
      await startFor(page, `E2e Twocars ${w}`, t.cars[1]);
      const moved = await page.waitForURL(/\/estimates\/[0-9a-f-]{36}/, { timeout: 30000 }).then(() => true).catch(() => false);
      check(`B ${w}x${h}: an estimate for the customer's SECOND car asks nothing and is made`, moved && (await page.locator("[data-estimate-duplicate]").count()) === 0 && (await estimatesOf(t.cars[1])) === before + 1);
      await page.screenshot({ path: path.join(SHOTS, `B-second-car-no-question-${w}x${h}.png`) });
      await browser.close();
    }
  }

  /* ---------------- C ---------------- */
  if (want("C") && process.env.REAL_ESTIMATE) {
    const real = (await sql("select q.id, q.number, q.customer_id, q.vehicle_id, q.created_by, coalesce(c.company_name, c.full_name) as name, s.role_id from public.quotations q join public.customers c on c.id = q.customer_id left join public.staff s on s.id = q.created_by where q.number = $1 and q.kind = 'estimate' and q.is_active order by q.version desc limit 1", [process.env.REAL_ESTIMATE]))[0];
    if (!real) check(`C ${process.env.REAL_ESTIMATE} found`, false);
    else {
      // As the advisor who made it (Anas for E-00035), the way he does it.
      const { browserForId } = await import("./pw-lib.mjs");
      const { browser, page } = await browserForId(real.created_by, { viewport: { width: 1440, height: 900 } });
      await startFor(page, real.name, real.vehicle_id);
      const dlg = page.locator("[data-estimate-duplicate]");
      await dlg.waitFor({ timeout: 20000 }).catch(() => null);
      const words = await text(dlg);
      check(`C the real car: "This car already has an open estimate: ${real.number} · AED … · …"`, words.includes(`open estimate: ${real.number} · AED `) || words.includes(`${real.number} · AED `), words.slice(0, 160));
      await page.screenshot({ path: path.join(SHOTS, `C-real-question-1440x900.png`) });
      await page.locator("[data-estimate-additional]").click();
      await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}/.test(u.toString()) && !u.toString().includes(real.id), { timeout: 30000 }).catch(() => null);
      const newId = (page.url().match(/estimates\/([0-9a-f-]{36})/) ?? [])[1];
      if (newId) realMade.push(newId);
      const made = newId ? (await sql("select number, customer_id, vehicle_id from public.quotations where id = $1", [newId]))[0] : null;
      check(`C [Make an additional estimate] made one for the same customer and car (removed again at the end)`, !!made && made.customer_id === real.customer_id && made.vehicle_id === real.vehicle_id, made?.number ?? "nothing");
      await page.screenshot({ path: path.join(SHOTS, `C-real-additional-made-1440x900.png`) });
      await browser.close();
    }
  }

  /* ---------------- D and E: one customer, one car, an accepted estimate (two versions) and an additional one ---------------- */
  if (want("D") || want("E")) {
    const t = await testCustomer("E2e Carry Customer", "+971500000085", ["85001"]);
    const car = t.cars[0];
    // E1: version 1 replaced by version 2, accepted by the customer. E2: made as an additional estimate to E1, opened by the customer, not accepted yet.
    const e1v1 = await openEstimate(t.cust, car, "sent", 700);
    await sql("update public.quotations set status = 'superseded' where id = $1", [e1v1.id]);
    const e1 = (await sql("insert into public.quotations (kind, number, version, parent_id, customer_id, vehicle_id, status, token, validity_days, sent_at, valid_until, responded_at, approver_name, total_aed, approved_total_aed, created_by, updated_by) values ('estimate', $1, 2, $2, $3, $4, 'sent', 'e2eaddest' || floor(random()*1e9)::text, 7, now(), now() + interval '6 days', now(), 'E2e Carry Customer', 735, 735, $5, $5) returning id, number, token", [e1v1.number, e1v1.id, t.cust, car, advisor]))[0];
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', 'E2e brake service', 'manual', 1, 2, 350, 700, $2, $2)", [e1.id, advisor]);
    // Approved only after its line is in: the approved-quotation lock refuses lines on an approved quotation.
    await sql("update public.quotations set status = 'approved' where id = $1", [e1.id]);
    const e2 = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, token, validity_days, sent_at, opened_at, valid_until, total_aed, additional_to_id, created_by, updated_by) values ('estimate', $1, $2, 'opened', 'e2eaddest' || floor(random()*1e9)::text, 7, now(), now(), now() + interval '6 days', 1575, $3, $4, $4) returning id, number, token", [t.cust, car, e1v1.id, advisor]))[0];
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', 'E2e PPF bonnet', 'manual', 1, 3, 500, 1500, $2, $2)", [e2.id, advisor]);

    if (want("D")) {
      for (const [w, h] of [[1440, 900], [800, 1280]]) {
        const { browser, page } = await browserFor("service_advisor", { viewport: { width: w, height: h }, touch: w < 1100 });
        await go(page, `${base}/vehicles/${car}`);
        const list = page.locator("[data-car-estimates]");
        const rows = list.locator("[data-quote-row]");
        const r1 = list.locator(`[data-quote-row="${e1.number}"]`);
        const r2 = list.locator(`[data-quote-row="${e2.number}"]`);
        check(`D ${w}x${h}: the car page lists BOTH estimates, ${e1.number} ORIGINAL (accepted, v2 of 2) and ${e2.number} ADDITIONAL "in addition to ${e1.number}"`, (await rows.count()) === 2 && (await r1.getAttribute("data-quote-role")) === "original" && (await r2.getAttribute("data-quote-role")) === "additional" && /Accepted/.test(await text(r1)) && /v2 of 2/.test(await text(r1)) && (await r2.locator(`[data-quote-adds-to="${e1.number}"]`).count()) === 1, `${await rows.count()} rows · ${await text(r1)} | ${await text(r2)}`);
        check(`D ${w}x${h}: ${e1.number}'s versions are one pick away (v1 and v2)`, (await r1.locator('[data-quote-versions="2"]').count()) === 1);
        await list.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `D-car-page-estimates-${w}x${h}.png`), fullPage: true });
        await go(page, `${base}/customers/${t.cust}`);
        const cl = page.locator("[data-customer-estimates]");
        check(`D ${w}x${h}: the customer page lists the same two estimates under the car`, (await cl.getAttribute("data-customer-estimates")) === "2" && (await cl.locator(`[data-quote-row="${e1.number}"]`).count()) === 1 && (await cl.locator(`[data-quote-row="${e2.number}"]`).count()) === 1);
        await cl.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `D-customer-page-estimates-${w}x${h}.png`), fullPage: true });
        await browser.close();
      }
      // The customer's copy: the page and the PDF are titled Additional estimate, in addition to E1 (accepted).
      const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 900 }, touch: true });
      await cp.context().clearCookies();
      await go(cp, `${base}/quote/${e2.token}`);
      const body = ((await cp.textContent("body")) ?? "").replace(/\s+/g, " ");
      check(`D the customer's link: "ADDITIONAL ESTIMATE" with "In addition to estimate ${e1.number} (accepted …)"`, /Additional estimate/i.test(body) && body.includes(`In addition to estimate ${e1.number} (accepted `), body.slice(0, 200));
      await cp.screenshot({ path: path.join(SHOTS, "D-customer-link-additional-420.png"), fullPage: true });
      await cb.close();
      const pdf = Buffer.from(await (await fetch(`${base}/api/pdf/quote/${e2.token}`)).arrayBuffer());
      const mupdf = await import("mupdf");
      const doc = mupdf.Document.openDocument(pdf, "application/pdf");
      let pdfText = "";
      for (let i = 0; i < doc.countPages(); i++) pdfText += doc.loadPage(i).toStructuredText().asText() + "\n";
      check(`D the PDF: "ADDITIONAL ESTIMATE" and "In addition to estimate ${e1.number}"`, /ADDITIONAL ESTIMATE/i.test(pdfText) && pdfText.includes(`In addition to estimate ${e1.number}`), pdfText.replace(/\s+/g, " ").slice(0, 160));
      fs.writeFileSync(path.join(SHOTS, "D-additional-estimate.pdf"), pdf);
    }

    if (want("E")) {
      // The gate-in, filled the way a person does it: both estimates are listed and ticked.
      const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());
      const { browser, page } = await browserFor("owner", { viewport: { width: 1280, height: 900 } });
      await go(page, `${base}/gate-in/new?vehicle=${car}`);
      const carry = page.locator("[data-carry-estimates]");
      const ticked = await page.locator('input[name="carry_estimate"]:checked').count();
      check(`E gate-in lists BOTH open estimates of the car, ticked to carry over (${e1.number} accepted, ${e2.number} additional, not accepted yet)`, (await carry.getAttribute("data-carry-estimates")) === "2" && ticked === 2 && /additional to/.test(await text(carry)), await text(carry));
      await carry.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, "E-gate-in-both-estimates-1280.png") });
      await pick(page, "arrived_by", "customer_drove");
      await pick(page, "condition", "runs_drives");
      await pick(page, "fuel_level", "half");
      await pick(page, "cleanliness", "clean");
      await pick(page, "dash_cam", "no");
      await pick(page, "major_damage", "no");
      await pick(page, "keys_count", "1");
      await pick(page, "keys_keychain", "no");
      await pick(page, "old_parts_return", "no");
      await pick(page, "department", "mechanical");
      const addr = page.locator('textarea[name="location_address"]');
      if (await addr.count()) await addr.fill("E2e test address");
      await page.locator('input[name="mileage_display"]').pressSequentially("9500");
      await page.keyboard.press("Tab");
      await page.locator('input[name="requests"]:visible').first().pressSequentially("Brakes and PPF as estimated");
      await chooseInspectionFee(page, 1000);
      await sleep(400);
      await page.getByText("Save and continue to photos and video").click();
      await page.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      const job = (await sql("select id, job_number, estimate_id from public.jobs where vehicle_id = $1 and is_open", [car]))[0];
      const carried = job ? await sql("select number, version from public.quotations where carried_job_id = $1 order by created_at", [job.id]) : [];
      check(`E the gate-in carried BOTH estimates over to the job (${e1.number} the original)`, !!job && carried.length >= 2 && job.estimate_id === e1.id, `${job?.job_number} · ${carried.map((c) => c.number).join(", ")} · job points at ${job?.estimate_id === e1.id ? "v2 (accepted)" : job?.estimate_id === e1v1.id ? "v1 (replaced)" : job?.estimate_id}`);
      // The owner starts the quotation (before the inspection is approved, written down): each estimate becomes its own quotation.
      await go(page, `${base}/jobs/${job.id}`);
      await page.getByRole("button", { name: "Start quotation" }).first().click();
      await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 30000 }).catch(() => null);
      const qs = await sql("select q.number, q.status, q.estimate_id, e.number as est, (select string_agg(title, ', ') from public.quotation_lines where quotation_id = q.id and is_active) as titles from public.quotations q join public.quotations e on e.id = q.estimate_id where q.job_id = $1 and q.kind = 'quotation' order by q.created_at", [job.id]);
      check(`E Start quotation made TWO quotations: ${qs[0]?.number} from ${e1.number} (brakes) and ${qs[1]?.number} from ${e2.number} (PPF)`, qs.length === 2 && qs[0].est === e1.number && /E2e brake service/.test(qs[0].titles ?? "") && qs[1].est === e2.number && /E2e PPF bonnet/.test(qs[1].titles ?? ""), JSON.stringify(qs));
      await go(page, `${base}/jobs/${job.id}`);
      const ql = page.locator('[data-quotation-list][data-list-kind="quotation"]');
      check("E the job card lists them as ORIGINAL and ADDITIONAL", (await ql.locator('[data-quote-role="original"]').count()) === 1 && (await ql.locator('[data-quote-role="additional"]').count()) === 1);
      await ql.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, "E-job-card-two-quotations-1280.png") });
      // The original came from an ACCEPTED estimate: "Confirm: nothing changed" approves it. The customer approves the additional one (as on its link).
      await go(page, `${base}/jobs/${job.id}/quote/${(await sql("select id from public.quotations where job_id = $1 and estimate_id = $2", [job.id, job.estimate_id]))[0].id}`);
      const confirmBtn = page.getByRole("button", { name: /Confirm: nothing changed/ });
      if (await confirmBtn.count()) {
        await confirmBtn.first().click();
        await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      }
      const q1 = (await sql("select id, number, status, total_aed from public.quotations where job_id = $1 and estimate_id = $2", [job.id, job.estimate_id]))[0];
      const q2 = (await sql("select id, number, status, total_aed from public.quotations where job_id = $1 and estimate_id = $2", [job.id, e2.id]))[0];
      await sql("update public.quotations set status = 'approved', token = coalesce(token, 'e2eaddq' || floor(random()*1e9)::text), sent_at = now(), responded_at = now(), approver_name = 'E2e Carry Customer', approved_total_aed = total_aed where id = $1", [q2.id]);
      check(`E the original ${q1.number} is approved from the accepted estimate`, q1.status === "approved", q1.status);
      await go(page, `${base}/jobs/${job.id}`);
      const money = await text(page.locator("[data-quote-money]"));
      const both = Math.round((Number(q1.total_aed) + Number(q2.total_aed)) * 100) / 100;
      check(`E the money counts EVERY approved quotation: "Approved so far AED ${both.toLocaleString("en-GB", { minimumFractionDigits: 2 })}"`, money.includes(`Approved so far AED ${both.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`), money);
      await page.locator("[data-quote-money]").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, "E-job-card-both-approved-1280.png") });
      await go(page, `${base}/jobs/${job.id}/invoice`);
      const inv = ((await page.textContent("main")) ?? "").replace(/\s+/g, " ");
      check("E the invoice draft takes the lines of BOTH approved quotations", /E2e brake service/i.test(inv) && /E2e PPF bonnet/i.test(inv), inv.slice(0, 160));
      await page.screenshot({ path: path.join(SHOTS, "E-invoice-both-1280.png"), fullPage: true });
      // Both estimates now say where they went, and no gate-in offers them again.
      await go(page, `${base}/vehicles/${car}`);
      check(`E the car page: both estimates "carried over to ${job.job_number}"`, (await page.locator(`[data-car-estimates] [data-quote-carried="${job.job_number}"]`).count()) === 2);
      await browser.close();
    }
  }
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
