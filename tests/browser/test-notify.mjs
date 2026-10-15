// One car through the whole path, checking that the right person is told at every hand-over:
// job card approved → assign → road test → inspection submitted → report approved → parts priced →
// quotation sent and approved → planning → parts handover → work finished → work confirmed → QC →
// wash → proforma → payment and tax invoice → gate-out. Run against `npx next dev -p 3100`:
//   node --env-file=.env.local tests/browser/test-notify.mjs
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, freeTech, go, makeChecks, setPin, settle, sleep, sql, submitted } from "./pw-lib.mjs";

/** Ticks a technician; one already on a car asks "Assign anyway?" first (depends on the live workshop). */
async function tickTech(page, box) {
  if (await box.isChecked()) return;
  await box.click({ force: true });
  await new Promise((r) => setTimeout(r, 250));
  const yes = page.getByRole("button", { name: "Yes, assign" });
  if (await yes.count()) { await yes.first().click(); await new Promise((r) => setTimeout(r, 250)); }
  if (!(await box.isChecked())) await box.check({ force: true });
}

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
cleanupDb();

/** Notifications written since a mark, with who got them. */
const mark = async () => Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0]?.m ?? 0);
const since = async (m, jobId) => sql("select n.type, n.title, s.display_name as who, s.role_id as role, s.id as staff_id from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and (n.job_id = $2 or n.job_id is null) order by n.id", [m, jobId]);
/** The step's hand-over: every listed person (by role or id) must have been told. */
async function told(step, m, jobId, wants) {
  const rows = await since(m, jobId);
  const got = rows.map((r) => `${r.type}→${r.who}`).join(", ") || "nobody";
  for (const w of wants) {
    const ok = rows.some((r) => (w.role ? r.role === w.role : true) && (w.id ? r.staff_id === w.id : true) && (w.type ? r.type === w.type : true));
    check(`${step}: ${w.label} told`, ok, got);
  }
  return rows;
}

