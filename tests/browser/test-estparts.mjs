// 30 October 2026: estimate parts priced by the parts desk (the estimate's separate "+ Part (estimate)" copy is gone).
//  A  the advisor adds a part to an estimate with the SAME "+ Add a part" as a job quotation, names it, sets the
//     quantity and a note for the parts desk, and sends it: [Send to parts desk to price].
//  B  the parts desk sees "ESTIMATE E-… – car not here yet" with make, model, year and VIN, prices it (part number,
//     type, cost, supplier, availability); the advisor is told.
//  C  the advisor sees cost, selling (minimum markup) and total, and the profit counts it.
//  D  a price the advisor already has: "Priced by advisor" (internal), the parts desk's "check this price" task,
//     "Price is right ✓".
//  E  "Estimate complete" is blocked while a part is unpriced ("1 part still waiting for the parts desk"), and a line
//     can simply be removed.
//  F  a test gate-in: the priced parts carry over to the job's quotation with their cost, supplier and markup (real
//     priced parts on the job, no re-pricing).
//  G  the job quotation's "+ Add a part" still names a part and sends it to the Parts desk.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-estparts.mjs
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { base, browserFor, browserForId, chooseInspectionFee, cleanupDb, go, here, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "estparts");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 15 * 60 * 1000).unref();
const until = async (fn, tries = 80, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());

