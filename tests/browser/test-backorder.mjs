// 13 November 2026 (URGENT, J-00317): BACK ORDER - FIT ON A LATER VISIT. A car with one part on a 60-day order: the
// manager puts it on back order and splits the shared labour line; work is confirmed, QC passes, the wash, the invoice
// covers only the work done (one clear "ON ORDER" line), payment, gate-out. The follow-up job carries the part, the moved
// hours and the customer's approval; the two jobs together equal the approved total. The part is received: the advisor
// is told to book the customer, and the follow-up job opens at gate-in instead of a new job. TEST only.
//   node --env-file=.env.test.local tests/browser/test-backorder.mjs
import fs from "node:fs";
import path from "node:path";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, go, makeChecks, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-back-order";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click()).catch(() => null);
const CLUSTER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQCJ9dvEAAAAAElFTkSuQmCC", "base64");
const LT = "ENGINE MOUNT AND TRANSMISSION MOUNT REMOVAL AND REPLACEMENT";
const day = (n) => new Date(Date.now() + 4 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());

try {
  cleanupDb();
  // A. The car: approved quotation = 4.0 h shared labour (AED 300/h) + the transmission mount (AED 300); total AED 1,575.00.
  const q1 = (await api("/api/e2e/stage", { stage: "quote", labourTitle: LT })).json;
  const JOB = q1.jobId, QID = q1.quotationId;
  await sql("update public.quotation_lines set hours = 4 where quotation_id = $1 and line_type = 'labour'", [QID]);
  await sql("update public.quotation_lines set title = 'TRANSMISSION MOUNT' where quotation_id = $1 and line_type = 'part'", [QID]);
  await api("/api/e2e/stage", { stage: "approved", labourTitle: LT });
  const PA = (await sql("select part_item_id from public.quotation_lines where quotation_id = $1 and line_type = 'part'", [QID]))[0].part_item_id;
  const approved = (await sql("select status, total_aed::float as total from public.quotations where id = $1", [QID]))[0];
  check("A0: the customer approved AED 1,575.00 (4.0 h labour + the mount)", approved?.status === "approved" && Math.abs(approved.total - 1575) < 0.005, JSON.stringify(approved));
  // The mount is a 60-day special order, already ordered; the rest of the work is done.
  await sql("update public.part_items set description = 'TRANSMISSION MOUNT', order_status = 'ordered', expected_date = $2::date, delivery_date = $2::date where id = $1", [PA, day(56)]);
  await sql("update public.jobs set status = 'in_work', stage = 'work', stage_entered_at = now() where id = $1", [JOB]);
  await api("/api/e2e/stage", { stage: "worklines", id: JOB });
  await sql("delete from public.part_requests where job_id = $1 and status = 'open'", [JOB]).catch(() => null);
  await sql("update public.part_requests set status = 'closed' where job_id = $1 and status = 'open'", [JOB]);
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [JOB]))[0].gated_in_by;

  // B. The Work complete box lists the part not handed over: the manager puts it on back order and splits the labour.
  const m = await browserForId(MANAGER_MECH, { viewport: { width: 1440, height: 1100 } });
  await go(m.page, `${base}/jobs/${JOB}/work`);
  check("B1: Work complete is blocked by the part not handed over", /1 part not handed to the technician/.test(await text(m.page, "[data-work-blockers]")));
  const box = m.page.locator(`[data-back-order-part="${PA}"]`);
  check("B2: the part is listed with both choices (still coming / back order)", (await box.count()) === 1 && (await box.locator('[data-back-order-choice="coming"]').count()) === 1);
  check("B3: it shows whether the supplier is paid", /Supplier|nothing paid/i.test(await text(m.page, `[data-back-order-part="${PA}"] [data-supplier-paid]`)));
  await box.locator('[data-back-order-choice="later"]').click();
  await box.locator("[data-back-order-reason]").pressSequentially("60-day special order, the car cannot wait");
  check("B4: the shared labour line is suggested for the split", (await box.locator("[data-back-order-labour]").inputValue()) !== "");
  await box.locator("[data-back-order-hours]").pressSequentially("1.5");
  await sleep(300);
  check("B5: the split shows 2.5 h done now, 1.5 h later", /Done now: 2\.5 h.*later: 1\.5 h/.test(await text(m.page, `[data-back-order-part="${PA}"] [data-back-order-split]`)));
  await box.screenshot({ path: path.join(OUT, "b-back-order-box-1440.png") });
  await m.page.setViewportSize({ width: 800, height: 1280 });
  await sleep(400);
  await m.page.screenshot({ path: path.join(OUT, "b-back-order-box-800.png") });
  await m.page.setViewportSize({ width: 1440, height: 1100 });
  await box.locator("[data-back-order-save]").click();
  const bo = await until(async () => (await sql("select id, status, follow_job_id, follow_quotation_id, moved_total_aed::float as moved, labour_hours_moved::float as hours from public.back_orders where part_item_id = $1 and status = 'active' and follow_job_id is not null", [PA]))[0]);
  check("B6: the back order is active with its follow-up job", !!bo, JSON.stringify(bo));
  const FJ = bo?.follow_job_id;
  const fj = (await sql("select job_number, status, is_open, continues_job_id from public.jobs where id = $1", [FJ]))[0];
  const orig = (await sql("select job_number from public.jobs where id = $1", [JOB]))[0];
  check("B7: the follow-up job is 'Waiting for part - car not here' (booked, not open) and continues this job", fj?.status === "booked" && fj?.is_open === false && fj?.continues_job_id === JOB, JSON.stringify(fj));
  const fq = (await sql("select status, rounded_total_aed::float as total from public.quotations where id = $1", [bo?.follow_quotation_id]))[0];
  const fLines = await sql("select line_type, hours::float as hours, part_item_id from public.quotation_lines where quotation_id = $1 and is_active and line_type in ('part','labour') order by line_type", [bo?.follow_quotation_id]);
  check("B8: it carries the customer's approval (approved copy, no second approval) for AED 787.50", fq?.status === "approved" && Math.abs(fq.total - 787.5) < 0.005, JSON.stringify(fq));
  check("B9: it carries the part and the 1.5 h of fitting labour", fLines.some((l) => l.line_type === "part" && l.part_item_id === PA) && fLines.some((l) => l.line_type === "labour" && l.hours === 1.5), JSON.stringify(fLines));
  check("B10: the part (with its LPO) moved to the follow-up job", (await sql("select job_id from public.part_items where id = $1", [PA]))[0]?.job_id === FJ);
  const wl = (await sql("select hours_quoted::float as h from public.work_lines where job_id = $1 and is_active and title = $2", [JOB, LT]))[0];
  check("B11: this visit's time budget keeps only the 2.5 h done now", wl?.h === 2.5, JSON.stringify(wl));
  const appt = (await sql("select starts_at from public.appointments where job_id = $1 and kind = 'car_drop' and is_active", [FJ]))[0];
  check("B12: the follow-up shows in the calendar on the expected day", !!appt && String(appt.starts_at).slice(0, 10) <= day(56));
  await go(m.page, `${base}/jobs/${JOB}/work`);
  check("B13: Work complete is no longer blocked", (await m.page.locator("[data-work-blockers]").count()) === 0);
  await m.page.getByRole("button", { name: /Confirmed, send to QC|Send to QC anyway/ }).click();
  await submitted(m.page);
  check("B14: confirmed: the car goes to QC", (await sql("select status from public.jobs where id = $1", [JOB]))[0]?.status === "pending_qc");
  await m.browser.close();

  // C. QC passes, the wash, Ready: the proforma covers only the work done.
  const qc = (await sql("select id from public.staff where role_id = 'qc_inspector' and is_active limit 1"))[0]?.id;
  {
    const { browser, page } = await browserForId(qc);
    await go(page, `${base}/qc/${JOB}`);
    const passes = page.getByRole("button", { name: "PASS" });
    for (let i = 0; i < (await passes.count()); i++) await passes.nth(i).click();
    await page.locator("input[name=mileage]").fill("42010");
    const waive = page.locator("textarea[name=postscan_waived_reason]");
    if (await waive.count()) await waive.fill("Back-order test, no scanner");
    await page.getByRole("button", { name: /Finish: pass/ }).click();
    await submitted(page);
    await browser.close();
  }
  check("C1: QC passed", (await sql("select status from public.jobs where id = $1", [JOB]))[0]?.status === "pending_wash");
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${JOB}`);
    check("C2: the job card shows the back order and its follow-up job", (await page.locator(`[data-back-order="${bo?.id}"] [data-back-order-follow]`).count()) === 1);
    await page.locator("[data-back-orders-card]").screenshot({ path: path.join(OUT, "c-job-card-back-order-1440.png") });
    await page.getByRole("button", { name: "Send to wash" }).click();
    await sleep(600);
    const free = page.getByRole("button", { name: /free|Yes/i }).first();
    if (await free.count()) await free.click();
    await submitted(page);
    await page.getByRole("button", { name: "Wash done" }).click();
    await submitted(page);
    await browser.close();
  }
  const pro = await until(async () => (await sql("select id, token, total_aed::float as total from public.invoices where job_id = $1 and kind = 'proforma' and is_active and deposit_for_quotation_id is null", [JOB]))[0]);
  check("C3: the proforma is AED 787.50: only the work done", Math.abs((pro?.total ?? 0) - 787.5) < 0.005, JSON.stringify(pro));
  const proLines = await sql("select description, quantity::float as q, part_item_id from public.invoice_lines where invoice_id = $1", [pro?.id]);
  check("C4: no part line for the mount; the labour line reads 2.5 h", !proLines.some((l) => l.part_item_id === PA) && proLines.some((l) => l.q === 2.5), JSON.stringify(proLines));
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
    await go(page, `${base}/proforma/${pro?.token}`);
    const line = await text(page, "[data-on-order]");
    check("C5: the customer's document carries the one ON ORDER line (no part number, cost or supplier)", /^TRANSMISSION MOUNT ON ORDER - TO BE FITTED ON ARRIVAL \(EXPECTED \d{2} [A-Z]{3} \d{4}\)$/.test(line), line);
    await page.screenshot({ path: path.join(OUT, "c-customer-proforma-1440.png"), fullPage: true });
    const pdf = await page.request.get(`${base}/api/pdf/invoice/${pro?.token}`);
    const buf = Buffer.from(await pdf.body());
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    let all = "";
    for (let i = 0; i < doc.countPages(); i++) all += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
    check("C6: the PDF carries the ON ORDER line too", /TRANSMISSION MOUNT ON ORDER - TO BE FITTED ON ARRIVAL/.test(all.replace(/\s+/g, " ")));
    check("C7: the PDF shows no supplier or part number for the mount", !/pad-stage-1|PAD-STAGE-1/i.test(all));
    await browser.close();
  }

  // D. Paid in full, tax invoice, gate-out.
  {
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1300 } });
    await go(page, `${base}/jobs/${JOB}/invoice`);
    const folded = page.locator("[data-record-block][data-folded] summary");
    if (await folded.count()) await folded.click();
    const chip = page.locator('[data-method="cash"], [data-pay-method="cash"]').first();
    if (await chip.count()) await chip.click();
    const full = page.locator("[data-amount-full]").first();
    if (await full.count()) await full.click();
    await page.locator("[data-record-payment]").first().click();
    const yes = page.locator("[data-confirm-yes]");
    if (await yes.count()) await yes.click();
    await submitted(page);
    await browser.close();
  }
  const tax = await until(async () => (await sql("select number, total_aed::float as total from public.invoices where job_id = $1 and kind = 'tax_invoice' and is_active and deposit_for_quotation_id is null", [JOB]))[0], 30);
  check("D1: paid in full: the tax invoice is AED 787.50", Math.abs((tax?.total ?? 0) - 787.5) < 0.005, JSON.stringify(tax));
  check("D2: the customer's total across both jobs equals the approved total (AED 1,575.00)", Math.abs((tax?.total ?? 0) + (fq?.total ?? 0) - 1575) < 0.005, `${tax?.total} + ${fq?.total}`);
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${JOB}/gate-out`);
    await page.locator("input[name=collector_name]").fill("E2e Customer");
    await page.locator("input[name=keys_ok]").check();
    if (await page.locator("input[name=keychain_ok]").count()) await page.locator("input[name=keychain_ok]").check();
    if (await page.locator("[data-mileage-out]").count()) {
      const giKm = (await sql("select mileage from public.gate_ins where job_id = $1 order by created_at desc limit 1", [JOB]))[0]?.mileage;
      await page.locator("[data-mileage-out]").fill(String((Number(giKm) || 42010) + 5));
      await page.locator("[data-final-mileage] input[type=file]").first().setInputFiles({ name: "cluster.png", mimeType: "image/png", buffer: CLUSTER_PNG });
      await until(async () => (await sql("select id from public.job_files where job_id = $1 and kind = 'odometer_out' and removed_at is null", [JOB]))[0], 40, 500);
    }
    await page.locator("input[name=handover_confirmed]").first().check();
    await page.getByRole("button", { name: /Gate out and close the job|Release free of charge/ }).first().click();
    await submitted(page);
    await browser.close();
  }
  check("D3: gated out: this visit is closed", (await sql("select is_open from public.jobs where id = $1", [JOB]))[0]?.is_open === false);

  // E. The Back orders list (owner, advisor, parts desk) and the customer's advance on the follow-up job.
  const dep = (await sql("select id, number, total_aed::float as total from public.invoices where job_id = $1 and kind = 'proforma' and deposit_for_quotation_id is not null and is_active", [FJ]))[0];
  check("E1: 'Customer pays for the part now': an advance of AED 787.50 waits on the follow-up job", Math.abs((dep?.total ?? 0) - 787.5) < 0.005, JSON.stringify(dep));
  // The customer pays the advance now: accounts record it on the follow-up job's money page (the car is not here).
  {
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1300 } });
    await go(page, `${base}/jobs/${FJ}/invoice`);
    const folded = page.locator("[data-record-block][data-folded] summary");
    if (await folded.count()) await folded.click();
    const chip = page.locator('[data-method="cash"], [data-pay-method="cash"]').first();
    if (await chip.count()) await chip.click();
    const full = page.locator("[data-amount-full]").first();
    if (await full.count()) await full.click();
    const amount = page.locator('input[name="amount"]').first();
    if (await amount.count() && !(await amount.inputValue())) await amount.fill("787.50");
    await page.locator("[data-record-payment]").first().click();
    const yes = page.locator("[data-confirm-yes]");
    if (await yes.count()) await yes.click();
    await submitted(page);
    await browser.close();
  }
  const advPaid = await until(async () => (await sql("select coalesce(sum(amount_aed), 0)::float as paid from public.payments where job_id = $1 and is_active and status = 'recorded'", [FJ]))[0]?.paid >= 787.5, 30);
  check("E1b: accounts record the customer's advance (AED 787.50) on the follow-up job", !!advPaid);
  for (const [role, w] of [["owner", 1440], ["service_advisor", 1440], ["parts", 800]]) {
    const { browser, page } = await browserFor(role, { viewport: { width: w, height: 1100 } });
    await go(page, `${base}/dashboard`);
    const row = page.locator(`[data-back-order-row="${bo?.id}"]`);
    check(`E2: the Back orders list on the ${role} dashboard shows the car, part, expected date and paid yes/no`, (await row.count()) === 1 && /TRANSMISSION MOUNT/.test(await text(page, `[data-back-order-row="${bo?.id}"]`)) && (await row.locator("[data-back-order-expected]").count()) === 1 && (await row.locator("[data-back-order-paid]").count()) === 1);
    check(`E3: on the ${role} dashboard it reads "Paid by customer: yes" once the advance is in`, (await row.locator('[data-back-order-paid="yes"]').count()) === 1);
    if (role !== "service_advisor") await page.locator("[data-back-orders-list]").screenshot({ path: path.join(OUT, `e-back-orders-${role}-${w}.png`) });
    await browser.close();
  }

  // F. The parts desk receives the part: the advisor is told to book the customer, with a draft message.
  {
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 1100 } });
    await go(page, `${base}/parts/${FJ}`);
    await page.locator("[data-mark-received]").first().click();
    await page.locator("[data-no-stickers]").first().click();
    await sleep(2500);
    await browser.close();
  }
  const arrived = await until(async () => (await sql("select status from public.back_orders where id = $1 and status = 'arrived'", [bo?.id]))[0], 40);
  check("F1: received: the back order reads 'Part arrived - book the customer'", !!arrived);
  const bell = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and type = 'back_order' and title like 'Back-order part arrived%'", [advisorId]))[0], 30);
  check("F2: the advisor gets 'Back-order part arrived - book the customer'", !!bell, JSON.stringify(bell));
  {
    const { browser, page } = await browserForId(advisorId, { viewport: { width: 1440, height: 1100 } });
    await go(page, `${base}/jobs/${FJ}`);
    check("F3: the follow-up job card says it continues the first job", new RegExp(orig.job_number).test(await text(page, "[data-continues]")));
    check("F4: the draft message for the customer is ready (WhatsApp / Copy)", /has arrived at OFJ Automotive/.test(await text(page, "[data-arrived-message]")));
    await page.locator("[data-back-orders-card]").screenshot({ path: path.join(OUT, "f-follow-up-arrived-1440.png") });
    await browser.close();
  }

  // G. The car comes back: the gate-in opens the follow-up job instead of a new one.
  const veh = (await sql("select vehicle_id from public.jobs where id = $1", [JOB]))[0].vehicle_id;
  {
    const { browser, page } = await browserFor("gate_in", { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/gate-in/new?vehicle=${veh}`);
    for (const [n2, v2] of [["arrived_by", "customer_drove"], ["condition", "runs_drives"], ["fuel_level", "half"], ["cleanliness", "clean"], ["dash_cam", "no"], ["major_damage", "no"], ["keys_count", "1"], ["keys_keychain", "no"], ["old_parts_return", "no"], ["department", "mechanical"]]) await pick(page, n2, v2);
    const addr = page.locator('textarea[name="location_address"]');
    if (await addr.count()) await addr.fill("E2e back order address");
    await page.locator('input[name="mileage_display"]').pressSequentially("42100");
    await page.keyboard.press("Tab");
    const req = page.locator('input[name="requests"]:visible').first();
    if (await req.count()) await req.pressSequentially("Fit the transmission mount (back order)");
    await sleep(400);
    await page.getByText("Save and continue to photos and video").click();
    await page.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    await page.screenshot({ path: path.join(OUT, "g-gate-in-opens-follow-up-800.png") });
    await browser.close();
  }
  const opened = (await sql("select id, status, is_open, inspection_fee_choice from public.jobs where vehicle_id = $1 and is_open", [veh]));
  check("G1: the gate-in opened the follow-up job itself (no new job, no inspection fee)", opened.length === 1 && opened[0].id === FJ && opened[0].inspection_fee_choice === "none", JSON.stringify(opened));
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
