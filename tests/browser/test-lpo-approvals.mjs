// LPO approvals + intake manifold (1 November 2026, LPO-00038 on J-00317). One line refused on its own (greyed "Refused
// by …", never To order), Replace adds a row for another supplier that joins the LPO waiting for approval by itself
// (owner told "1 part added to …"), an LPO already approved gets a NEW approval request for a part added later, line
// numbers are refused in the part number box and never reach the supplier copy, "Send LPO for approval" names the
// unfinished lines, the advisor's markup never goes below the minimum, every pending LPO is on the owner's Waiting on
// you, and "Intake manifold" is on the tablet, in the report under ENGINE BAY, on the quotation's report strip and in
// "Add a part".
// Run: node --env-file=.env.test.local tests/browser/test-lpo-approvals.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "lpo-approvals");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const rowOf = (page, name) => page.locator("[data-row-key]").filter({ has: page.locator("[data-part-name]", { hasText: new RegExp(name, "i") }) });

const owner = (await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const partsUser = (await sql("select id, display_name from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const tech = (await sql("select id from public.staff where role_id = 'technician' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1440, h = 900) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };

cleanupDb();
try {
  for (const n of ["E2E SUPPLIER A", "E2E WRONG SUPPLIER", "E2E RIGHT SUPPLIER"]) await sql("insert into public.suppliers (name, created_by, updated_by) select $1, $2, $2 where not exists (select 1 from public.suppliers where name ilike $1)", [n, owner.id]);

  /* ---------- 0. Intake manifold on the report and the quotation strip; the advisor's markup floor ---------- */
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = q.jobId;
  const intake = (await sql("select id from public.inspection_items where inspection_id = $1 and item_key = 'engine_bay.intake_manifold'", [q.inspectionId]))[0];
  check("0: a new inspection carries Intake manifold (ENGINE BAY)", !!intake);
  if (intake) await sql("update public.inspection_items set status = 'bad', remarks = 'Cracked at runner 3, vacuum leak', labour_hours = 3 where id = $1", [intake.id]);
  const adv = await open(advisor.id);
  await go(adv.page, `${base}/jobs/${jobId}/inspection`);
  await adv.page.locator("[data-report-preview] button").first().click();
  await sleep(800);
  const engine = adv.page.locator("[data-report-section]").filter({ hasText: /engine bay/i });
  const engineText = await text(engine);
  check(`0: the report groups the finding under ENGINE BAY ("${engineText.slice(0, 90)}")`, /intake manifold/i.test(engineText) && /cracked at runner 3/i.test(engineText));
  await engine.first().scrollIntoViewIfNeeded().catch(() => {});
  await adv.page.screenshot({ path: shot("0a-report-engine-bay.png") });
  await go(adv.page, `${base}/jobs/${jobId}/quote/${q.quotationId}`);
  const pageText = (await adv.page.locator("main").textContent()) ?? "";
  check("0: the quotation's report strip names Intake manifold", /intake manifold/i.test(pageText));
  await adv.page.screenshot({ path: shot("0b-quotation-strip.png") });
  // The advisor types 2% on a part: it comes back at the minimum (5%).
  const partLine = (await sql("select id from public.quotation_lines where quotation_id = $1 and line_type = 'part' limit 1", [q.quotationId]))[0];
  const save = await adv.page.evaluate(async ([qid, id]) => (await fetch("/api/quote/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, opId: crypto.randomUUID(), patchLine: { id, markup_percent: 2 } }) })).status, [q.quotationId, partLine.id]);
  const mk = (await sql("select markup_percent::float as m from public.quotation_lines where id = $1", [partLine.id]))[0];
  const minRow = (await sql("select value::text as v from public.settings where key = 'parts_min_markup_percent'"))[0];
  check(`0: an advisor's 2% markup is pulled back to the minimum (${mk?.m}%, minimum ${minRow?.v}%, save ${save})`, Number(mk?.m) >= Number(minRow?.v ?? 5));

  /* ---------- A. LPO for approval with two suppliers ---------- */
  await api("/api/e2e/stage", { stage: "approved" });
  const pa = (await sql("select id from public.part_items where job_id = $1 and description ilike 'front brake pads' limit 1", [jobId]))[0];
  await sql("update public.part_items set supplier = 'E2E SUPPLIER A' where id = $1", [pa.id]);
  // The seed's open request (rear brake discs) is answered: not available.
  await sql("update public.part_requests set status = 'unavailable' where job_id = $1 and status in ('open', 'listed')", [jobId]);
  const mount = (await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, delivery_date, confirm_status, part_type, priced_at, priced_by, order_status, created_by, updated_by) values ($1, 'E2E TRANSMISSION MOUNT', 'E2E-TM-WRONG', 1, 1, 1192, 'E2E WRONG SUPPLIER', 'to_order', (now() + interval '61 days')::date, 'confirmed', 'genuine', now(), $2, 'to_order', $2, $2) returning id", [jobId, partsUser.id]))[0];
  const desk = await open(partsUser.id);
  await go(desk.page, `${base}/parts/${jobId}`);
  await desk.page.locator("[data-send-lpo]").first().click();
  const lpo = await until(async () => (await sql("select id, number, status, total_cost_aed::float as total from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval'", [jobId]))[0]);
  const lines0 = lpo ? (await sql("select count(*)::int as n from public.purchase_order_lines where po_id = $1 and is_active", [lpo.id]))[0] : null;
  check(`A: Send LPO for approval makes ${lpo?.number} with both suppliers (2 lines, AED ${lpo?.total})`, lines0?.n === 2 && Math.abs((lpo?.total ?? 0) - 1392) < 0.01);

  /* ---------- B. The owner refuses ONE line ---------- */
  const own = await open(owner.id);
  await go(own.page, `${base}/dashboard`);
  const wOwner = await text(own.page.locator(`[data-waiting-job="lpo:${lpo.id}"]`));
  check(`B: the owner's Waiting on you lists ${lpo.number} ("${wOwner.slice(0, 80)}")`, wOwner.includes(lpo.number) && /LPO waiting for approval/.test(wOwner));
  await go(own.page, `${base}/parts/orders/${lpo.id}`);
  const mountLine = (await sql("select id from public.purchase_order_lines where po_id = $1 and part_item_id = $2", [lpo.id, mount.id]))[0];
  const box = own.page.locator(`[data-refuse-line="${mountLine.id}"]`);
  await box.locator("summary").click();
  await box.locator("[data-refuse-reason]").fill("Wrong supplier for this car");
  await own.page.screenshot({ path: shot("b1-owner-refuses-one-line.png") });
  await box.locator("[data-refuse-send]").click();
  const refused = await until(async () => (await sql("select refused_at, refused_reason, order_status, po_id from public.part_items where id = $1 and refused_at is not null", [mount.id]))[0]);
  check("B: the line is refused: reason kept, order status none, off the LPO", refused?.refused_reason === "Wrong supplier for this car" && refused?.order_status === "none" && !refused?.po_id);
  const lpoB = (await sql("select status, total_cost_aed::float as total from public.purchase_orders where id = $1", [lpo.id]))[0];
  check(`B: the rest of the LPO still waits (AED ${lpoB?.total})`, lpoB?.status === "pending_approval" && Math.abs(lpoB.total - 200) < 0.01);
  await own.page.waitForURL(/message=/, { timeout: 20000 }).catch(() => {});
  await sleep(800);
  await own.page.screenshot({ path: shot("b2-lpo-after-refusal.png") });
  const refusedListed = await text(own.page.locator("[data-refused-lines]"));
  check(`B: the LPO page lists the refused line ("${refusedListed.slice(0, 90)}")`, /E2E TRANSMISSION MOUNT/i.test(refusedListed) && /Refused by/.test(refusedListed));
  const deskNote = (await sql("select title from public.notifications where staff_id = $1 and title like $2 order by created_at desc limit 1", [partsUser.id, `Refused on ${lpo.number}%`]))[0];
  check(`B: Parts are told ("${deskNote?.title}")`, !!deskNote);

  /* ---------- C. Replace with another supplier: it joins the LPO waiting for approval ---------- */
  await go(desk.page, `${base}/parts/${jobId}`);
  const oldRow = rowOf(desk.page, "E2E TRANSMISSION MOUNT").first();
  const chip = await text(oldRow.locator("[data-refused-chip]"));
  check(`C: the refused row is greyed with "Refused by … – reason" ("${chip}")`, /^Refused by .+ – Wrong supplier for this car$/.test(chip));
  check("C: the refused row never says To order", !/To order/.test(await text(oldRow.locator("[data-status-line]"))));
  await oldRow.scrollIntoViewIfNeeded().catch(() => {});
  await desk.page.screenshot({ path: shot("c1-refused-row.png") });
  await oldRow.locator("[data-replace-part]").click();
  const repl = await until(async () => (await sql("select id from public.part_items where replaced_part_id = $1 and is_active", [mount.id]))[0]);
  check("C: Replace adds a new row tied to the refused one", !!repl);
  await go(desk.page, `${base}/parts/${jobId}`);
  const newRow = desk.page.locator("[data-row-key]").filter({ has: desk.page.locator("[data-replaces-chip]") }).first();
  const replChip = await text(newRow.locator("[data-replaces-chip]"));
  check(`C: the new row says what it replaces ("${replChip}")`, /^Replaces the refused line \(E2e Wrong Supplier\)$/i.test(replChip));
  // A line number in the part number box is refused with words.
  const pn = newRow.locator("input[aria-label='Part number']");
  await pn.fill("13");
  const notSaved = await text(newRow.locator("[data-row-tag]"));
  check(`C: typing shows "Not saved yet" until the save goes ("${notSaved}")`, notSaved === "Not saved yet");
  await pn.blur();
  const lineTag = await until(async () => { const t = await text(newRow.locator("[data-row-tag]")); return /line number/.test(t) ? t : null; }, 30);
  check(`C: "13" is refused as a line number ("${lineTag}")`, !!lineTag);
  await pn.fill("E2E-TM-RIGHT");
  await newRow.locator("select[aria-label='Supplier']").selectOption({ label: /right supplier/i }).catch(async () => { const opts = await newRow.locator("select[aria-label='Supplier'] option").allTextContents(); const pick = opts.find((o) => /right supplier/i.test(o)); if (pick) await newRow.locator("select[aria-label='Supplier']").selectOption({ label: pick }); });
  await newRow.locator("input[aria-label='Cost before VAT']").fill("1180");
  await newRow.locator("select[aria-label='Availability']").selectOption("d3");
  await desk.page.locator("body").click({ position: { x: 5, y: 5 } });
  const joined = await until(async () => (await sql("select order_status, po_id from public.part_items where id = $1 and po_id is not null", [repl.id]))[0], 60);
  check("C: once priced it is To order and on the LPO that waits", joined?.order_status === "to_order" && joined?.po_id === lpo.id);
  const lpoC = (await sql("select status, total_cost_aed::float as total, supplier_name from public.purchase_orders where id = $1", [lpo.id]))[0];
  check(`C: the LPO total moved (AED ${lpoC?.total}, ${lpoC?.supplier_name})`, lpoC?.status === "pending_approval" && Math.abs(lpoC.total - 1380) < 0.01 && lpoC.supplier_name === "2 suppliers");
  const addNote = (await sql("select title, body from public.notifications where staff_id = $1 and title = $2 order by created_at desc limit 1", [owner.id, `1 part added to ${lpo.number}`]))[0];
  check(`C: the owner hears "1 part added to ${lpo.number}"`, !!addNote && /E2E TRANSMISSION MOUNT/i.test(addNote.body ?? ""));
  const pnLine = (await sql("select part_number from public.purchase_order_lines where po_id = $1 and part_item_id = $2 and is_active", [lpo.id, repl.id]))[0];
  check(`C: the LPO line carries the real part number (${pnLine?.part_number})`, pnLine?.part_number === "E2E-TM-RIGHT");
  await go(own.page, `${base}/parts/orders/${lpo.id}`);
  const groups = await own.page.locator("[data-lpo-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-lpo-group")));
  check(`C: the LPO shows a section per supplier (${groups.join(" / ")})`, groups.length === 2 && groups.some((g) => /right supplier/i.test(g ?? "")));
  await own.page.screenshot({ path: shot("c2-lpo-with-added-supplier.png"), fullPage: true });

  /* ---------- D. Approved LPO: a part added later gets its own approval request ---------- */
  await own.page.locator("button[name='decision'][value='approve']").first().click();
  await until(async () => (await sql("select 1 from public.purchase_orders where id = $1 and status = 'approved'", [lpo.id]))[0]);
  // A part to order that was marked not needed before it was ordered, then replaced.
  const extra = (await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, order_status, not_needed_at, not_needed_by, not_needed_reason, created_by, updated_by) values ($1, 'E2E ENGINE BOLT', 'E2E-BOLT-1', 2, 2, 15, 'E2E SUPPLIER A', 'to_order', 'confirmed', 'genuine', 'to_order', now(), $2, 'Wrong size', $2, $2) returning id", [jobId, partsUser.id]))[0];
  await go(desk.page, `${base}/parts/${jobId}`);
  await rowOf(desk.page, "E2E ENGINE BOLT").first().locator("[data-replace-part]").click();
  const repl2 = await until(async () => (await sql("select id from public.part_items where replaced_part_id = $1 and is_active", [extra.id]))[0]);
  await go(desk.page, `${base}/parts/${jobId}`);
  const row2 = desk.page.locator("[data-row-key]").filter({ has: desk.page.locator("[data-replaces-chip]", { hasText: /not needed/i }) }).first();
  await row2.locator("input[aria-label='Part number']").fill("E2E-BOLT-2");
  const opts2 = await row2.locator("select[aria-label='Supplier'] option").allTextContents();
  await row2.locator("select[aria-label='Supplier']").selectOption({ label: opts2.find((o) => /supplier a/i.test(o)) });
  await row2.locator("input[aria-label='Cost before VAT']").fill("16");
  await row2.locator("select[aria-label='Availability']").selectOption("d1");
  await desk.page.locator("body").click({ position: { x: 5, y: 5 } });
  const lpo2 = await until(async () => (await sql("select po.id, po.number, po.status from public.purchase_orders po join public.purchase_order_lines l on l.po_id = po.id where po.job_id = $1 and po.kind = 'main' and po.status = 'pending_approval' and l.part_item_id = $2", [jobId, repl2.id]))[0], 60);
  check(`D: the LPO was approved, so the added part gets a NEW approval request (${lpo2?.number})`, !!lpo2 && lpo2.id !== lpo.id);
  await go(own.page, `${base}/dashboard`);
  const w2 = await text(own.page.locator(`[data-waiting-job="lpo:${lpo2?.id}"]`));
  check("D: the new request is on the owner's Waiting on you", w2.includes(lpo2?.number ?? "??"));
  await own.page.screenshot({ path: shot("d1-owner-waiting-new-lpo.png") });
  const listHtml = await (await fetch(`${base}/parts/orders`, { headers: { cookie: (await own.context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).text();
  check("D: the LPO list shows the new request", listHtml.includes(lpo2?.number ?? "??"));

  /* ---------- E. Send for approval names an unfinished line ---------- */
  cleanupDb();
  await api("/api/e2e/stage", { stage: "approved" });
  await sql("update public.part_items set supplier = 'E2E SUPPLIER A' where job_id = $1 and description ilike 'front brake pads'", [jobId]);
  await sql("update public.part_requests set status = 'unavailable' where job_id = $1 and status in ('open', 'listed')", [jobId]);
  await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, confirm_status, order_status, created_by, updated_by) values ($1, 'E2E HALF PRICED PART', 1, 1, 'confirmed', 'none', $2, $2)", [jobId, partsUser.id]);
  await go(desk.page, `${base}/parts/${jobId}`);
  const warn = await text(desk.page.locator("[data-lpo-unfinished]"));
  check(`E: the button names the unfinished line ("${warn}")`, /^1 line not finished: E2E HALF PRICED PART$/i.test(warn));
  await desk.page.locator("[data-send-lpo]").click();
  await desk.page.locator("[data-lpo-unfinished-ask]").waitFor({ timeout: 10000 }).catch(() => {});
  await desk.page.screenshot({ path: shot("e1-send-warns-unfinished.png") });
  check("E: pressing it asks first", await desk.page.locator("[data-lpo-unfinished-ask]").isVisible());
  await desk.page.locator("[data-lpo-unfinished-back]").click();

  /* ---------- F. Intake manifold on the tablet and in Add a part ---------- */
  cleanupDb();
  const ins = (await api("/api/e2e/stage", { stage: "inspection" })).json;
  await sql("update public.inspections set scan_read_at = now() where id = $1", [ins.inspectionId]);
  const techB = await open(ins.technicianId ?? tech.id, 800, 1280);
  await go(techB.page, `${base}/my-jobs/${ins.jobId}`);
  const hint = techB.page.locator("[data-item-hint='engine_bay.intake_manifold']");
  await hint.first().scrollIntoViewIfNeeded().catch(() => {});
  check(`F: the tablet shows Intake manifold with its hint ("${await text(hint)}")`, (await text(hint)) === "cracks, leaks, gasket, flaps / runner actuator");
  const order = await techB.page.locator("[id^='item-engine_bay.']").evaluateAll((els) => els.map((e) => e.id.replace("item-engine_bay.", "")));
  check(`F: it sits right after Valve cover`, order.indexOf("intake_manifold") === order.indexOf("valve_cover") + 1 && order.includes("valve_cover"));
  await techB.page.screenshot({ path: shot("f1-tablet-intake-manifold.png") });
  await go(desk.page, `${base}/parts/${ins.jobId}`);
  await desk.page.locator("[data-add-part]").click();
  await desk.page.locator("[data-part-picker] input[aria-label='Find a part']").fill("intake");
  await sleep(600);
  const pickerText = (await desk.page.locator("[data-part-picker]").textContent()) ?? "";
  check("F: Add a part offers Intake manifold and Intake manifold gasket", /Intake manifold gasket/i.test(pickerText) && /Intake manifold(?! gasket)/i.test(pickerText));
  await desk.page.screenshot({ path: shot("f2-add-a-part-intake.png") });
} finally {
  for (const b of browsers) await b.browser?.close?.().catch(() => {});
  cleanupDb();
}
summary();