const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0];
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const mm = (await sql("select m.id as make_id, m.name as make, v.id as model_id, v.name as model from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
const vin = `WDC${Math.floor(1e13 + Math.random() * 8e13)}`.slice(0, 17).replace(/[IOQ]/g, "1");
const made = { estimates: [] };

async function finish() {
  // The notifications this test made go (they carry no job, so the clean-up SQL does not see them), then the usual clean-up and the numbering.
  if (made.estimates.length) {
    const file = path.join(os.tmpdir(), `estparts-${process.pid}.sql`);
    const ors = made.estimates.map((id) => `href like '%${id}%'`).join(" or ");
    fs.writeFileSync(file, `delete from public.notifications where ${ors};\n`);
    try { execSync(`node --env-file=.env.local scripts/db-sql.mjs "${file}"`, { cwd: projectRoot, encoding: "utf8" }); } catch (e) { console.log("notifications not removed:", String(e.message).slice(0, 160)); }
    fs.rmSync(file, { force: true });
  }
  cleanupDb();
  for (const [seq, table, col, prefix] of [["estimate_number_seq", "quotations", "number", "E-"], ["quotation_number_seq", "quotations", "number", "Q-"], ["customer_number_seq", "customers", "customer_number", "C-"], ["job_number_seq", "jobs", "job_number", "J-"]]) {
    await sql(`select setval('public.${seq}', greatest(1, coalesce((select max(substring(${col} from 3)::int) from public.${table} where ${col} ~ '^${prefix}[0-9]+$'), 1)))`);
  }
}

try {
  cleanupDb();
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e Parts Estimate', '+971500000091') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'D', '91844', $2, $3, 2024, $4) returning id", [cust, mm.make_id, mm.model_id, vin]))[0].id;
  const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, $3, $3) returning id, number", [cust, car, advisor.id]))[0];
  made.estimates.push(est.id);
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', 'E2E BRAKE SERVICE', 'manual', 1, 2, 350, 700, $2, $2)", [est.id, advisor.id]);
  const lineOf = async (title) => (await sql("select id, title, quantity, unit_cost, markup_percent, parts_note, price_requested_at, priced_by_advisor, price_checked_at, supplier_text, part_number, availability, delivery_days from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active and upper(title) = upper($2)", [est.id, title]))[0] ?? null;

  /* ---------------- A ---------------- */
  const { browser: ab, page: ap } = await browserForId(advisor.id, { viewport: { width: 1440, height: 900 } });
  await go(ap, `${base}/estimates/${est.id}`);
  check("A the separate \"+ Part (estimate)\" button is gone; the estimate has the SAME \"+ Add a part\" as a job quotation", (await ap.getByRole("button", { name: "+ Part (estimate)" }).count()) === 0 && (await ap.locator("[data-add-part]").count()) === 1);
  const addPart = async (name) => {
    await ap.locator("[data-add-part]").click();
    const picker = ap.locator("[data-part-picker]");
    await picker.waitFor({ timeout: 15000 });
    await picker.locator('input[aria-label="Find a part"]').pressSequentially(name, { delay: 15 });
    await picker.locator("[data-use-custom]").click();
    await picker.getByRole("button", { name: "Done", exact: true }).click();
    return !!(await until(async () => await lineOf(name)));
  };
  check("A \"+ Add a part\" on the estimate adds a part line with the name typed", await addPart("Front brake pads e2e"));
  const pads = await lineOf("Front brake pads e2e");
  const padsRow = ap.locator(`[data-est-part="${pads.id}"]`);
  await padsRow.waitFor({ timeout: 15000 });
  check("A the name is an editable box (spell check on), with quantity and a note for the parts desk", (await padsRow.locator("[data-est-part-name]").getAttribute("spellcheck")) === "true" && (await padsRow.locator("[data-est-part-qty]").count()) === 1 && (await padsRow.locator("[data-est-part-note]").count()) === 1);
  await padsRow.locator("[data-est-part-qty]").fill("2");
  await padsRow.locator("[data-est-part-note]").pressSequentially("OEM only, front axle", { delay: 10 });
  await sleep(1500);
  check("A quantity 2 and the note are saved on the line", !!(await until(async () => { const l = await lineOf("Front brake pads e2e"); return Number(l?.quantity) === 2 && l?.parts_note === "OEM only, front axle"; })));
  await ap.screenshot({ path: path.join(SHOTS, "A-estimate-part-named-1440.png") });
  await padsRow.locator(`[data-est-send="${pads.id}"]`).click();
  check("A [Send to parts desk to price] sends it: \"With the parts desk\"", !!(await until(async () => !!(await lineOf("Front brake pads e2e"))?.price_requested_at)) && /With the parts desk/.test(await text(padsRow.locator("[data-est-part-state]"))));
  const toParts = await until(async () => (await sql("select count(*)::int as n from public.notifications where type = 'estimate_parts_to_price' and href = $1", [`/parts/estimate/${est.id}`]))[0].n > 0);
  check("A the parts desk is told: \"ESTIMATE … – car not here yet\"", !!toParts);
  await ap.screenshot({ path: path.join(SHOTS, "A-estimate-part-sent-1440.png") });

  /* ---------------- B ---------------- */
  const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(pp, `${base}/parts`);
  const entry = pp.locator(`[data-estimate-to-price="${est.number}"]`);
  const entryText = await text(entry);
  check(`B the Parts desk lists "ESTIMATE ${est.number} – car not here yet" with the car (${mm.make} ${mm.model} 2024) and the VIN`, entryText.includes(`ESTIMATE ${est.number} – car not here yet`) && entryText.includes(`${mm.make} ${mm.model} 2024`) && /1 part to price/.test(entryText) && (await entry.locator("[data-copy-vin], button").count()) >= 1, entryText.slice(0, 200));
  await entry.scrollIntoViewIfNeeded();
  await pp.screenshot({ path: path.join(SHOTS, "B-parts-desk-list-1440.png") });
  await entry.locator("[data-estimate-price-open]").click();
  await pp.waitForURL(/\/parts\/estimate\//, { timeout: 20000 });
  const deskRow = pp.locator(`[data-desk-part="${pads.id}"]`);
  check("B the pricing page shows the part, quantity 2 and the advisor's note", /FRONT BRAKE PADS E2E/i.test(await text(deskRow)) && /× 2/.test(await text(deskRow)) && /OEM only, front axle/.test(await text(deskRow)) && /DUBAI D 91844/i.test(await text(pp.locator("[data-desk-car]"))));
  await deskRow.locator("[data-desk-part-number]").fill("A0004209305");
  await deskRow.locator("[data-desk-cost]").fill("450");
  await deskRow.locator("[data-desk-supplier]").fill("E2e Supplier");
  await pick(pp, "part_type", "Genuine");
  await pick(pp, "availability", "1");
  await pp.screenshot({ path: path.join(SHOTS, "B-parts-desk-pricing-1440.png") });
  await deskRow.getByRole("button", { name: "Save price" }).click();
  const priced = await until(async () => { const l = await lineOf("Front brake pads e2e"); return Number(l?.unit_cost) === 450 ? l : null; });
  check("B the parts desk's price is on the line: cost 450, supplier, part number, genuine, next day", !!priced && priced.supplier_text === "E2e Supplier" && priced.part_number === "A0004209305" && priced.availability === "to_order" && Number(priced.delivery_days) === 1 && !priced.priced_by_advisor, JSON.stringify(priced));
  const told = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and type = 'estimate_parts_priced' and href = $2", [advisor.id, `/estimates/${est.id}`]))[0]);
  check(`B the advisor (${advisor.display_name}) is told: "${told?.title ?? "?"}"`, !!told && /Parts priced/.test(told.title));
  await pp.screenshot({ path: path.join(SHOTS, "B-parts-desk-priced-1440.png") });

  /* ---------------- C ---------------- */
  await go(ap, `${base}/estimates/${est.id}`);
  const row2 = ap.locator(`[data-est-part="${pads.id}"]`);
  const sell = await row2.locator("[data-selling-input]").inputValue();
  check("C the advisor sees the cost AED 450.00, the selling price with the minimum markup and the total (qty 2)", (await text(row2)).includes("AED 450.00") && Number(sell) >= 472.5 && /AED 9\d\d\.\d\d/.test(await text(row2)), `selling ${sell} · ${(await text(row2)).slice(0, 160)}`);
  check("C \"Priced by the parts desk\" with the supplier (internal)", /Priced by the parts desk/.test(await text(row2.locator("[data-est-part-state]"))) && /E2e Supplier/.test(await text(row2.locator("[data-est-part-state]"))));
  await row2.scrollIntoViewIfNeeded();
  await ap.screenshot({ path: path.join(SHOTS, "C-advisor-sees-price-1440.png") });

  /* ---------------- D ---------------- */
  check("D a second part added", await addPart("Oil filter e2e"));
  const filter = await lineOf("Oil filter e2e");
  const fRow = ap.locator(`[data-est-part="${filter.id}"]`);
  await fRow.waitFor({ timeout: 15000 });
  await fRow.locator(`[data-est-own-price="${filter.id}"]`).click();
  const box = ap.locator(`[data-est-own-price-box="${filter.id}"]`);
  await box.locator("[data-est-own-cost]").fill("80");
  await box.locator("[data-est-own-supplier]").fill("Dealer On The Phone");
  await box.locator("[data-est-own-save]").click();
  const own = await until(async () => { const l = await lineOf("Oil filter e2e"); return l?.priced_by_advisor && Number(l.unit_cost) === 80 ? l : null; });
  check("D \"I have a price\": cost 80 from the dealer, marked \"Priced by advisor\" (internal)", !!own && /Priced by advisor/.test(await text(fRow.locator("[data-est-part-state]"))), `${!!own} · ${await text(fRow.locator("[data-est-part-state]"))}`);
  await fRow.scrollIntoViewIfNeeded();
  await ap.screenshot({ path: path.join(SHOTS, "D-priced-by-advisor-1440.png") });
  const checkTask = await until(async () => (await sql("select title from public.notifications where type = 'estimate_price_check' and href = $1", [`/parts/estimate/${est.id}`]))[0]);
  check(`D the parts desk gets the "check this price" task: "${checkTask?.title ?? "?"}"`, !!checkTask);
  // The customer's copy never says who priced it.
  const tok = (await sql("update public.quotations set token = 'e2eestp' || floor(random()*1e9)::text where id = $1 returning token", [est.id]))[0].token;
  await go(pp, `${base}/parts`);
  check("D the Parts desk entry now reads \"1 advisor price to check\"", /1 advisor price to check/.test(await text(pp.locator(`[data-estimate-to-price="${est.number}"]`))));
  await go(pp, `${base}/parts/estimate/${est.id}`);
  await pp.locator(`[data-desk-part="${filter.id}"] [data-desk-price-right]`).click();
  check("D \"Price is right ✓\" checks it", !!(await until(async () => !!(await lineOf("Oil filter e2e"))?.price_checked_at)));
  await pp.screenshot({ path: path.join(SHOTS, "D-parts-desk-checked-1440.png") });

  /* ---------------- E ---------------- */
  check("E a third part added (not sent)", await addPart("Wiper blades e2e"));
  const wiper = await lineOf("Wiper blades e2e");
  await go(ap, `${base}/estimates/${est.id}`);
  const before = await text(ap.locator("[data-est-parts-waiting]"));
  const complete = ap.getByRole("button", { name: /Estimate complete/ }).first();
  await complete.click();
  await sleep(1500);
  const blocked = (await sql("select completed_at from public.quotations where id = $1", [est.id]))[0].completed_at === null;
  const bodyText = ((await ap.textContent("body")) ?? "").replace(/\s+/g, " ");
  check("E \"Estimate complete\" is blocked while a part is unpriced: \"1 part not sent to the parts desk yet\"", blocked && /1 part not sent to the parts desk yet/.test(bodyText) && /1 part not sent to the parts desk yet/.test(before), before);
  await ap.locator(`[data-est-send="${wiper.id}"]`).click();
  await until(async () => !!(await lineOf("Wiper blades e2e"))?.price_requested_at);
  await go(ap, `${base}/estimates/${est.id}`);
  check("E once sent: \"1 part still waiting for the parts desk\" (still blocked)", /1 part still waiting for the parts desk/.test(await text(ap.locator("[data-est-parts-waiting]"))));
  await ap.locator("[data-est-parts-waiting]").scrollIntoViewIfNeeded();
  await ap.screenshot({ path: path.join(SHOTS, "E-blocked-waiting-1440.png") });
  await ap.locator(`[data-est-remove="${wiper.id}"]`).click();
  check("E Remove takes the line off (nothing waiting any more)", !!(await until(async () => !(await lineOf("Wiper blades e2e")))) && (await until(async () => (await ap.locator("[data-est-parts-waiting]").count()) === 0)) === true);
  await ab.close();
  await pb.close();

  /* ---------------- F ---------------- */
  // The customer accepts the estimate (as on the link), then the car arrives.
  await sql("update public.quotations set status = 'approved', sent_at = now(), responded_at = now(), approver_name = 'E2e Parts Estimate', approved_total_aed = total_aed where id = $1", [est.id]);
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1280, height: 900 } });
  await go(op, `${base}/gate-in/new?vehicle=${car}`);
  for (const [n, v] of [["arrived_by", "customer_drove"], ["condition", "runs_drives"], ["fuel_level", "half"], ["cleanliness", "clean"], ["dash_cam", "no"], ["major_damage", "no"], ["keys_count", "1"], ["keys_keychain", "no"], ["old_parts_return", "no"], ["department", "mechanical"]]) await pick(op, n, v);
  const addr = op.locator('textarea[name="location_address"]');
  if (await addr.count()) await addr.fill("E2e test address");
  await op.locator('input[name="mileage_display"]').pressSequentially("12000");
  await op.keyboard.press("Tab");
  await op.locator('input[name="requests"]:visible').first().pressSequentially("Brake pads and oil filter as estimated");
  await chooseInspectionFee(op, 1000);
  await sleep(400);
  await op.getByText("Save and continue to photos and video").click();
  await op.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const job = (await sql("select id, job_number, estimate_id from public.jobs where vehicle_id = $1 and is_open", [car]))[0];
  await go(op, `${base}/jobs/${job.id}`);
  await op.getByRole("button", { name: "Start quotation" }).first().click();
  await op.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const qLines = await sql("select l.title, l.unit_cost, l.markup_percent, l.quantity, l.part_item_id, p.cost_aed, p.supplier, p.part_number, p.availability, p.priced_at is not null as priced from public.quotation_lines l join public.quotations q on q.id = l.quotation_id left join public.part_items p on p.id = l.part_item_id where q.job_id = $1 and q.kind = 'quotation' and l.is_active and l.line_type = 'part' order by l.position", [job.id]);
  const padsQ = qLines.find((l) => /FRONT BRAKE PADS/i.test(l.title));
  const filterQ = qLines.find((l) => /OIL FILTER/i.test(l.title));
  check(`F the gate-in's quotation carries the priced parts over: brake pads cost 450 × 2 from E2e Supplier (part number kept), oil filter cost 80 - real priced parts on ${job?.job_number}`, !!padsQ && !!padsQ.part_item_id && Number(padsQ.cost_aed) === 450 && Number(padsQ.unit_cost) === 450 && Number(padsQ.quantity) === 2 && padsQ.supplier === "E2e Supplier" && padsQ.part_number === "A0004209305" && padsQ.priced && !!filterQ && Number(filterQ.cost_aed) === 80 && Number(filterQ.markup_percent) >= 5, JSON.stringify(qLines));
  check("F nothing to re-price: no open part request for them on the job", (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and status = 'open'", [job.id]))[0].n === 0);
  await op.screenshot({ path: path.join(SHOTS, "F-job-quotation-parts-carried-1280.png"), fullPage: true });
  await go(op, `${base}/parts/${job.id}`);
  await op.screenshot({ path: path.join(SHOTS, "F-job-parts-desk-priced-1280.png"), fullPage: true });

  /* ---------------- G ---------------- */
  const qid = op.url().match(/quote\/([0-9a-f-]{36})/)?.[1] ?? (await sql("select id from public.quotations where job_id = $1 and kind = 'quotation' order by created_at limit 1", [job.id]))[0].id;
  await go(op, `${base}/jobs/${job.id}/quote/${qid}`);
  await op.locator("[data-add-part]").click();
  const picker = op.locator("[data-part-picker]");
  await picker.locator('input[aria-label="Find a part"]').pressSequentially("Radiator hose e2e", { delay: 15 });
  await picker.locator("[data-use-custom]").click();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  check("G the job quotation's \"+ Add a part\" still names a part and sends it to the Parts desk", !!(await until(async () => (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and upper(label) = 'RADIATOR HOSE E2E'", [job.id]))[0].n === 1)));
  await ob.close();
  void tok;
  void owner;
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