let jobId = null;
try {
  // People
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  jobId = seed.json?.jobId;
  if (!jobId) throw new Error("seed failed: " + JSON.stringify(seed));
  const job = (await sql("select gated_in_by, department, customer_id from public.jobs where id = $1", [jobId]))[0];
  const advisorId = job.gated_in_by;
  const techId = await freeTech(null, "mechanical");
  await setPin(techId, "1234");
  const qc = (await sql("select id from public.staff where role_id = 'qc_inspector' and is_active order by display_name limit 1"))[0]?.id;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by display_name limit 1"))[0]?.id;
  const accountsId = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by display_name limit 1"))[0]?.id;
  // Back to the moment before the customer approves the job card, with a sent approval link.
  await sql("update public.jobs set status = 'pending_approval', stage = 'gate_in', first_approval_at = null, assigned_to = null, assigned_at = null where id = $1", [jobId]);
  await sql("delete from public.job_technicians where job_id = $1", [jobId]);
  const token = "e2enotify" + Date.now();
  await sql("insert into public.approval_requests (job_id, kind, token, sent_to_name, sent_to_phone, sent_by, terms_text, status, created_by) values ($1, 'job_card', $2, 'Stage Customer', '+971500000003', $3, 'terms', 'sent', $3)", [jobId, token, advisorId]);

  // 1. The customer approves the job card.
  let m = await mark();
  const fd = new URLSearchParams({ approver_name: "Stage Customer", agree: "on" });
  const r1 = await fetch(`${base}/api/approve/${token}`, { method: "POST", body: fd, redirect: "manual" });
  check("job card approval accepted", r1.status === 303 && !/error=/.test(r1.headers.get("location") ?? ""), `${r1.status} ${r1.headers.get("location")}`);
  await told("1 job card approved", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "workshop_manager", id: MANAGER_MECH, label: "the workshop manager" }]);

  // 2. The manager assigns a technician with a road test.
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/assign`);
    const box = page.locator(`input[name=technician][value='${techId}']`).first();
    const values = await page.locator("input[name=technician]").evaluateAll((els) => els.map((e) => e.getAttribute("value")));
    check("assign page lists the free technician", (await box.count()) === 1, `tech ${techId} · boxes ${values.join(",")} · ${page.url()}`);
    await tickTech(page, box);
    await page.locator("label:has(input[name=road_test][value=needed])").first().click();
    await page.getByRole("button", { name: "Assign" }).first().click();
    await submitted(page);
    await browser.close();
  }
  await told("2 assigned with a road test", m, jobId, [{ id: techId, label: "the technician" }, { role: "qc_inspector", label: "the QC inspector" }]);
  check("car waits in its own step, Pending road test (C2)", (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status === "pending_road_test");

  // 3. The QC inspector does the road test.
  m = await mark();
  {
    const { browser, page } = await browserForId(qc);
    await go(page, `${base}/road-tests/${jobId}`);
    const goods = page.getByRole("button", { name: /^Good$/i });
    for (let i = 0; i < (await goods.count()); i++) await goods.nth(i).click();
    await page.getByRole("button", { name: /Save road test/ }).click();
    await submitted(page);
    await browser.close();
  }
  await told("3 road test done", m, jobId, [{ id: techId, label: "the technician" }]);
  check("road test done: the car is back in Pending inspection (C2)", (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status === "pending_inspection");

  // 4. The technician fills the report and submits it with one tap.
  m = await mark();
  {
    const { browser, page } = await browserForId(techId, { viewport: { width: 820, height: 1180 }, touch: true });
    // The scan report is step one: the technician reads it, then Start inspection opens.
    const insp = (await sql("select id from public.inspections where job_id = $1 order by created_at desc limit 1", [jobId]))[0];
    check("inspection row exists after assignment", !!insp?.id);
    if (!insp?.id) throw new Error("no inspection: the walk cannot continue");
    const cookie = await cookieHeader(techId);
    const save = (body) => api("/api/inspection/save", { inspectionId: insp.id, ...body }, cookie);
    const scanRes = await save({ inspection: { scan_read: true } });
    check("scan report marked as read (A4 of the overnight list)", scanRes.status === 200, JSON.stringify(scanRes.json ?? scanRes.text).slice(0, 120));
    await go(page, `${base}/my-jobs/${jobId}`);
    const start = page.getByRole("button", { name: "Start inspection" });
    check("Start inspection is open once the scan is read", (await start.count()) === 1 && !(await start.isDisabled()));
    if (await start.count()) { await start.click(); await submitted(page); }
    const sections = await sql("select distinct section_key from public.inspection_items where inspection_id = $1", [insp.id]);
    for (const s of sections) await save({ sectionAllGood: s.section_key });
    const firstItem = (await sql("select item_key from public.inspection_items where inspection_id = $1 order by position limit 1", [insp.id]))[0];
    await save({ item: { key: firstItem.item_key, status: "bad", remarks: "Worn out, replace" } });
    // The technician picks the part from the pool under the finding (E1); the list is saved whole.
    const pool = (await sql("select id from public.part_catalogue where name ilike 'brake pads' limit 1"))[0];
    await save({ partsList: [{ id: "e2e-part-1", catalogue_id: pool?.id ?? null, name: "Brake pads", qty: 1, positions: ["Front"], item_key: firstItem.item_key, source: "item", note: null }] });
    const ms = { tyre_size_front: "275/40 R20", tyre_size_rear: "305/35 R20", pad_front: "8", pad_rear: "7", battery_voltage: "12.6", battery_health: "good", vent_temp: "7" };
    for (const p of ["fl", "fr", "rl", "rr"]) Object.assign(ms, { [`tyre_${p}_tread`]: "6", [`tyre_${p}_year`]: "2024", [`tyre_${p}_cond`]: "good", [`tyre_${p}_action`]: "none", [`tyre_${p}_brand`]: "Michelin" });
    await save({ measurements: ms });
    await save({ inspection: { estimated_hours: 2 } });
    await go(page, `${base}/my-jobs/${jobId}`);
    const submit = page.getByRole("button", { name: "Submit to workshop manager" });
    check("Submit button present", (await submit.count()) === 1, (await page.textContent("body") ?? "").match(/\d+ (still to do|to fix)/)?.[0] ?? "");
    await submit.click();
    const quick = await page.getByRole("button", { name: "Submitting…" }).count();
    check("one tap: the button says Submitting… at once (A5)", quick === 1 || /submitted=/.test(page.url()));
    await page.waitForURL((u) => /submitted=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    await settle(page);
    const st = (await sql("select status from public.inspections where id = $1", [insp.id]))[0];
    check("report submitted with one tap (A5)", st?.status === "submitted", `${st?.status} · ${page.url().slice(-60)} · ${(await page.textContent("body") ?? "").match(/Cannot finish[^.]*\.|[^.]*to fix[^.]*\./)?.[0] ?? ""}`);
    await browser.close();
  }
  await told("4 report submitted", m, jobId, [{ role: "workshop_manager", id: MANAGER_MECH, label: "the workshop manager" }]);

  // 5. The manager approves the report.
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}/inspection`);
    // B2: the tick under the parts list comes first (it saves on its own), then the one-tap note, then the bar.
    const plc = page.getByRole("button", { name: /I have checked the parts list|I confirm no parts are needed/ }).first();
    check("the parts list waits for the manager's tick (E3, B2)", (await plc.count()) === 1, (await page.textContent("body") ?? "").match(/.{0,40}parts list.{0,40}/)?.[0] ?? "");
    if (await plc.count()) { await plc.click(); await sleep(3000); }
    const preset = page.getByRole("button", { name: /^Report checked and accurate/ }).first();
    if (await preset.count()) await preset.click(); else await page.locator("textarea[name=manager_note]").fill("Checked, agreed.");
    check("one-tap note fills the manager's note (D7, B1)", /Report checked|Checked, agreed/.test(await page.locator("textarea[name=manager_note]").inputValue()));
    const hours = page.locator("input[name=estimated_hours_manager]");
    if (await hours.count()) await hours.fill("2");
    await page.getByRole("button", { name: "Approve and send to the advisor" }).click();
    await submitted(page);
    await browser.close();
  }
  await told("5 report approved", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "parts", label: "Parts" }]);
  {
    const pr = await sql("select label, positions, quantity from public.part_requests where job_id = $1 and is_active", [jobId]);
    check("the confirmed list made one price request with its position (E4)", pr.some((r) => /brake pads/i.test(r.label) && (r.positions ?? []).includes("Front")), JSON.stringify(pr));
  }

  // 6. Parts price the request.
  m = await mark();
  {
    const { browser, page } = await browserForId(partsId);
    await go(page, `${base}/parts/${jobId}`);
    // D2: one table, every row saves itself as Parts type.
    const cost = page.locator("input[aria-label='Cost before VAT']").first();
    check("parts desk shows the request as one row to fill (E5, D2)", (await cost.count()) >= 1, (await page.textContent("body") ?? "").slice(0, 120));
    const bodyParts = await page.textContent("body");
    check("no findings on the Parts page (E8)", !/Worn out, replace|Technician wrote/.test(bodyParts ?? ""));
    check("the request's position is on the row (E4)", /Front/.test(bodyParts ?? ""));
    await page.locator("input[aria-label='Part number']").first().fill("BP-100");
    await cost.fill("200");
    // The supplier comes from the list (item 3 of 12 Oct); availability is in words.
    const supplierName = (await sql("select name from public.suppliers where is_active order by name limit 1"))[0]?.name ?? "e2e Supplier";
    const supSel = page.locator("select[aria-label='Supplier']").first();
    const supVal = await supSel.locator("option").evaluateAll((os, name) => (os.find((o) => (o.textContent ?? "").startsWith(name)) ?? {}).value ?? "", supplierName);
    check("supplier list on the row has the supplier (12 Oct, 3)", !!supVal, supplierName);
    if (supVal) await supSel.selectOption(supVal);
    await page.locator("select[aria-label='Availability']").first().selectOption("in_stock");
    await sleep(3500);
    const pi = await sql("select id, cost_aed, availability from public.part_items where job_id = $1", [jobId]);
    check("part priced in stock", pi.length >= 1 && Number(pi[0].cost_aed) === 200, JSON.stringify(pi));
    await browser.close();
  }
  await told("6 parts priced", m, jobId, [{ id: advisorId, label: "the advisor" }]);

  // 7. The advisor builds the quotation (a service line through the save route), completes and sends it.
  m = await mark();
  let quotationId = null;
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    await page.getByRole("button", { name: "Start quotation" }).click();
    await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 25000 }).catch(() => null);
    quotationId = (page.url().match(/\/quote\/([0-9a-f-]{36})/) ?? [])[1];
    check("quotation started", !!quotationId, page.url().slice(-80));
    const lines0 = await sql("select line_type, title from public.quotation_lines where quotation_id = $1 and is_active and fee_kind is null order by position", [quotationId]);
    check("no labour pre-filled from the report; the part line is there (main rule)", !lines0.some((l) => l.line_type === "labour") && lines0.some((l) => l.line_type === "part"), JSON.stringify(lines0));
    const svc = (await sql("select id from public.services where is_active and price_aed is not null order by position limit 1"))[0] ?? (await sql("select id from public.services where is_active order by position limit 1"))[0];
    await api("/api/quote/save", { quotationId, addLine: { service_id: svc.id } }, await cookieHeader(advisorId));
    // The part belongs under the job it is for (the service line), as the advisor would do with the row's job picker.
    await sql("update public.quotation_lines set markup_confirmed = true, parent_line_id = (select id from public.quotation_lines where quotation_id = $1 and line_type in ('labour', 'package') and is_active order by position limit 1) where quotation_id = $1 and line_type = 'part'", [quotationId]);
    await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
    const body0 = await page.textContent("body");
    check("editor shows no ratings or findings (main rule)", !/BAD|AVG|not quoted|Request:/.test(body0 ?? ""), (body0 ?? "").match(/BAD|AVG|not quoted|Request:/)?.[0] ?? "");
    const complete = page.getByRole("button", { name: /complete$/ });
    if (await complete.count()) {
      await complete.click();
      // The markup reminder (every part still at the minimum markup): Continue anyway, as an advisor would when the price is right.
      for (let i = 0; i < 12; i++) { if (await page.locator("[data-markup-ask]").count()) { await page.locator("[data-markup-continue]").click(); break; } await sleep(500); }
      await sleep(3500);
    }
    await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
    const sendBtn = page.getByRole("button", { name: /^Send (the )?quotation|^Send to the customer|^Send$/ }).first();
    check("Send button after Complete", (await sendBtn.count()) >= 1, (await page.textContent("body") ?? "").match(/Finish the quotation[^.]*\./)?.[0] ?? "");
    if (await sendBtn.count()) {
      await sendBtn.click();
      // The send action takes a second or two: wait for the rounding choice or the message window instead of a fixed pause.
      await page.getByRole("button", { name: /^AED |Copy/ }).first().waitFor({ timeout: 20000 }).catch(() => null);
      const round = page.getByRole("button", { name: /^AED .*down/ }).first();
      if (await round.count()) await round.click();
      const copy = page.getByRole("button", { name: /Copy/ }).first();
      await copy.waitFor({ timeout: 20000 }).catch(() => null);
      if (await copy.count()) { await copy.click(); await sleep(2500); }
    }
    const q = (await sql("select status, token from public.quotations where id = $1", [quotationId]))[0];
    check("quotation sent to the customer", ["sent", "opened"].includes(q?.status) && !!q?.token, JSON.stringify(q));
    await browser.close();
    // 8. The customer approves.
    m = await mark();
    const fd2 = new URLSearchParams({ action: "approve", approver_name: "Stage Customer", agree: "on" });
    const r8 = await fetch(`${base}/api/quote/${q.token}`, { method: "POST", body: fd2, redirect: "manual" });
    check("customer approval accepted", r8.status === 303 && !/error=/.test(r8.headers.get("location") ?? ""), `${r8.status} ${r8.headers.get("location")}`);
  }
  await told("8 quotation approved by the customer", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "parts", label: "Parts" }]);

  // 9. Planning: Parts send the LPO for approval when something is to order (the owner approves with one tap, Parts press
  // Ordered); parts all from stock finish the Parts step at approval. The mark from step 8 is kept: the manager's "Plan
  // the work" comes either at approval (stock) or at Ordered (LPO).
  {
    const { browser, page } = await browserForId(partsId);
    await go(page, `${base}/parts/${jobId}`);
    const send = page.locator("[data-send-lpo]");
    if (await send.count()) {
      await send.click();
      await submitted(page);
      const main = (await sql("select id from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' order by created_at desc limit 1", [jobId]))[0];
      check("9 LPO sent for approval", !!main);
      if (main) {
        const o = await browserFor("owner");
        await go(o.page, `${base}/parts/orders/${main.id}`);
        if (await o.page.locator("textarea[name='override_reason']").count()) await o.page.locator("textarea[name='override_reason']").fill("E2e test: deposit override");
        await o.page.getByRole("button", { name: "Approve", exact: true }).click();
        await submitted(o.page);
        await o.browser.close();
        await go(page, `${base}/parts/${jobId}`);
        while (await page.locator("[data-lpo-ordered]").count()) {
          const before = page.url();
          await page.locator("[data-lpo-ordered]").first().click();
          await page.waitForURL((u) => u.toString() !== before, { timeout: 25000 }).catch(() => null);
          await sleep(800);
        }
      }
    }
    await browser.close();
  }
  await told("9a parts step done (stock at approval, or LPO ordered)", m, jobId, [{ role: "workshop_manager", id: MANAGER_MECH, label: "the workshop manager" }]);
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}`);
    const box = page.locator(`input[name=technician][value='${techId}']`).first();
    if (await box.count()) await tickTech(page, box);
    const start = page.locator("input[name=start_date]");
    if ((await start.count()) && !(await start.inputValue())) await start.fill(new Date().toISOString().slice(0, 10));
    // Parts still on order: the manager starts with the available parts.
    const force = page.locator("input[name='force']");
    if (await force.count()) await force.check();
    await page.getByRole("button", { name: "Release to workshop" }).click();
    await submitted(page);
    await browser.close();
  }
  await told("9b released to the workshop", m, jobId, [{ id: advisorId, label: "the advisor" }, { id: techId, label: "the technician" }]);
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    const confirm = page.getByRole("button", { name: "Confirm the date" });
    if (await confirm.count()) { await confirm.click(); await submitted(page); }
    await browser.close();
  }
  const st9 = (await sql("select status from public.jobs where id = $1", [jobId]))[0];
  check("car is in Work after planning", st9?.status === "in_work", JSON.stringify(st9));

  // 10. Parts hand the part over; the technician confirms with his PIN.
  m = await mark();
  {
    const { browser, page } = await browserForId(partsId);
    await go(page, `${base}/parts/handover/${jobId}`);
    const boxes = page.locator("input[name=part]");
    for (let i = 0; i < (await boxes.count()); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
    await page.locator("select[name=technician]").selectOption(techId);
    await page.locator("button[type=submit]:has-text('Hand over')").click();
    await page.waitForURL((u) => /\/print\/stickers\//.test(u.toString()) || /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
    await browser.close();
  }
  await told("10a handover requested", m, jobId, [{ id: techId, label: "the technician" }]);
  m = await mark();
  {
    const { browser, page } = await browserForId(techId, { viewport: { width: 820, height: 1180 }, touch: true });
    await go(page, `${base}/my-jobs/${jobId}`);
    // 12 Oct, 9: "Parts for this car" under Start work: Receive parts, then the ticks and the PIN.
    const receive = page.getByRole("button", { name: "Receive parts" }).first();
    check("Receive parts under Start work (12 Oct, 9)", (await receive.count()) === 1, (await page.textContent("body") ?? "").match(/.{0,30}waiting for you.{0,20}/)?.[0] ?? "");
    if (await receive.count()) { await receive.click(); await sleep(400); }
    const pin = page.locator("input[aria-label=PIN]");
    if (await pin.count()) { await pin.fill("1234"); await page.getByRole("button", { name: "I received these parts" }).click(); await sleep(3500); }
    const ho = await sql("select status from public.part_handovers where job_id = $1 order by created_at desc limit 1", [jobId]);
    check("handover confirmed with the PIN", ho[0]?.status === "confirmed", JSON.stringify(ho));
    // 11. Work: Working, then Job finished.
    m = await mark();
    await go(page, `${base}/my-jobs/${jobId}`);
    const working = page.getByRole("button", { name: /^Start work$/ });
    if (await working.count()) { await working.first().click(); await sleep(2500); }
    await go(page, `${base}/my-jobs/${jobId}`);
    await page.getByRole("button", { name: "Job finished" }).first().click();
    await sleep(500);
    await page.getByRole("button", { name: "Yes" }).first().click();
    await sleep(3500);
    const wd = (await sql("select work_done_at from public.jobs where id = $1", [jobId]))[0];
    check("job finished by the technician", !!wd?.work_done_at, JSON.stringify(wd));
    await browser.close();
  }
  await told("11 job finished", m, jobId, [{ role: "workshop_manager", id: MANAGER_MECH, label: "the workshop manager" }]);

  // 12. The manager confirms: to QC.
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}/work`);
    const btn = page.getByRole("button", { name: "Confirmed, send to QC" });
    check("manager can confirm the work", (await btn.count()) === 1 && !(await btn.isDisabled()), (await page.textContent("body") ?? "").match(/Before QC[^.]*\.|still to do[^.]*\./)?.[0] ?? "");
    await btn.click();
    await submitted(page);
    await browser.close();
  }
  await told("12 work confirmed", m, jobId, [{ role: "qc_inspector", label: "the QC inspector" }]);

  // 13. QC passes.
  m = await mark();
  {
    const { browser, page } = await browserForId(qc);
    await go(page, `${base}/qc/${jobId}`);
    const passes = page.getByRole("button", { name: "PASS" });
    for (let i = 0; i < (await passes.count()); i++) await passes.nth(i).click();
    await page.locator("input[name=mileage]").fill("42010");
    await page.locator("textarea[name=postscan_waived_reason]").fill("Test run, no scanner");
    await page.getByRole("button", { name: /Finish: pass/ }).click();
    await submitted(page);
    await browser.close();
  }
  await told("13 QC passed", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "owner", label: "the owner" }]);

  // 14. Wash: sent, done, Ready; the proforma prepares itself.
  m = await mark();
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    await page.getByRole("button", { name: "Send to wash" }).click();
    await submitted(page);
    await page.getByRole("button", { name: "Wash done" }).click();
    await submitted(page);
    const inv = await sql("select kind, number from public.invoices where job_id = $1 and is_active order by created_at", [jobId]);
    check("proforma prepared at Ready", inv.some((i) => i.kind === "proforma"), JSON.stringify(inv));
    await browser.close();
  }
  await told("14 ready with the proforma", m, jobId, [{ id: advisorId, label: "the advisor" }]);

  // 15. Payment in full: the tax invoice is generated.
  m = await mark();
  {
    const { browser, page } = await browserForId(accountsId);
    await go(page, `${base}/jobs/${jobId}/invoice`);
    const full = page.getByRole("button", { name: "Full amount" }).first();
    if (await full.count()) await full.click();
    await page.getByRole("button", { name: /^Record/ }).first().click();
    await submitted(page);
    const inv = await sql("select kind, number from public.invoices where job_id = $1 and is_active order by created_at", [jobId]);
    check("tax invoice generated at zero balance", inv.some((i) => i.kind === "tax_invoice"), JSON.stringify(inv));
    await browser.close();
  }
  await told("15 paid, tax invoice", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "accounts", label: "accounts" }]);

  // 16. Gate-out.
  m = await mark();
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}/gate-out`);
    await page.locator("input[name=collector_name]").fill("Stage Customer");
    await page.locator("input[name=handover_confirmed]").first().check();
    await page.getByRole("button", { name: "Gate out and close the job" }).click();
    await submitted(page);
    const j = (await sql("select is_open, status from public.jobs where id = $1", [jobId]))[0];
    check("job closed at gate-out", j?.is_open === false, JSON.stringify(j));
    await browser.close();
  }
  await told("16 gated out", m, jobId, [{ role: "owner", label: "the owner" }]);
} catch (e) {
  check("walk: no crash", false, e.message.slice(0, 300));
}
const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
