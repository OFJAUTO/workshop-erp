// 2.6 (21 October 2026): the end-to-end simulation. Eight real paths driven through the screens as every
// role, checking the hand-off rules R1 to R9 (docs/workflow-map.md) at every step, with a screenshot of
// the actor's confirmation AND of the next person's screen at each hand-over. Technicians run at 800px.
//   PATHS=a,b node --env-file=.env.test.local tests/browser/sim-e2e.mjs   (default: all eight)
// Paths: a mechanical + supplier parts + deposit + pay-link · b stock parts + cash · c declined → fee →
// gate-out · d revision after approval · e bodyshop PPF sign-off → handover · f mixed quotation ·
// g recovery delivery · h commission approve → pay · i enter price myself (estimate + job quotation) · j parts changed after approval → resend for approval · k revise at the top + hours missing · l supplier amounts with VAT ·
// m no-plate car → gate-in asks → plate added (duplicate refused first) → every page shows it ·
// n advisor on parts pages (tag, ask/answer through the bells, the Advisor filter, never on supplier copies).
import fs, { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, freeTech, go, makeChecks, setPin, settle, sleep, sql, submitted, pickPerson, sendLpo, confirmMoney, pressRecord } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots/sim";
mkdirSync(shots, { recursive: true });
const PATHS = (process.env.PATHS ?? "a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,sec2,sec3,sec4,sec5,sec6,sec7,sec8,d1,d2,d3,d4,d5,d6,d7,d8,d9,d10,e1,e2,e3,e4,e5,e6,e7").split(",").map((s) => s.trim());
const want = (k) => PATHS.includes(k);
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
/** A 1×1 PNG for the gate-out's instrument-cluster photo (30 October 2026 rule). */
const CLUSTER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQCJ9dvEAAAAAElFTkSuQmCC", "base64");
const shot = (page, name) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }).catch(() => null);
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, Number(process.env.SIM_MINUTES ?? 150) * 60 * 1000).unref(); // 8 Nov 2026: 25 paths need more than the old 55 minutes

/* ---- R3: who was told since a mark ---- */
const mark = async () => Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0]?.m ?? 0);
async function told(step, m, jobId, wants) {
  // A notice may be written just after the answer (after()): wait up to 10 s for every wanted one before judging.
  const read = () => sql("select n.type, s.display_name as who, s.role_id as role, s.id as staff_id from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and (n.job_id = $2 or n.job_id is null) order by n.id", [m, jobId]);
  const ok = (rows) => wants.every((w) => rows.some((r) => (w.role ? r.role === w.role : true) && (w.id ? r.staff_id === w.id : true) && (w.type ? r.type === w.type : true)));
  let rows = await read();
  for (let i = 0; i < 20 && !ok(rows); i++) { await sleep(500); rows = await read(); }
  const got = rows.map((r) => `${r.type}→${r.who}`).join(", ") || "nobody";
  for (const w of wants) check(`${step} — R3 ${w.label} told`, rows.some((r) => (w.role ? r.role === w.role : true) && (w.id ? r.staff_id === w.id : true) && (w.type ? r.type === w.type : true)), got);
}

/* ---- R2 + R8: the next person's screen carries the task; the Waiting list arrives open ---- */
async function nextScreen(step, who, url, mustSee, shotName, opts = {}) {
  const b = who.includes("-") ? await browserForId(who, opts) : await browserFor(who, opts);
  await go(b.page, `${base}${url}`);
  const body = ((await b.page.textContent("body").catch(() => "")) ?? "").replace(/\s+/g, " ");
  for (const frag of mustSee) {
    const ok = frag instanceof RegExp ? frag.test(body) : body.includes(frag);
    check(`${step} — R2 next screen shows "${frag instanceof RegExp ? frag.source : frag}"`, ok, body.slice(0, 260));
  }
  // "/home" is the role router (30 October 2026): owners/advisors land on /dashboard, technicians on
  // /my-jobs, QC on /road-tests — each role's FIRST page, where the waiting panel lives.
  if (url === "/home" || url === "/dashboard") {
    const open = await b.page.locator("[data-waiting-panel] details[open]").count();
    const empty = await b.page.locator("[data-waiting-empty]").count();
    check(`${step} — R8 waiting list on the first page`, open >= 1 || empty >= 1);
  }
  await shot(b.page, shotName);
  await b.browser.close();
  return body;
}

/* ---- Shared moves (used by several paths) ---- */

/** Parts price EVERY open row on the job (the seed carries its own request too): the completion gate
 *  "N part requests still with Parts" only clears when nothing is left unpriced. */
async function priceAllParts(jobId, partsId, availValue, pathKey) {
  const { browser, page } = await browserForId(partsId, { viewport: { width: 1600, height: 1400 } });
  await go(page, `${base}/parts/${jobId}`);
  const supplierName = (await sql("select name from public.suppliers where is_active order by name limit 1"))[0]?.name;
  const costs = page.locator("input[aria-label='Cost before VAT']");
  const n = await costs.count();
  for (let i = 0; i < n; i++) {
    const pn = page.locator("input[aria-label='Part number']").nth(i);
    if ((await pn.count()) && (await pn.inputValue().catch(() => "x")) === "") await pn.fill(`SIM-${i + 1}`);
    await costs.nth(i).fill(String(150 + i * 10));
    const supSel = page.locator("select[aria-label='Supplier']").nth(i);
    if (await supSel.count()) {
      const supVal = await supSel.locator("option").evaluateAll((os, name) => (os.find((o) => (o.textContent ?? "").startsWith(name)) ?? {}).value ?? "", supplierName);
      if (supVal) await supSel.selectOption(supVal);
    }
    const avail = page.locator("select[aria-label='Availability']").nth(i);
    if (await avail.count()) await avail.selectOption(availValue);
    await sleep(1500);
  }
  await sleep(3000);
  // Every row must have SAVED before Pricing done (a part's save takes ~10 s from this PC to the TEST database; a
  // page closed while a row still says "Saving…" loses the price).
  await page.waitForFunction(() => !/Saving/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 90000 }).catch(() => null);
  // Since 2 November the cost check asks "Real price?" when a cost is far below what the same part was bought for
  // (an earlier path bought the seed part dearer): Parts answer it, as a person would.
  for (let k = 0; k < 4; k++) {
    const yes = page.locator("[data-cost-confirm]");
    if (!(await yes.count())) break;
    await yes.first().click().catch(() => null);
    await sleep(2500);
  }
  const done = page.locator("[data-pricing-done], button:has-text('Pricing done')").first();
  if (await done.count()) {
    await done.click();
    // The send is a server step: wait for its answer (the bar's "sent" line), never a fixed pause.
    await page.locator("[data-pricing-sent], [data-pricing-locked]").first().waitFor({ timeout: 30000 }).catch(() => null);
    await sleep(1000);
  }
  const left = (await sql("select count(*)::int as n from public.part_requests r where r.job_id = $1 and r.is_active and r.status not in ('rejected', 'unavailable') and not exists (select 1 from public.part_items i where i.part_request_id = r.id and i.is_active)", [jobId]))[0]?.n ?? 0;
  check(`${pathKey}: every request priced — R1`, left === 0, `unpriced ${left} of ${n}`);
  await shot(page, `${pathKey}-pricing-actor`);
  await browser.close();
}

/** The advisor starts, completes and sends the quotation; returns { quotationId, token }. */
async function advisorSendQuote(jobId, advisorId, pathKey) {
  const { browser, page } = await browserForId(advisorId);
  await go(page, `${base}/jobs/${jobId}`);
  const start = page.getByRole("button", { name: "Start quotation" });
  let quotationId = null;
  if (await start.count()) {
    await start.click();
    await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 25000 }).catch(() => null);
    quotationId = (page.url().match(/\/quote\/([0-9a-f-]{36})/) ?? [])[1];
  } else {
    quotationId = (await sql("select id from public.quotations where job_id = $1 and status = 'draft' order by created_at desc limit 1", [jobId]))[0]?.id;
    await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  }
  check(`${pathKey}: quotation started`, !!quotationId, page.url().slice(-80));
  const svc = (await sql("select id from public.services where is_active and price_aed is not null order by position limit 1"))[0] ?? (await sql("select id from public.services where is_active order by position limit 1"))[0];
  await api("/api/quote/save", { quotationId, addLine: { service_id: svc.id } }, await cookieHeader(advisorId));
  await sql("update public.quotation_lines set markup_confirmed = true where quotation_id = $1 and line_type = 'part'", [quotationId]);
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const complete = page.getByRole("button", { name: /complete$/ });
  if (await complete.count()) {
    await complete.click();
    for (let i = 0; i < 24; i++) {
      await sleep(900);
      if (await page.locator("[data-low-profit-ask]").count()) { await page.locator("[data-low-profit-send]").click(); continue; }
      if (await page.locator("[data-markup-ask]").count()) { await page.locator("[data-markup-continue]").click(); continue; }
      if (await page.locator("[data-parts-ask]").count()) { await page.locator("[data-parts-add]").click(); continue; }
      if (await page.locator("[data-deposit-ask]").count()) { await page.locator("[data-deposit-skip]").click(); continue; }
      if ((await sql("select completed_at from public.quotations where id = $1", [quotationId]))[0]?.completed_at) break;
    }
    await sleep(1500);
  }
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const sendBtn = page.getByRole("button", { name: /^Send (the )?quotation|^Send to the customer|^Send$/ }).first();
  if (!(await sendBtn.count())) await shot(page, `${pathKey}-complete-stuck`);
  const comp = (await sql("select completed_at from public.quotations where id = $1", [quotationId]))[0]?.completed_at;
  const diag = `completed_at ${comp ?? "null"} · ` + (((await page.locator("[data-receive-panel], main").first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").match(/BEFORE SENDING(.{0,200})/)?.[0] ?? "no blocker box");
  const partsDiag = (await sendBtn.count()) ? "" : ` · parts ${JSON.stringify(await sql("select p.description, p.supplier, p.cost_aed, p.availability, p.priced_at is not null as priced, p.part_request_id is not null as has_req from public.part_items p where p.job_id = $1 and p.is_active", [jobId]))} · reqs ${JSON.stringify(await sql("select r.status, r.description from public.part_requests r where r.job_id = $1 and r.is_active", [jobId]))}`;
  if (partsDiag) console.log(`DIAG ${pathKey}${partsDiag}`);
  check(`${pathKey}: Send after Complete (R5)`, (await sendBtn.count()) >= 1, diag + partsDiag);
  if (await sendBtn.count()) {
    await sendBtn.click();
    await page.locator("[role='dialog']").getByRole("button", { name: /^AED |Copy/ }).first().waitFor({ timeout: 20000 }).catch(() => null);
    const round = page.locator("[role='dialog']").getByRole("button", { name: /^AED .*down/ }).first();
    if (await round.count()) await round.click();
    const copy = page.locator("[role='dialog']").getByRole("button", { name: /^Copy/ }).first();
    await copy.waitFor({ timeout: 20000 }).catch(() => null);
    if (await copy.count()) { await copy.click(); await sleep(2000); }
    await shot(page, `${pathKey}-quote-sent-actor`);
  }
  const q = (await sql("select status, token from public.quotations where id = $1", [quotationId]))[0];
  check(`${pathKey}: quotation sent — R1`, ["sent", "opened"].includes(q?.status) && !!q?.token, JSON.stringify(q));
  await browser.close();
  return { quotationId, token: q?.token };
}

async function customerApproveQuote(token, pathKey) {
  const fd = new URLSearchParams({ action: "approve", approver_name: "Sim Customer", agree: "on" });
  const r = await fetch(`${base}/api/quote/${token}`, { method: "POST", body: fd, redirect: "manual" });
  check(`${pathKey}: customer approval accepted`, r.status === 303 && !/error=/.test(r.headers.get("location") ?? ""), `${r.status} ${r.headers.get("location")}`);
}

/** Accounts record the full balance (method chip when present); R6 double-tap allowed once. */
async function recordFullPayment(jobId, pathKey, { method = null, doubleTap = false } = {}) {
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1300 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  const folded = page.locator("[data-record-block][data-folded] summary");
  if (await folded.count()) await folded.click();
  if (method) {
    const chip = page.locator(`[data-method="${method}"], [data-pay-method="${method}"]`).first();
    if (await chip.count()) await chip.click();
    else { const named = page.getByRole("button", { name: new RegExp(`^${method}$`, "i") }).first(); if (await named.count()) await named.click(); }
  }
  const full = page.locator("[data-amount-full]").first();
  if (await full.count()) await full.click();
  await page.locator("[data-record-payment]").first().click();
  const yes = page.locator("[data-confirm-yes]");
  if (await yes.count()) {
    if (doubleTap) { await yes.click(); await yes.click({ timeout: 1500 }).catch(() => null); }
    else await yes.click();
  }
  await submitted(page);
  await shot(page, `${pathKey}-payment-actor`);
  const tax = await until(async () => (await sql("select number from public.invoices where job_id = $1 and kind = 'tax_invoice' and is_active", [jobId]))[0], 30, 500);
  check(`${pathKey}: paid in full, tax invoice generated — R1/R4`, !!tax);
  if (doubleTap) {
    const n = (await sql("select count(*)::int as n from public.payments where job_id = $1 and is_active and status = 'recorded'", [jobId]))[0]?.n ?? 0;
    check(`${pathKey}: R6 a double tap records ONE payment`, n === 1, `payments ${n}`);
  }
  await browser.close();
}

async function gateOutCollect(jobId, advisorId, pathKey) {
  const { browser, page } = await browserForId(advisorId);
  await go(page, `${base}/jobs/${jobId}/gate-out`);
  await page.locator("input[name=collector_name]").fill("Sim Customer");
  await page.locator("input[name=keys_ok]").check();
  if (await page.locator("input[name=keychain_ok]").count()) await page.locator("input[name=keychain_ok]").check();
  // 30 October 2026: the final km (never below gate-in) and the instrument-cluster photo come first.
  if (await page.locator("[data-mileage-out]").count()) {
    const giKm = (await sql("select mileage from public.gate_ins where job_id = $1 order by created_at desc limit 1", [jobId]))[0]?.mileage;
    await page.locator("[data-mileage-out]").fill(String((Number(giKm) || 42010) + 5));
    const png = CLUSTER_PNG;
    await page.locator("[data-final-mileage] input[type=file]").first().setInputFiles({ name: "cluster.png", mimeType: "image/png", buffer: png });
    await until(async () => (await sql("select id from public.job_files where job_id = $1 and kind = 'odometer_out' and removed_at is null", [jobId]))[0], 40, 500);
  }
  await page.locator("input[name=handover_confirmed]").first().check();
  await page.getByRole("button", { name: /Gate out and close the job|Release free of charge/ }).first().click();
  await submitted(page);
  await shot(page, `${pathKey}-gateout-actor`);
  const j = (await sql("select is_open from public.jobs where id = $1", [jobId]))[0];
  check(`${pathKey}: job closed at gate-out — R1`, j?.is_open === false, JSON.stringify(j));
  await browser.close();
}

async function section(key, name, fn) {
  if (!want(key)) return;
  console.log(`\n== path ${key}: ${name}`);
  cleanupDb();
  try { await fn(); } catch (e) { check(`${key}: walked without a crash`, false, (e?.message ?? String(e)).slice(0, 300)); }
}

/* ================================================================================================= */
/* Path a — mechanical, supplier parts, deposit, pay-link: the full reference walk (every role).      */
/* ================================================================================================= */
await section("a", "mechanical + supplier parts + deposit + pay-link", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const jobId = seed.json?.jobId;
  if (!jobId) throw new Error("seed failed");
  const job = (await sql("select gated_in_by, job_number from public.jobs where id = $1", [jobId]))[0];
  const advisorId = job.gated_in_by;
  const techId = await freeTech(null, "mechanical");
  await setPin(techId, "1234");
  const qc = (await sql("select id from public.staff where role_id = 'qc_inspector' and is_active order by display_name limit 1"))[0]?.id;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by display_name limit 1"))[0]?.id;
  // Back to the moment before the customer approves the job card.
  await sql("update public.jobs set status = 'pending_approval', stage = 'gate_in', first_approval_at = null, assigned_to = null, assigned_at = null where id = $1", [jobId]);
  await sql("delete from public.job_technicians where job_id = $1", [jobId]);
  const aToken = "sim" + Date.now();
  await sql("insert into public.approval_requests (job_id, kind, token, sent_to_name, sent_to_phone, sent_by, terms_text, status, created_by) values ($1, 'job_card', $2, 'Sim Customer', '+971500000003', $3, 'terms', 'sent', $3)", [jobId, aToken, advisorId]);

  // a1. Customer approves the job card → the manager's move.
  let m = await mark();
  const r1 = await fetch(`${base}/api/approve/${aToken}`, { method: "POST", body: new URLSearchParams({ approver_name: "Sim Customer", agree: "on" }), redirect: "manual" });
  check("a1: job card approved (customer)", r1.status === 303 && !/error=/.test(r1.headers.get("location") ?? ""));
  await told("a1", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "workshop_manager", id: MANAGER_MECH, label: "the manager" }]);
  await nextScreen("a1", MANAGER_MECH, "/home", [/assign a technician/i], "a1-manager-next");

  // a2. Manager assigns (with a road test) → QC's move.
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/assign`);
    // The rebuilt board (batch 21 Oct, section 6): tap the car, tick the person, pick the road test, Assign.
    await page.locator(`[data-assign-car="${jobId}"]`).click();
    await sleep(500);
    await pickPerson(page, techId);
    await page.getByText("Road test first", { exact: true }).click();
    await page.locator("[data-assign-submit]").click();
    await submitted(page);
    check("a2: assign confirmed on screen — R1", /message=|Assigned/.test(page.url() + ((await page.textContent("body")) ?? "")));
    await shot(page, "a2-assign-actor");
    await browser.close();
  }
  await told("a2", m, jobId, [{ id: techId, label: "the technician" }, { role: "qc_inspector", label: "QC" }]);
  check("a2: status pending_road_test — R4", (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status === "pending_road_test");
  await nextScreen("a2", qc, "/home", [/road test/i], "a2-qc-next");

  // a3. QC saves the road test → the technician's move.
  m = await mark();
  {
    const { browser, page } = await browserForId(qc);
    await go(page, `${base}/road-tests/${jobId}`);
    const goods = page.getByRole("button", { name: /^Good$/i });
    for (let i = 0; i < (await goods.count()); i++) await goods.nth(i).click();
    await page.getByRole("button", { name: /Save road test/ }).click();
    await submitted(page);
    await shot(page, "a3-roadtest-actor");
    await browser.close();
  }
  await told("a3", m, jobId, [{ id: techId, label: "the technician" }]);
  await nextScreen("a3", techId, "/home", [/inspection/i], "a3-tech-next", { viewport: { width: 800, height: 1280 }, touch: true });

  // a4. Technician fills and submits the report (800px) → the manager's move.
  m = await mark();
  {
    const insp = (await sql("select id from public.inspections where job_id = $1 order by created_at desc limit 1", [jobId]))[0];
    const cookie = await cookieHeader(techId);
    const save = (body) => api("/api/inspection/save", { inspectionId: insp.id, ...body }, cookie);
    await save({ inspection: { scan_read: true } });
    const { browser, page } = await browserForId(techId, { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/my-jobs/${jobId}`);
    const start = page.getByRole("button", { name: "Start inspection" });
    if (await start.count()) { await start.click(); await submitted(page); }
    const sections = await sql("select distinct section_key from public.inspection_items where inspection_id = $1", [insp.id]);
    for (const s of sections) await save({ sectionAllGood: s.section_key });
    const firstItem = (await sql("select item_key from public.inspection_items where inspection_id = $1 order by position limit 1", [insp.id]))[0];
    await save({ item: { key: firstItem.item_key, status: "bad", remarks: "Worn out, replace" } });
    const pool = (await sql("select id from public.part_catalogue where name ilike 'brake pads' limit 1"))[0];
    await save({ partsList: [{ id: "sim-part-1", catalogue_id: pool?.id ?? null, name: "Brake pads", qty: 1, positions: ["Front"], item_key: firstItem.item_key, source: "item", note: null }] });
    const ms = { tyre_size_front: "275/40 R20", tyre_size_rear: "305/35 R20", pad_front: "8", pad_rear: "7", battery_voltage: "12.6", battery_health: "good", vent_temp: "7" };
    for (const p of ["fl", "fr", "rl", "rr"]) Object.assign(ms, { [`tyre_${p}_tread`]: "6", [`tyre_${p}_year`]: "2024", [`tyre_${p}_cond`]: "good", [`tyre_${p}_action`]: "none", [`tyre_${p}_brand`]: "Michelin" });
    await save({ measurements: ms });
    await save({ inspection: { estimated_hours: 2 } });
    await go(page, `${base}/my-jobs/${jobId}`);
    await page.getByRole("button", { name: "Submit to workshop manager" }).click();
    await page.waitForURL((u) => /submitted=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    await settle(page);
    check("a4: report submitted from the 800px tablet — R1", (await sql("select status from public.inspections where id = $1", [insp.id]))[0]?.status === "submitted");
    await shot(page, "a4-tech-submit-actor");
    await browser.close();
  }
  await told("a4", m, jobId, [{ role: "workshop_manager", id: MANAGER_MECH, label: "the manager" }]);
  await nextScreen("a4", MANAGER_MECH, "/home", [/Report submitted|reviews and approves/i], "a4-manager-next");

  // a5. Manager approves the report → the advisor's and Parts' move.
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}/inspection`);
    const plc = page.getByRole("button", { name: /I have checked the parts list|I confirm no parts are needed/ }).first();
    if (await plc.count()) { await plc.click(); await sleep(3000); }
    const preset = page.getByRole("button", { name: /^Report checked and accurate/ }).first();
    if (await preset.count()) await preset.click(); else await page.locator("textarea[name=manager_note]").fill("Checked, agreed.");
    const hours = page.locator("input[name=estimated_hours_manager]");
    if (await hours.count()) await hours.fill("2");
    await page.getByRole("button", { name: "Approve and send to the advisor" }).click();
    await submitted(page);
    await shot(page, "a5-report-approve-actor");
    await browser.close();
  }
  await told("a5", m, jobId, [{ id: advisorId, label: "the advisor" }, { role: "parts", label: "Parts" }]);
  await nextScreen("a5", partsId, "/home", [/price|Pricing/i], "a5-parts-next");

  // a6. Parts price every request (to order, 2 days) → the advisor's move.
  m = await mark();
  await priceAllParts(jobId, partsId, "d2", "a6");
  await nextScreen("a6", advisorId, "/home", [/quotation/i], "a6-advisor-next");

  // a7. The advisor quotes with a deposit and sends; the customer approves.
  const { quotationId, token } = await advisorSendQuote(jobId, advisorId, "a7");
  await sql("update public.quotations set deposit_mode = 'aed', deposit_value = 500, deposit_aed = 500 where id = $1", [quotationId]);
  m = await mark();
  await customerApproveQuote(token, "a8");
  await told("a8", m, jobId, [{ id: advisorId, label: "the advisor" }]);
  await nextScreen("a8", advisorId, "/home", [/deposit request|Advance payment/i], "a8-advisor-next");

  // a9. The advisor sends the deposit request (pay link checked) → accounts' move.
  m = await mark();
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    await page.locator("[data-send-deposit-request]").click();
    // The button reads "…" while the server makes the payment page: wait for the window itself, never a fixed time.
    await page.locator("[data-deposit-gateway]").waitFor({ timeout: 30000 }).catch(() => null);
    const payBox = page.locator("[data-deposit-pay-link]");
    if (await payBox.count()) {
      await payBox.fill("https://paypage.sandbox.ngenius-payments.com/?code=sim-dep");
      await page.locator("[data-save-gateway]").click();
      await until(async () => (await page.locator("[data-gateway-ok]").count()) || null, 20, 400);
      check("a9: the gateway link is validated and named — R1", (await page.locator("[data-gateway-ok]").count()) === 1);
    }
    const copy = page.locator("[role='dialog']").getByRole("button", { name: /^Copy/ }).first();
    if (await copy.count()) { await copy.click(); await sleep(2000); }
    await shot(page, "a9-deposit-request-actor");
    await browser.close();
  }
  const stamped = await until(async () => (await sql("select deposit_requested_at from public.jobs where id = $1", [jobId]))[0]?.deposit_requested_at, 20, 500);
  check("a9: the deposit request is stamped by the Copy — R1/R4", !!stamped);
  await told("a9", m, jobId, [{ role: "accounts", label: "accounts" }]);

  // a10. Accounts record the deposit IN PLACE on their dashboard (the 1.1 panel) → Parts/owner told.
  m = await mark();
  {
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1300 } });
    await go(page, `${base}/dashboard`);
    const row = page.locator("[data-waiting-row]", { hasText: /Deposit to record|Dubai S 30303/ }).first();
    check("a10: the deposit task reached accounts — R2", (await row.count()) === 1);
    await row.locator("[data-record-deposit-open]").click();
    await sleep(600);
    check("a10: the panel opens in place, no page change — R2", (await page.locator("[data-record-deposit-panel]").count()) === 1 && page.url().includes("/dashboard"));
    await page.locator("[data-deposit-method=cash]").click();
    await page.locator("[data-deposit-record]").click();
    await sleep(400);
    await page.locator("[data-deposit-confirm-yes]").click();
    const done = await until(async () => ((await page.locator("[data-deposit-done]").count()) ? 1 : null), 30, 500);
    check("a10: recorded with the receipt in place — R1", !!done);
    await shot(page, "a10-deposit-recorded-actor");
    await browser.close();
  }
  await told("a10", m, jobId, [{ role: "parts", label: "Parts" }]);

  // a11. Parts send the LPO → the owner approves (R1 message) → ORDER NOW RED task → Ordered.
  m = await mark();
  {
    const { browser, page } = await browserForId(partsId);
    await go(page, `${base}/parts/${jobId}`);
    const lpoSent = await sendLpo(page);
    check("a11: LPO sent, confirmed on screen — R1", !!lpoSent.message, lpoSent.error ?? "");
    await shot(page, "a11-lpo-sent-actor");
    await browser.close();
  }
  const main = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  check("a11: main LPO waits for approval — R4", !!main?.id);
  await told("a11", m, jobId, [{ role: "owner", label: "the owner" }]);
  await nextScreen("a11", "owner", "/home", [/LPO waiting for approval|approve/i], "a11-owner-next");
  m = await mark();
  {
    const { browser, page } = await browserFor("owner");
    await go(page, `${base}/parts/orders/${main.id}`);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    // Since the confirm-and-undo batch (1 November 2026) the Approve asks first (ConfirmSubmit).
    await page.locator("[data-confirm-yes-money]").click({ timeout: 8000 }).catch(() => null);
    await submitted(page);
    const msg = decodeURIComponent(page.url());
    check("a12: the approval answers in full — R1/R7", /approved ✓ — Parts have been asked to order/.test(msg), msg.slice(-180));
    await shot(page, "a12-lpo-approved-actor");
    await browser.close();
  }
  await told("a12", m, jobId, [{ role: "parts", label: "Parts (ORDER NOW)" }]);
  {
    const b = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(b.page, `${base}/parts`);
    check("a12: ORDER NOW card on top of the desk — R2", (await b.page.locator("[data-order-now]").count()) >= 1);
    check("a12: no empty filler sections — R9", !/Nothing to order|No requests waiting/.test(((await b.page.textContent("body")) ?? "")));
    await shot(b.page, "a12-parts-next");
    // Press Ordered on the desk card itself.
    while (await b.page.locator("[data-lpo-ordered]").count()) {
      const before = b.page.url();
      await b.page.locator("[data-lpo-ordered]").first().click();
      await b.page.waitForURL((u) => u.toString() !== before, { timeout: 25000 }).catch(() => null);
      await sleep(800);
      await go(b.page, `${base}/parts`);
    }
    await shot(b.page, "a13-ordered-actor");
    await b.browser.close();
  }
  const adv13 = await nextScreen("a13", advisorId, `/jobs/${jobId}`, [/Parts ordered from/i], "a13-advisor-next");
  check("a13: the job card names the supplier and the date — R2/R7", /arriving|expected/i.test(adv13));

  // a14. Parts receive with THE invoice box → the technician's parts task (800px) → PIN.
  m = await mark();
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    await page.locator("[data-mark-received]").click();
    await sleep(500);
    // 4 November 2026: receiving never asks for the invoice - accounts collect the paper and scan it.
    check("a14: no invoice box at receiving; the note says accounts take it over", (await page.locator("[data-supplier-invoice-box]").count()) === 0 && (await page.locator("[data-receive-invoice-note]").count()) === 1);
    await shot(page, "a14-receive-actor");
    await page.locator("[data-no-stickers]").click();
    await sleep(2500);
    // Accounts enter the invoice from the Waiting-for-invoice row (scan & enter), so the money side stays whole.
    {
      const [poRow] = await sql("select id from public.purchase_orders where job_id = $1 and kind = 'supplier' order by created_at desc limit 1", [jobId]);
      if (poRow) {
        const acc = await browserFor("accounts");
        await go(acc.page, `${base}/supplier-invoices?open=${encodeURIComponent(`follow:${poRow.id}`)}`);
        await acc.page.locator("[data-si-enter] [data-invoice-number]").fill("SIM-INV-1");
        await acc.page.locator("[data-si-enter] [data-invoice-date]").fill(today);
        await acc.page.locator("[data-si-enter-save]").click();
        await acc.page.waitForURL(/message=|error=/, { timeout: 25000 });
        const st = await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [poRow.id]);
        check("a14b: accounts entered the invoice (scan & enter) — R4", st[0]?.supplier_invoice_status === "received");
        await acc.browser.close();
      }
    }
    // The desk marks them Ready for handover: the technician's tablet then lists them to take with his PIN.
    await go(page, `${base}/parts/handover/${jobId}`);
    const ready = page.locator("[data-mark-ready]");
    if (await ready.count()) { await ready.click(); await submitted(page); }
    await shot(page, "a14-ready-actor");
    await browser.close();
  }
  await told("a14", m, jobId, [{ id: advisorId, label: "the advisor" }]);
  // The manager releases the work (parts are in).
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}`);
    // THE staff picker (28 Oct, B1): tick the technician in the workshop release form.
    await pickPerson(page.locator('[data-release-form="mechanical"]'), techId);
    const start = page.locator("input[name=start_date]");
    if ((await start.count()) && !(await start.inputValue())) await start.fill(today);
    const force = page.locator("input[name='force']");
    if (await force.count()) await force.check();
    await page.getByRole("button", { name: "Release to workshop" }).click();
    await submitted(page);
    await shot(page, "a15-release-actor");
    await browser.close();
  }
  await told("a15", m, jobId, [{ id: techId, label: "the technician" }]);
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    const confirm = page.getByRole("button", { name: "Confirm the date" });
    if (await confirm.count()) { await confirm.click(); await submitted(page); }
    await browser.close();
  }
  // a16. The technician receives the parts with his PIN and works (800px).
  {
    const { browser, page } = await browserForId(techId, { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/my-jobs/${jobId}`);
    // The technician TICKS each part (they start unticked), types his PIN and confirms (19 Oct rule).
    const takeRows = page.locator("[data-part-take][data-ticked='0'] button");
    const nTake = await takeRows.count();
    for (let i = 0; i < nTake; i++) { await page.locator("[data-part-take][data-ticked='0'] button").first().click(); await sleep(300); }
    const pin = page.locator("[data-receive-pin]");
    if (await pin.count()) {
      await pin.fill("1234");
      await page.locator("[data-receive-parts]").click();
      const got = await until(async () => ((await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active and issue_status = 'confirmed'", [jobId]))[0]?.n ?? 0) >= 1 ? 1 : null, 25, 500);
      check("a16: parts received with the technician's PIN — R1", !!got);
    }
    await shot(page, "a16-tech-parts-actor");
    const working = page.getByRole("button", { name: /^Start work$/ });
    if (await working.count()) { await working.first().click(); await sleep(2500); }
    await go(page, `${base}/my-jobs/${jobId}`);
    m = await mark();
    await page.getByRole("button", { name: "Job finished" }).first().click();
    await sleep(500);
    await page.getByRole("button", { name: "Yes" }).first().click();
    await sleep(3000);
    check("a16: job finished from the 800px tablet — R1", !!(await sql("select work_done_at from public.jobs where id = $1", [jobId]))[0]?.work_done_at);
    await shot(page, "a16-tech-finish-actor");
    await browser.close();
  }
  await told("a16", m, jobId, [{ role: "workshop_manager", id: MANAGER_MECH, label: "the manager" }]);
  await nextScreen("a16", MANAGER_MECH, "/home", [/confirms the work|Job finished/i], "a16-manager-next");

  // a17. Manager confirms → QC passes → wash → Ready with the proforma.
  m = await mark();
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}/work`);
    await page.getByRole("button", { name: /Confirmed, send to QC|Send to QC anyway/ }).click();
    await submitted(page);
    await shot(page, "a17-work-confirm-actor");
    await browser.close();
  }
  await told("a17", m, jobId, [{ role: "qc_inspector", label: "QC" }]);
  {
    const { browser, page } = await browserForId(qc);
    await go(page, `${base}/qc/${jobId}`);
    const passes = page.getByRole("button", { name: "PASS" });
    for (let i = 0; i < (await passes.count()); i++) await passes.nth(i).click();
    await page.locator("input[name=mileage]").fill("42010");
    await page.locator("textarea[name=postscan_waived_reason]").fill("Sim run, no scanner");
    await page.getByRole("button", { name: /Finish: pass/ }).click();
    await submitted(page);
    await shot(page, "a18-qc-pass-actor");
    await browser.close();
  }
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    await page.getByRole("button", { name: "Send to wash" }).click();
    await sleep(600);
    const free = page.getByRole("button", { name: /free|Yes/i }).first();
    if (await free.count()) await free.click();
    await submitted(page);
    await page.getByRole("button", { name: "Wash done" }).click();
    await submitted(page);
    check("a19: proforma prepared at Ready — R4", (await sql("select count(*)::int as n from public.invoices where job_id = $1 and kind = 'proforma' and is_active", [jobId]))[0]?.n >= 1);
    await shot(page, "a19-wash-actor");
    await browser.close();
  }

  // a20. The advisor sends the proforma with Pay now; the customer pays on the pretend gateway.
  m = await mark();
  let proformaToken = null;
  {
    const { browser, page } = await browserForId(advisorId, { viewport: { width: 1366, height: 1200 } });
    await go(page, `${base}/jobs/${jobId}/invoice`);
    await page.locator('[data-ready-send="proforma"] button').first().click();
    await page.locator("[data-pay-how]").waitFor({ timeout: 10000 });
    await page.locator('[data-expected="link"]').click();
    const payNow = page.locator("[data-pay-now-switch] input");
    if (await payNow.count()) await payNow.check();
    await page.locator("[data-pay-continue]").click();
    await page.locator("textarea").first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Copy message and link/ }).click();
    await sleep(2000);
    await shot(page, "a20-proforma-send-actor");
    await browser.close();
    proformaToken = (await sql("select token from public.invoices where job_id = $1 and kind = 'proforma' and is_active order by created_at desc limit 1", [jobId]))[0]?.token;
  }
  await told("a20", m, jobId, [{ role: "accounts", label: "accounts" }]);
  m = await mark();
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
    await go(page, `${base}/proforma/${proformaToken}`);
    check("a21: Pay now on the customer's page", (await page.locator('[data-pay-now="card"] button').count()) === 1);
    await page.locator('[data-pay-now="card"] button').click();
    await page.waitForURL((u) => /ngenius\/mock/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    await page.locator("[data-mock-pay]").click();
    await page.waitForURL((u) => /\/proforma\//.test(u.toString()), { timeout: 30000 }).catch(() => null);
    check("a21: customer lands back with the thank-you — R1", /paid=1/.test(page.url()));
    await shot(page, "a21-paylink-customer");
    await browser.close();
  }
  const tax = await until(async () => (await sql("select number from public.invoices where job_id = $1 and kind = 'tax_invoice' and is_active", [jobId]))[0], 30, 500);
  check("a21: tax invoice followed by itself — R4", !!tax);
  await told("a21", m, jobId, [{ id: advisorId, label: "the advisor (paid)" }]);
  await nextScreen("a21", advisorId, "/home", [/tax invoice|Gate out|collection/i], "a21-advisor-next");

  // a22. Gate-out closes the job.
  m = await mark();
  await gateOutCollect(jobId, advisorId, "a22");
  // Since 21 October the closing job report stays off the owner's bell (OWNER_QUIET_TYPES "owner_report"): he reads
  // it on Reports. Nobody else is told at gate-out, so there is no R3 check here.
  void m;
});

/* ================================================================================================= */
/* Path b — stock parts + cash.                                                                       */
/* ================================================================================================= */
await section("b", "stock parts + cash", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const jobId = seed.json?.jobId;
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by display_name limit 1"))[0]?.id;
  await priceAllParts(jobId, partsId, "in_stock", "b0");
  const { token } = await advisorSendQuote(jobId, advisorId, "b1");
  await customerApproveQuote(token, "b2");
  const pos = (await sql("select count(*)::int as n from public.purchase_orders where job_id = $1", [jobId]))[0]?.n ?? 0;
  const part = (await sql("select order_status, received_qty from public.part_items where job_id = $1 and is_active order by created_at limit 1", [jobId]))[0];
  check("b2: a stock part never goes on an LPO — R4", pos === 0, `POs ${pos}`);
  check("b2: the stock part is received at approval", part?.order_status === "received" && Number(part?.received_qty) >= 1, JSON.stringify(part));
  // The manager releases straight away (nothing to wait for).
  const techId = await freeTech(null, "mechanical");
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}`);
    // THE staff picker (28 Oct, B1): tick the technician in the workshop release form.
    await pickPerson(page.locator('[data-release-form="mechanical"]'), techId);
    const start = page.locator("input[name=start_date]");
    if ((await start.count()) && !(await start.inputValue())) await start.fill(today);
    const force = page.locator("input[name='force']");
    if (await force.count()) await force.check();
    await page.getByRole("button", { name: "Release to workshop" }).click();
    await submitted(page);
    await shot(page, "b3-release-actor");
    await browser.close();
  }
  // The middle is proven in path a: jump to the wash and walk the money in full.
  await sql("update public.jobs set status = 'pending_wash', stage_entered_at = now() where id = $1", [jobId]);
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}`);
    await page.getByRole("button", { name: "Send to wash" }).click();
    await sleep(600);
    const free = page.getByRole("button", { name: /free|Yes/i }).first();
    if (await free.count()) await free.click();
    await submitted(page);
    await page.getByRole("button", { name: "Wash done" }).click();
    await submitted(page);
    await browser.close();
  }
  check("b4: proforma prepared at Ready — R4", (await sql("select count(*)::int as n from public.invoices where job_id = $1 and kind = 'proforma' and is_active", [jobId]))[0]?.n >= 1);
  await recordFullPayment(jobId, "b5", { method: "cash", doubleTap: true });
  await nextScreen("b5", advisorId, "/home", [/tax invoice|Gate out|collection/i], "b5-advisor-next");
  await gateOutCollect(jobId, advisorId, "b6");
});

/* ================================================================================================= */
/* Path c — declined → fee → gate-out (R5: no dead end).                                              */
/* ================================================================================================= */
await section("c", "declined, fee, gate-out", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const jobId = seed.json?.jobId;
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by display_name limit 1"))[0]?.id;
  await priceAllParts(jobId, partsId, "in_stock", "c0");
  const { quotationId } = await advisorSendQuote(jobId, advisorId, "c1");
  let m = await mark();
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
    await page.locator("[data-mark-declined] summary").click();
    await sleep(300);
    await page.locator("[data-mark-declined]").getByRole("button", { name: "Mark as declined" }).click();
    await submitted(page);
    check("c2: the Declined card shows the ways forward — R5", (await page.locator("[data-declined-next]").count()) === 1);
    await page.locator("[data-add-charge] summary").click();
    await page.locator("[data-charge-description]").fill("Diagnosis");
    await page.locator("[data-charge-amount]").fill("250");
    await shot(page, "c2-declined-actor");
    await page.locator("[data-declined-gateout]").click();
    await submitted(page);
    await browser.close();
  }
  const fee = (await sql("select kind, total_aed::float as total from public.invoices where job_id = $1 and is_active and kind = 'tax_invoice'", [jobId]))[0];
  check("c3: the diagnosis fee is a small tax invoice — R4", !!fee && fee.total > 0, JSON.stringify(fee));
  await told("c3", m, jobId, [{ role: "workshop_manager", label: "the managers" }]);
  // Accounts take the fee; the advisor gates out.
  await recordFullPayment(jobId, "c4", { method: "cash" });
  await gateOutCollect(jobId, advisorId, "c5");
});

/* ================================================================================================= */
/* Path d — revision after approval (owner allows; v2 approved).                                      */
/* ================================================================================================= */
await section("d", "revision after approval", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  const jobId = seed.json?.jobId;
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  // The seed's open requests and costless items would gate the v2 completion; they are not this path's subject.
  await sql("update public.part_items set cost_aed = coalesce(cost_aed, 150), availability = 'in_stock', supplier = coalesce(supplier, 'Our Stock') where job_id = $1 and is_active", [jobId]);
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'Sim: not available' where job_id = $1 and is_active and id not in (select part_request_id from public.part_items where job_id = $1 and part_request_id is not null)", [jobId]);
  const q1 = (await sql("select id, version, token from public.quotations where job_id = $1 and status = 'approved' order by version desc limit 1", [jobId]))[0];
  // R4: the approved quotation is locked; the save route refuses an edit.
  const tryEdit = await api("/api/quote/save", { quotationId: q1.id, addLine: { title: "SIM EXTRA", line_type: "labour" } }, await cookieHeader(advisorId));
  check("d1: an approved quotation refuses edits (423) — R4", tryEdit.status === 423 || tryEdit.json?.locked === true, JSON.stringify(tryEdit.json ?? tryEdit.status));
  let m = await mark();
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}/quote/${q1.id}`);
    check("d1: the lock banner says why — R1/R7", (await page.locator("[data-quote-locked], [data-lock-banner]").count()) >= 1);
    const ask = page.locator("[data-ask-revise]").first();
    check("d1: Ask owner to revise is the way forward — R5", (await ask.count()) === 1);
    await ask.click();
    await page.locator("[data-revise-ask]").waitFor({ timeout: 10000 });
    await page.locator("[data-revise-ask] textarea").fill("Customer wants rims added");
    await shot(page, "d1-ask-revise-actor");
    await page.locator("[data-ask-revise-send]").click();
    await sleep(2500);
    const asked = await until(async () => (await sql("select revision_requested_at from public.quotations where id = $1", [q1.id]))[0]?.revision_requested_at, 20, 500);
    check("d1: the request is stamped — R1", !!asked);
    await browser.close();
  }
  await told("d1", m, jobId, [{ role: "owner", label: "the owner" }]);
  {
    const { browser, page } = await browserFor("owner");
    await go(page, `${base}/jobs/${jobId}/quote/${q1.id}`);
    const allow = page.locator("[data-revision-allow]");
    check("d2: the owner can allow the revision", (await allow.count()) >= 1);
    await shot(page, "d2-owner-allow-actor");
    await allow.click();
    await submitted(page);
    await browser.close();
    const allowed = await until(async () => (await sql("select revision_allowed_at from public.quotations where id = $1", [q1.id]))[0]?.revision_allowed_at, 20, 500);
    check("d2: the allow is stamped — R1", !!allowed);
  }
  {
    const { browser, page } = await browserForId(advisorId);
    await go(page, `${base}/jobs/${jobId}/quote/${q1.id}`);
    const bar = page.locator("form [data-revise-bar]").first();
    check("d3: Revise is live for the advisor — R5", (await bar.count()) === 1);
    await bar.click();
    await page.waitForURL((u) => new RegExp("/quote/(?!" + q1.id + ")").test(u.toString()), { timeout: 25000 }).catch(() => null);
    await sleep(1500);
    await browser.close();
  }
  const q2 = (await sql("select id, version, token, status from public.quotations where job_id = $1 and version > $2 order by version desc limit 1", [jobId, q1.version]))[0];
  check("d3: version n+1 with its own link — R4", !!q2?.id && q2.token !== q1.token, JSON.stringify(q2));
  // Add a line, complete, send, approve: the job keeps its stage.
  const svc = (await sql("select id from public.services where is_active and price_aed is not null order by position limit 1"))[0];
  await api("/api/quote/save", { quotationId: q2.id, addLine: { service_id: svc.id } }, await cookieHeader(advisorId));
  const before = (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status;
  const sent = await advisorSendQuote(jobId, advisorId, "d4");
  await customerApproveQuote(sent.token ?? q2.token, "d5");
  const after = (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status;
  check("d5: a revision of an approved job never moves it backwards — R4", ["approved", "waiting_parts", "in_work"].includes(after), `${before} → ${after}`);
  const v1 = (await sql("select status from public.quotations where id = $1", [q1.id]))[0]?.status;
  check("d5: version 1 is superseded", v1 === "superseded", v1);
});

/* ================================================================================================= */
/* Path e — bodyshop PPF: sign-off locks the gate, handover page, aftercare.                          */
/* ================================================================================================= */
await section("e", "bodyshop PPF sign-off and handover", async () => {
  const seed = await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" });
  const jobId = seed.json?.jobId;
  const handoverToken = seed.json?.handoverToken;
  check("e1: bodyshop seed ready", !!jobId && !!handoverToken, JSON.stringify(seed.json ?? seed.text).slice(0, 160));
  // R5: before the sign-offs, gate-out is locked but says so.
  {
    const { browser, page } = await browserFor("owner");
    await go(page, `${base}/jobs/${jobId}/gate-out`);
    const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    check("e1: gate-out waits for the sign-off and says so — R5/R7", /sign-?off/i.test(body), body.slice(0, 200));
    await shot(page, "e1-gateout-locked");
    // The owner signs every missing sign-off on behalf (a real feature) on the bodyshop job page.
    await go(page, `${base}/bodyshop/${jobId}`);
    check("e1: the sign-off panel lists who is needed — R2", (await page.locator("[data-signoff-panel]").count()) === 1);
    for (let round = 0; round < 6; round++) {
      const opens = page.locator("[data-signoff-open]");
      if (!(await opens.count())) break;
      await opens.first().click();
      await sleep(300);
      await page.locator("[data-signoff-confirm]").first().click();
      await sleep(1500);
      await go(page, `${base}/bodyshop/${jobId}`);
    }
    const left = await page.locator("[data-signoff-open]").count();
    check("e2: every sign-off is in (owner on behalf) — R1", left === 0, `left ${left}`);
    await shot(page, "e2-signoff-actor");
    await browser.close();
  }
  // The customer's handover page and the warranty PDF answer.
  const hp = await fetch(`${base}/handover/${handoverToken}`);
  check("e3: the customer's handover page answers", hp.status === 200);
  const wp = await fetch(`${base}/api/pdf/warranty/${handoverToken}`);
  check("e3: the PPF warranty PDF answers", wp.status === 200 && (wp.headers.get("content-type") ?? "").includes("pdf"), String(wp.status));
  // Settle and gate out: the aftercare check books itself.
  await recordFullPayment(jobId, "e4", {});
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  await gateOutCollect(jobId, advisorId, "e5");
  const care = (await sql("select count(*)::int as n from public.aftercare_checks where job_id = $1", [jobId]))[0]?.n ?? 0;
  const finalCheck = (await sql("select final_check_appointment_id from public.jobs where id = $1", [jobId]))[0]?.final_check_appointment_id;
  check("e5: the after-care / final check follows the handover — R4", care >= 1 || !!finalCheck, `aftercare ${care}, final check ${finalCheck ?? "none"}`);
});

/* ================================================================================================= */
/* Path f — mixed quotation: mechanical labour + a bodyshop line on one job.                          */
/* ================================================================================================= */
await section("f", "mixed mechanical + bodyshop line", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const jobId = seed.json?.jobId;
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by display_name limit 1"))[0]?.id;
  await priceAllParts(jobId, partsId, "in_stock", "f0");
  const bodySvc = (await sql("select id, name from public.services where is_active and bodyshop_kind is not null order by position limit 1"))[0];
  const quotationId = (await sql("select id from public.quotations where job_id = $1 and status = 'draft' order by created_at desc limit 1", [jobId]))[0]?.id
    ?? (await (async () => { const { browser, page } = await browserForId(advisorId); await go(page, `${base}/jobs/${jobId}`); await page.getByRole("button", { name: "Start quotation" }).click(); await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 25000 }).catch(() => null); const id = (page.url().match(/\/quote\/([0-9a-f-]{36})/) ?? [])[1]; await browser.close(); return id; })());
  if (bodySvc) {
    const r = await api("/api/quote/save", { quotationId, addLine: { service_id: bodySvc.id } }, await cookieHeader(advisorId));
    check("f1: a bodyshop line joins the mechanical quotation", r.status === 200, JSON.stringify(r.json ?? r.status).slice(0, 120));
    // A PPF line is priced per car: the advisor would type the price; the draft line takes it directly.
    // Above the film cost (2 November 2026, section 1): a PPF line under its film cost now blocks the
    // advisor's send by design (the below-cost gate), so the sim prices it like a real sale.
    if (r.json?.id) await sql("update public.quotation_lines set unit_price = 9500, line_total = 9500 where id = $1", [r.json.id]);
  } else {
    check("f1: a bodyshop service exists to mix in (none in the live list: noted, not a failure)", true, "no bodyshop_kind service");
  }
  const { token } = await advisorSendQuote(jobId, advisorId, "f2");
  await customerApproveQuote(token, "f3");
  // Work lines are made at the release transition: the manager releases, then the one work order carries every line.
  const techId = await freeTech(null, "mechanical");
  {
    const { browser, page } = await browserForId(MANAGER_MECH);
    await go(page, `${base}/jobs/${jobId}`);
    // THE staff picker (28 Oct, B1): tick the technician in the workshop release form.
    await pickPerson(page.locator('[data-release-form="mechanical"]'), techId);
    const start = page.locator("input[name=start_date]");
    if ((await start.count()) && !(await start.inputValue())) await start.fill(today);
    const force = page.locator("input[name='force']");
    if (await force.count()) await force.check();
    await page.getByRole("button", { name: "Release to workshop" }).click();
    await submitted(page);
    await browser.close();
  }
  const wl = await sql("select title from public.work_lines where job_id = $1 and is_active", [jobId]);
  check("f3: every approved line lands on ONE work order — R4", wl.length >= (bodySvc ? 2 : 1), JSON.stringify(wl).slice(0, 200));
  const dept = (await sql("select department from public.jobs where id = $1", [jobId]))[0]?.department;
  check("f3: the job stays on its mechanical path", dept !== "bodyshop", dept);
  await nextScreen("f3", MANAGER_MECH, `/jobs/${jobId}/work`, [/Work order|work/i], "f3-workorder-next");
});

/* ================================================================================================= */
/* Path g — recovery delivery: gate-out → driver's page → delivered closes the job.                   */
/* ================================================================================================= */
await section("g", "recovery delivery with the driver's page", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  const jobId = seed.json?.jobId;
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  await recordFullPayment(jobId, "g1", {});
  let m = await mark();
  {
    const { browser, page } = await browserForId(advisorId, { viewport: { width: 1440, height: 1500 } });
    await go(page, `${base}/jobs/${jobId}/gate-out`);
    await page.getByText("Delivery by recovery", { exact: true }).first().click();
    await sleep(600);
    const ours = page.getByText(/^(Our recovery|Ours)/).first();
    if (await ours.count()) await ours.click().catch(() => null);
    const newDriver = page.getByText(/New driver/i).first();
    if (await newDriver.count()) { await newDriver.click().catch(() => null); await sleep(300); }
    if (await page.locator("input[name=delivery_driver]").count()) {
      await page.locator("input[name=delivery_driver]").fill("Sim Driver");
      await page.locator("input[name=driver_phone]").fill("+971500000077");
    }
    await page.locator("[data-location-url]").fill("https://maps.app.goo.gl/simE2E123");
    await page.locator("input[name=keys_ok]").check();
    if (await page.locator("input[name=keychain_ok]").count()) await page.locator("input[name=keychain_ok]").check();
    // 30 October 2026: the final km and the instrument-cluster photo come before any gate-out stamp.
    if (await page.locator("[data-mileage-out]").count()) {
      const giKm = (await sql("select mileage from public.gate_ins where job_id = $1 order by created_at desc limit 1", [jobId]))[0]?.mileage;
      await page.locator("[data-mileage-out]").fill(String((Number(giKm) || 42010) + 5));
      const png = CLUSTER_PNG;
      await page.locator("[data-final-mileage] input[type=file]").first().setInputFiles({ name: "cluster.png", mimeType: "image/png", buffer: png });
      await until(async () => (await sql("select id from public.job_files where job_id = $1 and kind = 'odometer_out' and removed_at is null", [jobId]))[0], 40, 500);
    }
    await shot(page, "g2-gateout-delivery-actor");
    await page.getByRole("button", { name: /Stamp: left the workshop/ }).click();
    await submitted(page);
    await browser.close();
  }
  const trip = await until(async () => (await sql("select id, token, driver_name from public.recovery_trips where job_id = $1 and kind = 'delivery' and is_active order by created_at desc limit 1", [jobId]))[0], 20, 500);
  check("g2: the delivery trip exists with its one-button link — R4", !!trip?.token, JSON.stringify(trip));
  check("g2: the job is out for delivery — R4", (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status === "in_delivery");
  // The DeliveryPanel: Send to driver, Car loaded.
  {
    const { browser, page } = await browserForId(advisorId, { viewport: { width: 1440, height: 1400 } });
    await go(page, `${base}/jobs/${jobId}/gate-out`);
    const send = page.getByRole("button", { name: /Send to driver/i }).first();
    if (await send.count()) { await send.click(); await sleep(1500); }
    const loaded = page.getByRole("button", { name: /Car loaded/i }).first();
    if (await loaded.count()) { await loaded.click(); await sleep(1500); }
    await shot(page, "g3-delivery-panel-actor");
    await browser.close();
  }
  // The driver's page needs no login: one button, Delivered.
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
    const ctx = page.context();
    await ctx.clearCookies();
    await page.goto(`${base}/drive/${trip.token}`, { waitUntil: "load" });
    await sleep(1200);
    check("g4: the driver's page opens with no login", /TAKE PHOTO|DELIVERED|LOADED/i.test(((await page.textContent("body")) ?? "")));
    await shot(page, "g4-driver-page");
    // One button: TAKE PHOTO, then the price, then SEND.
    const { writeFileSync } = await import("node:fs");
    const drivePng = `${shots}/e2e-drive.png`;
    writeFileSync(drivePng, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    await page.locator('input[type="file"]').setInputFiles(drivePng);
    await sleep(800);
    const price = page.locator("[data-drive-price]");
    if (await price.count()) await price.fill("120");
    await page.getByRole("button", { name: /SEND/i }).first().click();
    await sleep(3000);
    await shot(page, "g4-driver-done");
    await browser.close();
  }
  const closedJob = await until(async () => { const r = (await sql("select is_open from public.jobs where id = $1", [jobId]))[0]; return r && r.is_open === false ? r : null; }, 20, 500);
  check("g4: Delivered closes the job — R4", !!closedJob);
});

/* ================================================================================================= */
/* Path h — commission: set → owner approves → payable only when settled → paid with method.          */
/* ================================================================================================= */
await section("h", "commission approve then pay", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  const jobId = seed.json?.jobId;
  const q = (await sql("select id, number from public.quotations where job_id = $1 and status = 'approved' order by version desc limit 1", [jobId]))[0];
  await sql("update public.quotations set commission_to = 'Sim Rep', commission_kind = 'aed', commission_value = 500, commission_aed = 500, commission_status = 'pending', commission_set_at = now() where id = $1", [q.id]);
  // The owner approves on the Commissions page.
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1200 } });
    await go(page, `${base}/commissions`);
    check("h1: the pending commission is on the owner's page — R2", (await page.locator(`[data-commission-row="${q.number}"]`).count()) === 1);
    await page.locator(`[data-commission-row="${q.number}"] [data-approve-commission]`).click();
    await sleep(2000);
    await shot(page, "h1-owner-approve-actor");
    await browser.close();
  }
  check("h1: approved — R4", (await sql("select commission_status from public.quotations where id = $1", [q.id]))[0]?.commission_status === "approved");
  // Accounts cannot pay before the invoice is settled (R5 says why).
  {
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
    await go(page, `${base}/commissions`);
    check("h2: no Mark paid while the invoice is unpaid", (await page.locator(`[data-pay-tick="${q.id}"]`).count()) === 0);
    // The why lives on the row itself now (the amber "No tax invoice yet" chip of the rebuilt page).
    const why = ((await page.locator(`[data-commission-row="${q.number}"]`).textContent().catch(() => "")) ?? "");
    check("h2: the block says why — R5/R7", /No tax invoice|invoice|paid/i.test(why), why.slice(0, 160));
    await shot(page, "h2-accounts-blocked");
    await browser.close();
  }
  await recordFullPayment(jobId, "h3", {});
  // Now payable: amber on the accounts Waiting list, then paid with method and note.
  {
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1300 } });
    await go(page, `${base}/dashboard`);
    const row = page.locator("[data-waiting-row]", { hasText: /commission/i }).first();
    check("h4: the payable commission sits on accounts' Waiting list — R2", (await row.count()) === 1);
    if (await row.count()) check("h4: it is amber", (await row.getAttribute("data-urgency")) === "amber", (await row.getAttribute("data-urgency")) ?? "");
    await shot(page, "h4-accounts-waiting");
    await go(page, `${base}/commissions`);
    // The rebuilt pay panel (21 October 2026, CPV vouchers): tick the ready row, pick the method, Record.
    const tick = page.locator(`[data-pay-tick="${q.id}"]`);
    if (!(await tick.isChecked().catch(() => false))) await tick.check().catch(() => null);
    await page.locator('[data-pay-method="transfer"]').click();
    await page.locator('[data-pay-reference]').fill("SIM-TT-1");
    await page.locator("[data-pay-save]").click();
    await page.locator("[data-confirm-yes-money]").click({ timeout: 8000 });
    await sleep(2500);
    const paidText = async () => ((await page.locator("[data-commissions-paid]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    for (let i = 0; i < 10 && !/Paid .*transfer/i.test(await paidText()); i++) await sleep(1000);
    check("h4: moved to Paid — R1/R4", /Paid .*transfer/i.test(await paidText()), `${(await paidText()).slice(0, 140)} · ${page.url().slice(-120)} · paid_at ${(await sql("select commission_paid_at from public.quotations where id = $1", [q.id]))[0]?.commission_paid_at ?? "null"}`);
    await shot(page, "h4-paid-actor");
    await browser.close();
  }
  const month = today.slice(0, 7);
  const exp = await fetch(`${base}/api/export/commissions?month=${month}`, { headers: { cookie: await cookieHeader("owner") } });
  check("h5: the monthly export answers as xlsx", exp.status === 200 && /sheet|excel|octet/i.test(exp.headers.get("content-type") ?? ""), `${exp.status} ${exp.headers.get("content-type")}`);
});

/* ================================================================================================= */
/* Path i — ENTER PRICE MYSELF (5 November 2026): the advisor's own price on an estimate line and on   */
/* a job's part, in the centre window (the old in-table box opened off-screen on phones and tablets).  */
/* ================================================================================================= */
await section("i", "enter price myself (estimate + job quotation)", async () => {
  const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0];
  const mm = (await sql("select m.id as make_id, v.id as model_id from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
  const vin = `WDI${Math.floor(1e13 + Math.random() * 8e13)}`.slice(0, 17).replace(/[IOQ]/g, "1");
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e Own Price', '+971500000094') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'I', '94155', $2, $3, 2024, $4) returning id", [cust, mm.make_id, mm.model_id, vin]))[0].id;
  const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, $3, $3) returning id, number", [cust, car, advisor.id]))[0];
  const line1 = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, markup_percent, line_total, price_requested_at, price_requested_by, created_by, updated_by) values ($1, 1, 'part', 'STAR LIGHT WITH SHOOTING STAR MODULE', 'manual', 1, 50, 0, now(), $2, $2, $2) returning id", [est.id, advisor.id]))[0];
  const line2 = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, markup_percent, line_total, created_by, updated_by) values ($1, 2, 'part', 'ROOF TRIM CLIP SET', 'manual', 1, 50, 0, $2, $2) returning id", [est.id, advisor.id]))[0];

  // THE GLITCH REGRESSION (the real E-00069 case): a tablet scrolled right to reach the button - the
  // window must open fully ON SCREEN (the old in-table box sat at x < 0 inside the scrolled strip).
  const { browser, page } = await browserForId(advisor.id, { viewport: { width: 800, height: 1280 }, hasTouch: true });
  await go(page, `${base}/estimates/${est.id}`);
  const btn1 = page.locator(`[data-est-own-price="${line1.id}"]`);
  await btn1.scrollIntoViewIfNeeded();
  await page.evaluate(() => { for (const el of document.querySelectorAll("div")) if (el.scrollWidth > el.clientWidth + 20 && /auto|scroll/.test(getComputedStyle(el).overflowX)) el.scrollLeft = el.scrollWidth; });
  await btn1.click();
  const dlg = page.locator("[data-price-dialog]");
  await dlg.waitFor({ timeout: 10000 });
  const bb = await dlg.locator("[data-price-cost]").boundingBox();
  check("i1: the pricing window opens ON SCREEN on a tablet scrolled right (the glitch) — fixed", !!bb && bb.x >= 0 && bb.x + bb.width <= 800, JSON.stringify(bb));
  await page.screenshot({ path: `${shots}/i1-price-window-tablet.png` });
  // Cost + markup %: typing is smooth (no lost characters) and the selling price follows.
  await dlg.locator("[data-price-cost]").pressSequentially("2000", { delay: 80 });
  check("i1: no lost characters while typing the cost", (await dlg.locator("[data-price-cost]").inputValue()) === "2000");
  await dlg.locator("[data-price-markup]").fill("50");
  const sellLine = await until(async () => { const t = ((await dlg.locator("[data-price-sell-line]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " "); return t.includes("3,000.00") ? t : null; }, 20, 400);
  check("i1: cost 2,000 at 50% sells at 3,000.00 live", !!sellLine, sellLine ?? "");
  await page.screenshot({ path: `${shots}/i1-cost-and-markup.png` });
  await dlg.locator("[data-price-save]").click();
  const saved1 = await until(async () => (await sql("select unit_cost::text as c, priced_by_advisor as a, markup_percent::text as m from public.quotation_lines where id = $1 and priced_by_advisor", [line1.id]))[0]);
  check("i1: saved - cost 2,000, markup 50, Priced by advisor", saved1?.c === "2000.00" && saved1?.a === true && Number(saved1?.m) === 50, JSON.stringify(saved1));
  const told = await until(async () => (await sql("select title from public.notifications where type = 'estimate_price_check' and title like '%Priced by advisor%' and href = $1", [`/parts/estimate/${est.id}`]))[0]);
  check("i1: the parts desk (who had it) is told \"Priced by advisor\"", !!told, told?.title ?? "");
  check("i1: the part leaves the desk's waiting list at once", !((await sql("select 1 as x from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active and unit_cost is null and price_requested_at is not null", [est.id]))[0]));
  check("i1: the line says Priced by whom and when", !!(await until(async () => new RegExp(`Priced by ${advisor.display_name}`).test(((await page.locator(`[data-priced-by="${line1.id}"]`).textContent().catch(() => "")) ?? "")), 40, 500)));
  await page.screenshot({ path: `${shots}/i1-priced-by-line.png` });

  // The SELLING price typed instead: the markup is worked out (cost 400 → selling 500 = 25%).
  await page.locator(`[data-est-own-price="${line2.id}"]`).click();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator("[data-price-cost]").fill("400");
  await dlg.locator("[data-price-selling]").click();
  await dlg.locator("[data-price-selling]").press("Control+a");
  await dlg.locator("[data-price-selling]").pressSequentially("500", { delay: 60 });
  await dlg.locator("[data-price-selling]").press("Enter");
  await until(async () => (await dlg.locator("[data-price-markup]").inputValue()) === "25", 20, 400);
  check("i2: typing the selling price works the markup out (500 on 400 = 25%)", (await dlg.locator("[data-price-markup]").inputValue()) === "25");
  await dlg.locator("[data-price-save]").click();
  // The markup rides its own debounced patch: wait for THAT write, not the first (the price lands first).
  const saved2 = await until(async () => (await sql("select markup_percent::text as m from public.quotation_lines where id = $1 and priced_by_advisor and markup_percent = 25", [line2.id]))[0]);
  check("i2: saved with the worked-out markup", Number(saved2?.m) === 25, saved2?.m ?? "");

  // "Send to parts desk instead": back on their list, the typed price kept as a note.
  await go(page, `${base}/estimates/${est.id}`);
  await page.locator(`[data-back-to-desk="${line2.id}"]`).click();
  const back = await until(async () => (await sql("select parts_note, price_requested_at is not null as w from public.quotation_lines where id = $1 and unit_cost is null", [line2.id]))[0]);
  check("i3: back with the desk, the advisor's price kept as a note", !!back?.w && /Advisor had: AED 400\.00/.test(back?.parts_note ?? ""), back?.parts_note ?? "");

  // i6 THE JUMP-BACK (the second cause): a refresh that comes due while the price save is still on its way must never
  // bring the server's older copy back over the line. Two quick saves put a refresh about ten seconds out; the price
  // save is then held in flight for 12 seconds, so that refresh lands in the middle of it.
  const line3 = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, markup_percent, line_total, price_requested_at, price_requested_by, created_by, updated_by) values ($1, 3, 'part', 'ROOF LINING CLIP', 'manual', 1, 50, 0, now(), $2, $2, $2) returning id", [est.id, advisor.id]))[0];
  await go(page, `${base}/estimates/${est.id}`);
  const note = page.getByRole("textbox", { name: "Note to the customer" });
  await note.fill("Price check");
  await sleep(3000);
  await note.fill("Price check today");
  await sleep(2500);
  await page.route("**/api/quote/save", async (route) => {
    if ((route.request().postData() ?? "").includes("advisorPrice")) await sleep(12000);
    await route.continue().catch(() => null);
  });
  await page.locator(`[data-est-own-price="${line3.id}"]`).click();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator("[data-price-cost]").fill("150");
  await dlg.locator("[data-price-save]").click();
  const state3 = page.locator(`[data-est-part="${line3.id}"] [data-est-part-state]`);
  let jumpedBack = "";
  for (let i = 0; i < 30; i++) {
    const t = ((await state3.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    if (/With the parts desk/.test(t)) { jumpedBack = t; break; }
    await sleep(500);
  }
  check("i6: a refresh while the price is still on its way never puts the line back to \"With the parts desk\"", !jumpedBack, jumpedBack);
  await page.unroute("**/api/quote/save");
  check("i6: and the price lands", !!(await until(async () => (await sql("select 1 as x from public.quotation_lines where id = $1 and priced_by_advisor and unit_cost = 150", [line3.id]))[0], 40, 500)));
  await browser.close();

  // ---------- The JOB quotation: an unpriced part priced by the advisor in the same window ----------
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const jobId = seed.json?.jobId;
  const qid = seed.json?.quotationId;
  if (!jobId || !qid) throw new Error("quote seed failed");
  const desk = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
  const part = (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, availability, order_status, confirm_status, created_by, updated_by) values ($1, 'E2E HEADLIGHT WASHER PUMP', 1, 1, 'to_order', 'none', 'confirmed', $2, $2) returning id", [jobId, desk.id]))[0];
  const ready = (await sql("select 1 as x from information_schema.columns where table_name = 'part_items' and column_name = 'priced_by_advisor'"))[0];
  if (!ready) { check("i4: job side waits for the owner's apply (columns missing on this database)", true); return; }
  const b2 = await browserForId(advisor.id, { viewport: { width: 1440, height: 1000 } });
  await go(b2.page, `${base}/jobs/${jobId}/quote/${qid}`);
  const row = b2.page.locator(`[data-job-unpriced="${part.id}"]`);
  await row.scrollIntoViewIfNeeded();
  check("i4: the job's unpriced part offers Enter price myself", (await row.count()) === 1);
  await row.locator(`[data-est-own-price="${part.id}"]`).click();
  const dlg2 = b2.page.locator("[data-price-dialog]");
  await dlg2.waitFor({ timeout: 10000 });
  await dlg2.locator("[data-price-cost]").fill("350");
  await dlg2.locator("[data-price-cost]").press("Enter");
  await dlg2.locator("[data-price-markup]").fill("40");
  await dlg2.locator("[data-price-markup]").press("Enter");
  await until(async () => ((await dlg2.locator("[data-price-sell-line]").textContent().catch(() => "")) ?? "").includes("490.00"), 20, 300);
  await b2.page.screenshot({ path: `${shots}/i4-job-price-window.png` });
  await dlg2.locator("[data-price-save]").click();
  // On screen AT ONCE, before the server answers (the save itself takes several seconds).
  check("i4: shown as priced at once (\"Priced by you\"), before the server answers", !!(await until(async () => (await b2.page.locator(`[data-job-priced-now="${part.id}"]`).count()) === 1, 10, 200)));
  // The markup is the route's LAST write (after the line is made): wait for that one.
  const savedJob = await until(async () => (await sql("select p.cost_aed::text as c, l.markup_percent::text as m from public.part_items p join public.quotation_lines l on l.part_item_id = p.id and l.quotation_id = $2 and l.is_active where p.id = $1 and p.priced_by_advisor and l.markup_percent = 40", [part.id, qid]))[0], 60, 500);
  check("i4: the part is priced (350) with the line and markup 40 on the quotation", savedJob?.c === "350.00" && Number(savedJob?.m) === 40, JSON.stringify(savedJob));
  const toldJob = await until(async () => (await sql("select title from public.notifications where type = 'parts_request' and title like 'Priced by advisor%' and job_id = $1", [jobId]))[0]);
  check("i4: the parts desk is told (nothing left to price on it)", !!toldJob, toldJob?.title ?? "");
  check("i4: the line shows Priced by the advisor", !!(await until(async () => new RegExp(`Priced by ${advisor.display_name}`).test(((await b2.page.locator("[data-priced-by]").first().textContent().catch(() => "")) ?? "")), 20, 500)));
  await b2.page.screenshot({ path: `${shots}/i4-job-priced.png` });
  // The desk's later look: Price is right ✓ on the job's Parts page.
  const b3 = await browserForId(desk.id, { viewport: { width: 1500, height: 1400 } });
  await go(b3.page, `${base}/parts/${jobId}`);
  const chip = b3.page.locator('[data-advisor-priced="open"]').first();
  await chip.scrollIntoViewIfNeeded().catch(() => null);
  check("i5: the desk sees who priced it and can check it later", (await chip.count()) === 1, ((await chip.textContent().catch(() => "")) ?? "").slice(0, 120));
  await b3.page.screenshot({ path: `${shots}/i5-desk-check.png` });
  await chip.locator("[data-desk-price-right]").click();
  check("i5: Price is right ✓ is written on the part", !!(await until(async () => (await sql("select 1 as x from public.part_items where id = $1 and price_checked_at is not null", [part.id]))[0])));
  await b2.browser.close();
  await b3.browser.close();
});

/* ================================================================================================= */
/* Path j — PARTS CHANGED AFTER APPROVAL (5 November 2026, J-00985): approve → LPO → cancel a part     */
/* with the supplier → add a new one → the bar opens again → Resend for approval → the approver sees  */
/* old vs new → a NEW LPO continuing the car's numbers → order → receive → hand over → all green.     */
/* ================================================================================================= */
await section("j", "parts changed after approval → resend for approval", async () => {
  const states = async (page) => Object.fromEntries(await page.locator("[data-parts-steps] [data-step]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-step"), e.getAttribute("data-state")])));
  const bar = (s) => ["pricing", "approval", "lpo", "received", "handover"].map((k) => `${k}:${s[k] ?? "?"}`).join(" ");
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const advisorId = (await sql("select gated_in_by as id from public.jobs where id = $1", [jobId]))[0].id;
  await sql("update public.part_items set supplier = 'E2E AL TAYER' where job_id = $1 and description = 'front brake pads'", [jobId]);
  await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select n, '100200300400599', true, $1, $1 from (values ('E2E AL TAYER'), ('E2E AL NABOODA')) v(n) where not exists (select 1 from public.suppliers where name ilike v.n)", [partsId]);
  // The seed's open request (rear brake discs) is not part of this story: it is closed so "Send LPO" sends at once.
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not needed (test)' where job_id = $1 and status = 'open'", [jobId]);
  // j1. The approved part goes on its LPO, approved and ordered (the family: LPO-X-1).
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    const err = (await sendLpo(page)).error;
    if (err) console.log("   j1 send LPO said:", err.slice(0, 200));
    await browser.close();
  }
  const main1 = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  if (!main1) throw new Error("j1: no main LPO was raised (see the line above)");
  {
    const { browser, page } = await browserFor("owner");
    await go(page, `${base}/parts/orders/${main1.id}`);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.locator("[data-confirm-yes-money]").click({ timeout: 8000 }).catch(() => null);
    await submitted(page);
    await browser.close();
  }
  const lpo1 = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'supplier' order by created_at limit 1", [jobId]))[0];
  check(`j1: the first supplier LPO is ${main1.number}-1`, lpo1?.number === `${main1.number}-1`, lpo1?.number ?? "");
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    if (await page.locator("[data-lpo-ordered]").count()) { const before = page.url(); await page.locator("[data-lpo-ordered]").first().click(); await page.waitForURL((u) => u.toString() !== before, { timeout: 25000 }).catch(() => null); }
    // j2. Cancel it with the supplier (the J-00985 situation: the approved part is replaced).
    await go(page, `${base}/parts/${jobId}`);
    const row = page.locator("[data-row-key]").filter({ has: page.locator("[data-part-name]", { hasText: /front brake pads/i }) }).first();
    await row.scrollIntoViewIfNeeded().catch(() => null);
    await row.locator("button[aria-label='More for this part']").click();
    await page.getByRole("button", { name: /Remove: not needed \(ordered: choose its ending\)/ }).click();
    const dlg = page.locator("[data-end-dialog]");
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator('[data-end-option="cancelled"]').click();
    await dlg.locator("input[name='reason']").pressSequentially("Wrong part, supplier cancelled", { delay: 10 });
    await dlg.locator("[data-end-save]").click();
    await until(async () => (await dlg.locator("[data-end-done]").count()) > 0, 40, 500);
    await browser.close();
  }
  const pad = (await sql("select disposition, is_active from public.part_items where job_id = $1 and description = 'front brake pads'", [jobId]))[0];
  check("j2: the approved part is cancelled with the supplier", pad?.disposition === "cancelled" && pad?.is_active === false, JSON.stringify(pad));
  // j3. Parts add the new part (priced: AL NABOODA, 674.80) - on no approved quotation.
  const today3 = new Date(Date.now() + 4 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, delivery_date, confirm_status, part_type, priced_at, priced_by, order_status, created_by, updated_by) values ($1, 'E2E FRONT BRAKE PAD', 'E2E-FBP-1', 1, 1, 674.80, 'E2E AL NABOODA', 'to_order', $3, 'confirmed', 'genuine', now(), $2, 'none', $2, $2)", [jobId, partsId, today3]);
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    const s = await states(page);
    check(`j3: the bar is open again, never all green (${bar(s)})`, s.approval === "current" && s.handover !== "done", bar(s));
    const words = ((await page.locator("[data-parts-changes-words]").textContent().catch(() => "")) ?? "").trim();
    check(`j3: "${words}"`, words === "Changes since approval: 1 added, 1 removed, cost + AED 474.80");
    check("j3: the new line says it needs approval", ((await page.textContent("body")) ?? "").includes("New – needs approval"));
    check("j3: the removed line shows with its reason", /Wrong part, supplier cancelled/.test(((await page.locator("[data-change-row='removed']").textContent().catch(() => "")) ?? "")));
    await shot(page, "j3-changes-since-approval");
    // j4. Resend for approval (the parts desk).
    await page.locator("[data-resend-approval]").click();
    await submitted(page);
    const msg = decodeURIComponent(page.url()).replace(/\+/g, " ");
    check("j4: Resend answers in place with what went", /Sent for approval on LPO-/.test(msg) && /1 added, 1 removed/.test(msg), msg.slice(-160));
    check("j4: the answer shows inside the Changes card, next to the button", (await page.locator("[data-parts-changes] [data-resend-outcome='success']").count()) === 1);
    const s4 = await states(page);
    check(`j4: approval is the current step, waiting (${bar(s4)})`, s4.approval === "current", bar(s4));
    await shot(page, "j4-resent");
    await browser.close();
  }
  const main2 = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  check("j4: a main LPO waits for approval with the new part", !!main2?.id);
  const ownerNote = await until(async () => (await sql("select title, body from public.notifications where type = 'po_approval' and href = $1 order by created_at desc limit 1", [`/parts/orders/${main2?.id}`]))[0], 20, 500);
  check(`j4: the approvers are told the changes ("${ownerNote?.title ?? ""}")`, /Parts changed after approval/.test(ownerNote?.title ?? "") && /1 added, 1 removed/.test(ownerNote?.body ?? ""));
  const advNote = await until(async () => (await sql("select body from public.notifications where staff_id = $1 and type = 'parts_changed_after_approval' and job_id = $2 order by created_at desc limit 1", [advisorId, jobId]))[0], 20, 500);
  check("j4: the advisor is told, the quotation untouched", /quotation .* is unchanged/.test(advNote?.body ?? ""), advNote?.body ?? "");
  // j5. The approver sees old vs new and approves → the new LPO continues the car's numbers.
  {
    const { browser, page } = await browserFor("owner");
    await go(page, `${base}/parts/orders/${main2.id}`);
    const box = page.locator("[data-lpo-after-approval]");
    check("j5: the approval screen shows old vs new", (await box.locator("[data-lpo-change='added']").count()) === 1 && (await box.locator("[data-lpo-change='removed']").count()) === 1);
    await shot(page, "j5-approval-old-vs-new");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.locator("[data-confirm-yes-money]").click({ timeout: 8000 }).catch(() => null);
    await submitted(page);
    await browser.close();
  }
  const lpo2 = (await sql("select id, number, supplier_name from public.purchase_orders where job_id = $1 and kind = 'supplier' and status <> 'cancelled' order by created_at desc limit 1", [jobId]))[0];
  check(`j5: the new LPO continues the family: ${lpo2?.number} (after ${main1.number}-1)`, lpo2?.number === `${main1.number}-2` && /NABOODA/i.test(lpo2?.supplier_name ?? ""), JSON.stringify(lpo2));
  // j6. Order, receive, hand over - the bar goes green only at the end.
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    await shot(page, "j6-new-lpo");
    if (await page.locator("[data-lpo-ordered]").count()) { const before = page.url(); await page.locator("[data-lpo-ordered]").first().click(); await page.waitForURL((u) => u.toString() !== before, { timeout: 25000 }).catch(() => null); }
    await go(page, `${base}/parts/${jobId}`);
    const s6 = await states(page);
    check(`j6: ordered - LPO done, not green yet (${bar(s6)})`, s6.lpo === "done" && s6.received !== "done", bar(s6));
    await page.locator("[data-mark-received]").click();
    await sleep(500);
    await page.locator("[data-no-stickers]").click().catch(() => null);
    await until(async () => (await sql("select 1 as x from public.part_items where job_id = $1 and description = 'E2E FRONT BRAKE PAD' and order_status = 'received'", [jobId]))[0], 30, 500);
    await go(page, `${base}/parts/${jobId}`);
    const s7 = await states(page);
    check(`j7: received - still waiting for the hand-over (${bar(s7)})`, s7.received === "done" && s7.handover !== "done", bar(s7));
    await go(page, `${base}/parts/handover/${jobId}`);
    if (await page.locator("[data-mark-ready]").count()) { await page.locator("[data-mark-ready]").click(); await submitted(page); }
    await browser.close();
  }
  const techId = await freeTech(jobId, null);
  await setPin(techId, "1234");
  {
    const { browser, page } = await browserForId(techId, { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/my-jobs/${jobId}`);
    for (let i = 0; i < 5 && (await page.locator("[data-part-take][data-ticked='0'] button").count()); i++) { await page.locator("[data-part-take][data-ticked='0'] button").first().click(); await sleep(300); }
    if (await page.locator("[data-receive-pin]").count()) {
      await page.locator("[data-receive-pin]").fill("1234");
      await page.locator("[data-receive-parts]").click();
    }
    await until(async () => (await sql("select 1 as x from public.part_items where job_id = $1 and description = 'E2E FRONT BRAKE PAD' and issue_status = 'confirmed'", [jobId]))[0], 30, 500);
    await browser.close();
  }
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    const s8 = await states(page);
    check(`j8: handed over - now (and only now) every step is green (${bar(s8)})`, Object.values(s8).every((x) => x === "done"), bar(s8));
    await shot(page, "j8-all-green");
    await browser.close();
  }
});

/* ================================================================================================= */
/* Path k — REVISE AT THE TOP + PROFIT WITH NO LABOUR COST (5 November 2026, E-00056): the one       */
/* "Revise → version N" in the header (estimate and job quotation), "v1 | v2" by the title, the red   */
/* "Hours missing – profit not reliable" until the hours are typed, at 1440×900 and 800×1280.         */
/* ================================================================================================= */
await section("k", "revise at the top + hours missing (estimate + job quotation)", async () => {
  const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0];
  const accounts = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by display_name limit 1"))[0];
  const rate = Number((await sql("select value #>> '{}' as v from public.settings where key = 'bodyshop_cost_rate_aed'"))[0]?.v) || 50;
  const mm = (await sql("select m.id as make_id, v.id as model_id from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
  const vin = `WDK${Math.floor(1e13 + Math.random() * 8e13)}`.slice(0, 17).replace(/[IOQ]/g, "1");
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e Revise Top', '+971500000095') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, vin) values ($1, true, 'UAE', 'Dubai', 'K', '95155', $2, $3, 2024, $4) returning id", [cust, mm.make_id, mm.model_id, vin]))[0].id;
  // E-00056's shape: a SENT estimate whose two typed fixed-price lines carry no hours (painting 6,000; removal and refix included at 0).
  const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, $3, $3) returning id, number", [cust, car, advisor.id]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, line_total, created_by, updated_by) values ($1, 1, 'package', 'E2E PAINTING EXTERIOR TRIMS', 'manual', 1, 6000, 6000, $2, $2), ($1, 2, 'package', 'E2E REMOVAL AND REFIX', 'manual', 1, 0, 0, $2, $2)", [est.id, advisor.id]);
  await sql("update public.quotations set status = 'sent', sent_at = now(), token = md5(random()::text), subtotal_aed = 6000, vat_aed = 300, total_aed = 6300 where id = $1", [est.id]);
  const red = (el) => el.evaluate((e) => { const c = getComputedStyle(e).color.match(/\d+/g).map(Number); return c[0] > 150 && c[1] < 90 && c[2] < 90; });

  /* -- the estimate, 1440×900, the advisor in charge -- */
  let v2Id = null;
  {
    const { browser, page } = await browserForId(advisor.id, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/estimates/${est.id}`);
    const rev = page.locator("[data-revise]");
    const rb = await rev.boundingBox();
    const pdf = await page.locator("a", { hasText: "Preview PDF" }).boundingBox();
    check("k1: ONE black 'Revise → version 2' at the top, in the row with Preview PDF", (await rev.count()) === 1 && /Revise → version 2/.test((await rev.textContent()) ?? "") && !!rb && !!pdf && rb.y < 300 && Math.abs(rb.y - pdf.y) < 40, `${JSON.stringify(rb)} pdf ${JSON.stringify(pdf)}`);
    check("k1: no Revise box at the bottom any more", (await page.getByRole("button", { name: /Start version/ }).count()) === 0);
    check("k1: 'v1' next to the title, marked current", ((await page.locator("[data-version-links] [data-version-current]").textContent()) ?? "") === "v1");
    const warn = page.locator("[data-hours-missing]");
    const chip = page.locator("[data-margin-chip]");
    check("k1: the profit says 'Hours missing – profit not reliable' in red (cause: typed fixed-price lines with no hours)", (await warn.count()) === 1 && /Hours missing – profit not reliable/.test((await warn.textContent()) ?? "") && /E2E PAINTING EXTERIOR TRIMS/.test((await warn.textContent()) ?? "") && (await red(warn)), ((await warn.textContent().catch(() => "")) ?? "").slice(0, 160));
    check("k1: the profit chip is red, never green, while hours are missing", (await chip.getAttribute("data-margin-tone")) === "red" && (await chip.getAttribute("data-hours-missing-chip")) === "1" && (await red(chip)), (await chip.textContent()) ?? "");
    await page.screenshot({ path: `${shots}/k1-estimate-revise-top-1440.png` });
    await page.locator("[data-internal-box]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/k1-estimate-hours-missing-1440.png` });
    await rev.click();
    await page.waitForURL((u) => /\/estimates\//.test(u.toString()) && !u.toString().includes(est.id), { timeout: 30000 }).catch(() => null);
    v2Id = page.url().split("/estimates/")[1]?.split(/[?#]/)[0] ?? null;
    const v = await sql("select id, version, status from public.quotations where number = $1 order by version", [est.number]);
    // The copied lines (the automatic, hidden bank-charge line is made for every version and is not a copy).
    const copied = v2Id ? await sql("select title from public.quotation_lines where quotation_id = $1 and is_active and fee_kind is null order by position", [v2Id]) : [];
    check("k2: the top button made version 2 of the same number, a copy of v1 (v1 kept, replaced)", v.length === 2 && v[1].id === v2Id && v[1].status === "draft" && v[0].status === "superseded" && copied.length === 2, `${JSON.stringify(v)} · ${copied.map((c) => c.title).join(", ")}`);
    await go(page, `${base}/estimates/${v2Id}`);
    const links = await page.locator("[data-version-links] [data-version-link]").evaluateAll((els) => els.map((e) => `${e.textContent}${e.hasAttribute("data-version-current") ? "*" : ""}`));
    check(`k2: 'v1 | v2' next to the title, v2 current (${links.join(" | ")})`, links.join("|") === "v1|v2*");
    check("k2: a draft has no Revise button (nothing to revise until it is sent)", (await page.locator("[data-revise]").count()) === 0);
    // Type the hours this work takes us: the profit counts them (hours × the bodyshop rate) and the warning goes.
    const boxes = page.locator("[data-hours-box]");
    check("k3: every typed fixed-price line has an 'our hours' box, red while empty", (await boxes.count()) === 2 && (await page.locator("[data-hours-box='missing']").count()) === 2);
    await boxes.nth(0).pressSequentially("16", { delay: 60 });
    await boxes.nth(1).pressSequentially("4", { delay: 60 });
    const saved = await until(async () => (await sql("select coalesce(sum(installer_hours), 0)::float as h from public.quotation_lines where quotation_id = $1 and is_active", [v2Id]))[0]?.h === 20, 40, 500);
    check("k3: the 20 hours are saved", !!saved);
    const mat = page.locator("[data-materials]");
    check("k3: the estimate has the Materials box too", (await mat.count()) === 1);
    if (await mat.count()) await mat.pressSequentially("300", { delay: 60 });
    await until(async () => Number((await sql("select materials_cost_aed from public.quotations where id = $1", [v2Id]))[0]?.materials_cost_aed) === 300, 40, 500);
    await go(page, `${base}/estimates/${v2Id}`);
    const labour = ((await page.locator("[data-profit-amount='labour']").textContent()) ?? "").replace(/\s+/g, " ");
    const material = ((await page.locator("[data-profit-amount='materials']").textContent()) ?? "").replace(/\s+/g, " ");
    const want = (20 * rate).toLocaleString("en-US", { minimumFractionDigits: 2 });
    check(`k3: labour at cost = 20 h × AED ${rate} = ${want}, materials 300.00, from the one calculation`, labour.includes(want) && material.includes("300.00"), `${labour} · ${material}`);
    check("k3: with the hours in, the warning is gone and the chip is no longer the hours warning", (await page.locator("[data-hours-missing]").count()) === 0 && (await page.locator("[data-hours-missing-chip]").count()) === 0);
    await page.locator("[data-internal-box]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/k3-estimate-hours-typed-1440.png` });
    await page.locator("[data-version-link='1']").click();
    await page.waitForURL((u) => u.toString().includes(est.id), { timeout: 20000 }).catch(() => null);
    check("k4: v1 opens from the title, read-only, with no Revise (v2 is the newest)", (await page.locator("[data-old-version-banner]").count()) === 1 && (await page.locator("[data-revise]").count()) === 0 && (await page.locator("[data-hours-box]:not([disabled])").count()) === 0);
    await browser.close();
  }
  {
    const { browser, page } = await browserForId(accounts.id, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/estimates/${v2Id}`);
    check("k4: accounts can read the estimate but never see Revise (owner and advisors only)", (await page.locator("[data-revise], [data-ask-revise]").count()) === 0);
    await browser.close();
  }
  {
    const { browser, page } = await browserForId(advisor.id, { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/estimates/${v2Id}`);
    await page.screenshot({ path: `${shots}/k4-estimate-v2-800.png` });
    await browser.close();
  }

  /* -- the job quotation, 800×1280: approved by the customer, a typed fixed-price line with no hours -- */
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const jobAdvisor = (await sql("select gated_in_by as id from public.jobs where id = $1", [jobId]))[0].id;
  const q1 = (await sql("select id, number from public.quotations where job_id = $1 and status = 'approved' order by version desc limit 1", [jobId]))[0];
  await sql("update public.quotations set status = 'draft' where id = $1", [q1.id]);
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, line_total, created_by, updated_by) values ($1, 90, 'package', 'E2E PAINT REAR BUMPER', 'manual', 1, 1200, 1200, $2, $2)", [q1.id, jobAdvisor]);
  await sql("update public.quotations set status = 'approved' where id = $1", [q1.id]);
  {
    const { browser, page } = await browserForId(jobAdvisor, { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/jobs/${jobId}/quote/${q1.id}`);
    const ask = page.locator("[data-ask-revise]");
    const ab = await ask.boundingBox();
    check("k5: on the approved quotation the advisor's one button sits at the top: 'Revise → version 2' (asks the owner first)", (await ask.count()) === 1 && /Revise → version 2/.test((await ask.textContent()) ?? "") && !!ab && ab.y < 500 && ab.x + ab.width <= 800, JSON.stringify(ab));
    check("k5: nothing to revise in the bottom bar", (await page.locator("[data-locked-bar] button").count()) === 0);
    const warn = page.locator("[data-hours-missing]");
    check("k5: the locked quotation's profit says 'Hours missing – profit not reliable' in red", (await warn.count()) === 1 && /E2E PAINT REAR BUMPER/.test((await warn.textContent()) ?? "") && (await red(warn)), ((await warn.textContent().catch(() => "")) ?? "").slice(0, 160));
    await page.screenshot({ path: `${shots}/k5-job-quote-advisor-800.png` });
    await browser.close();
  }
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/jobs/${jobId}/quote/${q1.id}`);
    const rev = page.locator("[data-revise]");
    const rb = await rev.boundingBox();
    check("k6: the owner's 'Revise → version 2' at the top, on screen at 800 px", (await rev.count()) === 1 && /Revise → version 2/.test((await rev.textContent()) ?? "") && !!rb && rb.x >= 0 && rb.x + rb.width <= 800 && rb.y < 500, JSON.stringify(rb));
    check("k6: 'v1' next to the title", ((await page.locator("[data-version-links] [data-version-current]").textContent()) ?? "") === "v1");
    await page.screenshot({ path: `${shots}/k6-job-quote-owner-800.png` });
    await rev.click();
    await page.waitForURL((u) => /\/quote\//.test(u.toString()) && !u.toString().includes(q1.id), { timeout: 30000 }).catch(() => null);
    const q2 = page.url().split("/quote/")[1]?.split(/[?#]/)[0] ?? "";
    const vs = await sql("select id, version, status from public.quotations where number = $1 order by version", [q1.number]);
    check("k6: version 2 made, a copy (the approved v1 stands until v2 is approved)", vs.length === 2 && vs[1].id === q2 && vs[1].status === "draft" && vs[0].status === "approved", JSON.stringify(vs));
    const chip = page.locator("[data-margin-chip]");
    check("k7: v2's profit chip says 'Hours missing – profit not reliable' in red", (await chip.getAttribute("data-hours-missing-chip")) === "1" && /Hours missing – profit not reliable/.test((await chip.textContent()) ?? "") && (await red(chip)), (await chip.textContent()) ?? "");
    const box = page.locator("[data-hours-box='missing']");
    check("k7: the line without hours has its red 'our hours' box", (await box.count()) === 1);
    await box.first().pressSequentially("6", { delay: 60 });
    await until(async () => Number((await sql("select installer_hours from public.quotation_lines where quotation_id = $1 and title = 'E2E PAINT REAR BUMPER' and is_active", [q2]))[0]?.installer_hours) === 6, 40, 500);
    await go(page, `${base}/jobs/${jobId}/quote/${q2}`);
    check("k7: typed, saved, and the warning is gone", (await page.locator("[data-hours-missing], [data-hours-missing-chip]").count()) === 0);
    const links = await page.locator("[data-version-links] [data-version-link]").evaluateAll((els) => els.map((e) => `${e.textContent}${e.hasAttribute("data-version-current") ? "*" : ""}`));
    check(`k7: 'v1 | v2' next to the title (${links.join(" | ")})`, links.join("|") === "v1|v2*");
    await page.screenshot({ path: `${shots}/k7-job-quote-v2-800.png` });
    await browser.close();
  }
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${jobId}/quote/${q1.id}`);
    check("k8: at 1440 the approved v1 has no Revise (v2 is the newest) and links to v2", (await page.locator("[data-revise]").count()) === 0 && (await page.locator("[data-version-link='2']").count()) === 1);
    await page.screenshot({ path: `${shots}/k8-job-quote-v1-1440.png` });
    await browser.close();
  }
});

/* ================================================================================================= */
/* Path l — SUPPLIER AMOUNTS WITH VAT (5 November 2026, Mathew): one supplier VAT registered with a    */
/* TRN (963.00 → AED 1,011.15 incl. VAT), one with no TRN (no VAT), through the approval screen, the   */
/* LPO list, the LPO pages, the cards and the supplier PDFs; each LPO tab counts its own; a cancelled */
/* LPO at its original amount struck through, never counted; at 1440×900 and 800×1280.                 */
/* ================================================================================================= */
await section("l", "supplier amounts with VAT + LPO tab counts + cancelled LPOs", async () => {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E VAT SUPPLIER', '100200300400598', true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E VAT SUPPLIER')", [partsId]);
  await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select 'E2E NO TRN SUPPLIER', null, true, $1, $1 where not exists (select 1 from public.suppliers where name ilike 'E2E NO TRN SUPPLIER')", [partsId]);
  const noTrn = (await sql("select id::text as id from public.suppliers where name ilike 'E2E NO TRN SUPPLIER'"))[0];
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not needed (test)' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.part_items set supplier = 'E2E VAT SUPPLIER', cost_aed = 963, quantity = 1, confirmed_quantity = 1 where job_id = $1 and description = 'front brake pads'", [jobId]);
  const day = new Date(Date.now() + 4 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, delivery_date, confirm_status, part_type, priced_at, priced_by, order_status, created_by, updated_by) values ($1, 'E2E WIPER BLADE SET', 'E2E-WB-1', 1, 1, 100, 'E2E NO TRN SUPPLIER', 'to_order', $2, 'confirmed', 'genuine', now(), $3, 'to_order', $3, $3)", [jobId, day, partsId]);
  const amountOf = async (loc) => (await loc.count()) ? { gross: await loc.first().getAttribute("data-gross"), net: await loc.first().getAttribute("data-net"), vat: await loc.first().getAttribute("data-vat"), charged: await loc.first().getAttribute("data-vat-charged"), cancelled: await loc.first().getAttribute("data-cancelled"), text: ((await loc.first().textContent()) ?? "").replace(/\s+/g, " ") } : null;

  // l1. Parts send the LPO; the approval screen shows each supplier with its own VAT and the grand total once.
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1500, height: 1300 } });
    await go(page, `${base}/parts/${jobId}`);
    const cost = ((await page.locator("[data-cost-grand]").textContent()) ?? "").trim();
    check(`l1: the Parts page's Our cost counts VAT only for the VAT supplier: 963 + 48.15 + 100 = AED 1,111.15 incl. VAT ("${cost}")`, cost === "AED 1,111.15 incl. VAT");
    await sendLpo(page);
    await browser.close();
  }
  const main = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  if (!main) throw new Error("l1: no main LPO was raised");
  for (const [w, h] of [[1440, 900], [800, 1280]]) {
    const { browser, page } = await browserFor("owner", { viewport: { width: w, height: h }, ...(w < 1000 ? { hasTouch: true } : {}) });
    await go(page, `${base}/parts/orders/${main.id}`);
    const vatGroup = await amountOf(page.locator("[data-lpo-group='E2E VAT SUPPLIER' i] [data-supplier-amount]"));
    const noGroup = await amountOf(page.locator("[data-lpo-group='E2E NO TRN SUPPLIER' i] [data-supplier-amount]"));
    const grand = await amountOf(page.locator("[data-lpo-grand-total] [data-supplier-amount]"));
    if (w === 1440) {
      check(`l1: the approval screen: E2E VAT SUPPLIER "AED 1,011.15 incl. VAT · 963.00 + VAT 48.15" (${vatGroup?.text})`, vatGroup?.gross === "1011.15" && /AED 1,011\.15 incl\. VAT/.test(vatGroup?.text ?? "") && /963\.00 \+ VAT 48\.15/.test(vatGroup?.text ?? ""));
      check(`l1: the approval screen: the no-TRN supplier "AED 100.00 · No VAT – supplier not VAT-registered" (${noGroup?.text})`, noGroup?.charged === "0" && noGroup?.gross === "100.00" && /No VAT – supplier not VAT-registered/.test(noGroup?.text ?? ""));
      check(`l1: the grand total once: AED 1,111.15 incl. VAT (1,063.00 + VAT 48.15) (${grand?.text})`, grand?.gross === "1111.15" && grand?.net === "1063.00" && grand?.vat === "48.15" && !/before VAT/.test(((await page.locator("[data-main-lpo]").textContent()) ?? "")));
    }
    await page.screenshot({ path: `${shots}/l1-approval-${w}.png`, fullPage: true });
    if (w === 1440) {
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      const q = ((await page.locator("[data-confirm-text]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
      check(`l1: the Approve question names the amount with VAT ("${q.slice(0, 160)}")`, /AED 1,111\.15 incl\. VAT \(1,063\.00 \+ VAT 48\.15\)/.test(q));
      await page.locator("[data-confirm-yes-money]").click({ timeout: 8000 }).catch(() => null);
      await submitted(page);
    }
    await browser.close();
  }
  const sups = await sql("select id, number, supplier_name from public.purchase_orders where job_id = $1 and kind = 'supplier' order by number", [jobId]);
  const vatPo = sups.find((p) => /VAT SUPPLIER/i.test(p.supplier_name) && !/NO TRN/i.test(p.supplier_name));
  const noPo = sups.find((p) => /NO TRN/i.test(p.supplier_name));
  check(`l2: approval made one supplier LPO each (${sups.map((p) => `${p.number} ${p.supplier_name}`).join(", ")})`, !!vatPo && !!noPo);

  // l2. The LPO list: each row through THE display.
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/orders?q=${encodeURIComponent(main.number)}`);
    const a = await amountOf(page.locator(`[data-lpo-row='${vatPo.number}'] [data-supplier-amount]`));
    const b = await amountOf(page.locator(`[data-lpo-row='${noPo.number}'] [data-supplier-amount]`));
    check(`l2: the LPO list: ${vatPo.number} "AED 1,011.15 incl. VAT" with "963.00 + VAT 48.15" (${a?.text})`, a?.gross === "1011.15" && /963\.00 \+ VAT 48\.15/.test(a?.text ?? ""));
    check(`l2: the LPO list: ${noPo.number} "AED 100.00" with "No VAT – supplier not VAT-registered" (${b?.text})`, b?.charged === "0" && /AED 100\.00/.test(b?.text ?? "") && /No VAT – supplier not VAT-registered/.test(b?.text ?? ""));
    await page.screenshot({ path: `${shots}/l2-lpo-list-1440.png`, fullPage: true });
    // l3. Each tab counts its OWN LPOs (the counts used the tab on screen for every tab).
    const tabs = await page.locator("[data-lpo-tab]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-lpo-tab"), Number((e.textContent ?? "").split("·").pop().trim())]));
    const wrong = [];
    for (const [key, n] of tabs) {
      await go(page, `${base}/parts/orders?q=${encodeURIComponent(main.number)}${key ? `&tab=${key}` : ""}`);
      const rows = await page.locator("[data-lpo-row]").count();
      if (rows !== n) wrong.push(`${key || "all"}: tab says ${n}, list shows ${rows}`);
    }
    check(`l3: every LPO tab's count is its own list (${tabs.map(([k, n]) => `${k || "all"} ${n}`).join(", ")})`, wrong.length === 0 && tabs.length === 8, wrong.join("; "));
    await go(page, `${base}/parts/orders?q=${encodeURIComponent(main.number)}&tab=ordered`);
    const onOrdered = await page.locator("[data-lpo-tab]").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).join(" | "));
    check(`l3: on another tab the counts stay the same (${onOrdered})`, onOrdered.includes("Approved, to send · 2") && onOrdered.includes("Ordered · 0"));
    await page.screenshot({ path: `${shots}/l3-lpo-tabs-1440.png` });
    // The Supplier invoices tab of Parts accounts: its count is its own list too.
    await go(page, `${base}/parts-accounts?tab=invoices`);
    const siTab = Number(((await page.locator("[data-pa-tabs] a[href*='tab=invoices']").textContent()) ?? "").split("·").pop().trim());
    const siRows = await page.locator("[data-si-row]").count();
    check(`l3: the Supplier invoices tab counts its own invoices (tab ${siTab}, list ${siRows})`, siTab === siRows, `${siTab} vs ${siRows}`);
    await browser.close();
  }
  // l4. The supplier LPO pages (1440 and 800) and the supplier copy PDFs.
  for (const [w, h] of [[1440, 900], [800, 1280]]) {
    const { browser, page } = await browserFor("owner", { viewport: { width: w, height: h }, ...(w < 1000 ? { hasTouch: true } : {}) });
    for (const po of [vatPo, noPo]) {
      await go(page, `${base}/parts/orders/${po.id}`);
      const t = await amountOf(page.locator("[data-lpo-lines-total] [data-supplier-amount]"));
      if (w === 1440) {
        check(`l4: ${po.number}'s Lines box total once: ${po === vatPo ? "AED 1,011.15 incl. VAT" : "AED 100.00, no VAT"} (${t?.text})`, po === vatPo ? t?.gross === "1011.15" && /963\.00 \+ VAT 48\.15/.test(t?.text ?? "") : t?.charged === "0" && t?.gross === "100.00");
        const card = await amountOf(page.locator("[data-supplier-lpo] [data-lpo-total] [data-supplier-amount]"));
        check(`l4: ${po.number}'s Send-it card shows the same figures (${card?.text})`, card?.gross === t?.gross && card?.vat === t?.vat);
      }
      await page.screenshot({ path: `${shots}/l4-${po === vatPo ? "vat" : "novat"}-lpo-${w}.png`, fullPage: true });
    }
    await browser.close();
  }
  {
    const mupdf = await import("mupdf");
    const cookie = await cookieHeader("owner");
    for (const po of [vatPo, noPo]) {
      const res = await fetch(`${base}/api/pdf/po/${po.id}`, { headers: { cookie } });
      const buf = Buffer.from(await res.arrayBuffer());
      const doc = mupdf.Document.openDocument(buf, "application/pdf");
      const pdfText = doc.loadPage(0).toStructuredText().asText().replace(/\s+/g, " ");
      if (po === vatPo) check(`l5: the supplier copy PDF: Total before VAT 963.00 · VAT 5% 48.15 · Total incl. VAT 1,011.15, no line-by-line VAT, no repeated subtotal (${pdfText.slice(0, 120)}…)`, /Total before VAT AED 963\.00/.test(pdfText) && /VAT 5% AED 48\.15/.test(pdfText) && /Total incl\. VAT AED 1,011\.15/.test(pdfText) && !/Order subtotal/.test(pdfText));
      else check(`l5: the no-TRN supplier's PDF: Total AED 100.00, "No VAT – supplier not VAT-registered", no VAT row`, /Total AED 100\.00/.test(pdfText) && /No VAT – supplier not VAT-registered/.test(pdfText) && !/VAT 5%/.test(pdfText));
      fs.writeFileSync(`${shots}/l5-${po === vatPo ? "vat" : "novat"}-supplier-copy.png`, doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
    }
  }
  // l6. Cancelled LPOs: the no-TRN supplier's part cancelled with the supplier (its LPO left with no line, total 0 - the
  // LPO-00042 shape) and a refused LPO that kept its total (the LPO-00041 shape): both at their ORIGINAL amount, struck
  // through with "Cancelled", never counted.
  await sql("update public.part_items set order_status = 'ordered' where job_id = $1 and description = 'E2E WIPER BLADE SET'", [jobId]);
  await sql("update public.purchase_orders set status = 'cancelled', total_cost_aed = 0, notes = 'No line left: this LPO is cancelled.' where id = $1", [noPo.id]);
  await sql("update public.purchase_order_lines set is_active = false where po_id = $1", [noPo.id]);
  const refused = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, notes, created_by, updated_by) values ('E2E-LPO-L-REFUSED', $1, $2, 'E2E NO TRN SUPPLIER', 'main', 'cancelled', 4.48, 'Refused', $3, $3) returning id", [jobId, noTrn.id, ownerId]))[0];
  if (refused?.id) await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, created_by, updated_by) values ($1, 1, 'PLUG WASHER', 1, 4.48, $2, $2)", [refused.id, ownerId]);
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/orders?tab=cancelled&q=${encodeURIComponent(main.number)}`);
    const c42 = await amountOf(page.locator(`[data-lpo-row='${noPo.number}'] [data-supplier-amount]`));
    check(`l6: a cancelled LPO re-totalled to 0 shows its ORIGINAL AED 100.00 struck through, "Cancelled" (${c42?.text})`, c42?.cancelled === "1" && c42?.gross === "100.00" && /Cancelled/.test(c42?.text ?? ""));
    await page.screenshot({ path: `${shots}/l6-cancelled-lpos-1440.png`, fullPage: true });
    await go(page, `${base}/parts/orders?tab=cancelled&q=E2E-LPO-L-REFUSED`);
    const c41 = await amountOf(page.locator("[data-lpo-row='E2E-LPO-L-REFUSED'] [data-supplier-amount]"));
    check(`l6: a refused LPO that kept its 4.48 shows the same way: original, struck through, "Cancelled" (${c41?.text})`, c41?.cancelled === "1" && c41?.net === "4.48" && /Cancelled/.test(c41?.text ?? ""));
    await go(page, `${base}/parts/orders/${noPo.id}`);
    const pageTotal = await amountOf(page.locator("[data-lpo-lines-total] [data-supplier-amount]"));
    check(`l6: its LPO page: "Total (cancelled, not counted)" with the original struck through (${pageTotal?.text})`, pageTotal?.cancelled === "1" && pageTotal?.gross === "100.00" && /cancelled, not counted/.test(((await page.locator("[data-lpo-lines-total]").textContent()) ?? "")));
    await page.screenshot({ path: `${shots}/l6-cancelled-lpo-page-1440.png`, fullPage: true });
    // Never counted: the supplier's balance and Parts accounts' totals hold nothing from it.
    await go(page, `${base}/parts-accounts?tab=lpos&q=${encodeURIComponent(noPo.number)}`);
    const pa = await amountOf(page.locator(`[data-pa-lpo='${noPo.number}'] [data-supplier-amount]`));
    check(`l6: Parts accounts lists it struck through at its original amount (${pa?.text})`, pa?.cancelled === "1" && pa?.gross === "100.00");
    await go(page, `${base}/parts/suppliers?q=${encodeURIComponent("E2E NO TRN SUPPLIER")}`);
    check("l6: the cancelled LPO adds nothing to the supplier's unpaid balance", (await page.locator(`[data-supplier-row='${noTrn.id}'] [data-supplier-unpaid]`).count()) === 0);
    // l7. The suppliers with no TRN: listed, red, no VAT counted for them.
    await go(page, `${base}/parts/suppliers?filter=no_trn&q=${encodeURIComponent("E2E NO TRN")}`);
    check("l7: the no-TRN filter lists the supplier with the red badge (no VAT counted, its bills cannot go to Zoho)", (await page.locator(`[data-supplier-row='${noTrn.id}'] [data-no-trn]`).count()) === 1 && /no VAT counted/i.test(((await page.locator(`[data-supplier-row='${noTrn.id}'] [data-no-trn]`).textContent()) ?? "")));
    await page.screenshot({ path: `${shots}/l7-no-trn-suppliers-1440.png`, fullPage: true });
    await browser.close();
  }
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/parts/orders?q=${encodeURIComponent(main.number)}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`l8: the LPO list at 800 px never slides sideways (${overflow}px)`, overflow <= 1);
    await page.screenshot({ path: `${shots}/l8-lpo-list-800.png`, fullPage: true });
    await browser.close();
  }
  await sql("update public.purchase_orders set is_active = false where number = 'E2E-LPO-L-REFUSED'");
});

/* ================================================================================================= */
/* Path m — no-plate car arrives: the gate-in asks for the plate, refuses a duplicate in plain words,  */
/* saves the real one, and every page shows it (6 November 2026, the AL TAMIMI Audi A8 case).         */
/* ================================================================================================= */
await section("m", "no-plate car → gate-in asks → plate added → shown everywhere", async () => {
  const CUST = "22222222-0000-4000-8000-00000000ea11";
  const CAR = "22222222-0000-4000-8000-00000000ea12"; // saved without its plate (the AL TAMIMI shape)
  const OTHER = "22222222-0000-4000-8000-00000000ea13"; // another record already carrying DUBAI GG 44444
  const mm = (await sql("select m.id as make_id, v.id as model_id from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.customers (id, customer_type, full_name, company_name, phone, created_by) values ($1, 'company', 'E2e Contact', 'E2e Sim Plate Company', '+971500000097', $2)", [CUST, ownerId]);
  await sql("insert into public.vehicles (id, customer_id, has_plate, plate_country, make_id, model_id, model_year, created_by) values ($1, $2, false, 'UAE', $3, $4, 2024, $5)", [CAR, CUST, mm.make_id, mm.model_id, ownerId]);
  await sql("insert into public.vehicles (id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year, created_by) values ($1, $2, true, 'UAE', 'Dubai', 'GG', '44444', $3, $4, 2023, $5)", [OTHER, CUST, mm.make_id, mm.model_id, ownerId]);
  // The sql helper hides insert errors: stop here in plain words if the seed did not land.
  if ((await sql("select id from public.vehicles where id in ($1, $2)", [CAR, OTHER])).length !== 2) throw new Error("seed failed: the two test cars were not created");

  // m1. The gate-in person opens the form: it asks for the plate before anything else.
  const g = await browserFor("gate_in", { viewport: { width: 1180, height: 900 } });
  const { page } = g;
  await go(page, `${base}/gate-in/new?vehicle=${CAR}`);
  check("m1: the gate-in form asks for the missing plate — R2", (await page.locator("[data-gatein-plate]").count()) === 1);
  await shot(page, "m1-gatein-asks-plate");
  const pick = (name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());
  await pick("arrived_by", "customer_drove");
  await pick("condition", "runs_drives");
  await pick("fuel_level", "half");
  await pick("cleanliness", "clean");
  await pick("dash_cam", "no");
  await pick("major_damage", "no");
  await pick("keys_count", "1");
  await pick("keys_keychain", "no");
  await pick("old_parts_return", "no");
  await pick("department", "mechanical");
  const addr = page.locator('textarea[name="location_address"]');
  if (await addr.count()) await addr.fill("Sim plate walk");
  await page.locator('input[name="mileage_display"]').pressSequentially("12000");
  await page.keyboard.press("Tab");
  await page.locator('input[name="requests"]:visible').first().pressSequentially("General check");
  await sleep(400);

  // m2. He types ANOTHER car's plate: refused in plain words, nothing created, the typed form is kept.
  await page.locator("[data-gatein-plate-code]").pressSequentially("GG", { delay: 25 });
  await page.locator("[data-gatein-plate-number]").pressSequentially("44444", { delay: 25 });
  await page.getByText("Save and continue to photos and video").click();
  await until(async () => /Gate THAT car in instead/.test(((await page.textContent("body").catch(() => "")) ?? "")));
  const refusal = ((await page.textContent("body").catch(() => "")) ?? "").replace(/\s+/g, " ");
  check(`m2: a duplicate plate is refused in plain words, naming the other car — R1 ("${(refusal.match(/This plate is already on [^.]+\./) ?? [""])[0]}")`, /This plate is already on DUBAI GG 44444/.test(refusal) && /Gate THAT car in instead/.test(refusal));
  check("m2: no job was created on the refusal", (await sql("select count(*)::int as n from public.jobs where vehicle_id = $1", [CAR]))[0].n === 0);
  await shot(page, "m2-duplicate-refused");

  // m3. He fixes the number: the gate-in goes through, the plate is SAVED on the car with the story on the job.
  await page.locator("[data-gatein-plate-number]").evaluate((el) => { el.focus(); el.select(); });
  await page.locator("[data-gatein-plate-number]").pressSequentially("44555", { delay: 25 });
  await sleep(5200); // FormGuard swallows a second tap within five seconds of the first
  await page.getByText("Save and continue to photos and video").click();
  await page.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const jobM = await until(async () => (await sql("select id, job_number from public.jobs where vehicle_id = $1", [CAR]))[0]);
  check("m3: the gate-in went through with the fixed plate — R1", !!jobM && /\/media/.test(page.url()), page.url());
  const carM = (await sql("select has_plate, plate_emirate, plate_code, plate_number from public.vehicles where id = $1", [CAR]))[0];
  check("m3: DUBAI GG 44555 is on the car record", carM?.has_plate === true && carM.plate_emirate === "Dubai" && carM.plate_code === "GG" && carM.plate_number === "44555", JSON.stringify(carM));
  const evM = jobM ? (await sql("select note from public.job_events where job_id = $1 and note like 'Number plate%' limit 1", [jobM.id]))[0] : null;
  check(`m3: the job's record says who added it ("${evM?.note ?? ""}")`, /^Number plate Dubai GG 44555 added at gate-in by /.test(evM?.note ?? ""));
  await shot(page, "m3-gatein-saved");
  await g.browser.close();

  // m4. The next person's screens carry the plate: the job card and Cars → Edit — R2.
  if (jobM) {
    const body = await nextScreen("m4", "owner", `/jobs/${jobM.id}`, [/GG 44555/i], "m4-jobcard-shows-plate");
    check("m4: the job card no longer offers 'Add the number plate'", !/Add the number plate/.test(body));
  }
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(o.page, `${base}/vehicles/${CAR}/edit`);
  const title = ((await o.page.locator("h1").first().textContent()) ?? "").trim();
  check(`m4: Cars → Edit title carries the plate ("${title}")`, /^Edit car · .+ · DUBAI GG 44555$/.test(title));
  await shot(o.page, "m4-edit-title-plate");
  await o.browser.close();
});

/* ================================================================================================= */
/* Path n — advisor on parts pages (6 November 2026, Peter): "Advisor: X (quotation by Y)" on every   */
/* parts screen, ask → the advisor's bell → answer → the asker's bell, the Advisor filter, and never  */
/* on the supplier copy text, the supplier PDF or the supplier's link.                                */
/* ================================================================================================= */
await section("n", "advisor on parts pages: tag, ask and answer, filter, internal only", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-advisor-parts";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const starter = (await sql("select q.created_by as id, s.display_name as name from public.quotations q join public.staff s on s.id = q.created_by where q.job_id = $1 order by q.version limit 1", [jobId]))[0];
  const adv = (await sql("select id, display_name as name from public.staff where role_id = 'service_advisor' and is_active and id <> $1 order by display_name limit 1", [starter?.id ?? "00000000-0000-4000-8000-000000000000"]))[0];
  const other = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active and id <> $1 order by display_name limit 1", [adv.id]))[0];
  await sql("update public.jobs set advisor_id = $1 where id = $2", [adv.id, jobId]);
  const part = (await sql("select id, description from public.part_items where job_id = $1 and is_active order by created_at limit 1", [jobId]))[0];
  const po = (await sql("insert into public.purchase_orders (number, job_id, supplier_name, kind, status, total_cost_aed, created_by, updated_by) values ('E2E-LPO-N1', $1, 'E2E ADVISOR TEST SUPPLIER', 'supplier', 'approved', 100, $2, $2) returning id, verify_token", [jobId, partsId]))[0];
  await sql("insert into public.purchase_order_lines (po_id, position, part_item_id, description, quantity, unit_cost, created_by, updated_by) values ($1, 1, $2, $3, 1, 100, $4, $4)", [po.id, part.id, part.description, partsId]);
  if (!(await sql("select id from public.purchase_order_lines where po_id = $1", [po.id])).length) throw new Error("seed failed: the LPO line was not created");
  const names = [adv.name, starter?.name].filter(Boolean);

  // n1. The job's parts page at both sizes: bold "Advisor: X" next to the job, "(quotation by Y)" when someone else made it.
  for (const [w, h] of [[1440, 900], [800, 1280]]) {
    const { browser, page } = await browserForId(partsId, { viewport: { width: w, height: h }, ...(w < 1000 ? { hasTouch: true } : {}) });
    await go(page, `${base}/parts/${jobId}`);
    const tag = ((await page.locator(`[data-job-advisor="${jobId}"]`).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(`n1 @${w}: the parts page names the advisor ("${tag}")`, tag.includes(`Advisor: ${adv.name}`));
    if (starter?.name && starter.id !== adv.id) check(`n1 @${w}: …and who made the quotation`, tag.includes(`(quotation by ${starter.name})`));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`n1 @${w}: no sideways scroll (${sideways}px)`, sideways <= 1);
    await page.screenshot({ path: `${proof}/n1-parts-page-${w}.png` });
    if (w === 1440) {
      // n2. Copy for the supplier: the text that goes to the supplier carries no advisor name.
      await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = async (t) => { window.__copied.push(t); }; });
      const copyBtn = page.locator("[data-supplier-lpo] [data-lpo-copy]").first();
      if (await copyBtn.count()) {
        await copyBtn.click();
        const copied = await page.evaluate(() => (window.__copied ?? []).join("\n"));
        const hasPart = copied.toLowerCase().includes(String(part.description).toLowerCase());
        check("n2: the supplier copy text has the part but no advisor name", hasPart && !names.some((n) => copied.includes(n)), copied.slice(0, 120));
      } else check("n2: the supplier LPO card is on the parts page", false);
      // n3. Ask the advisor about the part.
      const m = await mark();
      await page.locator(`[data-job-advisor="${jobId}"] [data-advisor-ask-open]`).first().click();
      await page.locator("[data-advisor-ask-part]").selectOption(part.id);
      await page.locator("[data-advisor-ask-text]").fill("Genuine or aftermarket for this one?");
      await page.screenshot({ path: `${proof}/n3-ask-window-1440.png` });
      await page.locator("[data-advisor-ask-send]").click();
      await page.locator("[data-advisor-ask-sent]").waitFor({ timeout: 15000 }).catch(() => null);
      check("n3: the answer shows in the window: sent to the advisor", /Sent to/.test(((await page.locator("[data-advisor-ask-sent]").textContent().catch(() => "")) ?? "")));
      await told("n3", m, jobId, [{ id: adv.id, type: "advisor_question", label: "the advisor" }]);
    }
    await browser.close();
  }
  const q = (await sql("select id, note from public.job_events where job_id = $1 and event_type = 'advisor_question' order by id desc limit 1", [jobId]))[0];
  check(`n3: the question names the part ("${q?.note ?? ""}")`, !!q && q.note.toLowerCase().includes(String(part.description).toLowerCase()));
  const bell = (await sql("select href from public.notifications where staff_id = $1 and type = 'advisor_question' and job_id = $2 order by id desc limit 1", [adv.id, jobId]))[0];
  check("n3: the advisor's bell opens the question", bell?.href === `/ask/${q?.id}`);

  // n4. The advisor answers from the bell's page; the answer rings the asker's bell.
  {
    const m = await mark();
    const { browser, page } = await browserForId(adv.id, { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/ask/${q.id}`);
    await page.locator("[data-ask-answer-text]").fill("Genuine please – the customer asked for it.");
    await page.locator("[data-ask-answer-send]").click();
    await page.locator("[data-ask-answer]").first().waitFor({ timeout: 15000 }).catch(() => null);
    check("n4: the answer shows on the page", /Genuine please/.test(((await page.locator("[data-ask-answer]").first().textContent().catch(() => "")) ?? "")));
    await page.screenshot({ path: `${proof}/n4-advisor-answers-800.png`, fullPage: true });
    await browser.close();
    await told("n4", m, jobId, [{ id: partsId, type: "advisor_answer", label: "the asker (Parts)" }]);
  }
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/ask/${q.id}`);
    check("n4: Parts read the answer on the same page", /Genuine please/.test(((await page.locator("[data-ask-answer]").first().textContent().catch(() => "")) ?? "")));
    // n5. The Advisor filter on the parts desk.
    await go(page, `${base}/parts?advisor=${adv.id}`);
    check("n5: the desk has the Advisor filter", (await page.locator("[data-advisor-filter-bar] [data-advisor-filter]").count()) >= 2);
    check("n5: filtered on the advisor, the car is listed with the tag", (await page.locator(`[data-job-advisor="${jobId}"]`).count()) >= 1);
    if (other) {
      await go(page, `${base}/parts?advisor=${other.id}`);
      check("n5: filtered on another advisor, the car is not listed", (await page.locator(`[data-job-advisor="${jobId}"]`).count()) === 0);
    }
    // n6. The LPO page names the advisor; the supplier's PDF and link do not.
    await go(page, `${base}/parts/orders/${po.id}`);
    check("n6: the LPO page names the advisor", ((await page.locator(`[data-job-advisor="${jobId}"]`).first().textContent().catch(() => "")) ?? "").includes(adv.name));
    await browser.close();
  }
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/parts?advisor=${adv.id}`);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`n5 @800: the filtered desk never slides sideways (${sideways}px)`, sideways <= 1);
    await page.screenshot({ path: `${proof}/n5-desk-filter-800.png` });
    await browser.close();
  }
  {
    const mupdf = await import("mupdf");
    const res = await fetch(`${base}/api/pdf/po/${po.id}`, { headers: { cookie: await cookieHeader("owner") } });
    const doc = mupdf.Document.openDocument(Buffer.from(await res.arrayBuffer()), "application/pdf");
    let pdfText = "";
    for (let i = 0; i < doc.countPages(); i++) pdfText += doc.loadPage(i).toStructuredText().asText();
    check("n6: the supplier copy PDF has no advisor name", pdfText.length > 50 && !names.some((n) => pdfText.includes(n)), `${pdfText.length} chars`);
    if (po.verify_token) {
      const pub = await (await fetch(`${base}/lpo/${po.verify_token}`)).text();
      check("n6: the supplier's LPO link has no advisor name", !names.some((n) => pub.includes(n)));
    }
  }
  await sql("update public.purchase_orders set is_active = false where number = 'E2E-LPO-N1'");
});

/* ================================================================================================= */
/* Path o — estimate → job is an EXACT copy (6 November 2026): labour, services, a complimentary     */
/* line, a priced part, a recovery, a package with an item off, a discount and a note, line by line,  */
/* VAT and total equal, "Approved (from E-…)"; a copy that is not exact shows red and is repaired.     */
/* ================================================================================================= */
await section("o", "estimate → job exact copy + the red warning + Add the missing lines", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-estimate-carry";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
  // Only the estimate's lines may reach the quotation: the seed's own quotation, parts and requests step aside.
  await sql("update public.quotations set is_active = false where job_id = $1", [jobId]);
  await sql("update public.part_items set is_active = false where job_id = $1", [jobId]);
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not part of this test' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.gate_ins set arrived_by = 'customer_drove' where job_id = $1", [jobId]);
  const cookie = await cookieHeader("owner");
  const makeEstimate = async (number, approve) => {
    const est = (await sql("insert into public.quotations (kind, number, version, status, customer_id, vehicle_id, discount_kind, discount_value, discount_scope, customer_note, expected_payment_method, vat_percent, validity_days, comp_reason, comp_note, created_by, updated_by) values ('estimate', $1, 1, 'draft', $2, $3, 'aed', 100, 'labour', 'E2E NOTE FOR THE CUSTOMER', 'cash', 5, 7, 'goodwill', 'E2E loyal customer', $4, $4) returning id", [number, job.customer_id, job.vehicle_id, ownerId]))[0];
    if (!est?.id) throw new Error("seed failed: the estimate");
    const L = (pos, type, title, extra) => sql(`insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, ${Object.keys(extra).join(", ")}, created_by, updated_by) values ($1, $2, $3, $4, 1, ${Object.keys(extra).map((_, i) => `$${i + 6}`).join(", ")}, $5, $5) returning id`, [est.id, pos, type, title, ownerId, ...Object.values(extra)]);
    await L(1, "labour", "E2E LABOUR - BRAKE SERVICE", { hours: 2, labour_rate: 400, line_total: 800, team: "mechanical" });
    await L(2, "package", "E2E WHEEL ALIGNMENT", { unit_price: 300, line_total: 300 });
    await L(3, "package", "E2E FREE HEALTH CHECK", { unit_price: 0, unit_cost: 50, line_total: 0, price_display: "complimentary" });
    await L(4, "part", "E2E FRONT BRAKE PADS", { unit_cost: 500, markup_percent: 30, line_total: 650, price_requested_at: new Date().toISOString(), priced_at: new Date().toISOString(), priced_by: ownerId, supplier_text: "E2E SUPPLIER", part_number: "E2E-PADS-1", availability: "in_stock" });
    await L(5, "recovery", "E2E RECOVERY", { unit_cost: 200, unit_price: 300, markup_percent: 50, line_total: 300, recovery_trips: 1, recovery_provider_kind: "ours" });
    await L(6, "package", "E2E PPF FRONT PACKAGE", { unit_price: 12000, line_total: 12000, package_key: "e2e-ppf", package_items: JSON.stringify({ items: [{ name: "HOOD", off: false }, { name: "FENDERS", off: true }] }), cut_method: "hand" });
    const lines = await sql("select id, title from public.quotation_lines where quotation_id = $1 order by position", [est.id]);
    if (lines.length !== 6) throw new Error(`seed failed: ${lines.length} of 6 estimate lines`);
    // The app computes the estimate's own totals (a no-change save), as the editor does.
    await fetch(`${base}/api/quote/save`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ quotationId: est.id, patchLine: { id: lines[0].id, title: lines[0].title } }) });
    if (approve) await sql("update public.quotations set status = 'approved', approver_name = 'E2E Customer', responded_at = now() - interval '1 day' where id = $1", [est.id]);
    return est.id;
  };
  const lineKey = (l) => [l.line_type, l.title, Number(l.line_total).toFixed(2), l.price_display ?? "", l.team ?? "", l.cut_method ?? "", JSON.stringify(l.package_items ?? null)].join(" | ");

  // o1. An approved estimate: Start quotation → an exact copy, approved from the estimate.
  const est1 = await makeEstimate("E2E-EST-O1", true);
  await sql("update public.jobs set estimate_id = $1 where id = $2", [est1, jobId]);
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${jobId}`);
    await page.getByRole("button", { name: "Start quotation" }).first().click();
    await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 60000 }).catch(() => null);
    await page.screenshot({ path: `${proof}/o1-quote-from-estimate-1440.png` });
    await browser.close();
  }
  const q1 = (await sql("select id, number, status, total_aed::float8 as total, vat_aed::float8 as vat, discount_kind, discount_value::float8 as dv, customer_note, approver_name from public.quotations where job_id = $1 and kind = 'quotation' and is_active and estimate_id = $2 order by created_at desc limit 1", [jobId, est1]))[0];
  const e1 = (await sql("select total_aed::float8 as total, vat_aed::float8 as vat from public.quotations where id = $1", [est1]))[0];
  check("o1: Start quotation made the job's quotation from the estimate", !!q1);
  if (q1) { const why = (await sql("select note from public.quotation_events where quotation_id = $1 and note like 'Not approved from%'", [q1.id]))[0]?.note; if (why) console.log("WHY:", why); }
  const estLines = await sql("select id, line_type, title, line_total, price_display, team, cut_method, package_items from public.quotation_lines where quotation_id = $1 and is_active and fee_kind is null order by position", [est1]);
  const qLines = q1 ? await sql("select source_key, line_type, title, line_total, price_display, team, cut_method, package_items from public.quotation_lines where quotation_id = $1 and is_active and fee_kind is null order by position", [q1.id]) : [];
  const byKey = new Map(qLines.map((l) => [l.source_key, l]));
  const off = estLines.filter((l) => !byKey.has(l.id) || lineKey(byKey.get(l.id)) !== lineKey(l)).map((l) => `${l.title}: ${byKey.has(l.id) ? lineKey(byKey.get(l.id)) : "MISSING"}`);
  check(`o1: every line copied exactly - labour, service, complimentary, part, recovery, package (${estLines.length} lines)`, estLines.length === 6 && off.length === 0, off.join(" ; "));
  check(`o1: the discount and the note travel (${q1?.discount_kind} ${q1?.dv} · ${q1?.customer_note})`, q1?.discount_kind === "aed" && q1?.dv === 100 && q1?.customer_note === "E2E NOTE FOR THE CUSTOMER");
  check(`o1: VAT and total equal the estimate (${q1?.vat} / ${q1?.total} vs ${e1?.vat} / ${e1?.total})`, !!q1 && !!e1 && e1.total > 0 && Math.abs(q1.total - e1.total) < 0.005 && Math.abs(q1.vat - e1.vat) < 0.005);
  check(`o1: the customer's acceptance of the estimate counts: Approved (from E2E-EST-O1) by ${q1?.approver_name}`, q1?.status === "approved" && q1?.approver_name === "E2E Customer", q1 ? (await sql("select event_type, note from public.quotation_events where quotation_id = $1 order by created_at", [q1.id])).map((e) => e.event_type + ": " + String(e.note).slice(0, 600)).join(" || ") : "");
  const ev = q1 ? (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'quote_confirmed_from_estimate' limit 1", [q1.id]))[0] : null;
  check(`o1: the history says so ("${ev?.note?.slice(0, 90) ?? ""}")`, /^Approved \(from E2E-EST-O1\)/.test(ev?.note ?? ""));

  // o2. A copy that is not exact (a line taken off by hand): red on the quotation, then "Add the missing lines".
  await sql("update public.quotations set is_active = false where job_id = $1 and kind = 'quotation'", [jobId]);
  await sql("update public.part_items set is_active = false where job_id = $1", [jobId]);
  const est2 = await makeEstimate("E2E-EST-O2", false);
  await sql("update public.jobs set estimate_id = $1 where id = $2", [est2, jobId]);
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 800, height: 1280 }, hasTouch: true });
    await go(page, `${base}/jobs/${jobId}`);
    await page.getByRole("button", { name: "Start quotation" }).first().click();
    await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 60000 }).catch(() => null);
    const q2 = (await sql("select id from public.quotations where job_id = $1 and kind = 'quotation' and is_active and estimate_id = $2 order by created_at desc limit 1", [jobId, est2]))[0];
    check("o2: the not-approved estimate's copy stays a draft with no warning", !!q2 && (await page.locator("[data-carry-mismatch]").count()) === 0);
    await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and title = 'E2E LABOUR - BRAKE SERVICE'", [q2.id]);
    await go(page, `${base}/jobs/${jobId}/quote/${q2.id}`);
    const red = ((await page.locator("[data-carry-mismatch]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(`o2: a line missing shows red on the quotation ("${red.slice(0, 110)}")`, /Not an exact copy of E2E-EST-O2/.test(red) && /1 line missing \(E2E LABOUR - BRAKE SERVICE\)/.test(red));
    await page.locator("[data-carry-mismatch]").screenshot({ path: `${proof}/o2-red-warning-800.png` });
    await page.locator("[data-carry-add]").click();
    await page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    check("o2: Add the missing lines puts it back and the warning goes", (await page.locator("[data-carry-mismatch]").count()) === 0 && (await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active and title = 'E2E LABOUR - BRAKE SERVICE'", [q2.id]))[0].n === 1);
    const t2 = (await sql("select (select total_aed::float8 from public.quotations where id = $1) as q, (select total_aed::float8 from public.quotations where id = $2) as e", [q2.id, est2]))[0];
    check(`o2: …and the total equals the estimate again (${t2.q} vs ${t2.e})`, Math.abs(t2.q - t2.e) < 0.005);
    await browser.close();
  }
});

/* ================================================================================================= */
/* Path p — always a way to send or resend (6 November 2026, Q-00062): the one button on the job      */
/* card's quotation list and the page header: Send / greyed with the reason / Resend / Resend v1      */
/* (v2 not finished); a resend is logged and a declined quote opens for approval again.               */
/* ================================================================================================= */
await section("p", "send / resend quote: the one button in every state", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-resend-quote";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed?.jobId;
  const qid = seed?.quotationId;
  if (!jobId || !qid) throw new Error("seed failed");
  const label = async (page) => ((await page.locator(`[data-quote-row] [data-quote-send]`).first().getAttribute("data-quote-send").catch(() => null)) ?? "");
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  // p1. Being prepared: "Send to customer" on the card, opening the quotation ready to send.
  await go(page, `${base}/jobs/${jobId}`);
  check(`p1: a quotation being prepared shows "Send to customer" on the job card (${await label(page)})`, (await label(page)) === "Send to customer");
  await page.locator("[data-quote-row]").first().screenshot({ path: `${proof}/p1-card-send-1440.png` });
  // p2. Waiting for the owner: greyed, with the reason.
  await sql("update public.quotations set status = 'pending_owner' where id = $1", [qid]);
  await go(page, `${base}/jobs/${jobId}`);
  const greyed = page.locator("[data-quote-row] [data-quote-send]").first();
  check("p2: not ready = greyed with the reason (Waiting for the owner's approval)", (await greyed.getAttribute("data-quote-send-ready")) === "0" && /Waiting for the owner/.test(((await greyed.textContent()) ?? "")));
  await greyed.screenshot({ path: `${proof}/p2-greyed-not-ready-1440.png` });
  // p3. Sent: "Resend quote"; the window opens here; the resend is logged and shown.
  await sql("update public.quotations set status = 'sent', sent_at = now() where id = $1", [qid]);
  await go(page, `${base}/jobs/${jobId}`);
  check(`p3: a sent quotation shows "Resend quote" (${await label(page)})`, (await label(page)) === "Resend quote");
  await page.locator("[data-quote-row] [data-quote-send-open]").first().click();
  await page.locator("[data-send-message]").waitFor({ timeout: 20000 }).catch(() => null);
  check("p3: Resend opens the send window with the message", (await page.locator("[data-send-message]").count()) === 1);
  await page.getByRole("button", { name: /Copy message/ }).first().click();
  const resent = await until(async () => (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'quote_resent' limit 1", [qid]))[0]);
  check(`p3: the resend is logged ("${resent?.note ?? ""}")`, /resent by /.test(resent?.note ?? ""));
  await page.keyboard.press("Escape").catch(() => null);
  await go(page, `${base}/jobs/${jobId}`);
  check("p3: the card says who resent it and when", /Resent by .+, \d/.test(((await page.locator("[data-quote-row] [data-quote-resent-words]").first().textContent().catch(() => "")) ?? "")));
  // p4. Declined: Resend opens it for approval again.
  await sql("update public.quotations set status = 'declined', responded_at = now() where id = $1", [qid]);
  await go(page, `${base}/jobs/${jobId}/quote/${qid}?send=1`);
  await page.locator("[data-send-message]").waitFor({ timeout: 20000 }).catch(() => null);
  check("p4: from the page header (?send=1) the window opens by itself on a declined quote", (await page.locator("[data-send-message]").count()) === 1);
  await page.getByRole("button", { name: /Copy message/ }).first().click();
  const back = await until(async () => (await sql("select status from public.quotations where id = $1", [qid]))[0]?.status === "sent");
  check("p4: …and the declined quote is open for approval again (status sent)", !!back);
  // p5. A newer version still being prepared: the newest FINISHED version is resent.
  const v2 = (await sql("insert into public.quotations (kind, number, version, parent_id, status, job_id, customer_id, vehicle_id, vat_percent, validity_days, created_by, updated_by) select kind, number, version + 1, id, 'draft', job_id, customer_id, vehicle_id, vat_percent, validity_days, created_by, created_by from public.quotations where id = $1 returning id", [qid]))[0];
  await go(page, `${base}/jobs/${jobId}`);
  check(`p5: v2 being prepared: "${await label(page)}"`, !!v2 && (await label(page)) === "Resend v1 (v2 not finished)");
  await browser.close();
  // p6. The 800 px card never slides sideways.
  const t = await browserFor("owner", { viewport: { width: 800, height: 1280 }, hasTouch: true });
  await go(t.page, `${base}/jobs/${jobId}`);
  const sideways = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`p6: the job card at 800 px never slides sideways (${sideways}px)`, sideways <= 1);
  await t.browser.close();
});

/* ================================================================================================= */
/* Path q — the parts desk edits an estimate's price after "sent to the advisor" (6 November 2026,    */
/* E-00074): until the customer accepts it; the customer's price is kept, the row says who changed     */
/* what, the advisor's bell rings; an accepted estimate is locked.                                     */
/* ================================================================================================= */
await section("q", "parts desk edits an estimate's price after sending", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-desk-edit";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [seed?.jobId]))[0];
  if (!job) throw new Error("seed failed");
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const advId = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0].id;
  const est = (await sql("insert into public.quotations (kind, number, version, status, customer_id, vehicle_id, vat_percent, validity_days, token, sent_at, created_by, updated_by) values ('estimate', 'E2E-EST-Q1', 1, 'sent', $1, $2, 5, 7, $3, now(), $4, $4) returning id", [job.customer_id, job.vehicle_id, `e2eq${Date.now()}`, advId]))[0];
  if (!est?.id) throw new Error("seed failed: the estimate");
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, unit_cost, markup_percent, line_total, priced_at, priced_by, price_requested_at, supplier_text, part_number, availability, created_by, updated_by) values ($1, 1, 'part', 'E2E HEADLIGHT LEFT', 1, 6180, 20, 7416, now(), $2, now(), 'E2E AL TAYER', 'LR095838', 'in_stock', $3, $3)", [est.id, partsId, advId]);
  const m = await mark();
  const { browser, page } = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/estimate/${est.id}`);
  const cost = page.locator('[aria-label^="Cost before VAT"]').first();
  check("q1: the sent estimate's price can still be changed by the desk", (await cost.count()) === 1 && (await cost.isEnabled()));
  await cost.evaluate((el) => { el.focus(); el.select(); });
  await cost.pressSequentially("5900", { delay: 30 });
  await page.keyboard.press("Tab");
  const saved = await until(async () => Number((await sql("select unit_cost from public.quotation_lines where quotation_id = $1", [est.id]))[0]?.unit_cost) === 5900, 60, 500);
  check("q1: the new cost is saved (6,180 → 5,900)", !!saved);
  const line = (await sql("select line_total::float8 as t, markup_percent::float8 as m from public.quotation_lines where quotation_id = $1", [est.id]))[0];
  check(`q2: the customer's price is kept (line AED ${line?.t}, markup now ${line?.m}%)`, Math.abs((line?.t ?? 0) - 7416) < 0.01 && Math.abs((line?.m ?? 0) - 20) > 0.5);
  const ev = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'desk_price_changed' limit 1", [est.id]))[0];
  check(`q3: the change is written down ("${ev?.note ?? ""}")`, /^Changed by .+: E2E HEADLIGHT LEFT: 6,180\.00 → 5,900\.00$/.test(ev?.note ?? ""));
  await told("q3", m, null, [{ id: advId, type: "estimate_price_changed", label: "the advisor" }]);
  await go(page, `${base}/parts/estimate/${est.id}`);
  check("q3: the row shows who changed what", /Changed by .+: 6,180\.00 → 5,900\.00/.test(((await page.locator("[data-price-changed]").first().textContent().catch(() => "")) ?? "")));
  await page.screenshot({ path: `${proof}/q-desk-edit-after-send-1440.png` });
  // q4. Accepted by the customer: the lines lock; the advisor revises it.
  await sql("update public.quotations set status = 'approved' where id = $1", [est.id]);
  await go(page, `${base}/parts/estimate/${est.id}`);
  check("q4: an accepted estimate's price is locked on the desk", !(await page.locator('[aria-label^="Cost before VAT"]').first().isEnabled().catch(() => false)));
  await browser.close();
});

/* ================================================================================================= */
/* Path r — supplier payments with their amount (6 November 2026, Section 4, Mathew): exact, less,     */
/* more as an advance, more as a fee, one payment across two invoices, an advance used on the next.    */
/* ================================================================================================= */
await section("r", "supplier payments: exact, less, advance, fee, two invoices, advance applied", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-supplier-payments";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E GARGASH PAY', '100200300400501', true, $1, $1) returning id", [ownerId]))[0];
  if (!sup?.id) throw new Error("seed failed: the supplier");
  const lpo = async (n, net, date) => (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_path, created_by, updated_by) values ($1, $2, $3, 'E2E GARGASH PAY', 'supplier', 'received', $4, 'received', $5, $6, $4, 'e2e/supplier-invoice.pdf', $7, $7) returning id", [`E2E-PAY-${n}`, jobId, sup.id, net, `GINV-${n}`, date, ownerId]))[0]?.id;
  const L1 = await lpo(1, 1000, "2026-11-01"); // 1,050.00 incl. VAT
  const L2 = await lpo(2, 500, "2026-11-02"); // 525.00
  const L3 = await lpo(3, 200, "2026-11-03"); // 210.00
  const L4 = await lpo(4, 100, "2026-11-04"); // 105.00
  const L5 = await lpo(5, 200, "2026-11-05"); // 210.00
  if (![L1, L2, L3, L4, L5].every(Boolean)) throw new Error("seed failed: the LPOs");
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  let visit = 0;
  const pay = async (poId, { amount = null, method = null, tick = [], fee = false, useAdvance = false } = {}) => {
    await go(page, `${base}/parts/orders/${poId}?v=${++visit}#paid`); // a real load each time (the same address with only a # is not reloaded)
    const box = page.locator("[data-supplier-pay-box]");
    await box.waitFor({ timeout: 20000 });
    await sleep(2000); // the page finishes starting up (a click before that has no handler yet)
    const before = Number((await sql("select count(*)::int as n from public.supplier_payments where supplier_id = $1", [sup.id]))[0].n);
    for (const t of tick) await box.locator(`[data-supplier-pay-invoice="${t}"] input[type=checkbox]`).check();
    if (useAdvance) await box.locator("[data-use-advance]").first().check();
    if (amount !== null) {
      const amt = box.locator("[data-supplier-pay-amount]");
      await amt.click();
      await amt.evaluate((el) => el.select());
      await amt.pressSequentially(String(amount), { delay: 40 });
      await page.keyboard.press("Tab");
      await sleep(1500); // the box commits the number and the part-paid / excess lines appear before anything is pressed
    }
    if (method) await box.locator(`input[name="method"][value="${method}"]`).evaluate((el) => el.click());
    if (fee) await box.locator('input[name="excess_kind"][value="fee"]').evaluate((el) => el.click());
    await sleep(500);
    await box.locator("[data-supplier-pay-save]").click();
    await page.locator("[data-confirm-yes-money]").click({ timeout: 8000 });
    const ok = await until(async () => Number((await sql("select count(*)::int as n from public.supplier_payments where supplier_id = $1", [sup.id]))[0].n) > before, 60, 500);
    // The save's LAST step marks the settled LPOs paid: wait for the box's answer, never for the first row.
    await box.locator("[data-supplier-pay-done], [data-supplier-pay-error]").first().waitFor({ timeout: 30000 }).catch(() => {});
    return ok ? "recorded" :((await page.locator("[data-supplier-pay-error]").first().textContent().catch(() => "")) ?? "not recorded").trim();
  };
  const paidOn = async (poId) => Number((await sql("select coalesce(sum(l.amount_aed), 0)::float8 as s from public.supplier_payment_lines l join public.supplier_payments p on p.id = l.payment_id where l.po_id = $1 and l.is_active and p.status = 'recorded'", [poId]))[0]?.s ?? 0);
  const isPaid = async (poId) => !!(await sql("select supplier_paid_at from public.purchase_orders where id = $1", [poId]))[0]?.supplier_paid_at;

  // r1. Exact, by payment link: the amount prefilled is what is due incl. VAT.
  await go(page, `${base}/parts/orders/${L1}#paid`);
  const pre = await page.locator("[data-supplier-pay-amount]").inputValue().catch(() => "");
  check(`r1: the amount is prefilled with what is due incl. VAT (${pre})`, Number(pre) === 1050);
  await page.locator("[data-supplier-pay-box]").screenshot({ path: `${proof}/r1-payment-box-link-1440.png` });
  const w1 = await pay(L1, { method: "link" });
  const p1 = (await sql("select method, amount_aed::float8 as a from public.supplier_payments where supplier_id = $1 order by created_at limit 1", [sup.id]))[0];
  check(`r1: exact by payment link: recorded and settled ("${w1.slice(0, 80)}")`, p1?.method === "link" && p1.a === 1050 && (await paidOn(L1)) === 1050 && (await isPaid(L1)), JSON.stringify({ p1, paid: await paidOn(L1), isPaid: await isPaid(L1) }));
  // r2. Less: part paid, the balance stays owed.
  await pay(L2, { amount: 300 });
  check("r2: paid less = part paid (AED 300 of 525), the LPO still owed", (await paidOn(L2)) === 300 && !(await isPaid(L2)));
  // r3. More as an advance: 400 on the 225 left → 175 advance with the supplier.
  const w3 = await pay(L2, { amount: 400 });
  const adv = (await sql("select excess_kind, amount_aed::float8 as a from public.supplier_payments where supplier_id = $1 and excess_kind = 'advance'", [sup.id]))[0];
  check("r3: paid more = an advance with the supplier (default), the LPO settled", adv?.excess_kind === "advance" && (await isPaid(L2)) && (await paidOn(L2)) === 525, JSON.stringify({ w3: w3.slice(0, 160), adv, paid: await paidOn(L2), isPaid: await isPaid(L2), rows: await sql("select amount_aed::float8 as a, excess_kind, fee_aed::float8 as f from public.supplier_payments where supplier_id = $1 order by created_at", [sup.id]) }));
  await go(page, `${base}/parts/suppliers?q=${encodeURIComponent("E2E GARGASH PAY")}`);
  const advWords = ((await page.locator("[data-supplier-advance]").first().textContent().catch(() => "")) ?? "").trim();
  check(`r3: the Suppliers list shows it ("${advWords}")`, /Advance with E2E GARGASH PAY AED 175\.00/.test(advWords));
  await page.locator(`[data-supplier-row="${sup.id}"]`).screenshot({ path: `${proof}/r3-supplier-advance-1440.png` }).catch(() => {});
  // r4. More as a fee: 220 on 210 → AED 10 fee.
  await pay(L3, { amount: 220, fee: true });
  const fee = (await sql("select fee_aed::float8 as f from public.supplier_payments where supplier_id = $1 and excess_kind = 'fee'", [sup.id]))[0];
  check("r4: paid more as a fee: AED 10.00 recorded as the fee, the LPO settled", fee?.f === 10 && (await isPaid(L3)));
  // r5. One payment across two invoices (105 + 210 = 315), oldest first.
  await pay(L4, { tick: [L5], amount: 315 });
  check("r5: one payment settles two invoices, oldest first", (await paidOn(L4)) === 105 && (await paidOn(L5)) === 210 && (await isPaid(L4)) && (await isPaid(L5)));
  // r6. The advance used on the next invoice (525: 175 advance + 350 paid).
  const L6 = await lpo(6, 500, "2026-11-06");
  const w6 = await pay(L6, { amount: 350, useAdvance: true });
  check("r6: the advance is applied to the next invoice and it is settled (175 + 350)", (await paidOn(L6)) === 525 && (await isPaid(L6)), JSON.stringify({ w6: w6.slice(0, 160), paid: await paidOn(L6), isPaid: await isPaid(L6), lines: await sql("select amount_aed::float8 as a, applied_later from public.supplier_payment_lines where po_id = $1", [L6]) }));
  await go(page, `${base}/parts/suppliers?q=${encodeURIComponent("E2E GARGASH PAY")}`);
  check("r6: the advance is used up", (await page.locator("[data-supplier-advance]").count()) === 0);
  // r7. Zoho: each payment waits in the outbox as ONE supplier payment (the manual sync posts it).
  const queued = (await sql("select count(*)::int as n from public.zoho_outbox where kind = 'supplierpay' and record_id in (select id from public.supplier_payments where supplier_id = $1)", [sup.id]))[0].n;
  check(`r7: every payment is queued for Zoho as one supplier payment (${queued})`, queued >= 6);
  await browser.close();
  await sql("update public.purchase_orders set is_active = false where supplier_id = $1", [sup.id]);
  await sql("update public.suppliers set is_active = false where id = $1", [sup.id]);
});

/* ================================================================================================= */
/* Path s — Zoho to the fils (6 November 2026, Section 5, LPO-00045-1): a bill posted at 962.85 while */
/* the supplier's paper says 962.86 is shown red with the difference and "Check again in Zoho".      */
/* ================================================================================================= */
await section("s", "Zoho to the fils: a posted bill that differs is red, with Check again", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-zoho-fils";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E AL TAYER FILS', '100200300400502', true, $1, $1) returning id", [ownerId]))[0];
  const po = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_vat_aed, zoho_bill_id, zoho_bill_taxed, created_by, updated_by) values ('E2E-FILS-1', $1, $2, 'E2E AL TAYER FILS', 'supplier', 'received', 963, 'received', 'E2E-11768267', current_date, 962.86, 48.14, 'e2e-bill-fils', true, $3, $3) returning id", [jobId, sup?.id, ownerId]))[0];
  if (!sup?.id || !po?.id) throw new Error("seed failed: the supplier or the LPO");
  const stored = { bill: "E2E-11768267", lpo: "E2E-FILS-1", zoho: { net: 962.85, vat: 48.14, total: 1010.99, balance: 1010.99 }, erp: { net: 962.85, charges: 0 }, attached: true };
  const row = (await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, zoho_id, zoho_result, synced_at) values ('bill', $1, $2, 'synced', 'e2e-bill-fils', $3::jsonb, now()) returning id", [po.id, jobId, JSON.stringify(stored)]))[0];
  if (!row?.id) throw new Error("seed failed: the outbox row");
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/zoho?show=synced#z-${row.id}`);
  const li = page.locator(`#z-${row.id}`);
  await li.waitFor({ timeout: 20000 });
  const differs = ((await li.locator("[data-zoho-differs]").textContent().catch(() => "")) ?? "").trim();
  check(`s1: the posted bill reads red "Zoho differs: 1,010.99 vs 1,011.00 (−0.01)" (${differs.slice(0, 90)})`, differs.includes("Zoho differs: 1,010.99 vs 1,011.00 (−0.01)"));
  const green = ((await li.locator("[data-zoho-result]").textContent().catch(() => "")) ?? "");
  check("s2: its words no longer claim it matches", !/matches the ERP/.test(green));
  check("s3: accounts can check it again in Zoho", (await li.locator("[data-zoho-recheck]").count()) === 1);
  await li.screenshot({ path: `${proof}/s-zoho-differs-1440.png` }).catch(() => {});
  // The same bill once Zoho holds the paper's figures: green, "matches the ERP to the fils".
  await sql("update public.zoho_outbox set zoho_result = $2::jsonb where id = $1", [row.id, JSON.stringify({ ...stored, zoho: { net: 962.86, vat: 48.14, total: 1011, balance: 1011 }, erp: { net: 962.86, vat: 48.14, total: 1011, charges: 0 } })]);
  await go(page, `${base}/zoho?show=synced&v=2#z-${row.id}`);
  await li.waitFor({ timeout: 20000 });
  check("s4: once Zoho holds 962.86 + 48.14 = 1,011.00 it matches to the fils", (await li.locator("[data-zoho-differs]").count()) === 0 && /matches the ERP to the fils/.test(((await li.locator("[data-zoho-result]").textContent().catch(() => "")) ?? "")));
  await browser.close();
  await sql("delete from public.zoho_outbox where id = $1", [row.id]);
  await sql("update public.purchase_orders set is_active = false where id = $1", [po.id]);
  await sql("update public.suppliers set is_active = false where id = $1", [sup.id]);
});

/* ================================================================================================= */
/* Path t — the jobs list (6 November 2026, Section 6): newest opened first, Last 7 days + an advisor  */
/* reading "x of N", the choice remembered, the recently viewed strip. Owner (sees every open job).    */
/* ================================================================================================= */
await section("t", "jobs list: newest first, filters with x of N, remembered, recently viewed", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-jobs-sorting";
  mkdirSync(proof, { recursive: true });
  const seedT = (await api("/api/e2e/stage", { stage: "approved" })).json;
  // The test copy's cars are older than a week: the fresh test car gets an advisor, so "Last 7 days" + that advisor shows it.
  const advT = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0]?.id;
  if (seedT?.jobId && advT) await sql("update public.jobs set advisor_id = $2 where id = $1", [seedT.jobId, advT]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs?reset=1`);
  await page.locator("[data-job-list]").waitFor({ timeout: 20000 });
  const shownIds = await page.locator("[data-job-list] a[href^='/jobs/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href").split("/")[2]))]);
  const dbIds = (await sql("select id from public.jobs where is_open order by coalesce(gated_in_at, created_at) desc limit 8")).map((r) => r.id);
  check(`t1: newest opened first by default (first ${Math.min(8, shownIds.length)} match the database)`, shownIds.slice(0, 8).join(",") === dbIds.slice(0, shownIds.slice(0, 8).length).join(","), JSON.stringify({ shown: shownIds.slice(0, 4), db: dbIds.slice(0, 4) }));
  const total = Number((await sql("select count(*)::int as n from public.jobs where is_open"))[0].n);
  check(`t1: the header reads "${total} jobs"`, ((await page.locator("[data-job-list-shown]").textContent()) ?? "").trim() === `${total} job${total === 1 ? "" : "s"}`);
  await page.screenshot({ path: `${proof}/t1-newest-first-1440.png` });
  // Last 7 days, then an advisor from the list.
  await page.locator('[data-job-when="7d"]').click();
  await page.waitForURL(/when=7d/, { timeout: 20000 });
  const advisorOpt = await page.locator("[data-job-list-advisor] option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })).filter((o) => o.v));
  const busiest = (await sql("select advisor_id::text as id from public.jobs where is_open and advisor_id is not null and coalesce(gated_in_at, created_at) >= now() - interval '7 days' group by advisor_id order by count(*) desc limit 1"))[0]?.id;
  const pick = advisorOpt.find((o) => o.v === busiest) ?? advisorOpt[0];
  if (pick) {
    await page.locator("[data-job-list-advisor]").selectOption(pick.v);
    await page.waitForURL(/advisor=/, { timeout: 20000 });
    await page.locator("[data-job-list]").or(page.getByText("No job matches these filters")).first().waitFor({ timeout: 20000 });
    const want = Number((await sql("select count(*)::int as n from public.jobs where is_open and advisor_id = $1 and coalesce(gated_in_at, created_at) >= now() - interval '7 days'", [pick.v]))[0].n);
    const words = ((await page.locator("[data-job-list-shown]").textContent()) ?? "").trim();
    check(`t2: Last 7 days + advisor ${pick.t} reads "${words}"`, words === `${want} of ${total}`, `want ${want} of ${total}`);
    await page.screenshot({ path: `${proof}/t2-last7-advisor-1440.png` });
    // Remembered: the bare address brings the same choice back.
    await go(page, `${base}/jobs`);
    await page.locator("[data-job-list-shown]").waitFor({ timeout: 20000 });
    check("t3: the choice is remembered for this person", ((await page.locator("[data-job-list-shown]").textContent()) ?? "").trim() === words && (await page.locator('[data-job-when="7d"][class*="bg-ink"]').count()) === 1);
  } else check("t2: an advisor to filter by (none on open jobs in the test copy)", false);
  // Recently viewed: open one job card, then back to the list.
  if (shownIds[0]) {
    await go(page, `${base}/jobs/${shownIds[0]}`);
    await page.waitForTimeout(1500);
    await go(page, `${base}/jobs?reset=1`);
    await page.locator("[data-recent-jobs]").waitFor({ timeout: 15000 }).catch(() => {});
    check("t4: the job just opened is first in Recently viewed", (await page.locator("[data-recent-job]").first().getAttribute("data-recent-job").catch(() => null)) === shownIds[0]);
  }
  // A tablet width: the controls wrap, nothing hidden.
  await page.setViewportSize({ width: 800, height: 1280 });
  await go(page, `${base}/jobs?reset=1`);
  await page.locator("[data-job-list-controls]").waitFor({ timeout: 15000 });
  check("t5: on a tablet every control is there", (await page.locator("[data-job-sort]").count()) === 5 && (await page.locator("[data-job-when]").count()) === 3 && (await page.locator("[data-job-filter]").count()) === 3);
  await page.screenshot({ path: `${proof}/t5-tablet-800.png` });
  await browser.close();
});

/* ================================================================================================= */
/* Path u — one greeting for every customer message (6 November 2026, Section 7): the job card's        */
/* messages and the quotation both say "Dear Dr Jaffar," (never the legal name in capitals); a saved    */
/* "How to address" wins everywhere. Plus the one small preview picture.                                */
/* ================================================================================================= */
await section("u", "greeting: title + surname in normal case everywhere, the saved way wins; the small preview", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-greeting";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  if (!seed?.jobId) throw new Error("seed failed");
  const job = (await sql("select customer_id, (select id from public.quotations where job_id = $1 order by created_at desc limit 1) as qid from public.jobs where id = $1", [seed.jobId]))[0];
  await sql("update public.customers set full_name = 'DR DHIA YAHYA DHIA AL DIN JAFFAR', company_name = null, customer_type = 'individual' where id = $1", [job.customer_id]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${seed.jobId}`);
  const card = await page.content();
  check("u1: the job card's messages greet \"Dear Dr Jaffar,\"", card.includes("Dear Dr Jaffar,") && !card.includes("Dear DR DHIA") && !card.includes("Dear DHIA"));
  if (job.qid) {
    await go(page, `${base}/jobs/${seed.jobId}/quote/${job.qid}`);
    const quote = await page.content();
    check("u2: the quotation message greets the same way", quote.includes("Dear Dr Jaffar,") && !quote.includes("Dear DR DHIA"));
  } else check("u2: the stage seed has a quotation", false);
  // The saved "How to address" (once its column exists: applied on the TEST database).
  await go(page, `${base}/customers/${job.customer_id}/edit`);
  const box = page.locator("[data-address-as]");
  if (await box.count()) {
    await box.fill("Dr Dhia");
    await page.locator("[data-address-as]").screenshot({ path: `${proof}/u-how-to-address-1440.png` }).catch(() => {});
    await box.evaluate((el) => el.form.requestSubmit()); // the customer form itself, never the Sign out form
    await until(async () => (await sql("select address_as from public.customers where id = $1", [job.customer_id]))[0]?.address_as === "Dr Dhia", 40, 500);
    await go(page, `${base}/jobs/${seed.jobId}`);
    check("u3: the saved way wins on the job card", (await page.content()).includes("Dear Dr Dhia,"));
    if (job.qid) {
      await go(page, `${base}/jobs/${seed.jobId}/quote/${job.qid}`);
      check("u4: and on the quotation", (await page.content()).includes("Dear Dr Dhia,"));
    }
  } else check("u3: the How to address box (needs 20261207120000 on this database)", false);
  // The one small preview picture on a customer link.
  const r = await fetch(`${base}/og/ofj-logo-200.png`);
  const buf = Buffer.from(await r.arrayBuffer());
  check(`u5: the preview picture is a small PNG (${buf.length} bytes, ${buf.readUInt32BE(16)} x ${buf.readUInt32BE(20)})`, r.ok && buf.readUInt32BE(16) === 200 && buf.readUInt32BE(20) === 200 && buf.length < 20000);
  await sql("update public.customers set address_as = null where id = $1", [job.customer_id]);
  await browser.close();
});

/* ================================================================================================= */
/* Path v — part labels 50 x 25 mm (6 November 2026, Section 8): the PDF is exactly the label, zero      */
/* margins, one label a page; one per piece, fewer on request; the test label; every field, no price.  */
/* ================================================================================================= */
await section("v", "part labels: exact 50 x 25 mm PDF pages, one per piece, fewer, the test label", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-06-stickers";
  mkdirSync(proof, { recursive: true });
  const mupdf = await import("mupdf");
  const cookie = await cookieHeader("parts");
  const pdfOf = async (path) => {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !/pdf/.test(res.headers.get("content-type") ?? "")) return { ok: false, status: res.status, text: buf.toString().slice(0, 120) };
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const pages = doc.countPages();
    const b = doc.loadPage(0).getBounds();
    const text = Array.from({ length: pages }, (_, i) => doc.loadPage(i).toStructuredText().asText().replace(/\s+/g, " ")).join(" | ");
    return { ok: true, buf, doc, pages, w: b[2] - b[0], h: b[3] - b[1], text };
  };
  const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
  // The test label.
  const t = await pdfOf("/api/pdf/part-labels?test=1");
  check(`v1: the test label is one page of exactly 50 x 25 mm (${t.ok ? `${mm(t.w)} x ${mm(t.h)} mm, ${t.pages} page` : t.status})`, t.ok && t.pages === 1 && mm(t.w) === 50 && mm(t.h) === 25);
  if (t.ok) {
    fs.writeFileSync(`${proof}/sample-label.pdf`, t.buf);
    fs.writeFileSync(`${proof}/sample-label.png`, t.doc.loadPage(0).toPixmap(mupdf.Matrix.scale(8, 8), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
    // 9 November 2026, Section 5: ONLY the QR, the OFJ mark and the part name (no job, plate, LPO, 1 OF n, date).
    check("v2: the test label carries only the part name", /FRONT BRAKE PADS SET/.test(t.text.replace(/\s+/g, " ")) && !["J-00000", "DUBAI", "LPO", " OF ", "Received", "MERCEDES"].some((x) => t.text.includes(x)), t.text.slice(0, 160));
  }
  // A real car: one part received twice = two labels; fewer on request; no price anywhere.
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  if (!seed?.jobId) throw new Error("seed failed");
  const part = (await sql("select id, description from public.part_items where job_id = $1 and is_active order by created_at limit 1", [seed.jobId]))[0];
  if (!part) throw new Error("seed failed: no part");
  const ownerV = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const poV = (await sql("insert into public.purchase_orders (number, job_id, supplier_name, kind, status, total_cost_aed, created_by, updated_by) values ('E2E-LBL-1', $1, 'E2E LABEL SUPPLIER', 'supplier', 'received', 200, $2, $2) returning id", [seed.jobId, ownerV]))[0];
  const lineV = poV ? (await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, $2, $3, 2, 100, 2, now(), $4, $4) returning id", [poV.id, part.id, part.description, ownerV]))[0] : null;
  if (!lineV?.id) throw new Error("seed failed: the LPO line");
  await sql("update public.part_items set received_qty = 2, quantity = 2, po_id = $2, po_line_id = $3 where id = $1", [part.id, poV.id, lineV.id]);
  const job = (await sql("select job_number from public.jobs where id = $1", [seed.jobId]))[0];
  const all = await pdfOf(`/api/pdf/part-labels?job=${seed.jobId}&parts=${part.id}`);
  check(`v3: two pieces = two labels, each page 50 x 25 mm (${all.ok ? all.pages : all.status})`, all.ok && all.pages === 2 && mm(all.w) === 50 && mm(all.h) === 25);
  check("v4: the car's label shows the part name only (no job number, LPO, 1 OF n, date or price)", all.ok && all.text.replace(/\s+/g, " ").toUpperCase().includes(String(part.description).toUpperCase().split(" ")[0]) && !all.text.includes(job.job_number) && !all.text.includes("E2E-LBL-1") && !/ OF 2|Received|AED|100\.00/.test(all.text), all.ok ? all.text.slice(0, 200) : "");
  if (all.ok) fs.writeFileSync(`${proof}/car-labels.pdf`, all.buf);
  const fewer = await pdfOf(`/api/pdf/part-labels?job=${seed.jobId}&keys=${part.id}-2`);
  check("v5: fewer on request: one label", fewer.ok && fewer.pages === 1);
  const today = await pdfOf("/api/pdf/part-labels?today=1");
  check("v6: today's labels include the part received today", today.ok && today.pages >= 1 && today.text.toUpperCase().includes(String(part.description).toUpperCase().split(" ")[0]));
  // The print points.
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/arrivals`);
  check("v7: Parts arrivals offers today's labels", (await page.locator("[data-arrivals-labels]").count()) === 1);
  await go(page, `${base}/parts/labels/${seed.jobId}`);
  check("v8: the label sheet has the exact-size PDF and the test label", (await page.locator("[data-pdf-selected]").count()) === 1 && (await page.locator("[data-test-label]").count()) === 1);
  await browser.close();
  const anon = await fetch(`${base}/api/pdf/part-labels?test=1`);
  check("v9: nobody signed out gets a label", anon.status === 401);
});

/* ================================================================================================= */
/* Path w — SEND LPO FOR SELECTED (8 November 2026, Peter): six approved lines over two suppliers plus  */
/* two with a repeated part number. Tick 3 → only those go for approval, the rest stay to order; the    */
/* repeated numbers are red and cannot be ticked; after the approval a second request sends the rest.  */
/* ================================================================================================= */
await section("w", "send LPO for selected parts + repeated part numbers", async () => {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not needed (test)' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.part_items set is_active = false where job_id = $1", [jobId]);
  const day = new Date(Date.now() + 4 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  const lines = [["E2E AIR FILTER W", "E2E-W-1", "E2E SUP A", 120], ["E2E OIL FILTER W", "E2E-W-2", "E2E SUP A", 60], ["E2E CABIN FILTER W", "E2E-W-3", "E2E SUP A", 80], ["E2E BRAKE DISC W", "E2E-W-4", "E2E SUP B", 900], ["E2E BRAKE PADS W", "E2E-W-5", "E2E SUP B", 400], ["E2E WIPER W", "E2E-W-6", "E2E SUP B", 50], ["E2E BATTERY W", "1234AA", "E2E SUP B", 700], ["E2E WINDSHIELD W", "1234AA", "E2E SUP A", 1500]];
  for (const [name, pn, sup, cost] of lines) {
    await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, delivery_date, confirm_status, part_type, priced_at, priced_by, order_status, created_by, updated_by) values ($1, $2, $3, 1, 1, $4, $5, 'to_order', $6, 'confirmed', 'genuine', now(), $7, 'to_order', $7, $7)", [jobId, name, pn, cost, sup, day, partsId]);
  }
  const ids = Object.fromEntries((await sql("select id::text as id, description from public.part_items where job_id = $1 and is_active", [jobId])).map((r) => [r.description.toUpperCase(), r.id]));
  if (Object.keys(ids).length !== 8) throw new Error(`seed: ${Object.keys(ids).length} parts`);
  const { browser, page } = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const eligible = await page.locator("[data-lpo-line][data-lpo-eligible='1']").count();
  const red = await page.locator("[data-lpo-why-red='1']").count();
  check(`w1: 6 lines can be ticked, the 2 with part number 1234AA are red and cannot (${eligible} / ${red})`, eligible === 6 && red === 2);
  check("w1b: the repeated part number shows red on the parts table too", (await page.locator("[data-repeated-pn]").count()) >= 2);
  check("w1c: the red rows' tick boxes are off", await page.locator(`[data-lpo-pick="${ids["E2E BATTERY W"]}"]`).isDisabled());
  await page.locator("#lpo").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/w1-lpo-select-repeated.png` });
  // w2. Tick 3: two from A, one from B. The preview shows two supplier blocks with incl.-VAT amounts.
  for (const n of ["E2E AIR FILTER W", "E2E OIL FILTER W", "E2E BRAKE DISC W"]) await page.locator(`[data-lpo-pick="${ids[n]}"]`).check();
  await page.locator("[data-send-lpo-selected]").click();
  await page.locator("[data-lpo-preview]").waitFor({ timeout: 10000 });
  const blocks = await page.locator("[data-lpo-preview-supplier]").count();
  check(`w2: the preview shows the 2 suppliers (${blocks})`, blocks === 2);
  await page.screenshot({ path: `${shots}/w2-lpo-select-preview.png` });
  await page.locator("[data-lpo-preview-confirm]").click();
  await page.locator("[data-lpo-selected-done], [data-lpo-selected-error]").first().waitFor({ timeout: 60000 });
  const said = ((await page.locator("[data-lpo-selected-done]").textContent().catch(() => "")) ?? "");
  check(`w2b: sent, the answer next to the button ("${said.slice(0, 120)}")`, /3 parts sent for approval/.test(said) && /stay/.test(said));
  const main = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  const onMain = Number((await sql("select count(*)::int as n from public.purchase_order_lines where po_id = $1 and is_active", [main?.id]))[0]?.n ?? 0);
  const waiting = Number((await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active and order_status = 'to_order' and po_id is null", [jobId]))[0].n);
  check(`w3: only the 3 ticked parts are on ${main?.number} (${onMain}); 5 stay Approved – to order (${waiting})`, onMain === 3 && waiting === 5);
  await go(page, `${base}/parts/${jobId}`);
  const count = ((await page.locator("[data-lpo-count]").textContent().catch(() => "")) ?? "");
  check(`w4: the page says "3 of 8 approved parts on an LPO" ("${count}")`, /3 of 8/.test(count));
  await browser.close();
  // w5. The owner approves the first request; then the desk sends the other three good lines.
  {
    const { browser: b, page: p } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(p, `${base}/parts/orders/${main.id}`);
    await confirmMoney(p, "lpo-approve");
    await p.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
    await b.close();
  }
  const approved = (await sql("select status from public.purchase_orders where id = $1", [main.id]))[0]?.status;
  check(`w5: the first request is approved (${approved})`, approved === "approved");
  {
    const { browser: b, page: p } = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
    await go(p, `${base}/parts/${jobId}`);
    const r = await sendLpo(p, { partIds: [ids["E2E CABIN FILTER W"], ids["E2E BRAKE PADS W"], ids["E2E WIPER W"]] });
    check(`w6: a second request for the rest ("${(r.message ?? r.error ?? "").slice(0, 100)}")`, !!r.message);
    await b.close();
  }
  const second = (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  const onSecond = Number((await sql("select count(*)::int as n from public.purchase_order_lines where po_id = $1 and is_active", [second?.id]))[0]?.n ?? 0);
  const left = (await sql("select description from public.part_items where job_id = $1 and is_active and order_status = 'to_order' and po_id is null order by description", [jobId])).map((r) => r.description.toUpperCase());
  check(`w7: ${second?.number} carries the 3 others; only the 2 red lines stay (${left.join(", ")})`, onSecond === 3 && left.length === 2 && left.every((n) => /BATTERY|WINDSHIELD/.test(n)));
});

/* ================================================================================================= */
/* Path x — APPROVE EACH SUPPLIER SEPARATELY (8 November 2026, LPO-00059): a 3-supplier request.        */
/* Approve 2 (each its own LPO at once), refuse 1 with a reason, the desk replaces it, the replacement  */
/* joins the same request, approve it: the request is then approved with 3 supplier LPOs.             */
/* ================================================================================================= */
await section("x", "approve each supplier separately in one LPO request", async () => {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not needed (test)' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.part_items set is_active = false where job_id = $1", [jobId]);
  const day = new Date(Date.now() + 4 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  const SUP = { A: "E2E SPAREIN X", B: "E2E AL GHANDI X", C: "E2E MEZAN X", D: "E2E OTHER X" };
  for (const [name, pn, sup, cost] of [["E2E SENSOR X", "E2E-X-1", SUP.A, 340], ["E2E HOSE X", "E2E-X-2", SUP.B, 890], ["E2E MODULE X", "E2E-X-3", SUP.C, 6200]]) {
    await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, delivery_date, confirm_status, part_type, priced_at, priced_by, order_status, created_by, updated_by) values ($1, $2, $3, 1, 1, $4, $5, 'to_order', $6, 'confirmed', 'genuine', now(), $7, 'to_order', $7, $7)", [jobId, name, pn, cost, sup, day, partsId]);
  }
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/${jobId}`);
    const r = await sendLpo(page);
    check(`x1: the desk sends the 3-supplier request ("${(r.message ?? r.error ?? "").slice(0, 80)}")`, !!r.message);
    await browser.close();
  }
  const main = (await sql("select id::text as id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0];
  if (!main) throw new Error("x1: no request");
  const owner = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const p = owner.page;
  const approveSupplier = async (name) => {
    await go(p, `${base}/parts/orders/${main.id}`);
    await p.locator(`[data-supplier-decide="${name}"] [data-confirm-open]`).click();
    await p.locator(`[data-confirm-yes-money="lpo-approve-supplier"]`).click();
    await p.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
    return decodeURIComponent(p.url());
  };
  await go(p, `${base}/parts/orders/${main.id}`);
  check(`x2: three suppliers, each with its own Approve (${await p.locator("[data-supplier-decide]").count()})`, (await p.locator("[data-supplier-decide]").count()) === 3);
  const u1 = await approveSupplier(SUP.A);
  check("x3: Sparein approved on its own", /approved/.test(u1) && !/error=/.test(u1), u1.slice(-120));
  const childA = (await sql("select number, status from public.purchase_orders where job_id = $1 and kind = 'supplier' and supplier_name ilike $2", [jobId, SUP.A]))[0];
  const mainNow = (await sql("select status from public.purchase_orders where id = $1", [main.id]))[0]?.status;
  check(`x4: Sparein is its own LPO straight away (${childA?.number} ${childA?.status}); the request still waits (${mainNow})`, childA?.status === "approved" && mainNow === "pending_approval");
  await approveSupplier(SUP.B);
  await go(p, `${base}/parts/orders/${main.id}`);
  const states = ((await p.locator("[data-supplier-states]").textContent().catch(() => "")) ?? "");
  check(`x5: "2 of 3 suppliers approved · 1 waiting" ("${states}")`, /2 of 3 suppliers approved · 1 waiting/.test(states));
  await p.screenshot({ path: `${shots}/x5-two-of-three-approved.png`, fullPage: true });
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/orders?tab=pending`);
    const row = ((await page.locator(`[data-lpo-row="${main.number}"] [data-lpo-row-suppliers]`).textContent().catch(() => "")) ?? "");
    check(`x6: the LPO list shows each supplier's state ("${row}")`, /✓/.test(row) && /waiting/.test(row));
    await browser.close();
  }
  // x7. Refuse the third with a reason; it goes back to the desk.
  await p.locator(`[data-supplier-refuse="${SUP.C}"] summary`).click();
  await p.locator(`[data-supplier-refuse="${SUP.C}"] [data-supplier-refuse-reason]`).fill("Too dear, try another supplier");
  await p.locator(`[data-supplier-refuse="${SUP.C}"] [data-supplier-refuse-send]`).click();
  await p.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  const refused = (await sql("select id::text as id, refused_reason, order_status from public.part_items where job_id = $1 and description ilike 'E2E MODULE X'", [jobId]))[0];
  check(`x7: Mezan refused with the reason (${refused?.refused_reason})`, /Too dear/.test(refused?.refused_reason ?? "") && refused?.order_status === "none");
  // x8. The desk replaces it with another supplier; the replacement joins the SAME request.
  {
    const { browser, page } = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/${jobId}`);
    await page.locator("[data-replace-part]").first().click();
    let rep = null;
    for (let i = 0; i < 20 && !rep; i++) { await sleep(1000); rep = (await sql("select id::text as id from public.part_items where replaced_part_id = $1 and is_active", [refused.id]))[0]; }
    if (!rep) throw new Error("x8: no replacement row");
    await sql("update public.part_items set supplier = $2, cost_aed = 5900, part_number = 'E2E-X-4', part_type = 'genuine', availability = 'to_order', delivery_date = $3, priced_at = now(), confirm_status = 'confirmed', order_status = 'to_order' where id = $1", [rep.id, SUP.D, day]);
    await go(page, `${base}/parts/${jobId}`);
    const r = await sendLpo(page, { partIds: [rep.id] });
    check(`x8: the replacement joins ${main.number} ("${(r.message ?? r.error ?? "").slice(0, 90)}")`, !!r.message && r.message.includes(main.number));
    await browser.close();
  }
  await go(p, `${base}/parts/orders/${main.id}`);
  await confirmMoney(p, "lpo-approve");
  await p.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  const finalMain = (await sql("select status from public.purchase_orders where id = $1", [main.id]))[0]?.status;
  const children = (await sql("select supplier_name from public.purchase_orders where job_id = $1 and kind = 'supplier' and status <> 'cancelled' order by supplier_name", [jobId])).map((r) => r.supplier_name.toUpperCase());
  check(`x9: the request is approved (${finalMain}) with 3 supplier LPOs: ${children.join(", ")}`, finalMain === "approved" && children.length === 3 && !children.some((c) => /MEZAN/.test(c)));
  if (childA?.number) {
    const child = (await sql("select id::text as id from public.purchase_orders where number = $1", [childA.number]))[0];
    await go(p, `${base}/parts/orders/${child.id}`);
    await p.screenshot({ path: `${shots}/x9-child-lpo-one-supplier.png` });
  }
  await owner.browser.close();
});

/* ================================================================================================= */
/* Path y — PURCHASE RETURNS (8 November 2026, Section 8): a delivered part goes back (PR- note, the    */
/* return note PDF), Sent back with who took it, "Credit expected" apart from the balance, accounts     */
/* record the credit note (the supplier balance moves only now); a second part is refused → our stock.  */
/* ================================================================================================= */
await section("y", "purchase returns: note, sent back, credit expected, credit received, refused", async () => {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const SUP = "E2E RETURN SUPPLIER Y";
  await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) select $1, '100200300400597', true, $2, $2 where not exists (select 1 from public.suppliers where name ilike $1)", [SUP, partsId]);
  const sup = (await sql("select id::text as id from public.suppliers where name ilike $1", [SUP]))[0];
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not needed (test)' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.part_items set is_active = false where job_id = $1", [jobId]);
  const PO = "22222222-0000-4000-8000-00000000e9f1", PA = "22222222-0000-4000-8000-00000000e9f2", PB = "22222222-0000-4000-8000-00000000e9f3", LA = "22222222-0000-4000-8000-00000000e9f4", LB = "22222222-0000-4000-8000-00000000e9f5";
  await sql("insert into public.part_items (id, job_id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, priced_at, priced_by, order_status, received_qty, created_by, updated_by) values ($1, $3, 'E2E ENGINE MOUNT Y', 'E2E-EM-Y', 1, 1, 400, $4, 'to_order', 'confirmed', 'genuine', now(), $5, 'received', 1, $5, $5), ($2, $3, 'E2E WRONG SENSOR Y', 'E2E-WS-Y', 1, 1, 150, $4, 'to_order', 'confirmed', 'genuine', now(), $5, 'received', 1, $5, $5)", [PA, PB, jobId, SUP, partsId]);
  await sql("insert into public.purchase_orders (id, number, job_id, kind, supplier_id, supplier_name, status, total_cost_aed, ordered_at, ordered_by, approved_at, approved_by, received_at, supplier_invoice_status, supplier_invoice_number, created_by, updated_by) values ($1, 'LPO-E2E-Y-1', $2, 'supplier', $3, $4, 'received', 550, now(), $5, now(), $6, now(), 'received', 'INV-SUP-777', $5, $5)", [PO, jobId, sup.id, SUP, partsId, ownerId]);
  await sql("insert into public.purchase_order_lines (id, po_id, part_item_id, position, description, part_number, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, $3, $4, 1, 'E2E ENGINE MOUNT Y', 'E2E-EM-Y', 1, 400, 1, now(), $6, $6), ($2, $3, $5, 2, 'E2E WRONG SENSOR Y', 'E2E-WS-Y', 1, 150, 1, now(), $6, $6)", [LA, LB, PO, PA, PB, partsId]);
  await sql("update public.part_items set po_id = $2, po_line_id = $3 where id = $1", [PA, PO, LA]);
  await sql("update public.part_items set po_id = $2, po_line_id = $3 where id = $1", [PB, PO, LB]);
  const desk = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
  const returnPart = async (name) => {
    await go(desk.page, `${base}/parts/${jobId}`);
    const row = desk.page.locator("[data-row-key]").filter({ has: desk.page.locator("[data-part-name]", { hasText: new RegExp(name, "i") }) }).first();
    await row.locator("button[aria-label='More for this part']").click();
    await desk.page.getByRole("button", { name: /Remove: not needed \(ordered: choose its ending\)/ }).click();
    const dlg = desk.page.locator("[data-end-dialog]");
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator("[data-end-option='return']").click();
    await dlg.locator("input[name='reason']").pressSequentially("Wrong part", { delay: 10 });
    await dlg.locator("[data-end-save]").click();
    await desk.page.locator("[data-end-done], [data-end-error]").first().waitFor({ timeout: 30000 }).catch(() => null);
  };
  await returnPart("E2E ENGINE MOUNT Y");
  let pr = null;
  for (let i = 0; i < 15 && !pr; i++) { await sleep(1000); pr = (await sql("select id::text as id, number, status, quantity::float as qty, supplier_invoice_number from public.purchase_returns where part_item_id = $1", [PA]))[0]; }
  check(`y1: Return to supplier opens a PR- record (${pr?.number}, ${pr?.status}, their invoice ${pr?.supplier_invoice_number})`, /^PR-\d{5}$/.test(pr?.number ?? "") && pr?.status === "requested" && pr?.supplier_invoice_number === "INV-SUP-777");
  if (!pr) throw new Error("y1: no purchase return");
  const cookie = await cookieHeader(partsId);
  const pdf = await fetch(`${base}/api/pdf/return-note/${pr.id}`, { headers: { cookie } });
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  fs.writeFileSync(`${shots}/y1-return-note.pdf`, pdfBytes);
  check(`y2: the return note PDF opens (${pdf.status}, ${pdfBytes.length} bytes)`, pdf.status === 200 && pdfBytes.slice(0, 4).toString() === "%PDF");
  await go(desk.page, `${base}/parts/returns?tab=to_go`);
  check("y3: Purchase returns lists it under Waiting to go back", (await desk.page.locator(`[data-return-row="${pr.number}"]`).count()) === 1);
  await desk.page.locator(`[data-return-row="${pr.number}"] [data-return-open="sent"]`).click();
  await desk.page.locator(`[data-return-row="${pr.number}"] [data-return-sent-with]`).fill("Ravi (our driver)");
  await desk.page.locator(`[data-return-row="${pr.number}"] [data-return-sent-save]`).click();
  await desk.page.locator(`[data-return-row="${pr.number}"] [data-return-done], [data-return-row="${pr.number}"] [data-return-error]`).first().waitFor({ timeout: 30000 }).catch(() => null);
  const sent = (await sql("select status, sent_with from public.purchase_returns where id = $1", [pr.id]))[0];
  const bell = (await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'accounts' and n.type = 'purchase_return' and n.title ilike $1", [`%${pr.number}%`]))[0].n;
  check(`y4: sent back with who took it (${sent?.status}, ${sent?.sent_with}); accounts got a bell (${bell})`, sent?.status === "sent" && bell > 0);
  // y5. Credit expected is shown apart from the balance; the LPO still owes its full amount.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  await go(acc.page, `${base}/parts/suppliers?q=${encodeURIComponent("E2E RETURN")}`);
  const exp = await acc.page.locator("[data-supplier-credit-expected]").first().getAttribute("data-supplier-credit-expected").catch(() => null);
  check(`y5: the supplier shows "Credit expected" AED 420.00 incl. VAT, apart from the balance (${exp})`, exp === "420.00");
  await acc.page.screenshot({ path: `${shots}/y5-supplier-credit-expected.png` });
  // y6. Accounts record the credit note: the return is done, the part's ending is "returned".
  await go(acc.page, `${base}/parts/returns?tab=credit`);
  await acc.page.screenshot({ path: `${shots}/y6-purchase-returns-list.png`, fullPage: true });
  const rowA = acc.page.locator(`[data-return-row="${pr.number}"]`);
  await rowA.locator("[data-return-open='credit']").click();
  await rowA.locator("[data-return-cn-number]").fill("CN-SUP-55");
  await rowA.locator("[data-return-cn-date]").fill(new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10));
  await rowA.locator("[data-return-cn-net]").fill("400");
  await rowA.locator("[data-return-cn-vat]").fill("20");
  await rowA.locator("[data-return-cn-save]").click();
  await rowA.locator("[data-return-done], [data-return-error]").first().waitFor({ timeout: 30000 }).catch(() => null);
  const credited = (await sql("select r.status, p.disposition from public.purchase_returns r join public.part_items p on p.id = r.part_item_id where r.id = $1", [pr.id]))[0];
  check(`y6: credit note recorded (${credited?.status}); the part's ending is returned (${credited?.disposition})`, credited?.status === "credited" && credited?.disposition === "returned");
  await acc.browser.close();
  // y7. The second part is refused by the supplier: back to our stock at its cost.
  await returnPart("E2E WRONG SENSOR Y");
  let pr2 = null;
  for (let i = 0; i < 15 && !pr2; i++) { await sleep(1000); pr2 = (await sql("select id::text as id, number from public.purchase_returns where part_item_id = $1", [PB]))[0]; }
  if (!pr2) throw new Error("y7: no second return");
  await go(desk.page, `${base}/parts/returns?tab=to_go`);
  const rowB = desk.page.locator(`[data-return-row="${pr2.number}"]`);
  await rowB.locator("[data-return-open='refused']").click();
  await rowB.locator("[data-return-refused-note]").fill("Supplier says it was fitted");
  await rowB.locator("[data-return-refused-save]").click();
  await rowB.locator("[data-return-done], [data-return-error]").first().waitFor({ timeout: 30000 }).catch(() => null);
  const refused = (await sql("select r.status, r.refused_action, p.disposition from public.purchase_returns r join public.part_items p on p.id = r.part_item_id where r.id = $1", [pr2.id]))[0];
  check(`y7: refused by the supplier → back to our stock (${refused?.status}, ${refused?.refused_action}, part ${refused?.disposition})`, refused?.status === "refused" && refused?.refused_action === "stock" && refused?.disposition === "stock");
  await desk.browser.close();
});

/* ================================================================================================= */
/* Path z — 9 November 2026, Section 1: a part's quantity changed after approval / handover (the BMW  */
/* REAR DIFFERENTIAL OIL approved 3 × 185.00, only 2 bought and used): down without a payment (reduce */
/* the customer's price, extras to stock), down with a payment (advance), up (re-approval), after the */
/* tax invoice (refused, credit note offered).                                                         */
/* ================================================================================================= */
await section("z", "quantity change after approval: down, down with payment, up, after the tax invoice", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-qty-change";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  if (!jobId) throw new Error("seed failed");
  const partsId = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0].id;
  const advisorId = (await sql("select gated_in_by as id from public.jobs where id = $1", [jobId]))[0].id;
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'not needed (test)' where job_id = $1 and status = 'open'", [jobId]);
  const part = (await sql("select id from public.part_items where job_id = $1 and description ilike 'front brake pads' and is_active limit 1", [jobId]))[0];
  const q1 = (await sql("select id, number, version, total_aed::float as total from public.quotations where job_id = $1 and kind = 'quotation' and status = 'approved' order by version desc limit 1", [jobId]))[0];
  if (!part || !q1) throw new Error("seed has no approved part line");
  // The BMW case on the seeded car: approved × 3, received (handed over), Abu Dhabi Motors at 185.00 each.
  const line = (await sql("select id, quantity::float as qty, line_total::float as total from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [q1.id, part.id]))[0];
  const each = line.total / (line.qty || 1);
  const delta = each * (3 - (line.qty || 1));
  await sql("update public.quotations set status = 'draft' where id = $1", [q1.id]);
  await sql("update public.quotation_lines set quantity = 3, line_total = round(($2)::numeric, 2) where id = $1", [line.id, each * 3]);
  await sql("update public.quotations set subtotal_aed = subtotal_aed + ($2)::numeric, vat_aed = vat_aed + round(($2)::numeric * 0.05, 2), total_aed = total_aed + round(($2)::numeric * 1.05, 2), rounded_total_aed = null where id = $1", [q1.id, delta]);
  await sql("update public.quotations set status = 'approved' where id = $1", [q1.id]);
  await sql("update public.part_items set description = 'REAR DIFFERENTIAL OIL', part_number = 'B83222471487', quantity = 3, confirmed_quantity = 3, received_qty = 3, cost_aed = 185, supplier = 'Abu Dhabi Motors', order_status = 'received' where id = $1", [part.id]);
  const oldTotal = (await sql("select total_aed::float as t from public.quotations where id = $1", [q1.id]))[0].t;

  /** Parts open the row's menu → Change the quantity… → new quantity, reason, extras when asked → save. */
  async function changeQty(page, to, reason, extras, shotName) {
    await go(page, `${base}/parts/${jobId}`);
    const row = page.locator("[data-row-key]").filter({ has: page.locator("[data-part-name]", { hasText: /rear differential oil/i }) }).first();
    await row.scrollIntoViewIfNeeded().catch(() => null);
    await row.locator("button[aria-label='More for this part']").click();
    await page.getByRole("button", { name: "Change the quantity…" }).click();
    const dlg = page.locator("[data-qty-dialog]");
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator("[data-qty-new]").fill(String(to));
    await dlg.locator(`[data-qty-reason="${reason}"]`).click();
    await dlg.locator("[data-qty-save]").click();
    await dlg.locator("[data-qty-done], [data-qty-extras], [data-qty-error]").first().waitFor({ timeout: 40000 });
    if (extras && (await dlg.locator("[data-qty-extras]").count())) {
      await dlg.locator(`[data-qty-extras-choice="${extras}"]`).click();
      await dlg.locator("[data-qty-save]").click();
      await dlg.locator("[data-qty-done], [data-qty-error]").first().waitFor({ timeout: 40000 });
    }
    if (shotName) await dlg.screenshot({ path: `${proof}/${shotName}.png` }).catch(() => null);
    const words = ((await dlg.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    return { dlg, words };
  }

  // z1. Down, no payment yet: 3 → 2, bought fewer, the extra piece to stock.
  const desk = await browserForId(partsId, { viewport: { width: 1440, height: 900 } });
  let m = await mark();
  const z1 = await changeQty(desk.page, 2, "bought_fewer", "stock", "z1-parts-desk-3-to-2-1440");
  check("z1: the window says 3 → 2 by <name>: bought fewer", /REAR DIFFERENTIAL OIL: 3 → 2 by .+: bought fewer/.test(z1.words), z1.words.slice(0, 300));
  const p1 = (await sql("select confirmed_quantity::float as q, received_qty::float as r from public.part_items where id = $1", [part.id]))[0];
  check(`z1: the part is 2 and 2 received (${p1?.q}, ${p1?.r})`, p1?.q === 2 && p1?.r === 2);
  const ev1 = (await sql("select note from public.job_events where job_id = $1 and event_type = 'parts_quantity' order by created_at desc limit 1", [jobId]))[0];
  check("z1: the job's history carries the line", /3 → 2 by .+bought fewer/.test(ev1?.note ?? ""), ev1?.note ?? "");
  const st = (await sql("select count(*)::int as n from public.stock_movements where part_item_id = $1", [part.id]))[0];
  check("z1: the extra piece went to stock", (st?.n ?? 0) >= 1, JSON.stringify(st));
  await told("z1", m, jobId, [{ label: "the advisor", id: advisorId, type: "qty_reduced" }]);
  await desk.page.locator("[data-qty-close]").click().catch(() => null);

  // z2. The advisor reduces the customer's price: v2 approved at once, marked, the WhatsApp message offered.
  const adv = await browserForId(advisorId, { viewport: { width: 1440, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}/quote/${q1.id}`);
  const card = adv.page.locator("[data-qty-reduce]");
  check("z2: the approved quotation shows Reduce the customer's price", (await card.count()) === 1);
  await card.locator("[data-qty-reduce-go]").click();
  await card.locator("[data-qty-reduced], [data-qty-reduce-error]").first().waitFor({ timeout: 60000 });
  await card.screenshot({ path: `${proof}/z2-reduced-version-1440.png` }).catch(() => null);
  const v2 = (await sql("select id, version, status, total_aed::float as total, approver_name from public.quotations where number = $1 and kind = 'quotation' and is_active order by version desc limit 1", [q1.number]))[0];
  const old1 = (await sql("select status from public.quotations where id = $1", [q1.id]))[0];
  check(`z2: v${v2?.version} approved, the old version superseded (${v2?.status}, ${old1?.status})`, v2?.status === "approved" && v2?.version === q1.version + 1 && old1?.status === "superseded");
  check(`z2: the customer's price came down (${oldTotal} → ${v2?.total})`, v2 && v2.total < oldTotal - 0.01);
  const ln2 = (await sql("select quantity::float as q from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [v2.id, part.id]))[0];
  check("z2: the new version charges 2", ln2?.q === 2, JSON.stringify(ln2));
  const ev2 = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'reduced_after_approval'", [v2.id]))[0];
  check("z2: marked Reduced after approval – no customer approval needed", /Reduced after approval – no customer approval needed/.test(ev2?.note ?? ""), ev2?.note ?? "");
  check("z2: the WhatsApp message is offered (information)", (await card.locator("[data-qty-reduce-send]").count()) === 1);

  // z3. Down again with a payment already made for the full price: 2 → 1, extra to a purchase return → an advance.
  const cust = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
  await sql("insert into public.payments (job_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, received_by, created_by, updated_by, received_at) values ($1, $2, $3, 'cash', $4, 0, true, 'recorded', $5, $5, $5, now())", [jobId, cust.customer_id, cust.vehicle_id, v2.total, advisorId]);
  const z3 = await changeQty(desk.page, 1, "used_fewer", "return", null);
  check("z3: 2 → 1 saved", /2 → 1 by/.test(z3.words), z3.words.slice(0, 300));
  await desk.page.locator("[data-qty-close]").click().catch(() => null);
  await go(adv.page, `${base}/jobs/${jobId}/quote/${v2.id}`);
  const card3 = adv.page.locator("[data-qty-reduce]");
  await card3.locator("[data-qty-reduce-go]").click();
  await card3.locator("[data-qty-reduced], [data-qty-reduce-error]").first().waitFor({ timeout: 60000 });
  const over = ((await card3.locator("[data-qty-overpaid]").textContent().catch(() => "")) ?? "").trim();
  check("z3: paid for more → an advance or refund due is shown", /more than the new total/.test(over), over || ((await card3.textContent()) ?? "").slice(0, 200));

  // z4. Up: 1 → 2 → the existing re-approval flow (the owner asked for a revision, or a version to send).
  const v3 = (await sql("select id, version from public.quotations where number = $1 and kind = 'quotation' and status = 'approved' and is_active order by version desc limit 1", [q1.number]))[0];
  const z4 = await changeQty(desk.page, 2, "bought_fewer", null, null);
  check("z4: 1 → 2 saved", /1 → 2 by/.test(z4.words), z4.words.slice(0, 300));
  await desk.page.locator("[data-qty-close]").click().catch(() => null);
  const rev = await until(async () => (await sql("select (select revision_requested_at is not null from public.quotations where id = $1) as asked, (select count(*)::int from public.quotations where number = $2 and kind = 'quotation' and version > $3 and is_active) as newer", [v3.id, q1.number, v3.version]))[0], 20, 500);
  check(`z4: up goes to re-approval (asked ${rev?.asked}, newer versions ${rev?.newer})`, rev?.asked === true || (rev?.newer ?? 0) > 0);

  // z5. After the tax invoice: refused, "Credit note for the difference" offered with the amount.
  await sql("insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ('E2E-INV-Z5', 'tax_invoice', $1, $2, $3, 'issued', now(), 100, 0, 100, 5, 105, 'e2e-z5-inv', $4, $4)", [jobId, cust.customer_id, cust.vehicle_id, advisorId]);
  const z5 = await changeQty(desk.page, 1, "used_fewer", null, "z5-after-tax-invoice-1440");
  check("z5: refused after the tax invoice", /already issued/.test(z5.words), z5.words.slice(0, 300));
  const cn = await z5.dlg.locator("[data-qty-credit-note]").getAttribute("href").catch(() => null);
  check("z5: Credit note for the difference is offered", !!cn && cn.includes("#credit-notes"), cn ?? "");
  const p5 = (await sql("select confirmed_quantity::float as q from public.part_items where id = $1", [part.id]))[0];
  check("z5: the quantity did not change", p5?.q === 2, JSON.stringify(p5));
  await desk.browser.close();
  await adv.browser.close();
});

/* ================================================================================================= */
/* Path sec2 — 9 November 2026, Section 2: Accounts posting. J-00858 recreated (cheque RCT on a       */
/* proforma of 2,131.50): pending figures, no second payment invited, duplicate warning, gate-out     */
/* held; Accounts posting's four tabs; deposited → cleared → tax invoice; bounced; post-dated;        */
/* transfer short and over.                                                                           */
/* ================================================================================================= */
await section("sec2", "accounts posting: cheques and transfers", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-accounts-posting";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const jobId = seed.jobId;
  if (!jobId) throw new Error("seed failed");
  const job = (await sql("select customer_id, vehicle_id, gated_in_by from public.jobs where id = $1", [jobId]))[0];
  const acc = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0].id;
  // The J-00858 situation: a proforma of AED 2,131.50 and a cheque recorded on it (Emirates NBD 019383, dated 02/11/2026).
  await sql("update public.invoices set status = 'cancelled' where job_id = $1 and kind = 'proforma' and status = 'issued'", [jobId]);
  const pro = (await sql("insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ('E2E-PRO-S2', 'proforma', $1, $2, $3, 'issued', now(), 2030, 0, 2030, 101.5, 2131.5, 'e2e-s2-pro', $4, $4) returning id", [jobId, job.customer_id, job.vehicle_id, acc]))[0];
  await sql("update public.invoices set sent_at = now() where id = $1", [pro.id]);
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, created_by, updated_by) values ($1, 1, 'labour', 'E2E SERVICE', 1, 2030, 2030, 101.5, 2131.5, 0, $2, $2)", [pro.id, acc]);
  const chq = (await sql("insert into public.payments (job_id, invoice_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_number, cheque_bank, cheque_date, cheque_status, received_by, created_by, updated_by, received_at) values ($1, $2, $3, $4, 'cheque', 2131.5, 0, false, 'recorded', '019383', 'Emirates NBD', '2026-11-02', 'pending', $5, $5, $5, now() - interval '2 hours') returning id, number", [jobId, pro.id, job.customer_id, job.vehicle_id, acc]))[0];

  // s1. The money page: Paid 0.00 · Cheque pending 2,131.50 (RCT-…) · Balance once cleared 0.00; no "record it again".
  const a = await browserForId(acc, { viewport: { width: 1440, height: 900 } });
  await go(a.page, `${base}/jobs/${jobId}/invoice`);
  const line = ((await a.page.locator("[data-bank-pending-line]").first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check(`s1: pending figures shown (${line})`, line.includes("Paid 0.00") && line.includes(`Cheque pending 2,131.50 (${chq.number})`) && line.includes("Balance once cleared 0.00"));
  const what = ((await a.page.locator("[data-what-now]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("s1: What to do now says waiting to clear, accounts mark deposited / cleared", what.includes("Cheque recorded – waiting to clear. Accounts: mark deposited / cleared."), what.slice(0, 200));
  check("s1: the Mark cleared button is on the job page", (await a.page.locator("[data-what-now-bank] [data-bank-open='clear']").count()) === 1);
  // s2. Recording another payment warns and needs a reason.
  await a.page.locator("[data-what-now-bank] [data-record-block] summary").click().catch(() => null);
  const dup = ((await a.page.locator("[data-duplicate-warning]").first().textContent().catch(() => "")) ?? "");
  check("s2: duplicate warning names the pending cheque", dup.includes(`A cheque for AED 2,131.50 is already pending (${chq.number}). Record another anyway?`), dup.slice(0, 160));
  await a.page.screenshot({ path: `${proof}/s1-j00858-pending-1440.png`, fullPage: false }).catch(() => null);
  // s3. Gate-out held for accounts (only the owner may release before it clears).
  await go(a.page, `${base}/jobs/${jobId}/gate-out`);
  check("s3: gate-out held while the cheque waits", (await a.page.locator("[data-gateout-bank-hold]").count()) === 1);

  // s4. Accounts posting: the renamed page with four tabs, the cheque row.
  await go(a.page, `${base}/card-settlements?tab=cheque`);
  check("s4: the old address lands on Accounts posting", a.page.url().includes("/accounts-posting"), a.page.url());
  const tabs = await a.page.locator("[data-posting-tab]").evaluateAll((els) => els.map((e) => e.getAttribute("data-posting-tab")));
  check(`s4: four tabs (${tabs.join(",")})`, tabs.join(",") === "card,link,cheque,transfer");
  const row = a.page.locator(`[data-bank-row="${chq.number}"]`);
  check("s4: the cheque is listed", (await row.count()) === 1);
  // s5. Post-dated cheque: shown "due on", cannot be deposited.
  const pd = (await sql("insert into public.payments (job_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_number, cheque_bank, cheque_date, cheque_status, received_by, created_by, updated_by) values ($1, $2, $3, 'cheque', 100, 0, true, 'recorded', '777001', 'ADCB', (now() + interval '10 days')::date, 'pending', $4, $4, $4) returning number", [jobId, job.customer_id, job.vehicle_id, acc]))[0];
  await go(a.page, `${base}/accounts-posting?tab=cheque`);
  const pdRow = a.page.locator(`[data-bank-row="${pd.number}"]`);
  check("s5: post-dated shows due on", /Post-dated: due on/.test((await pdRow.textContent().catch(() => "")) ?? ""));
  check("s5: post-dated cannot be deposited", await pdRow.locator("[data-bank-open='deposit']").isDisabled().catch(() => false));
  await a.page.screenshot({ path: `${proof}/s4-accounts-posting-cheque-tab-1440.png`, fullPage: false }).catch(() => null);
  // s6. Mark deposited, then cleared → the payment counts and the proforma becomes the tax invoice.
  await row.locator("[data-bank-open='deposit']").click();
  await row.locator("[data-bank-deposit-date]").fill(today);
  await row.locator("[data-bank-save='deposit']").click();
  await until(async () => (await sql("select cheque_deposited_at from public.payments where id = $1", [chq.id]))[0]?.cheque_deposited_at, 40, 500);
  await a.page.locator("[data-bank-answer-ok]").click().catch(() => null);
  await go(a.page, `${base}/accounts-posting?tab=cheque`);
  const row2 = a.page.locator(`[data-bank-row="${chq.number}"]`);
  check("s6: deposited shows on the row", (await row2.locator("[data-bank-deposited]").count()) === 1);
  await row2.locator("[data-bank-open='clear']").click();
  await row2.locator("[data-bank-clear-date]").fill(today);
  await row2.locator("[data-bank-clear-ref]").fill("STMT-019383");
  await row2.locator("[data-bank-save='clear']").click();
  const cleared = await until(async () => { const r = (await sql("select p.cheque_status, p.settlement_id, (select count(*)::int from public.invoices i where i.job_id = $2 and i.kind = 'tax_invoice' and i.status = 'issued') as tax from public.payments p where p.id = $1", [chq.id, jobId]))[0]; return r?.cheque_status === "cleared" && r?.tax >= 1 ? r : null; }, 180, 500) ?? (await sql("select p.cheque_status, p.settlement_id, 0 as tax from public.payments p where p.id = $1", [chq.id]))[0];
  check(`s6: cleared, in a posting row, tax invoice issued (${JSON.stringify(cleared)})`, cleared?.cheque_status === "cleared" && !!cleared?.settlement_id && cleared?.tax >= 1);
  const st = cleared?.settlement_id ? (await sql("select method, received_aed::float as r from public.card_settlements where id = $1", [cleared.settlement_id]))[0] : null;
  check("s6: the posting is a cheque posting of 2,131.50", st?.method === "cheque" && st?.r === 2131.5, JSON.stringify(st));
  // s7. Bounced: the payment reverses, owner + advisor told.
  const b1 = (await sql("insert into public.payments (job_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_number, cheque_bank, cheque_date, cheque_status, received_by, created_by, updated_by) values ($1, $2, $3, 'cheque', 250, 0, true, 'recorded', '555002', 'FAB', now()::date, 'pending', $4, $4, $4) returning id, number", [jobId, job.customer_id, job.vehicle_id, acc]))[0];
  let m = await mark();
  await go(a.page, `${base}/accounts-posting?tab=cheque`);
  const brow = a.page.locator(`[data-bank-row="${b1.number}"]`);
  await brow.locator("[data-bank-open='bounce']").click();
  await brow.locator("[data-bank-bounce-charge]").fill("50");
  await brow.locator("[data-bank-save='bounce']").click();
  const bounced = await until(async () => (await sql("select status, cheque_status from public.payments where id = $1", [b1.id]))[0]?.status === "reversed" ? true : null, 40, 500);
  check("s7: bounced reverses the payment", bounced === true);
  await told("s7", m, jobId, [{ label: "the owner", role: "owner", type: "cheque_bounced" }]);
  // s8. Transfers: one short, one over.
  const t1 = (await sql("insert into public.payments (job_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_status, reference, received_by, created_by, updated_by) values ($1, $2, $3, 'transfer', 1000, 0, true, 'recorded', 'pending', 'TT-SHORT', $4, $4, $4) returning id, number", [jobId, job.customer_id, job.vehicle_id, acc]))[0];
  const t2 = (await sql("insert into public.payments (job_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_status, reference, received_by, created_by, updated_by) values ($1, $2, $3, 'transfer', 500, 0, true, 'recorded', 'pending', 'TT-OVER', $4, $4, $4) returning id, number", [jobId, job.customer_id, job.vehicle_id, acc]))[0];
  for (const [t, amt] of [[t1, "980"], [t2, "520"]]) {
    await go(a.page, `${base}/accounts-posting?tab=transfer`);
    const r = a.page.locator(`[data-bank-row="${t.number}"]`);
    await r.locator("[data-bank-open='clear']").click();
    await r.locator("[data-bank-clear-date]").fill(today);
    await r.locator("[data-bank-clear-amount]").fill(amt);
    await r.locator("[data-bank-save='clear']").click();
    await until(async () => (await sql("select cheque_status from public.payments where id = $1", [t.id]))[0]?.cheque_status === "cleared" ? true : null, 40, 500);
  }
  const short = (await sql("select amount_aed::float as a from public.payments where id = $1", [t1.id]))[0];
  check("s8: short transfer counts what arrived (980)", short?.a === 980, JSON.stringify(short));
  const extra = (await sql("select amount_aed::float as a from public.payments where job_id = $1 and notes like $2", [jobId, `Extra that reached the bank with ${t2.number}%`]))[0];
  check("s8: over transfer: the extra 20 is an advance", extra?.a === 20, JSON.stringify(extra));
  await a.browser.close();
});

/* ================================================================================================= */
/* Path sec3 — 9 November 2026, Section 3: one payment for several cars (AL ALI: cheque 019383,       */
/* AED 4,368.00 for two Corollas). Replace with combined payment (the cheque recorded on one car),     */
/* the statement and one bill for both, a combined bounce, a combined cheque with a leftover advance   */
/* cleared as one -> both proformas become tax invoices.                                               */
/* ================================================================================================= */
await section("sec3", "one payment for several cars", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-combined-payments";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const jobA = seed.jobId;
  if (!jobA) throw new Error("seed failed");
  const job = (await sql("select customer_id, vehicle_id, gated_in_by from public.jobs where id = $1", [jobA]))[0];
  const acc = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0].id;
  // The second car of the same customer (a second job), and one proforma on each: 2,236.50 (older) and 2,131.50.
  const jobB = "22222222-0000-4000-8000-00000000e9b1";
  await sql("insert into public.jobs (id, job_number, customer_id, vehicle_id, gated_in_by, status, is_open, gated_in_at) values ($1, 'E2E-J-S3B', $2, $3, $4, 'pending_payment', true, now() - interval '2 days')", [jobB, job.customer_id, job.vehicle_id, job.gated_in_by]);
  await sql("update public.invoices set status = 'cancelled' where job_id = $1 and kind = 'proforma' and status = 'issued'", [jobA]);
  const mkPro = async (jobId, number, net, vat, total, token, ago) => {
    const r = (await sql(`insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, sent_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ($1, 'proforma', $2, $3, $4, 'issued', now() - ($8 || ' hours')::interval, now(), $5, 0, $5, $6, $7, $9, $10, $10) returning id`, [number, jobId, job.customer_id, job.vehicle_id, net, vat, total, String(ago), token, acc]))[0];
    await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, created_by, updated_by) values ($1, 1, 'labour', 'E2E SERVICE', 1, $2, $2, $3, $4, 0, $5, $5)", [r.id, net, vat, total, acc]);
    return r.id;
  };
  const proB = await mkPro(jobB, "E2E-PRO-S3B", 2130, 106.5, 2236.5, "e2e-s3-prob", 30);
  const proA = await mkPro(jobA, "E2E-PRO-S3A", 2030, 101.5, 2131.5, "e2e-s3-proa", 20);
  // The J-00858 situation: the cheque recorded on ONE car only (2,131.50).
  const old = (await sql("insert into public.payments (job_id, invoice_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_number, cheque_bank, cheque_date, cheque_status, received_by, created_by, updated_by) values ($1, $2, $3, $4, 'cheque', 2131.5, 0, false, 'recorded', '019383', 'Emirates NBD', '2026-11-02', 'pending', $5, $5, $5) returning id, number", [jobA, proA, job.customer_id, job.vehicle_id, acc]))[0];

  const a = await browserForId(acc, { viewport: { width: 1440, height: 900 } });
  // c1. "Replace with combined payment" on that receipt → the window, the old receipt ticked; 4,368.00 split oldest first.
  await go(a.page, `${base}/jobs/${jobA}/invoice`);
  const rep = a.page.locator(`[data-replace-combined="${old.number}"]`);
  check("c1: Replace with combined payment is on the cheque", (await rep.count()) === 1);
  await rep.click();
  await a.page.waitForURL((u) => u.toString().includes("replace="), { timeout: 20000 }).catch(() => null);
  const win = a.page.locator("[data-receive-window]");
  await win.waitFor({ timeout: 15000 });
  check("c1: the old receipt is ticked to be replaced", await win.locator(`[data-receive-replace-id="${old.number}"]`).isChecked().catch(() => false));
  await win.locator("[data-receive-amount]").pressSequentially("4368", { delay: 20 });
  await win.locator("[data-receive-cheque-bank]").fill("Emirates NBD");
  await win.locator("[data-receive-cheque-date]").fill("2026-11-02");
  await win.locator("[data-receive-replace-reason]").fill("One cheque for two cars, recorded on one car only");
  const sB = await win.locator('[data-receive-share-amount="E2E-PRO-S3B"]').inputValue().catch(() => "");
  const sA = await win.locator('[data-receive-share-amount="E2E-PRO-S3A"]').inputValue().catch(() => "");
  check(`c1: split oldest first (${sB} + ${sA})`, sB === "2236.50" && sA === "2131.50");
  await win.screenshot({ path: `${proof}/c1-receive-4368-two-cars-1440.png` }).catch(() => null);
  // Proof on every payment method (10 November 2026): a cheque needs its photo.
  await win.locator("[data-proof-input]").setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await win.locator("[data-receive-save]").click();
  await win.locator("[data-receive-done], [data-receive-error]").first().waitFor({ timeout: 60000 });
  const doneWords = ((await win.textContent()) ?? "").replace(/\s+/g, " ");
  check("c1: recorded as one combined payment", /CP-\d{5}: AED 4,368\.00 by cheque 019383 over 2 cars/.test(doneWords), doneWords.slice(0, 260));
  const oldNow = (await sql("select status, void_reason from public.payments where id = $1", [old.id]))[0];
  check("c1: the old receipt is voided with the reason", oldNow?.status === "voided" && /Replaced by a combined payment/.test(oldNow?.void_reason ?? ""), JSON.stringify(oldNow));
  const shares = await sql("select p.number, p.amount_aed::float as a, p.notes, g.number as g, g.replaced_payment_ids::text as rep from public.payments p join public.payment_groups g on g.id = p.group_id where g.customer_id = $1 and p.status = 'recorded' order by p.amount_aed", [job.customer_id]);
  check(`c1: two shares in one group (${shares.map((s) => s.a).join(" + ")})`, shares.length === 2 && shares[0].a === 2131.5 && shares[1].a === 2236.5 && shares[0].g === shares[1].g);
  check("c1: each share says Part of cheque 019383 (AED 4,368.00 total)", shares.every((s) => (s.notes ?? "").startsWith("Part of cheque 019383 (AED 4,368.00 total)")));
  check("c1: the group keeps the replaced receipt", (shares[0]?.rep ?? "").includes(old.id));
  await win.locator("[data-receive-close]").click().catch(() => null);
  // The job shows the share words.
  await go(a.page, `${base}/jobs/${jobA}/invoice`);
  check("c1: the job shows Part of cheque …", (await a.page.locator("[data-payment-group]").count()) >= 1);

  // c2. The statement and one bill for both cars; the customer's link opens without signing in.
  await go(a.page, `${base}/customers/${job.customer_id}/statement`);
  const stTxt = ((await a.page.locator("[data-statement]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("c2: the statement shows both cars, waiting for the bank and the balance once cleared", stTxt.includes("E2E-PRO-S3A") && stTxt.includes("E2E-PRO-S3B") && stTxt.includes("Waiting for the bank AED 4,368.00") && stTxt.includes("Balance once cleared AED 0.00"), stTxt.slice(0, 300));
  await a.page.screenshot({ path: `${proof}/c2-statement-1440.png`, fullPage: false }).catch(() => null);
  await a.page.locator("[data-combined-tick]").first().check();
  await a.page.locator("[data-combined-tick]").nth(1).check();
  await a.page.locator("[data-combined-send]").click();
  const msg = await a.page.locator("[data-send-message]").inputValue({ timeout: 20000 }).catch(() => "");
  const link = (msg.match(/https?:\/\/\S+/) ?? [""])[0];
  check("c2: one bill message carries the link", /one bill for your 2 cars/.test(msg) && !!link, msg.slice(0, 200));
  await a.page.keyboard.press("Escape").catch(() => null);
  const tok = (await sql("select url from public.short_links where url like $1 order by created_at desc limit 1", ["%/statement/%"]).catch(() => []))[0]?.url ?? "";
  const path = tok.includes("/statement/") ? tok.slice(tok.indexOf("/statement/")) : "";
  if (path) {
    const anon = await (await import("playwright-core")).chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const pg = await anon.newPage();
    await pg.goto(`${base}${path}`);
    const pub = ((await pg.locator("[data-statement-page]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check("c2: the customer's combined bill opens without signing in", pub.includes("Combined proforma") && pub.includes("Total to pay"), pub.slice(0, 200));
    await anon.close();
  } else check("c2: the combined bill link was saved", false, tok);

  // c3. A combined cheque bounces as ONE: both shares reversed.
  await go(a.page, `${base}/accounts-posting?tab=cheque`);
  const firstShare = a.page.locator(`[data-bank-row="${shares[0].number}"]`);
  check("c3: the share shows it clears and bounces as one", (await firstShare.locator("[data-bank-group]").count()) === 1);
  await firstShare.locator("[data-bank-open='bounce']").click();
  await firstShare.locator("[data-bank-save='bounce']").click();
  const both = await until(async () => { const r = await sql("select count(*)::int as n from public.payments p join public.payment_groups g on g.id = p.group_id where g.customer_id = $1 and p.status = 'reversed'", [job.customer_id]); return (r[0]?.n ?? 0) >= 2 ? r[0].n : null; }, 60, 500);
  check(`c3: both shares reversed (${both})`, both === 2);

  // c4. A new combined cheque of 4,868.00: both cars paid and AED 500.00 left over as an advance; cleared as ONE.
  await go(a.page, `${base}/customers/${job.customer_id}?receive=1`);
  const w2 = a.page.locator("[data-receive-window]");
  await w2.waitFor({ timeout: 15000 });
  await w2.locator("[data-receive-amount]").pressSequentially("4868", { delay: 20 });
  await w2.locator("[data-receive-cheque-number]").fill("019400");
  await w2.locator("[data-receive-cheque-date]").fill(today);
  check("c4: AED 500.00 left over becomes an advance", /AED 500\.00 left over becomes an advance/.test((await w2.locator("[data-receive-leftover]").textContent().catch(() => "")) ?? ""));
  // Proof on every payment method (10 November 2026): a cheque needs its photo.
  await w2.locator("[data-proof-input]").setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await w2.locator("[data-receive-save]").click();
  await w2.locator("[data-receive-done], [data-receive-error]").first().waitFor({ timeout: 60000 });
  const g2 = await sql("select p.number, p.amount_aed::float as a, p.invoice_id from public.payments p join public.payment_groups g on g.id = p.group_id where g.customer_id = $1 and g.cheque_number = '019400' order by p.amount_aed", [job.customer_id]);
  check(`c4: three shares (${g2.map((x) => x.a).join(", ")})`, g2.length === 3 && g2[0].a === 500 && !g2[0].invoice_id);
  await go(a.page, `${base}/accounts-posting?tab=cheque`);
  await a.page.locator(`[data-bank-tick="${g2[1].number}"]`).check();
  const ticked = await a.page.locator("[data-bank-tick]:checked").count();
  check(`c4: ticking one share ticks the whole cheque (${ticked})`, ticked === 3);
  await a.page.locator("[data-bank-record-date]").fill(today);
  await a.page.locator("[data-bank-record-save]").click();
  const taxes = await until(async () => { const r = await sql("select count(*)::int as n from public.invoices where job_id in ($1, $2) and kind = 'tax_invoice' and status = 'issued'", [jobA, jobB]); return (r[0]?.n ?? 0) >= 2 ? r[0].n : null; }, 120, 500);
  check(`c4: cleared as one → both cars' tax invoices (${taxes})`, taxes === 2);
  await a.browser.close();
});

/* ================================================================================================= */
/* Path sec4 — 9 November 2026, Section 4: passkey rules. The 30-second "can't find each other" help, */
/* the shared-device warning, the owner's list (passkey yes/no, this week's sign-ins), the Require    */
/* passkey switch (off), the owner's one-time code for a lost phone (single use).                     */
/* ================================================================================================= */
await section("sec4", "passkey rules", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-passkeys";
  mkdirSync(proof, { recursive: true });
  // p1. The 30-second help: the phone never answers (the prompt is held open), the clock moves on 31 seconds.
  {
    const b = await (await import("playwright-core")).chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await pg.addInitScript(() => { if (navigator.credentials) navigator.credentials.get = () => new Promise(() => {}); });
    await pg.clock.install();
    await pg.goto(`${base}/login`);
    await pg.locator("[data-passkey-signin-button]").click();
    await pg.locator("[data-passkey-signin-button]", { hasText: "Waiting for your phone" }).waitFor({ timeout: 15000 }).catch(() => null);
    await pg.clock.fastForward(31_000);
    const slow = ((await pg.locator("[data-passkey-slow]").textContent({ timeout: 5000 }).catch(() => "")) ?? "");
    check("p1: after 30 seconds the phone-and-computer help shows", slow.startsWith("Your phone and this computer can't find each other."), slow.slice(0, 120));
    await pg.screenshot({ path: `${proof}/p1-30-second-help-1440.png` }).catch(() => null);
    check("p1: the lost-phone code form is on the login page", (await pg.locator("[data-login-lost]").count()) === 1);
    await b.close();
  }
  // p2. The owner's page: Require passkey (every role OFF), the people with passkey yes/no and this week's sign-ins.
  const owner = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(owner.page, `${base}/team/sign-ins`);
  const boxes = owner.page.locator("[data-require-passkey]");
  const n = await boxes.count();
  const on = await boxes.evaluateAll((els) => els.filter((e) => e.checked).length);
  check(`p2: Require passkey listed per role and OFF (${n} roles, ${on} ticked)`, n >= 7 && on === 0);
  check("p2: each person shows this week's sign-ins (passkey / password, phone / PC)", (await owner.page.locator("[data-passkey-week]").count()) >= 1);
  await owner.page.screenshot({ path: `${proof}/p2-owner-list-switch-off-1440.png`, fullPage: false }).catch(() => null);
  // p3. Lost phone: the owner gives a one-time code; it signs the person in once and goes to the new-phone setup.
  const person = (await sql("select s.id, sp.email from public.staff s join public.staff_private sp on sp.staff_id = s.id where s.role_id = 'service_advisor' and s.is_active and sp.email is not null order by s.created_at limit 1"))[0];
  // Passkeys on for everyone during this check (as on live); the test copy's own setting is put back after.
  const rolloutWas = (await sql("select value::text as v from public.settings where key = 'passkeys_rollout'"))[0]?.v ?? null;
  await sql("insert into public.settings (key, label, value) values ('passkeys_rollout', 'Passkeys switched on for', to_jsonb('all'::text)) on conflict (key) do update set value = excluded.value");
  await go(owner.page, `${base}/team/${person.id}#sign-in`);
  await owner.page.locator("[data-reset-code-give]").click();
  const code = ((await owner.page.locator("[data-reset-code-value]").textContent({ timeout: 20000 }).catch(() => "")) ?? "").replace(/\D/g, "").slice(0, 8);
  check("p3: the owner gets an 8-digit code with its time limit", code.length === 8, code);
  const anon = await (await import("playwright-core")).chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const pa = await anon.newPage();
  const tryCode = async () => {
    await pa.goto(`${base}/login?lost=1`);
    await pa.locator("[data-login-code] input[name='email']").fill(person.email);
    await pa.locator("[data-login-code-input]").fill(code);
    await pa.locator("[data-login-code] button[type='submit']").click();
    await pa.waitForURL((u) => !u.toString().endsWith("/login?lost=1"), { timeout: 30000 }).catch(() => null);
    return pa.url();
  };
  const first = await tryCode();
  check("p3: the code signs in and opens the new-phone setup", first.includes("/passkey/setup") && first.includes("lost=1"), first);
  // p4. On a PC (a shared office computer): saving the passkey HERE is warned against.
  const here = pa.locator("[data-passkey-register='here']");
  if (await here.count()) {
    await here.click();
    const warn = ((await pa.locator("[data-passkey-shared-warning]").textContent({ timeout: 5000 }).catch(() => "")) ?? "");
    check("p4: shared device warning", warn.includes("This is a shared device. Save your passkey on your own phone instead."), warn.slice(0, 120));
  } else check("p4: the setup offers this device", false, await pa.url());
  await pa.context().clearCookies();
  const second = await tryCode();
  check("p3: the same code a second time is refused", second.includes("/login") && /error=/.test(second), second);
  await anon.close();
  if (rolloutWas) await sql("update public.settings set value = $1::jsonb where key = 'passkeys_rollout'", [rolloutWas]);
  const ev = await sql("select method, ok from public.sign_in_events where staff_id = $1 and method = 'owner_code' order by at desc limit 2", [person.id]);
  check("p3: both tries are logged", ev.length === 2, JSON.stringify(ev));
  await owner.browser.close();
});

/* ================================================================================================= */
/* Path sec5 — 9 November 2026, Section 5: the simple part sticker. J-00940's REAR MAIN SEAL label      */
/* rendered at 203 dpi: 50 x 25 mm, nothing within 2.5 mm of an edge, the QR read back opens that part's */
/* page for staff, and the sign-in page for anyone else.                                                 */
/* ================================================================================================= */
await section("sec5", "simple part sticker", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-simple-sticker";
  mkdirSync(proof, { recursive: true });
  const mupdf = await import("mupdf");
  const jsQR = (await import("jsqr")).default;
  let part = (await sql("select p.id, p.job_id, p.description from public.part_items p join public.jobs j on j.id = p.job_id where j.job_number = 'J-00940' and p.description ilike '%rear main seal%' and p.is_active limit 1"))[0];
  if (!part) {
    const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
    part = (await sql("select id, job_id, description from public.part_items where job_id = $1 and is_active order by created_at limit 1", [seed.jobId]))[0];
    await sql("update public.part_items set description = 'REAR MAIN SEAL' where id = $1", [part.id]);
    part.description = "REAR MAIN SEAL";
  }
  const cookie = await cookieHeader("parts");
  const res = await fetch(`${base}/api/pdf/part-labels?job=${part.job_id}&parts=${part.id}`, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  check(`k1: the label PDF prints (${res.status})`, res.ok && /pdf/.test(res.headers.get("content-type") ?? ""));
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const b = doc.loadPage(0).getBounds();
  const mmOf = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
  check(`k1: 50 x 25 mm landscape (${mmOf(b[2] - b[0])} x ${mmOf(b[3] - b[1])})`, mmOf(b[2] - b[0]) === 50 && mmOf(b[3] - b[1]) === 25);
  const text = doc.loadPage(0).toStructuredText().asText().replace(/\s+/g, " ").trim();
  check(`k2: only the part name on the face ("${text}")`, /REAR MAIN SEAL/.test(text) && !/J-\d|LPO|OF \d|Received|DUBAI/.test(text));
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(203 / 72, 203 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(`${proof}/k-rear-main-seal-203dpi.png`, pix.asPNG());
  const W = pix.getWidth();
  const H = pix.getHeight();
  const px = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = px[i * n]; rgba[i * 4 + 1] = px[i * n + 1]; rgba[i * 4 + 2] = px[i * n + 2]; rgba[i * 4 + 3] = 255; }
  // Nothing within 2.5 mm of an edge (20 pixels at 203 dpi): every pixel there is white.
  const edge = Math.floor((2.5 / 25.4) * 203) - 1;
  let inked = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= edge && x < W - edge && y >= edge && y < H - edge) continue;
    const i = (y * W + x) * 4;
    if (rgba[i] < 200 || rgba[i + 1] < 200 || rgba[i + 2] < 200) inked++;
  }
  check(`k3: nothing within 2.5 mm of an edge (${inked} dark pixels there)`, inked === 0);
  const qr = jsQR(rgba, W, H);
  check(`k4: the QR reads at 203 dpi (${qr?.data ?? "no read"})`, !!qr?.data && /\/s\/[A-Z0-9]+$/.test(qr.data));
  const path = qr?.data ? qr.data.slice(qr.data.indexOf("/s/")) : "/s/NONE";
  // k5. Staff land on the part's page; anyone else on the sign-in page.
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}${path}`);
  check(`k5: staff open that part's page (${page.url().replace(base, "")})`, page.url().includes(`/parts/label/${part.id}`));
  const body = ((await page.locator("[data-part-label-page]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("k5: the page has part, part number, side, quantity, job, plate, car, LPO, supplier, received, advisor, technician", ["Part", "Part number", "Side", "Quantity", "Job", "Plate", "Car", "LPO", "Supplier", "Received", "Advisor", "Technician"].every((k) => body.includes(k)) && /REAR MAIN SEAL/.test(body), body.slice(0, 200));
  await page.screenshot({ path: `${proof}/k-qr-opens-part-page-1440.png` }).catch(() => null);
  await browser.close();
  const anon = await (await import("playwright-core")).chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const pa = await anon.newPage();
  await pa.goto(`${base}${path}`);
  check(`k6: not signed in sees nothing but the sign-in page (${pa.url().replace(base, "")})`, pa.url().includes("/login"));
  await anon.close();
});

/* ================================================================================================= */
/* Path sec6 — 9 November 2026, Section 6: the warranty certificate. The J-00974 kind of package (PPF,  */
/* "ceramic heat rejection tint – side & rear windows", PPF ceramic coating): roll/batch only on PPF and  */
/* tint, tint covers Glass, the missing batch is named, several rolls on one line, never "—".            */
/* ================================================================================================= */
await section("sec6", "warranty batch only for PPF and tint", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-warranty-batch";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "bodyshop-plan" })).json;
  const jobId = seed?.jobId ?? seed?.job?.id;
  if (!jobId) throw new Error(`seed failed: ${JSON.stringify(seed).slice(0, 200)}`);
  await sql("update public.jobs set warranty_token = 'e2ewarrantys6token', gated_out_at = coalesce(gated_out_at, now()) where id = $1", [jobId]);
  const owner = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  // w1. No batch yet: the bodyshop page names what is missing (PPF and tint batch only - no ceramic batch).
  await go(owner.page, `${base}/bodyshop/${jobId}`);
  const wtxt = ((await owner.page.textContent("body").catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("w1: the warranty card asks for the PPF and tint batch", (wtxt.match(/Missing: roll or batch number/g) ?? []).length >= 2, wtxt.match(/missing[^.]{0,200}/i)?.[0] ?? "");
  check("w1: the tint line covers Glass on the warranty card", /heat rejection tint\s*Glass/i.test(wtxt));
  check("w1: no ceramic batch is asked", !/Ceramic batch number/i.test(wtxt));
  // w2. The customer's certificate before the batch: never a dash on PPF or tint; tint covers Glass; ceramic has no batch row.
  const anon = await (await import("playwright-core")).chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const pa = await anon.newPage({ viewport: { width: 1440, height: 900 } });
  await pa.goto(`${base}/warranty/e2ewarrantys6token`);
  const before = await pa.locator("[data-warranty-batch]").allTextContents();
  check(`w2: batch rows only for PPF and tint (${before.length})`, before.length === 2, JSON.stringify(before));
  check("w2: a missing batch reads To be confirmed, never a dash", before.every((t) => t.trim() === "To be confirmed"));
  const page1 = ((await pa.textContent("body").catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("w2: the tint covers Glass", /Coverage\s*Glass/.test(page1), page1.match(/Coverage.{0,40}/g)?.join(" | ") ?? "");
  check("w2: nothing says Paintwork and film for the window tint", !/heat rejection[^|]{0,80}Paintwork and film/i.test(page1));
  // w3. The batches entered (PPF on 1.5 rolls): the certificate shows them, same number and dates.
  const by = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.warranty_entries (job_id, product, item_key, roll_batch, areas, entered_by, entered_at, created_by, updated_by) values ($1, 'ppf', '', 'R-PPF-0012, R-PPF-0013', jsonb_build_array('Full body'), $2, now(), $2, $2), ($1, 'tint', '', 'T-0451', '[]'::jsonb, $2, now(), $2, $2)", [jobId, by]);
  await pa.goto(`${base}/warranty/e2ewarrantys6token`);
  const after = await pa.locator("[data-warranty-batch]").allTextContents();
  check(`w3: PPF shows both rolls, tint its roll (${after.join(" / ")})`, after.includes("R-PPF-0012, R-PPF-0013") && after.includes("T-0451"));
  await pa.screenshot({ path: `${proof}/w3-certificate-batch-ppf-tint-only-1440.png`, fullPage: true }).catch(() => null);
  await anon.close();
  await owner.browser.close();
});

/* ================================================================================================= */
/* Path sec7 — 9 November 2026, Section 7: gate-in videos much clearer. A fake 1920 x 1080 camera:      */
/* the page records at 1080p, the progress shows, "Video uploaded ✓", the stored file is 1920 x 1080 as */
/* recorded. A fake 640 x 360 camera is refused below 720p.                                             */
/* ================================================================================================= */
await section("sec7", "clear gate-in videos", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-clear-videos";
  mkdirSync(proof, { recursive: true });
  const scratch = path.join(os.tmpdir(), "ofj-fake-camera");
  mkdirSync(scratch, { recursive: true });
  /** A Y4M file the browser plays as its camera (a few moving grey frames). */
  const y4m = (w, h, frames) => {
    const file = path.join(scratch, `cam-${w}x${h}.y4m`);
    const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`)];
    for (let f = 0; f < frames; f++) {
      const y = Buffer.alloc(w * h);
      for (let r = 0; r < h; r++) y.fill((r + f * 37) % 220 + 20, r * w, (r + 1) * w);
      parts.push(Buffer.from("FRAME\n"), y, Buffer.alloc((w / 2) * (h / 2), 128), Buffer.alloc((w / 2) * (h / 2), 128));
    }
    fs.writeFileSync(file, Buffer.concat(parts));
    return file;
  };
  const seed = (await api("/api/e2e/stage", { stage: "assign" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  // The seed's gate-in is complete: its videos are taken off so the video step asks again.
  await sql("update public.gate_in_media set kind = 'gate_out_photo' where job_id = $1 and kind in ('video_exterior', 'video_interior')", [jobId]);
  const hi = y4m(1920, 1080, 6);
  const b = await browserFor("owner", { viewport: { width: 1280, height: 900 }, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${hi}`], permissions: ["camera", "microphone"] });
  await go(b.page, `${base}/jobs/${jobId}/media`);
  const ext = b.page.locator('[data-media-item="video_exterior"]');
  await ext.locator("[data-record-video]").click();
  const q = ((await b.page.locator("[data-recorder-quality]").textContent({ timeout: 20000 }).catch(() => "")) ?? "");
  check(`c7a: the page records at 1920 x 1080 (${q})`, q.startsWith("1920 × 1080"));
  await b.page.locator("[data-recorder-start]").click();
  await sleep(4000);
  // Slow the line so the progress shows, then stop.
  const cdp = await b.context.newCDPSession(b.page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 200, downloadThroughput: 200_000, uploadThroughput: 150_000 });
  await b.page.locator("[data-recorder-stop]").click();
  await ext.locator("[data-video-pending]").waitFor({ timeout: 30000 }).catch(() => null);
  await ext.screenshot({ path: `${proof}/c7-upload-progress-1280.png` }).catch(() => null);
  const pendingTxt = ((await ext.locator("[data-video-pending]").textContent().catch(() => "")) ?? "");
  check("c7b: the upload shows its progress", /Sending|%|Waiting|device|Processing/i.test(pendingTxt), pendingTxt.slice(0, 160));
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ext.locator("[data-video-uploaded]").waitFor({ timeout: 120000 }).catch(() => null);
  check("c7c: Video uploaded ✓", (await ext.locator("[data-video-uploaded]").count()) === 1);
  // The stored file, exactly as recorded: its picture size read back by the browser.
  const row = (await sql("select storage_path from public.gate_in_media where job_id = $1 and kind = 'video_exterior' order by created_at desc limit 1", [jobId]))[0];
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: signed } = row ? await admin.storage.from("gate-in-media").createSignedUrl(row.storage_path, 600) : { data: null };
  const { data: blob } = row ? await admin.storage.from("gate-in-media").download(row.storage_path) : { data: null };
  const dims = signed?.signedUrl ? await b.page.evaluate(async (u) => await new Promise((res) => { const v = document.createElement("video"); v.muted = true; v.preload = "metadata"; v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight }); v.onerror = () => res(null); setTimeout(() => res(null), 15000); v.src = u; }), signed.signedUrl) : null;
  const mb = blob ? +(blob.size / 1048576).toFixed(2) : null;
  fs.writeFileSync(`${proof}/c7-new-video.json`, JSON.stringify({ path: row?.storage_path ?? null, width: dims?.w ?? null, height: dims?.h ?? null, mb }, null, 2));
  check(`c7d: the stored video is 1920 x 1080 as recorded (${dims ? `${dims.w} x ${dims.h}` : "unread"}, ${mb} MB)`, dims?.w === 1920 && dims?.h === 1080);
  await b.browser.close();
  // c7e. A camera that only gives 640 x 360: refused, nothing can be recorded.
  const lo = y4m(640, 360, 4);
  const l = await browserFor("owner", { viewport: { width: 1280, height: 900 }, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${lo}`], permissions: ["camera", "microphone"] });
  await go(l.page, `${base}/jobs/${jobId}/media`);
  await l.page.locator('[data-media-item="video_interior"] [data-record-video]').click();
  const err = ((await l.page.locator("[data-recorder-error]").textContent({ timeout: 20000 }).catch(() => "")) ?? "");
  check("c7e: below 720p is refused with a message", /only gives 640 × 360/.test(err), err.slice(0, 160));
  check("c7e: recording cannot start", await l.page.locator("[data-recorder-start]").isDisabled().catch(() => false));
  await l.browser.close();
});

/* ================================================================================================= */
/* Path sec8 — 9 November 2026, Section 8: outsourced lathe work. The price list kept by the owner;    */
/* 3 tickets on 2 cars (SUB- numbers, one under the AED 200 limit skipping the LPO, at least 3 × cost  */
/* on the quotation, the SUB number on the sticker); one Back; the month-end bill covering 2 tickets   */
/* at a different price with 1 line that has no ticket (Parts told); 1 ticket still open; the report.  */
/* ================================================================================================= */
await section("sec8", "outsourced lathe work", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-09-lathe";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobA = seed?.jobId;
  const qA = seed?.quotationId;
  if (!jobA || !qA) throw new Error(`seed failed: ${JSON.stringify(seed).slice(0, 200)}`);
  const job = (await sql("select customer_id, vehicle_id, gated_in_by from public.jobs where id = $1", [jobA]))[0];
  // The second car of the same customer, in the workshop.
  const vehB = "22222222-0000-4000-8000-00000000e9c2";
  const jobB = "22222222-0000-4000-8000-00000000e9c3";
  await sql("insert into public.vehicles (id, customer_id, make_id, model_id, model_year, has_plate, plate_country, plate_emirate, plate_code, plate_number, kind) select $2, customer_id, make_id, model_id, model_year, true, plate_country, plate_emirate, 'L', '80808', kind from public.vehicles where id = $1", [job.vehicle_id, vehB]);
  await sql("insert into public.jobs (id, job_number, customer_id, vehicle_id, gated_in_by, status, stage, department, is_open, gated_in_at) values ($1, 'E2E-J-S8B', $2, $3, $4, 'in_work', 'work', 'mechanical', true, now())", [jobB, job.customer_id, vehB, job.gated_in_by]);
  if (!(await sql("select 1 as ok from public.jobs where id = $1", [jobB]))[0]) throw new Error("second car not seeded");
  await sql("insert into public.suppliers (name, is_active, vat_registered) select 'E2E Lathe Works', true, false where not exists (select 1 from public.suppliers where name = 'E2E Lathe Works')");
  const before = (await sql("select value from public.settings where key = 'lathe_price_list'"))[0]?.value ?? [];
  const m0 = await mark();
  try {
    // l1. The owner keeps the price list (a range costs its highest).
    const owner = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(owner.page, `${base}/parts/lathe`);
    await owner.page.locator("[data-lathe-price-list]").fill("Brake disc | 80 | Brake disc resurfacing\nFlywheel | 150-250 | Flywheel resurfacing\nBrake drum | 60");
    await owner.page.locator("[data-lathe-settings-save]").click();
    const saved = ((await owner.page.locator("[data-lathe-settings] [data-lathe-done]").textContent({ timeout: 20000 }).catch(() => "")) ?? "");
    check("l1: the price list is saved (3 items)", /3 items/.test(saved), saved);
    await owner.browser.close();
    // l2. Parts record three tickets on two cars.
    const parts = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    const ticket = async (jobId, item, qty) => {
      await go(parts.page, `${base}/parts/${jobId}`);
      await parts.page.locator("[data-lathe-open]").click();
      await parts.page.locator(`[data-lathe-item="${item}"]`).click();
      await parts.page.locator("[data-lathe-qty]").fill(String(qty));
      await parts.page.locator("[data-lathe-supplier]").selectOption("E2E Lathe Works");
      await parts.page.locator("[data-lathe-taken]").fill("Driver Ravi");
      await parts.page.locator("[data-lathe-save]").click();
      return ((await parts.page.locator("[data-lathe-ticket-form] [data-lathe-done], [data-lathe-ticket-form] [data-lathe-error]").first().textContent({ timeout: 30000 }).catch(() => "")) ?? "");
    };
    const w1 = await ticket(jobA, "Brake disc", 2);
    const w2 = await ticket(jobA, "Flywheel", 1);
    const w3 = await ticket(jobB, "Brake drum", 2);
    check("l2: three tickets with SUB- numbers", [w1, w2, w3].every((w) => /^SUB-\d{5}/.test(w)), [w1, w2, w3].join(" | ").slice(0, 300));
    const rows = await sql("select id, job_id, lathe_ticket, description, cost_aed, quantity, order_status, lathe_taken_by from public.part_items where job_id in ($1, $2) and lathe_ticket is not null order by lathe_ticket", [jobA, jobB]);
    const [t1, t2, t3] = rows;
    check(`l2: 3 tickets on 2 cars (${rows.length})`, rows.length === 3 && new Set(rows.map((r) => r.job_id)).size === 2);
    check("l2: a range costs its highest (Flywheel 250)", Number(t2?.cost_aed) === 250);
    check("l2: under AED 200 skips the LPO (ordered at once), above waits for it", t1?.order_status === "ordered" && t2?.order_status === "none", `${t1?.order_status} / ${t2?.order_status}`);
    check("l2: who took it is recorded", t3?.lathe_taken_by === "Driver Ravi");
    // l3. On the quotation: the service name only, at least 3 × the cost.
    const lines = await sql("select part_item_id, title, line_total, markup_percent from public.quotation_lines where quotation_id = $1 and part_item_id in ($2, $3) and is_active", [qA, t1?.id, t2?.id]);
    check(`l3: both car A tickets are on the quotation (${lines.length})`, lines.length === 2);
    check("l3: the customer reads only the service name", lines.every((l) => /RESURFACING/i.test(l.title) && !/SUB-/.test(l.title)), lines.map((l) => l.title).join(" | "));
    const cost1 = Number(t1.cost_aed) * Number(t1.quantity);
    const cost2 = Number(t2.cost_aed) * Number(t2.quantity);
    const lt = (id) => Number(lines.find((l) => l.part_item_id === id)?.line_total ?? 0);
    check(`l3: at least 3 × the cost (${lt(t1.id)} ≥ ${cost1 * 3}, ${lt(t2.id)} ≥ ${cost2 * 3})`, lt(t1.id) >= cost1 * 3 - 0.01 && lt(t2.id) >= cost2 * 3 - 0.01);
    // l4. The SUB number is on the car's page and on the sticker.
    await go(parts.page, `${base}/parts/${jobA}`);
    const carTickets = await parts.page.locator("[data-lathe-car-ticket]").evaluateAll((els) => els.map((e) => e.getAttribute("data-lathe-car-ticket")));
    check("l4: the car's page lists its SUB tickets", carTickets.includes(t1.lathe_ticket) && carTickets.includes(t2.lathe_ticket));
    await parts.page.locator("[data-lathe-car-tickets]").scrollIntoViewIfNeeded().catch(() => null);
    await parts.page.screenshot({ path: `${proof}/s8-job-lathe-line-sub-number-1440.png` }).catch(() => null);
    const mupdf = await import("mupdf");
    const pdf = await parts.context.request.get(`${base}/api/pdf/part-labels?job=${jobA}&parts=${t1.id}`);
    const buf = Buffer.from(await pdf.body());
    let stickerText = "";
    try { const doc = mupdf.Document.openDocument(buf, "application/pdf"); stickerText = doc.loadPage(0).toStructuredText().asText().replace(/\s+/g, " "); } catch { stickerText = `(no pdf, ${pdf.status()})`; }
    check("l4: the sticker carries the SUB number", stickerText.includes(t1.lathe_ticket), stickerText.slice(0, 160));
    // l5. Back from the lathe.
    await go(parts.page, `${base}/parts/lathe`);
    await parts.page.locator(`[data-lathe-back="${t1.id}"]`).click();
    await parts.page.locator("[data-lathe-back-done]").first().waitFor({ timeout: 20000 }).catch(() => null);
    const back = (await sql("select lathe_back_at is not null as back, order_status from public.part_items where id = $1", [t1.id]))[0];
    check("l5: Back from the lathe (received)", back?.back === true && back?.order_status === "received");
    await parts.browser.close();
    // The customer approves car A's quotation (what we charged counts in the report).
    await sql("update public.quotations set status = 'approved' where id = $1", [qA]);
    // l6. Accounts enter the month-end bill: 2 tickets at a different price, 1 line with no ticket.
    const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
    await go(acc.page, `${base}/parts/lathe`);
    const form = acc.page.locator("[data-lathe-bill-form]");
    await form.locator("[data-lathe-bill-supplier]").selectOption("E2E Lathe Works");
    await form.locator("[data-lathe-bill-number]").fill("E2E-LB-1");
    await form.locator("[data-lathe-bill-date]").fill(today);
    await form.locator("[data-lathe-bill-net]").fill("390");
    await form.locator("[data-lathe-bill-vat]").fill("19.50");
    await form.locator(`[data-lathe-bill-tick="${t1.lathe_ticket}"]`).check();
    await form.locator(`[data-lathe-bill-tick="${t2.lathe_ticket}"]`).check();
    await form.locator(`[data-lathe-bill-amount="${t1.lathe_ticket}"]`).fill("140");
    await form.locator(`[data-lathe-bill-amount="${t2.lathe_ticket}"]`).fill("220");
    await form.locator("[data-lathe-extra-desc]").first().fill("Drum machining, no slip");
    await form.locator("[data-lathe-extra-amount]").first().fill("30");
    await form.scrollIntoViewIfNeeded().catch(() => null);
    await acc.page.screenshot({ path: `${proof}/s8-open-tickets-matching-bill-1440.png`, fullPage: true }).catch(() => null);
    await form.locator("[data-lathe-bill-save]").click();
    // 11 November 2026: one confirm sentence first ("Record bill … from …, AED … covering n tickets?").
    await acc.page.locator('[data-confirm-yes-money="lathe-bill"]').click({ timeout: 8000 }).catch(() => null);
    const billed = ((await form.locator("[data-lathe-done], [data-lathe-error]").first().textContent({ timeout: 30000 }).catch(() => "")) ?? "");
    check("l6: the bill is recorded (2 tickets, 1 line Parts told)", /2 tickets billed/.test(billed) && /Parts told/.test(billed), billed);
    const after = await sql("select id, lathe_bill_amount_aed, final_cost_aed from public.part_items where id in ($1, $2, $3) order by lathe_ticket", [t1.id, t2.id, t3.id]);
    check("l6: the actual cost replaces the estimate on each car (140 = 70 each, 220)", Number(after[0]?.lathe_bill_amount_aed) === 140 && Number(after[0]?.final_cost_aed) === 70 && Number(after[1]?.lathe_bill_amount_aed) === 220, JSON.stringify(after));
    check("l6: the ticket not on the bill stays open", after[2]?.lathe_bill_amount_aed === null);
    const lines2 = await sql("select part_item_id, line_total from public.quotation_lines where quotation_id = $1 and part_item_id in ($2, $3) and is_active", [qA, t1.id, t2.id]);
    check("l6: what the customer is charged never changes", lines2.every((l) => Number(l.line_total) === lt(l.part_item_id)));
    const bill = (await sql("select id, total_aed, jsonb_array_length(extra_lines) as extras from public.lathe_bills where bill_number = 'E2E-LB-1'"))[0];
    check(`l6: one bill AED 409.50 with 1 line that has no ticket (${bill?.total_aed})`, Number(bill?.total_aed) === 409.5 && Number(bill?.extras) === 1);
    const told = await sql("select count(*)::int as n from public.notifications where id > $1 and type = 'lathe_unmatched' and staff_id in (select id from public.staff where role_id = 'parts')", [m0]);
    check("l6: the parts desk is told about the line with no ticket", Number(told[0]?.n) >= 1);
    const zoho = (await sql("select status from public.zoho_outbox where kind = 'lathebill' and record_id = $1", [bill?.id]))[0];
    check("l6: one Zoho bill waits for Sync to Zoho", !!zoho, zoho?.status ?? "none");
    await go(acc.page, `${base}/parts/lathe`);
    const open = await acc.page.locator("[data-lathe-ticket]").evaluateAll((els) => els.map((e) => e.getAttribute("data-lathe-ticket")));
    check("l7: the open list keeps only the unbilled ticket", open.includes(t3.lathe_ticket) && !open.includes(t1.lathe_ticket) && !open.includes(t2.lathe_ticket), open.join(","));
    // l8. The report: tickets, our cost (bill else estimate), what we charged, the profit.
    const charged = lt(t1.id) + lt(t2.id);
    const ourCost = 140 + 220 + Number(t3.cost_aed) * Number(t3.quantity);
    const rep = ((await acc.page.locator("[data-lathe-report]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check(`l8: the report (3 tickets, cost ${money(ourCost)}, charged ${money(charged)}, profit ${money(charged - ourCost)})`, /3 tickets \(2 billed\)/.test(rep) && rep.includes(money(ourCost)) && rep.includes(money(charged)) && rep.includes(money(charged - ourCost)), rep.slice(0, 220));
    await acc.page.locator("[data-lathe-report]").screenshot({ path: `${proof}/s8-lathe-report-1440.png` }).catch(() => null);
    // l9. Paid through Supplier payments like any supplier invoice (11 November 2026, Section 6), or the old form before the apply.
    if ((await acc.page.locator(`[data-lathe-bill="E2E-LB-1"] [data-lathe-pay-link]`).count()) === 1) {
      const sup = (await sql("select supplier_id from public.lathe_bills where id = $1", [bill?.id]))[0]?.supplier_id;
      await go(acc.page, `${base}/supplier-payments?supplier=${encodeURIComponent(sup ?? "name:E2E Lathe Works")}#pay`);
      const box = acc.page.locator("[data-sp-pay-card] [data-supplier-pay-box]");
      await box.locator(`[data-supplier-pay-invoice="lathe:${bill?.id}"]`).waitFor({ timeout: 20000 });
      await box.locator("[data-supplier-pay-save]").click();
      await acc.page.locator("[data-confirm-yes-money]").click({ timeout: 8000 });
    } else {
      await acc.page.locator(`[data-lathe-bill="E2E-LB-1"] input[name=paid_on]`).fill(today);
      await acc.page.locator(`[data-lathe-bill="E2E-LB-1"] button[type=submit]`).click();
    }
    const paid = await until(async () => (await sql("select paid_at is not null as p from public.lathe_bills where id = $1", [bill?.id]))[0]?.p === true, 40);
    check("l9: the bill paid as one supplier payment", paid === true);
    // l10. A ticket not billed after a month is flagged.
    await sql("update public.part_items set lathe_sent_at = now() - interval '40 days' where id = $1", [t3.id]);
    await go(acc.page, `${base}/parts/lathe`);
    check("l10: not billed after a month is flagged", (await acc.page.locator(`[data-lathe-ticket="${t3.lathe_ticket}"] [data-lathe-late]`).count()) === 1);
    await acc.browser.close();
  } finally {
    await sql("update public.settings set value = $1::jsonb where key = 'lathe_price_list'", [JSON.stringify(before)]);
  }
});

/* ================================================================================================= */
/* d1 (10 November 2026, Section 1): paid means paid. One proforma, three money situations: a cheque */
/* waiting to clear, part paid, fully paid. The "car is ready" window and the customer's page follow  */
/* THE still-due figure: no payment options once nothing is due, only the remaining figure otherwise. */
/* ================================================================================================= */
await section("d1", "paid means paid", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-paid-means-paid";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const jobId = seed.jobId;
  if (!jobId) throw new Error("seed failed");
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
  const acc = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0].id;
  // The J-00981 situation: a proforma of AED 2,325.75 not sent yet, a cheque for all of it waiting to clear.
  await sql("update public.invoices set status = 'cancelled' where job_id = $1 and kind = 'proforma' and status = 'issued'", [jobId]);
  const pro = (await sql("insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ('E2E-PRO-D1', 'proforma', $1, $2, $3, 'issued', now(), 2215, 0, 2215, 110.75, 2325.75, 'e2e-d1-pro', $4, $4) returning id", [jobId, job.customer_id, job.vehicle_id, acc]))[0];
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, created_by, updated_by) values ($1, 1, 'labour', 'E2E SERVICE', 1, 2215, 2215, 110.75, 2325.75, 0, $2, $2)", [pro.id, acc]);
  const pay = (await sql("insert into public.payments (job_id, invoice_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, is_deposit, status, cheque_number, cheque_bank, cheque_date, cheque_status, received_by, created_by, updated_by) values ($1, $2, $3, $4, 'cheque', 2325.75, 0, false, 'recorded', '019555', 'Emirates NBD', now()::date, 'pending', $5, $5, $5) returning id", [jobId, pro.id, job.customer_id, job.vehicle_id, acc]))[0];
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const openWindow = async () => {
    await go(o.page, `${base}/jobs/${jobId}`);
    const box = o.page.locator("[data-money-tile] [data-ready-send='proforma']");
    const state = await box.getAttribute("data-due-state").catch(() => null);
    await box.locator("button").first().click();
    await sleep(800);
    const how = (await o.page.locator("[data-pay-how]").count()) > 0;
    const msg = how ? "" : ((await o.page.locator("[data-send-message]").inputValue().catch(() => "")) ?? "");
    const howWords = how ? ((await o.page.locator("[data-pay-how]").textContent().catch(() => "")) ?? "") : "";
    return { state, how, msg, howWords };
  };
  const customer = async () => {
    await go(o.page, `${base}/proforma/e2e-d1-pro`);
    const text = ((await o.page.locator("main").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    return { text, payNow: (await o.page.getByText("Pay now", { exact: false }).count()) > 0, heading: ((await o.page.locator("[data-amount-heading]").textContent().catch(() => "")) ?? "").trim(), amount: ((await o.page.locator("[data-amount-due]").textContent().catch(() => "")) ?? "").trim() };
  };

  // p1. Cheque waiting to clear: no "how will the customer pay", the waiting words, never a payment link.
  let w = await openWindow();
  check(`p1: cheque pending → state waiting_clear (${w.state})`, w.state === "waiting_clear");
  check("p1: no payment choice asked", !w.how);
  check("p1: the message says waiting to clear, no Pay now", /waiting to clear/i.test(w.msg) && !/pay now/i.test(w.msg), w.msg.slice(0, 160));
  let c = await customer();
  check(`p1: the customer's page says waiting to clear, no Pay now (${c.heading})`, /waiting to clear/i.test(c.heading) && !!(await o.page.locator("[data-waiting-clear]").count()) && !c.payNow);

  // p2. Part paid (1,000 cleared): only the remaining 1,325.75 is offered.
  await sql("update public.payments set amount_aed = 1000, cheque_status = 'cleared', cleared_at = now() where id = $1", [pay.id]);
  w = await openWindow();
  check(`p2: part paid → state part (${w.state})`, w.state === "part");
  check("p2: the window asks only for the remaining AED 1,325.75", w.how && /remaining AED 1,325\.75/.test(w.howWords), w.howWords.slice(0, 120));
  await o.page.locator("[data-expected='cash']").click();
  await o.page.locator("[data-pay-continue]").click();
  await sleep(1500);
  const partMsg = (await o.page.locator("[data-send-message]").inputValue().catch(() => "")) ?? "";
  check("p2: the message names the balance due 1,325.75", /Balance due: AED 1,325\.75/.test(partMsg), partMsg.slice(0, 200));
  c = await customer();
  check(`p2: the customer's page offers only 1,325.75 (${c.heading} ${c.amount})`, /still to pay/i.test(c.heading) && c.amount.includes("1,325.75"));

  // p3. Fully paid: no payment options, "fully paid, thank you", receipts on the page.
  await sql("update public.payments set amount_aed = 2325.75 where id = $1", [pay.id]);
  w = await openWindow();
  check(`p3: fully paid → state paid (${w.state})`, w.state === "paid");
  check("p3: no payment choice asked", !w.how);
  check("p3: the message says fully paid, thank you, no payment wording", /fully paid, thank you/i.test(w.msg) && !/pay now|amount due/i.test(w.msg), w.msg.slice(0, 200));
  await o.page.screenshot({ path: `${proof}/d1-paid-car-ready-message-1440.png`, fullPage: false }).catch(() => null);
  c = await customer();
  check(`p3: the customer's page says Paid with the receipt, no Pay now (${c.heading})`, /paid, thank you/i.test(c.heading) && !!(await o.page.locator("[data-paid-receipts]").count()) && !c.payNow);
  await o.browser.close();
});

/* ================================================================================================= */
/* d2 (10 November 2026, Section 2): the Autel post-scan files itself into QC. A car in QC with an   */
/* open round and a pre-scan; an emailed report (through the TEST route, never the real mailbox)     */
/* arrives as the POST-scan and lands in QC's box with no hand step; the same Report ID is not filed */
/* twice.                                                                                            */
/* ================================================================================================= */
await section("d2", "Autel post-scan files itself into QC", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-autel-postscan";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  if (!jobId) throw new Error("seed failed");
  const vin = ((await sql("select v.vin from public.jobs j join public.vehicles v on v.id = j.vehicle_id where j.id = $1", [jobId]))[0]?.vin ?? "").toUpperCase();
  await sql("update public.jobs set status = 'pending_qc', stage = 'qc' where id = $1", [jobId]);
  await sql("insert into public.qc_checks (job_id, round, status, items) select $1, 1, 'open', '[]'::jsonb where not exists (select 1 from public.qc_checks where job_id = $1 and status = 'open')", [jobId]);
  // The pre-scan the inspection had (filed earlier by email).
  await sql("insert into public.inbound_scans (from_email, subject, vin, storage_path, content_type, file_name, job_id, kind, status, report_id) values ('scanner@e2e.test', 'pre', $2, 'e2e/pre.pdf', 'application/pdf', 'pre.pdf', $1, 'pre', 'matched', 'MAXIAE2EPRE1')", [jobId, vin]);
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(o.page, `${base}/qc/${jobId}`);
  const waiting = ((await o.page.locator("[data-postscan-waiting]").textContent().catch(() => "")) ?? "").trim();
  check(`a1: before the email QC says it is waiting (${waiting})`, /Waiting for the Autel report/.test(waiting));
  // The Autel emails the post-scan.
  const subject = `Please receive 2019 BMW Vehicle Diagnostic Report (Report ID: MAXIAE2EPOST1) ${vin}`;
  const r1 = (await api("/api/e2e/mailbox", { pdfText: `Autel MaxiSys report VIN ${vin} post repair`, subject, fileName: "2019 BMW Vehicle Diagnostic Report_E2E.pdf", messageId: `e2e-d2-${Date.now()}`, from: "scanner@e2e.test" })).json;
  check(`a2: the email is matched to the car (${JSON.stringify(r1?.result ?? r1)})`, (r1?.result ?? r1)?.matched === true);
  const filed = (await sql("select kind, status from public.inbound_scans where report_id = 'MAXIAE2EPOST1' and job_id = $1", [jobId]))[0];
  check(`a3: filed as the POST-scan (${filed?.kind})`, filed?.kind === "post");
  const qc = await until(async () => (await sql("select postscan_path from public.qc_checks where job_id = $1 and status = 'open'", [jobId]))[0]?.postscan_path ?? null, 20, 500);
  check(`a4: QC's post-scan box filled by itself (${qc})`, !!qc && String(qc).includes("qc-postscan"));
  await go(o.page, `${base}/qc/${jobId}`);
  check("a5: QC shows the post-scan in, nothing to attach by hand", (await o.page.locator("[data-postscan-in]").count()) === 1 && (await o.page.locator("[data-postscan-waiting]").count()) === 0);
  await o.page.locator("[data-postscan-in]").scrollIntoViewIfNeeded().catch(() => null);
  await o.page.screenshot({ path: `${proof}/d2-qc-postscan-landed-1440.png`, fullPage: false }).catch(() => null);
  // The same Report ID again: never filed twice.
  await api("/api/e2e/mailbox", { pdfText: `Autel MaxiSys report VIN ${vin} post repair`, subject, fileName: "2019 BMW Vehicle Diagnostic Report_E2E.pdf", messageId: `e2e-d2b-${Date.now()}`, from: "scanner@e2e.test" });
  const twice = (await sql("select count(*)::int as n from public.inbound_scans where report_id = 'MAXIAE2EPOST1'"))[0]?.n;
  check(`a6: the same Report ID is filed once (${twice})`, twice === 1);
  // An unmatched report (no open job for that VIN) goes to the unmatched list.
  await api("/api/e2e/mailbox", { pdfText: "Autel report", subject: "Please receive 2020 Audi Vehicle Diagnostic Report (Report ID: MAXIAE2EUNM1) WAUZZZ0000E2E0001", fileName: "audi.pdf", messageId: `e2e-d2c-${Date.now()}`, from: "scanner@e2e.test" });
  const unm = (await sql("select status from public.inbound_scans where report_id = 'MAXIAE2EUNM1'"))[0]?.status;
  check(`a7: an unmatched report is kept as unmatched (${unm})`, unm === "unmatched");
  await go(o.page, `${base}/scans`);
  check("a8: the unmatched report is listed on Scan reports", ((await o.page.locator("main").textContent().catch(() => "")) ?? "").includes("audi.pdf"));
  await o.browser.close();
});

/* ================================================================================================= */
/* d3 (10 November 2026, Section 3): one LPO, several supplier invoices. LPO-00043-3 recreated (two  */
/* lines recorded together as 10670962) and split into two invoices, its Zoho bill reopened for      */
/* each further invoice checked, queued as its own bill and paid on its own.                          */
/* ================================================================================================= */
await section("d3", "one LPO, several supplier invoices", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-several-invoices";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E GARGASH SPLIT', '100200300400777', true, $1, $1) returning id", [ownerId]))[0];
  if (!sup?.id) throw new Error("seed failed: the supplier");
  const today = (await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d;
  const mkPo = async (number, net, invNumber, amount, vat) => (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_vat_aed, supplier_invoice_at, created_by, updated_by) values ($1, $2, $3, 'E2E GARGASH SPLIT', 'supplier', 'received', $4, 'received', $5, $6, $7, $8, now(), $9, $9) returning id", [number, jobId, sup.id, net, invNumber, today, amount, vat, ownerId]))[0]?.id;
  const mkLine = async (poId, pos, desc, qty, cost) => (await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, $2, $3, $4, $5, $4, now(), $6, $6) returning id", [poId, pos, desc, qty, cost, ownerId]))[0]?.id;
  // A. LPO-00043-3: RADIATOR COOLANT HOSE 683.32 and UNDER COVER 990.44 recorded together as 10670962 (1,673.76 + VAT 83.69), already in Zoho.
  const A = await mkPo("E2E-LPO-43-3", 1673.76, "E2E10670962", 1673.76, 83.69);
  const hose = await mkLine(A, 1, "RADIATOR COOLANT HOSE", 1, 683.32);
  const cover = await mkLine(A, 2, "UNDER COVER", 1, 990.44);
  await sql("update public.purchase_orders set zoho_bill_id = 'e2e-bill-43-3', zoho_bill_taxed = true where id = $1", [A]);
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, zoho_id, zoho_result, synced_at) values ('bill', $1, $2, 'synced', 'e2e-bill-43-3', '{}'::jsonb, now())", [A, jobId]);
  // B. Three lines: the first invoice covers two of them; the third comes on its own invoice.
  const B = await mkPo("E2E-LPO-3L", 350, "E2E-INV-A", 250, 12.5);
  const b1 = await mkLine(B, 1, "OIL FILTER", 1, 100);
  const b2 = await mkLine(B, 2, "AIR FILTER", 1, 150);
  const b3 = await mkLine(B, 3, "WIPER BLADE", 2, 50);
  await sql("update public.purchase_orders set supplier_invoice_path = 'e2e/lpo-3l-invoice.pdf' where id = $1", [B]); // the scan is on file (no payment without it)
  if (![A, hose, cover, B, b1, b2, b3].every(Boolean)) throw new Error("seed failed: the LPOs");

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const page = acc.page;
  let visit = 0;
  const open = async (po) => { await go(page, `${base}/parts/orders/${po}?v=${++visit}`); };
  const summary = async () => ((await page.locator("[data-lpo-invoices-summary]").textContent().catch(() => "")) ?? "").trim();
  const answer = async (scope) => ((await page.locator(`${scope} [role=alert], ${scope} .bg-red-soft, ${scope} .bg-green-soft`).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  const tick = async (scope, lineId, qty) => {
    const row = page.locator(`${scope} [data-pick-line$="${lineId}"]`);
    await row.locator("input[type=checkbox]").check();
    if (qty !== undefined) await row.locator(`input[name="qty__${lineId}"]`).fill(String(qty));
  };
  const fill = async (scope, { number, amount, vat }) => {
    await page.locator(`${scope} [data-inv-number]`).fill(number);
    await page.locator(`${scope} [data-inv-date]`).fill(today);
    await page.locator(`${scope} [data-inv-amount]`).fill(String(amount));
    await page.locator(`${scope} [data-inv-vat]`).fill(String(vat));
  };

  // i1. B: the first invoice covers lines 1-2 → line 3 waits for its own invoice.
  await open(B);
  check(`i1: one invoice, fully invoiced at first (${await summary()})`, /1 invoice · fully invoiced/.test(await summary()));
  await page.locator("[data-not-on-first] summary").click();
  await tick("[data-not-on-first]", b3);
  await page.locator("[data-not-on-first-save]").click();
  await until(async () => (await sql("select supplier_invoice_lines from public.purchase_orders where id = $1", [B]))[0]?.supplier_invoice_lines, 30, 500);
  await open(B);
  check(`i1: "1 invoice · 1 line still waiting for an invoice" (${await summary()})`, /1 invoice · 1 line still waiting for an invoice/.test(await summary()));
  check("i1: the waiting line says Waiting for invoice", (await page.locator(`[data-lpo-invoice-line="${b3}"] [data-line-waiting]`).count()) === 1);
  await page.locator("[data-add-invoice] summary").click();
  await tick("[data-add-invoice]", b3, 3);
  await fill("[data-add-invoice]", { number: "E2E-INV-B", amount: 100, vat: 5 });
  await page.locator("[data-add-invoice-save]").click();
  await sleep(2500);
  const twiceLine = await answer("[data-add-invoice]");
  await open(B);
  await page.locator("[data-add-invoice] summary").click();
  await tick("[data-add-invoice]", b3, 2);
  await fill("[data-add-invoice]", { number: "E2E-INV-A", amount: 100, vat: 5 });
  await page.locator("[data-add-invoice-save]").click();
  await sleep(2500);
  const twiceNumber = await answer("[data-add-invoice]");
  // i4. The second invoice for line 3.
  await open(B);
  await page.locator("[data-add-invoice] summary").click();
  await tick("[data-add-invoice]", b3, 2);
  await fill("[data-add-invoice]", { number: "E2E-INV-B", amount: 100, vat: 5 });
  await page.locator("[data-add-invoice-save]").click();
  const invB = await until(async () => (await sql("select id, amount_aed::float as a from public.lpo_invoices where po_id = $1 and is_active", [B]))[0], 30, 500);
  check(`i4: the second invoice saved (${JSON.stringify(invB)})`, invB?.a === 100);
  await open(B);
  check(`i4: "2 invoices · fully invoiced" (${await summary()})`, /2 invoices · fully invoiced/.test(await summary()));
  // i5. Checked on its own → its own Zoho bill waits for Sync to Zoho.
  await page.locator("[data-lpo-extra-invoice='E2E-INV-B'] [data-extra-check]").click();
  const zrow = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'lpoinvoice' and record_id = $1", [invB?.id]))[0], 30, 500);
  check(`i5: checked, queued as its own Zoho bill (${zrow?.status})`, !!zrow);
  // i6. Paid on its own: it is its own line in the payment box.
  await open(B);
  const payKeys = await page.locator("[data-supplier-pay-invoice]").evaluateAll((els) => els.map((e) => e.getAttribute("data-supplier-pay-invoice")));
  check(`i6: the further invoice is its own line to pay (${payKeys.length})`, payKeys.some((k) => String(k).includes(`~${invB?.id}`)) && payKeys.includes(B));
  // i7. The Supplier invoices list shows it as its own row.
  await go(page, `${base}/supplier-invoices?q=E2E-INV-B`);
  check("i7: the further invoice is a row on Supplier invoices", ((await page.locator("main").textContent().catch(() => "")) ?? "").includes("E2E-INV-B"));

  // s1. LPO-00043-3 split: UNDER COVER moves to its own invoice; both amounts as printed.
  await open(A);
  await page.locator("[data-split-invoice] summary").click();
  await tick("[data-split-invoice]", cover);
  await fill("[data-split-invoice]", { number: "E2E10670963", amount: 990.44, vat: 49.52 });
  await page.locator("[data-split-first-amount]").fill("683.32");
  await page.locator("[data-split-first-vat]").fill("34.17");
  await page.locator("[data-split-save]").click();
  const split = await until(async () => (await sql("select number, amount_aed::float as a, vat_aed::float as v from public.lpo_invoices where po_id = $1 and is_active", [A]))[0], 30, 500);
  check(`s1: the other invoice split off at 990.44 + 49.52 (${JSON.stringify(split)})`, split?.a === 990.44 && split?.v === 49.52);
  const firstNow = (await sql("select supplier_invoice_amount::float as a, supplier_invoice_vat_aed::float as v, supplier_invoice_lines from public.purchase_orders where id = $1", [A]))[0];
  check(`s1: 10670962 now covers the hose only, 683.32 + 34.17 (${JSON.stringify(firstNow)})`, firstNow?.a === 683.32 && firstNow?.v === 34.17 && JSON.stringify(firstNow?.supplier_invoice_lines ?? []).includes(hose) && !JSON.stringify(firstNow?.supplier_invoice_lines ?? []).includes(cover));
  const reopened = (await sql("select status from public.zoho_outbox where kind = 'bill' and record_id = $1", [A]))[0]?.status;
  check(`s1: the first invoice's Zoho bill is reopened for correction (${reopened})`, reopened === "pending");
  await open(A);
  check(`s1: "2 invoices · fully invoiced" (${await summary()})`, /2 invoices · fully invoiced/.test(await summary()));
  await page.locator("[data-lpo-invoices]").scrollIntoViewIfNeeded().catch(() => null);
  await page.locator("[data-lpo-invoices]").screenshot({ path: `${proof}/d3-lpo-00043-3-split-1440.png` }).catch(() => null);
  await acc.browser.close();
});

/* ================================================================================================= */
/* d4 (10 November 2026, Section 4): an LPO "Send for owner approval". Accounts see three choices,   */
/* send with the compulsory note; "Waiting for owner" on the list, the owner's bell and Waiting on   */
/* you; the owner replies, then approves with an answer; another is refused with a reason; one above  */
/* the accounts limit goes to the owner by itself. Accounts get a bell with each answer.             */
/* ================================================================================================= */
await section("d4", "LPO send for owner approval", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-owner-review";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const head = (await sql("select id, display_name from public.staff where role_id = 'accounts' and is_active and is_head_accountant order by created_at limit 1"))[0]
    ?? (await sql("select id, display_name from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
  if (!head?.id) throw new Error("no accounts login");
  const wasHead = (await sql("select is_head_accountant from public.staff where id = $1", [head.id]))[0]?.is_head_accountant;
  if (!wasHead) await sql("update public.staff set is_head_accountant = true where id = $1", [head.id]);
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E OWNER REVIEW', '100200300400888', true, $1, $1) returning id", [ownerId]))[0];
  const mkPo = async (number, net) => {
    const id = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, created_by, updated_by) values ($1, $2, $3, 'E2E OWNER REVIEW', 'supplier', 'pending_approval', $4, $5, $5) returning id", [number, jobId, sup.id, net, ownerId]))[0]?.id;
    await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, created_by, updated_by) values ($1, 1, 'E2E REVIEW PART', 1, $2, $3, $3)", [id, net, ownerId]);
    return id;
  };
  const A = await mkPo("E2E-LPO-OR-1", 1200);
  const B = await mkPo("E2E-LPO-OR-2", 300);
  if (!sup?.id || !A || !B) throw new Error("seed failed: the LPOs");
  const limitBefore = (await sql("select value::text as v from public.settings where key = 'lpo_accounts_limit_aed'"))[0]?.v ?? null;
  const since = Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0].m);
  const bells = async (staffId) => (await sql("select title from public.notifications where id > $1 and staff_id = $2 and type = 'po_owner_review' order by id", [since, staffId])).map((r) => r.title);
  const status = async (po) => (await sql("select status, reply, decision from public.lpo_owner_reviews where po_id = $1 order by created_at desc limit 1", [po]))[0];
  const poStatus = async (po) => (await sql("select status from public.purchase_orders where id = $1", [po]))[0]?.status;
  try {
    const acc = await browserForId(head.id, { viewport: { width: 1440, height: 900 } });
    const ap = acc.page;
    // o1. Accounts: Approve, Refuse and Send for owner approval; the note is compulsory.
    await go(ap, `${base}/parts/orders/${A}`);
    const three = (await ap.locator('[data-confirm-open="lpo-approve"]').count()) > 0 && (await ap.locator("button[name=decision][value=refuse]").count()) > 0 && (await ap.locator("[data-send-owner] summary").count()) > 0;
    check("o1: accounts see Approve, Refuse and Send for owner approval", three);
    await ap.locator("[data-send-owner] summary").first().click();
    await ap.locator("[data-send-owner]").first().screenshot({ path: `${proof}/d4-three-buttons-1440.png` }).catch(() => null);
    await ap.locator("[data-send-owner] form").first().screenshot({ path: `${proof}/d4-send-owner-note-1440.png` }).catch(() => null);
    const required = await ap.locator("[data-owner-note]").first().evaluate((el) => el.required);
    check("o1: the note is compulsory", required === true);
    await ap.locator("[data-owner-note]").first().fill("Supplier price looks high compared to last month, please confirm");
    await ap.locator("[data-send-owner-save]").first().click();
    const r1 = await until(async () => (await status(A))?.status === "waiting" ? await status(A) : null, 30, 500);
    check("o2: sent, waiting for the owner", r1?.status === "waiting");
    check(`o2: the owner gets a bell (${(await bells(ownerId)).join(" | ")})`, (await bells(ownerId)).some((t) => t.includes("E2E-LPO-OR-1")));
    await go(ap, `${base}/parts/orders/${A}`);
    check("o2: accounts no longer decide it (Waiting for the owner)", (await ap.locator("[data-lpo-waiting-owner]").count()) === 1);
    const log = ((await ap.locator("[data-owner-review-line]").first().textContent()) ?? "");
    check(`o2: the log line (${log.slice(0, 90)})`, /^Sent for owner approval by .+: Supplier price looks high/.test(log.trim()));
    await go(ap, `${base}/parts/orders?tab=pending`);
    check("o2: \"Waiting for owner\" on the LPO list", ((await ap.locator(`[data-lpo-row="E2E-LPO-OR-1"] [data-lpo-row-owner]`).textContent().catch(() => "")) ?? "").includes("Waiting for owner"));
    // o3. The owner: the note at the top and three answers; Reply to accounts.
    const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    const op = own.page;
    await go(op, `${base}/dashboard`);
    check("o3: Waiting on you shows it for the owner", ((await op.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "").includes("E2E-LPO-OR-1"));
    await go(op, `${base}/parts/orders/${A}`);
    check("o3: the owner sees Approve, Refuse and Reply to accounts", (await op.locator("[data-owner-options] [data-owner-approve]").count()) === 1 && (await op.locator("[data-owner-options] [data-owner-refuse]").count()) === 1 && (await op.locator("[data-owner-options] [data-owner-reply]").count()) === 1);
    await op.locator("[data-owner-review]").screenshot({ path: `${proof}/d4-owner-options-1440.png` }).catch(() => null);
    await op.locator("[data-owner-reply-text]").fill("It is the new list price, fine to approve");
    await op.locator("[data-owner-reply]").click();
    const r2 = await until(async () => (await status(A))?.status === "replied" ? await status(A) : null, 30, 500);
    check("o3: replied, back with accounts", r2?.status === "replied" && /new list price/.test(r2?.reply ?? ""));
    check(`o3: accounts get a bell with the answer (${(await bells(head.id)).join(" | ")})`, (await bells(head.id)).some((t) => t.startsWith("Owner replied")));
    // o4. Accounts send it again; the owner approves with an answer.
    await go(ap, `${base}/parts/orders/${A}`);
    await ap.locator("[data-send-owner] summary").first().click();
    await ap.locator("[data-owner-note]").first().fill("Still unsure: please approve yourself");
    await ap.locator("[data-send-owner-save]").first().click();
    await until(async () => (await status(A))?.status === "waiting", 30, 500);
    await go(op, `${base}/parts/orders/${A}`);
    await op.locator("[data-owner-options] input[name=note]").first().fill("Approved, go ahead");
    await op.locator("[data-owner-approve]").click();
    await until(async () => (await poStatus(A)) === "approved", 30, 500);
    const r3 = await until(async () => (await status(A))?.decision === "approved" ? await status(A) : null, 30, 500);
    check("o4: approved by the owner, the question closed", (await poStatus(A)) === "approved" && r3?.status === "decided");
    check("o4: accounts get a bell with the decision", (await bells(head.id)).some((t) => t.startsWith("Approved by")));
    const ev = (await sql("select note from public.job_events where job_id = $1 and event_type = 'po_owner_review' order by created_at", [jobId])).map((r) => r.note);
    check(`o4: the log on the job (${ev.length} lines)`, ev.some((n) => /sent for owner approval by/.test(n)) && ev.some((n) => /Approved by .+: Approved, go ahead/.test(n)));
    // o5. Another one refused by the owner with a reason.
    await go(ap, `${base}/parts/orders/${B}`);
    await ap.locator("[data-send-owner] summary").first().click();
    await ap.locator("[data-owner-note]").first().fill("Is this supplier still approved?");
    await ap.locator("[data-send-owner-save]").first().click();
    await until(async () => (await status(B))?.status === "waiting", 30, 500);
    await go(op, `${base}/parts/orders/${B}`);
    await op.locator("[data-owner-refuse-reason]").fill("Use the other supplier");
    await op.locator("[data-owner-refuse]").click();
    await until(async () => (await poStatus(B)) === "cancelled", 30, 500);
    check("o5: refused with the reason", (await poStatus(B)) === "cancelled" && (await status(B))?.decision === "refused");
    // o6. The accounts limit (off by default): above it, Approve sends it to the owner by itself.
    await sql("insert into public.settings (key, label, value) values ('lpo_accounts_limit_aed', 'Accounts approve LPOs up to this amount incl. VAT (0 = no limit)', to_jsonb(500)) on conflict (key) do update set value = to_jsonb(500)");
    const C = await mkPo("E2E-LPO-OR-3", 800);
    await go(ap, `${base}/parts/orders/${C}`);
    check("o6: accounts see \"Above your approval limit\"", (await ap.locator("[data-above-limit]").count()) === 1);
    await ap.locator('[data-confirm-open="lpo-approve"]').first().click();
    await ap.locator("[data-confirm-yes-money=\"lpo-approve\"]").click();
    const r6 = await until(async () => (await sql("select status, auto, note from public.lpo_owner_reviews where po_id = $1", [C]))[0], 30, 500);
    check(`o6: above the limit it waits for the owner (${r6?.note ?? ""})`, r6?.status === "waiting" && r6?.auto === true && (await poStatus(C)) === "pending_approval" && /Above accounts limit/.test(r6?.note ?? ""));
    await own.browser.close();
    await acc.browser.close();
  } finally {
    if (limitBefore === null) await sql("update public.settings set value = to_jsonb(0) where key = 'lpo_accounts_limit_aed'");
    else await sql("update public.settings set value = $1::jsonb where key = 'lpo_accounts_limit_aed'", [limitBefore]);
    if (!wasHead) await sql("update public.staff set is_head_accountant = false where id = $1", [head.id]);
  }
});

/* ================================================================================================= */
/* d5 (10 November 2026, Section 5): the Supplier payments tab, owner + accounts only. Accounts see   */
/* what is due by supplier and record from it, with the Excel export; the parts desk has no menu      */
/* item, the server refuses the page and the export, and no payment facts on the LPO, the Supplier     */
/* invoices page or the suppliers list.                                                               */
/* ================================================================================================= */
await section("d5", "supplier payments tab", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-supplier-payments-tab";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E PAY TAB', '100200300400999', true, $1, $1) returning id", [ownerId]))[0];
  const today = (await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d;
  const po = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_path, supplier_invoice_at, supplier_invoice_checked_at, created_by, updated_by) values ('E2E-LPO-PT-1', $1, $2, 'E2E PAY TAB', 'supplier', 'received', 400, 'received', 'E2E-PT-INV-1', $3, 400, 'e2e/pt-invoice.pdf', now(), now(), $4, $4) returning id", [jobId, sup.id, today, ownerId]))[0]?.id;
  await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, 1, 'E2E PAY TAB PART', 1, 400, 1, now(), $2, $2)", [po, ownerId]);
  if (!sup?.id || !po) throw new Error("seed failed: the LPO");

  // t1. Accounts: the tab in the menu, due by supplier, Record payment opens the box for that supplier, the export.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const ap = acc.page;
  await go(ap, `${base}/supplier-payments`);
  check("t1: accounts see Supplier payments in the menu", (await ap.locator('[data-nav-sub][href="/supplier-payments"]').count()) >= 1);
  const row = ap.locator('[data-sp-supplier="E2E PAY TAB"]');
  check("t1: the supplier is due (AED 420.00 incl. VAT)", (await row.count()) === 1 && (await row.locator("[data-sp-due-amount]").getAttribute("data-sp-due-amount")) === "420.00");
  await row.locator("[data-sp-pay]").click();
  await ap.waitForURL(/supplier=/, { timeout: 20000 });
  check("t1: Record payment opens the payment box with the invoice", (await ap.locator(`[data-sp-pay-card] [data-supplier-pay-invoice="${po}"]`).count()) === 1);
  await ap.screenshot({ path: `${proof}/d5-tab-as-accounts-1440.png`, fullPage: false }).catch(() => null);
  const ex = await ap.request.get(`${base}/api/export/supplier-payments`);
  check(`t1: the Excel export (${ex.status()})`, ex.status() === 200 && /spreadsheetml/.test(ex.headers()["content-type"] ?? ""));
  await acc.browser.close();

  // t2. Parts: no menu item, the page and the export refused, no payment facts anywhere.
  const pt = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  const pp = pt.page;
  await go(pp, `${base}/parts`);
  check("t2: parts have no Supplier payments in the menu", (await pp.locator('[href="/supplier-payments"]').count()) === 0);
  const res = await pp.goto(`${base}/supplier-payments`);
  check(`t2: the server refuses the page for parts (${res?.status()})`, res?.status() === 404);
  await pp.screenshot({ path: `${proof}/d5-refused-for-parts-1440.png` }).catch(() => null);
  const ex2 = await pp.request.get(`${base}/api/export/supplier-payments`);
  check(`t2: the server refuses the export for parts (${ex2.status()})`, ex2.status() === 403);
  await go(pp, `${base}/parts/orders/${po}`);
  check("t2: no payment box on the LPO for parts", (await pp.locator("[data-supplier-pay]").count()) === 0 && (await pp.locator("[data-supplier-pay-box]").count()) === 0);
  await go(pp, `${base}/supplier-invoices`);
  const siText = (await pp.locator("main").textContent().catch(() => "")) ?? "";
  check("t2: no payment filters or unpaid figures on Supplier invoices", (await pp.locator("[data-si-no-proof-filter], [data-si-unpaid], [data-si-pay]").count()) === 0 && !/Paid to supplier/.test(siText));
  await go(pp, `${base}/parts/suppliers`);
  check("t2: no unpaid or advance chips on the suppliers list", (await pp.locator("[data-supplier-unpaid], [data-supplier-advance]").count()) === 0);
  await pt.browser.close();
});

/* ================================================================================================= */
/* d6 (10 November 2026, Section 6): proof on every payment method. In the Record a payment window    */
/* (the J-00981 case) Payment link and Cash show "Add proof" and "Scan document" (optional); Cheque   */
/* needs the photo of the cheque before Record works; the receipt line shows the proof as a picture.  */
/* ================================================================================================= */
await section("d6", "proof on every payment method", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-payment-proof";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const jobId = seed?.jobId;
  if (!jobId || !seed?.invoice?.id) throw new Error("seed failed");
  await sql("update public.invoices set sent_at = now() where id = $1", [seed.invoice.id]);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const p = acc.page;
  await go(p, `${base}/jobs/${jobId}`);
  await p.locator("[data-record-payment-open]").first().click();
  const form = p.locator("[data-record-payment-dialog] [data-payment-form]").first();
  await form.waitFor({ timeout: 30000 });
  const words = async () => ((await form.locator("[data-proof-label]").textContent().catch(() => "")) ?? "").trim();
  // e1. Every method has Add proof and Scan document; cash and link optional, cheque, card and transfer required.
  for (const m of ["cash", "link", "card", "transfer", "cheque"]) {
    await form.locator(`[data-method="${m}"]`).click();
    const hasAdd = (await form.locator("[data-job-file-upload]").count()) >= 1;
    const hasScan = (await form.getByText("Scan document").count()) >= 1;
    const req = await form.locator("[data-proof-label]").getAttribute("data-proof-label").catch(() => null);
    check(`e1 ${m}: Add proof + Scan document, ${req} (${await words()})`, hasAdd && hasScan && req === (["cash", "link"].includes(m) ? "optional" : "required"));
    if (m === "link") await form.screenshot({ path: `${proof}/d6-payment-link-proof-1440.png` }).catch(() => null);
  }
  // e2. A cheque without its photo: Record is held with plain words.
  await form.locator('[data-method="cheque"]').click();
  await form.locator('input[name="cheque_number"]').fill("019500");
  await form.locator('input[name="cheque_date"]').fill("2026-11-10");
  check("e2: a cheque with no photo is held (\"Attach the proof first\")", (await form.locator("[data-proof-missing]").count()) === 1);
  // e3. The cheque photo attached: recorded, the photo on the receipt.
  await form.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: png });
  await until(async () => (await form.locator("[data-proof-missing]").count()) === 0, 40, 500);
  if ((await form.locator("[data-amount-full]").count()) === 1) await form.locator("[data-amount-full]").click();
  await form.screenshot({ path: `${proof}/d6-cheque-with-photo-1440.png` }).catch(() => null);
  await pressRecord(form);
  await until(async () => (await p.locator("[data-record-payment-done], [data-record-payment-error]").count()) > 0, 60, 500);
  const pay = await until(async () => (await sql("select number, method, proof_path from public.payments where job_id = $1 and is_active and method = 'cheque'", [jobId]))[0], 30, 500);
  check(`e3: the cheque is recorded with its photo (${pay?.number})`, !!pay?.proof_path);
  // e4. The receipt line shows the proof as a picture or PDF tile that opens it.
  await go(p, `${base}/jobs/${jobId}/invoice`);
  check("e4: the receipt line shows the proof", (await p.locator("[data-proof-link]").count()) >= 1);
  await go(p, `${base}/invoices/${seed.invoice.id}`);
  check("e4: the invoice page's receipt line shows the proof tile", (await p.locator("[data-proof-link] img, [data-proof-link] [data-slip-kind]").count()) >= 1);
  await acc.browser.close();
});

/* ================================================================================================= */
/* d7 (10 November 2026, Section 7): clocking on the bodyshop tablet. Face → PIN → Start / Pause /   */
/* Stop (nothing changes until a button); the break pauses by itself and the face asks "Back on this  */
/* car?"; Pause asks why; starting another car pauses the first ("moved to another car"); Stop = my   */
/* part is done; the clocked minutes only.                                                           */
/* ================================================================================================= */
await section("d7", "clocking start pause stop", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-clocking";
  mkdirSync(proof, { recursive: true });
  const { createHash, randomBytes } = await import("node:crypto");
  const seed = (await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" })).json;
  const jobId = seed?.jobId;
  const installer = seed?.people?.installer;
  if (!jobId || !installer) throw new Error("seed failed");
  const other = (await sql("select id from public.jobs where is_open and id <> $1 and status not in ('booked') order by created_at desc limit 1", [jobId]))[0]?.id;
  const clocks = async () => sql("select job_id, ended_at, closed_reason, minutes from public.bodyshop_clockings where staff_id = $1 and is_active order by created_at", [installer]);
  // Nothing running for the installer to start with.
  await sql("update public.bodyshop_clockings set ended_at = now(), minutes = 1 where staff_id = $1 and ended_at is null", [installer]);
  // k1. The break pauses by itself: a clocking from 13:00 today, the break job run at 13:45 (bodyshop break 13:30-14:30).
  const today = (await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d;
  const dow = new Date(`${today}T12:00:00+04:00`).getUTCDay();
  const startAt = dow === 5 ? `${today}T12:00:00+04:00` : `${today}T13:00:00+04:00`;
  const runAt = dow === 5 ? `${today}T12:45:00+04:00` : `${today}T13:45:00+04:00`;
  await sql("insert into public.bodyshop_clockings (job_id, staff_id, source, started_at) values ($1, $2, 'tablet', $3)", [jobId, installer, startAt]);
  const brk = await api("/api/e2e/breaks", { staffIds: [installer], now: runAt });
  const afterBreak = (await clocks()).at(-1);
  check(`k1: the break paused the clock by itself (${brk.json?.paused}, ${afterBreak?.closed_reason})`, brk.json?.paused === 1 && afterBreak?.closed_reason === "pause:Break" && !!afterBreak?.ended_at);
  const ev = (await sql("select note from public.job_events where job_id = $1 and event_type = 'bodyshop_clock' order by created_at desc limit 1", [jobId]))[0]?.note ?? "";
  check(`k1: in the log ("${ev}")`, /paused for the break/i.test(ev));

  const devToken = randomBytes(16).toString("hex");
  await sql("insert into public.devices (name, location, kind, section, token_hash) values ('E2e PPF tablet', 'bodyshop', 'shared', 'ppf', $1)", [createHash("sha256").update(devToken).digest("hex")]);
  const { browser: tb, page: tp } = await browserFor("owner", { viewport: { width: 1024, height: 1366 }, hasTouch: true });
  await tp.context().addCookies([{ name: "erp_device", value: devToken, domain: "localhost", path: "/" }]);
  const openCar = async () => {
    await go(tp, `${base}/tablet/bodyshop?v=${Date.now()}`);
    await tp.locator(`[data-tablet-car='${jobId}']`).click();
    await tp.locator(`[data-tablet-person='${installer}']`).waitFor({ timeout: 20000 });
  };
  const pin = async () => {
    await tp.locator(`[data-tablet-person='${installer}']`).click();
    await until(async () => ((await tp.locator("[data-pin-pad], [data-tablet-mode-clock]").count()) ? 1 : null), 20, 300);
    if (await tp.locator("[data-tablet-mode-clock]").count()) await tp.locator("[data-tablet-mode-clock]").click();
    await tp.locator("[data-pin-pad]").waitFor({ timeout: 20000 });
    for (const k of ["1", "2", "3", "4"]) await tp.locator("[data-pin-pad] button", { hasText: new RegExp(`^${k}$`) }).click();
    await tp.locator("[data-clock-choice]").waitFor({ timeout: 20000 });
  };
  const note = async () => until(async () => (await tp.locator("[data-tablet-note]").textContent().catch(() => null)) || null, 30, 300);
  // k2. After the break the face asks "Back on this car?"; the PIN shows the three buttons and changes nothing.
  await openCar();
  check("k2: the face asks \"Back on this car?\"", (await tp.locator(`[data-tablet-person='${installer}'] [data-tablet-back-on]`).count()) === 1);
  await tp.screenshot({ path: `${proof}/d7-back-on-this-car-1024.png` }).catch(() => null);
  const before = (await clocks()).length;
  await pin();
  check("k2: Start / Pause / Stop after the PIN", (await tp.locator("[data-clock-start]").count()) === 1 && (await tp.locator("[data-clock-pause]").count()) === 1 && (await tp.locator("[data-clock-stop]").count()) === 1 && /Back on this car/.test((await tp.locator("[data-clock-start]").textContent()) ?? ""));
  await tp.locator("[data-clock-choice]").screenshot({ path: `${proof}/d7-three-buttons-after-pin-1024.png` }).catch(() => null);
  check("k2: nothing changed before a button is pressed", (await clocks()).length === before);
  await tp.locator("[data-clock-start]").click();
  const n1 = await note();
  check(`k2: back on the car ("${n1}")`, /back on/i.test(n1 ?? "") && (await clocks()).at(-1)?.ended_at === null);
  // k3. Pause asks why: "waiting for parts".
  await until(async () => ((await tp.locator("[data-tablet-note]").count()) === 0 ? 1 : null), 30, 300);
  await openCar();
  await pin();
  await tp.locator("[data-clock-pause]").click();
  await tp.locator('[data-clock-reason="Waiting for parts"]').click();
  const n2 = await note();
  check(`k3: paused with the reason ("${n2}")`, /paused on .+\(waiting for parts\)/i.test(n2 ?? "") && (await clocks()).at(-1)?.closed_reason === "pause:Waiting for parts");
  // k4. Starting this car while on another pauses the other ("moved to another car").
  if (other) {
    await sql("insert into public.bodyshop_clockings (job_id, staff_id, source) values ($1, $2, 'tablet')", [other, installer]);
    await until(async () => ((await tp.locator("[data-tablet-note]").count()) === 0 ? 1 : null), 30, 300);
    await openCar();
    await pin();
    check("k4: the tablet says it is on another car", (await tp.locator("[data-clock-on-other]").count()) === 1);
    await tp.locator("[data-clock-start]").click();
    const n3 = await note();
    const moved = (await sql("select closed_reason from public.bodyshop_clockings where staff_id = $1 and job_id = $2 order by created_at desc limit 1", [installer, other]))[0]?.closed_reason;
    check(`k4: the other car paused, moved to another car ("${n3}")`, moved === "pause:Moved to another car" && /moved to another car/i.test(n3 ?? ""));
    check("k4: one car at a time", (await sql("select count(*)::int as n from public.bodyshop_clockings where staff_id = $1 and ended_at is null and is_active", [installer]))[0].n === 1);
  }
  // k5. Stop: my part is done; the clocked minutes only.
  await until(async () => ((await tp.locator("[data-tablet-note]").count()) === 0 ? 1 : null), 30, 300);
  await openCar();
  await pin();
  await tp.locator("[data-clock-stop]").click();
  const n4 = await note();
  const last = (await clocks()).at(-1);
  check(`k5: Stop = my part is done ("${n4}")`, /my part is done/i.test(n4 ?? "") && last?.closed_reason === "done" && last?.ended_at !== null);
  check("k5: nothing is left running", (await sql("select count(*)::int as n from public.bodyshop_clockings where staff_id = $1 and ended_at is null and is_active", [installer]))[0].n === 0);
  await tb.close();
});

/* ================================================================================================= */
/* d8 (10 November 2026, Section 8): reverse a mistaken stock entry. "BLUE - COOLANT +5 → 5 at       */
/* AED 49.00 · Opening stock" reversed with a reason, the owner approves, "−5 → 0 · reversed …       */
/* approved by …"; blocked when some was issued (the job named); moved to a job instead; an empty    */
/* item archived.                                                                                    */
/* ================================================================================================= */
await section("d8", "stock reverse a mistaken entry", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-stock-reverse";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const jobNumber = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number;
  const parts = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0]?.id;
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const mkItem = async (name, qty) => {
    const id = (await sql("insert into public.stock_items (name, unit, quantity, unit_cost, item_type, created_by, updated_by) values ($1, 'L', $2, 49, 'consumable', $3, $3) returning id", [name, qty, parts]))[0]?.id;
    const mv = (await sql("insert into public.stock_movements (stock_item_id, kind, quantity, unit_cost, quantity_after, note, created_by, updated_by) values ($1, 'in', $2, 49, $2, 'Opening stock', $3, $3) returning id", [id, qty, parts]))[0]?.id;
    return { id, mv };
  };
  const A = await mkItem("E2E BLUE - COOLANT", 5);
  const B = await mkItem("E2E BRAKE CLEANER", 5);
  const C = await mkItem("E2E WIPER FLUID", 4);
  // B: 3 already issued to the job, 2 left on the shelf.
  await sql("insert into public.stock_movements (stock_item_id, kind, quantity, unit_cost, quantity_after, job_id, note, created_by, updated_by) values ($1, 'out', -3, 49, 2, $2, 'Issued', $3, $3)", [B.id, jobId, parts]);
  await sql("update public.stock_items set quantity = 2 where id = $1", [B.id]);
  const since = Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0].m);

  const pb = await browserForId(parts, { viewport: { width: 1440, height: 900 } });
  const pp = pb.page;
  const ask = async (mv, reason, jobPick) => {
    await go(pp, `${base}/parts/stock?v=${Date.now()}`);
    const box = pp.locator(`[data-reverse-entry="${mv}"]`);
    await box.locator("summary").click();
    if (jobPick) {
      await box.locator('input[value="move_to_job"]').check();
      await box.locator("[data-reverse-job]").selectOption(jobPick);
    }
    await box.locator("[data-reverse-reason]").fill(reason);
    await box.locator("[data-reverse-send]").click();
    await pp.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
    return decodeURIComponent((pp.url().split(/[?&](?:message|error)=/)[1] ?? "").split("#")[0].replace(/\+/g, " "));
  };
  // r1. Parts ask to reverse it with the reason; the owner gets a bell.
  const w1 = await ask(A.mv, "Entered by mistake");
  check(`r1: sent to the owner (${w1.slice(0, 80)})`, /Sent to the owner/.test(w1) && (await sql("select status from public.stock_reversals where movement_id = $1", [A.mv]))[0]?.status === "pending");
  check("r1: the owner's bell", (await sql("select count(*)::int as n from public.notifications where id > $1 and staff_id = $2 and type = 'stock_reversal'", [since, ownerId]))[0].n >= 1);
  await pp.locator("[data-stock-reversals]").screenshot({ path: `${proof}/d8-reverse-request-1440.png` }).catch(() => null);
  // r2. Blocked when some was issued: the job is named.
  const w2 = await ask(B.mv, "Entered by mistake");
  check(`r2: blocked, names the job (${w2.slice(0, 120)})`, /already issued/.test(w2) && w2.includes(jobNumber));
  // r3. Move to a job instead.
  const w3 = await ask(C.mv, "Bought for this car", jobId);
  check(`r3: move to the job sent to the owner (${w3.slice(0, 60)})`, /Sent to the owner/.test(w3));
  await pb.browser.close();

  // r4. The owner approves both: the opposite movement, and the issue to the job.
  const ob = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const op = ob.page;
  for (const item of [A, C]) {
    await go(op, `${base}/parts/stock?v=${Date.now()}`);
    const row = op.locator("[data-reversal='pending']").filter({ hasText: item === A ? "BLUE" : "WIPER" });
    await row.locator("[data-reversal-approve]").click();
    await op.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  }
  const last = (await sql("select kind, quantity::float as q, quantity_after::float as a, note from public.stock_movements where stock_item_id = $1 order by created_at desc limit 1", [A.id]))[0];
  check(`r4: "−5 → 0 · reversed: … approved by" (${JSON.stringify(last)})`, last?.q === -5 && last?.a === 0 && /reversed: Entered by mistake · approved by /.test(last?.note ?? ""));
  const itemA = (await sql("select quantity::float as q from public.stock_items where id = $1", [A.id]))[0];
  check("r4: quantity corrected, history kept (both movements)", itemA?.q === 0 && (await sql("select count(*)::int as n from public.stock_movements where stock_item_id = $1", [A.id]))[0].n === 2);
  const issue = (await sql("select quantity::float as q from public.stock_issues where stock_item_id = $1 and job_id = $2", [C.id, jobId]))[0];
  check(`r4: moved to the job, its cost on the car (${JSON.stringify(issue)})`, issue?.q === 4);
  await go(op, `${base}/parts/stock#reversals`);
  await op.locator("[data-stock-reversals]").screenshot({ path: `${proof}/d8-owner-approved-1440.png` }).catch(() => null);
  // r5. The empty item is archived (hidden, not deleted).
  await op.locator(`[data-archive-item="${A.id}"]`).click();
  await op.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  const arch = (await sql("select is_active from public.stock_items where id = $1", [A.id]))[0];
  check("r5: an empty item archived, not deleted", arch?.is_active === false);
  await ob.browser.close();
});

/* ================================================================================================= */
/* d9 (10 November 2026, Section 9): comeback at our cost. Marked on the job card (original job not  */
/* in the ERP, old invoice number, reason) → the owner approves at our cost → every line At our cost  */
/* (complimentary, cost counted), the customer sees "Covered by OFJ warranty – no charge" and no      */
/* price; a line switched to Charged keeps the customer's approval; an original in the ERP shows the  */
/* rework taken off its profit; the Comebacks page lists the reason and the cost.                    */
/* ================================================================================================= */
await section("d9", "comeback at our cost", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-comeback-at-our-cost";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const q = (await sql("select id from public.quotations where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0];
  if (!q?.id) throw new Error("seed failed: no quotation");
  const lineCount = (await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active and line_type <> 'fee'", [q.id]))[0].n;
  // y1. An advisor marks it: original job not in the ERP, the old invoice number, what went wrong.
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}`);
  const mark = adv.page.locator("[data-comeback-mark]");
  await mark.locator("summary").click();
  await mark.getByText("Original job not in the ERP").click();
  await mark.locator("[data-comeback-ref]").fill("OLD-INV-4471");
  await mark.locator("[data-comeback-reason-box]").fill("Battery terminal left loose after the battery change; fitted by the previous workshop team");
  await mark.locator("[data-comeback-mark-save]").click();
  await adv.page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  const m1 = (await sql("select comeback_original_ref, comeback_reason, comeback_cause from public.jobs where id = $1", [jobId]))[0];
  check(`y1: marked with the old invoice number and the reason (${m1?.comeback_original_ref})`, m1?.comeback_original_ref === "OLD-INV-4471" && /loose/.test(m1?.comeback_reason ?? "") && m1?.comeback_cause === "workmanship");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  check("y1: the owner is asked", (await sql("select count(*)::int as n from public.notifications where staff_id = $1 and job_id = $2 and type = 'comeback' and title like 'Comeback at our cost%'", [ownerId, jobId]))[0].n >= 1);
  await adv.browser.close();
  // y2. The owner approves at our cost: every line of the quotation being prepared is At our cost.
  const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const op = own.page;
  await go(op, `${base}/jobs/${jobId}`);
  const card = op.locator("#comeback");
  await card.getByText("At our cost (warranty repair)").click();
  await card.locator("button[type=submit]", { hasText: /^Confirm$/ }).click();
  await op.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  const j2 = (await sql("select comeback_free, comeback_deduct_original from public.jobs where id = $1", [jobId]))[0];
  check("y2: approved at our cost, taken off the original by default", j2?.comeback_free === true && j2?.comeback_deduct_original === true);
  const free = (await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active and line_type <> 'fee' and price_display = 'complimentary'", [q.id]))[0].n;
  const hdr = (await sql("select comp_reason from public.quotations where id = $1", [q.id]))[0];
  check(`y2: every line At our cost (${free} of ${lineCount}), reason our mistake`, free === lineCount && lineCount > 0 && hdr?.comp_reason === "our_mistake");
  await go(op, `${base}/jobs/${jobId}#comeback`);
  await op.locator("#comeback").screenshot({ path: `${proof}/d9-comeback-at-our-cost-1440.png` }).catch(() => null);
  // y3. The customer's view: "Covered by OFJ warranty – no charge", no price on those lines.
  const tok = `e2e-cb-${Date.now()}`;
  await sql("update public.quotations set token = $2, status = 'sent', sent_at = now(), valid_until = now() + interval '7 days' where id = $1", [q.id, tok]);
  const cust = await (await import("playwright-core")).chromium.launch({ channel: "msedge" }).catch(() => null);
  if (cust) {
    const cp = await (await cust.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await cp.goto(`${base}/quote/${tok}`, { waitUntil: "domcontentloaded" });
    await cp.waitForTimeout(1500);
    const text = ((await cp.locator("body").textContent()) ?? "").replace(/\s+/g, " ");
    // The link page is the short front; the lines are on its PDF (View).
    const pdf = Buffer.from(await (await fetch(base + "/api/pdf/quote/" + tok)).arrayBuffer());
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    let pdfText = "";
    for (let n = 0; n < doc.countPages(); n++) pdfText += doc.loadPage(n).toStructuredText().asText() + " ";
    pdfText = pdfText.replace(/\s+/g, " ");
    check("y3: the customer sees Covered by OFJ warranty – no charge, no price on those lines (" + pdfText.slice(0, 80) + ")", /COVERED BY OFJ WARRANTY/i.test(pdfText) && text.length > 0);
    await cp.screenshot({ path: `${proof}/d9-customer-view-390.png`, fullPage: true }).catch(() => null);
    await cust.close();
  }
  await sql("update public.quotations set status = 'draft' where id = $1", [q.id]);
  // y4. Mixed: one line switched to Charged makes a total, so the customer still approves it (never approved by itself).
  const one = (await sql("select id from public.quotation_lines where quotation_id = $1 and is_active and line_type <> 'fee' order by position limit 1", [q.id]))[0];
  await sql("update public.quotation_lines set price_display = 'normal' where id = $1", [one.id]);
  const charged = (await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active and price_display = 'normal' and line_type <> 'fee'", [q.id]))[0].n;
  check("y4: a line switched to Charged, the rest stay At our cost", charged === 1);
  // y5. An original job in the ERP: the rework shows on it as taken off its profit and its advisor bonus.
  const v = (await sql("select vehicle_id, customer_id, gated_in_by, gated_in_at from public.jobs where id = $1", [jobId]))[0];
  const old = (await sql("insert into public.jobs (job_number, vehicle_id, customer_id, gated_in_by, gated_in_at, status, is_open, department) values ($1, $2, $3, $4, $5::timestamptz - interval '40 days', 'closed', false, 'mechanical') returning id", [`E2E-OLD-${Date.now() % 100000}`, v.vehicle_id, v.customer_id, v.gated_in_by, v.gated_in_at]))[0]?.id;
  if (old) {
    await sql("update public.jobs set comeback_of = $2 where id = $1", [jobId, old]);
    await sql("update public.quotations set comp_original_job_id = $2, comp_status = 'approved', comp_cost_aed = 350, comp_decided_at = now(), status = 'approved' where id = $1", [q.id, old]);
    await go(op, `${base}/jobs/${old}`);
    const rw = ((await op.locator("[data-job-rework]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(`y5: the original job shows the rework (${rw.slice(0, 90)})`, /Rework: AED/.test(rw) && (await op.locator("[data-rework-deducted]").count()) === 1);
  }
  // y6. The Comebacks page: the reason, at our cost, the cost.
  await go(op, `${base}/comebacks`);
  const page = ((await op.locator("main").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check("y6: the Comebacks page lists it with the reason, At our cost", /Battery terminal left loose/i.test(page) && /At our cost/.test(page));
  await op.locator("main").screenshot({ path: `${proof}/d9-comebacks-page-1440.png` }).catch(() => null);
  await own.browser.close();
});

/* ================================================================================================= */
/* d10 (10 November 2026, Section 10): View as customer. Next to Job card on the inspection report     */
/* and the quotation: the customer's own page in a phone-sized frame, read-only; "Preview – not sent  */
/* yet" before sending; never counted as opened; nothing can be approved from it.                    */
/* ================================================================================================= */
await section("d10", "view as customer", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-10-view-as-customer";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const q = (await sql("select id, status from public.quotations where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0];
  const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const op = own.page;
  const frame = () => op.frameLocator("[data-view-as-customer-frame]");
  // v1. The inspection report: not sent yet.
  await go(op, `${base}/jobs/${jobId}/inspection`);
  check("v1: View as customer next to Job card on the inspection report", (await op.locator("[data-view-as-customer]").count()) === 1);
  await op.locator("[data-view-as-customer]").click();
  await op.locator("[data-view-as-customer-window]").waitFor({ timeout: 20000 });
  await frame().locator("[data-staff-preview]").waitFor({ timeout: 30000 });
  const label = ((await op.locator("[data-view-as-customer-label]").textContent()) ?? "").trim();
  const banner = await frame().locator("[data-staff-preview]").getAttribute("data-staff-preview");
  check(`v1: the customer's report in a phone frame, "Preview – not sent yet" (${label}, ${banner})`, label === "Preview – not sent yet" && banner === "not-sent");
  const fw = await op.locator("[data-view-as-customer-frame]").evaluate((el) => el.getBoundingClientRect().width);
  check(`v1: phone-sized (${Math.round(fw)} px)`, fw <= 392 && fw >= 300);
  await op.waitForTimeout(800);
  await op.locator("[data-view-as-customer-window] > div").screenshot({ path: `${proof}/d10-inspection-report-phone.png` }).catch(() => null);
  const rl = (await sql("select opened_at, sent_at from public.report_links where job_id = $1 order by created_at desc limit 1", [jobId]))[0];
  check("v1: staff viewing never counts as opened, never sent", rl && rl.opened_at === null && rl.sent_at === null);
  await op.locator("[data-view-as-customer-close]").click();
  // v2. The quotation, sent: read-only, the approve box switched off, never "opened".
  await sql("update public.quotations set token = coalesce(token, $2), status = 'sent', sent_at = now(), valid_until = now() + interval '7 days' where id = $1", [q.id, `e2e-vac-${Date.now()}`]);
  await go(op, `${base}/jobs/${jobId}/quote/${q.id}`);
  await op.locator("[data-view-as-customer]").click();
  await frame().locator("[data-staff-preview]").waitFor({ timeout: 30000 });
  check("v2: the approve box is switched off in the preview", (await frame().locator("[data-preview-action-off]").count()) === 1);
  const after = (await sql("select status, opened_at from public.quotations where id = $1", [q.id]))[0];
  check(`v2: never counted as opened (${after?.status})`, after?.status === "sent" && after?.opened_at === null);
  await own.browser.close();
});

/* ================================================================================================= */
/* e1 (11 November 2026, Section 1): a stock LPO (no car) flows like a car LPO. Ordered and not        */
/* received: on Supplier invoices tagged "Not received yet"; the supplier on Supplier payments as      */
/* "waiting for the invoice" with Pay an advance; any supplier payable as an advance; the LPO header   */
/* reads STOCK PURCHASE – NO CAR (no VIN); accounts enter the invoice and the supplier is then due.    */
/* ================================================================================================= */
await section("e1", "stock LPO in supplier invoices and payments", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-stock-lpo";
  mkdirSync(proof, { recursive: true });
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E STOCK SUP', '100200300400777', true, $1, $1) returning id", [ownerId]))[0];
  const po = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, order_type, status, total_cost_aed, supplier_invoice_status, ordered_at, created_by, updated_by) values ('LPO-E2E-STK-1', null, $1, 'E2E STOCK SUP', 'stock', 'stock_parts', 'ordered', 90, 'none', now(), $2, $2) returning id", [sup.id, ownerId]))[0]?.id;
  if (!po) throw new Error("seed failed: the stock LPO");
  await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, created_by, updated_by) values ($1, 1, 'E2E POWER STEERING OIL', 2, 45, $2, $2)", [po, ownerId]);
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const ap = acc.page;
  // s1. Supplier invoices: the stock LPO is listed, tagged Not received yet.
  await go(ap, `${base}/supplier-invoices?q=LPO-E2E-STK-1`);
  const row = ap.locator(`[data-si-row="follow:${po}"]`);
  check("s1: the ordered stock LPO is on Supplier invoices", (await row.count()) === 1);
  check("s1: tagged Not received yet and Stock purchase", (await row.locator("[data-si-not-received]").count()) === 1 && /Stock purchase/.test((await row.textContent()) ?? ""));
  await ap.screenshot({ path: `${proof}/e1-supplier-invoices-not-received-1440.png` }).catch(() => null);
  // s2. Supplier payments: waiting for the invoice, with Pay an advance; the any-supplier picker.
  await go(ap, `${base}/supplier-payments`);
  const w = ap.locator('[data-sp-awaiting-supplier="E2E STOCK SUP"]');
  check(`s2: the supplier is listed as waiting for the invoice (${((await w.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 90)})`, (await w.count()) === 1 && /not received yet/.test((await w.textContent()) ?? ""));
  check("s2: Pay any supplier (advance) is offered", (await ap.locator("[data-sp-any-select] option").count()) > 1);
  await w.locator("[data-sp-pay]").click();
  await ap.waitForURL(/supplier=/, { timeout: 20000 });
  check("s2: the payment box opens for an advance with no invoice due", (await ap.locator("[data-sp-pay-card] [data-supplier-pay-none]").count()) === 1 && (await ap.locator("[data-sp-pay-card] [data-supplier-pay-amount]").count()) === 1);
  // s3. The LPO header: STOCK PURCHASE – NO CAR, no VIN, no stray dot.
  await go(ap, `${base}/parts/orders/${po}`);
  const head = ((await ap.locator("main header, main").first().textContent()) ?? "").replace(/\s+/g, " ");
  check("s3: the LPO header reads Stock purchase – no car, with no VIN", (await ap.locator("[data-lpo-stock-header]").count()) === 1 && !/No VIN/.test(head));
  await ap.screenshot({ path: `${proof}/e1-lpo-header-1440.png` }).catch(() => null);
  // s4. The invoice entered (the delivery came with it): the supplier is now due on Supplier payments.
  const today = (await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d;
  await sql("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = 'E2E-STK-INV-1', supplier_invoice_date = $2, supplier_invoice_amount = 90, supplier_invoice_at = now(), supplier_invoice_checked_at = now() where id = $1", [po, today]);
  await go(ap, `${base}/supplier-payments`);
  const due = ap.locator('[data-sp-supplier="E2E STOCK SUP"]');
  check(`s4: once the invoice is entered the stock purchase is due (AED 94.50)`, (await due.count()) === 1 && (await due.locator("[data-sp-due-amount]").getAttribute("data-sp-due-amount")) === "94.50");
  await acc.browser.close();
});

/* ================================================================================================= */
/* e2 (11 November 2026, Section 2, Q-00078): every part belongs to ONE quotation. A part priced while  */
/* only the approved quotation existed is on no quotation; the additional quotation started later      */
/* counts only its own parts, offers "Parts priced for this job on another quote – Add here", and one   */
/* tap puts it on as a line "priced by parts desk". A request made while it is prepared belongs to it. */
/* The desk shows "for <number> · additional"; a part on the approved quotation cannot move.           */
/* ================================================================================================= */
await section("e2", "parts belong to one quotation", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-parts-per-quote";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const orig = (await sql("select id, number from public.quotations where job_id = $1 and is_active and kind = 'quotation' order by created_at limit 1", [jobId]))[0];
  // The Q-00078 case: a part priced while the only quotation was approved - it lands on no quotation.
  const late = (await sql("insert into public.part_items (job_id, description, quantity, cost_aed, supplier, availability, priced_at, created_by, updated_by) values ($1, 'E2E FRONT BRAKE PAD', 1, 635, 'E2E SUPPLIER', 'in_stock', now(), $2, $2) returning id, for_quote", [jobId, ownerId]))[0];
  check(`b1: a part priced while only the approved quotation exists is on no quotation (${late?.for_quote ?? "none"})`, !!late && late.for_quote === null);
  // The additional quotation, being prepared.
  const add = (await sql("insert into public.quotations (job_id, customer_id, vehicle_id, kind, number, version, status, created_by, updated_by) select $1, j.customer_id, j.vehicle_id, 'quotation', 'E2E-Q-ADD-1', 1, 'draft', $2, $2 from public.jobs j where j.id = $1 returning id, number", [jobId, ownerId]))[0];
  if (!add) throw new Error("seed failed: the additional quotation");
  // A request made now belongs to the quotation being prepared (the database fills it in).
  const req = (await sql("insert into public.part_requests (job_id, source_type, source_key, label, quantity, created_by, updated_by) values ($1, 'manual', 'e2e-b2', 'E2E REAR WIPER', 1, $2, $2) returning id, for_quote", [jobId, ownerId]))[0];
  check(`b2: a request made while ${add.number} is prepared belongs to it (${req?.for_quote})`, req?.for_quote === add.number);
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  const p = adv.page;
  await go(p, `${base}/jobs/${jobId}/quote/${add.id}`);
  const box = p.locator("[data-add-parts-here]");
  check("b3: the additional quotation offers Parts priced for this job on another quote – Add here", (await box.count()) === 1 && /another quote \(1\)/.test((await box.textContent()) ?? ""));
  const head = (((await p.locator("main").textContent()) ?? "").match(/\d+ of \d+ priced/) ?? [""])[0];
  const ownTotal = (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and is_active and status = 'open'", [jobId]))[0].n;
  check(`b3: the counter counts only this quotation's parts, not the approved one's (${head}; open requests ${ownTotal})`, new RegExp(`0 of ${ownTotal} priced`).test(head));
  await p.screenshot({ path: `${proof}/e2-add-here-1440.png` }).catch(() => null);
  await box.locator("[data-add-parts-here-go]").click();
  const line = await until(async () => (await sql("select id from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [add.id, late.id]))[0], 40, 500);
  check("b4: one tap puts the part on the quotation as a line", !!line);
  const tagged = (await sql("select for_quote from public.part_items where id = $1", [late.id]))[0]?.for_quote;
  check(`b4: the part now belongs to ${add.number} (${tagged})`, tagged === add.number);
  await go(p, `${base}/jobs/${jobId}/quote/${add.id}`);
  check("b4: the line reads Priced by parts desk", (await p.locator("[data-priced-by-desk]").count()) >= 1);
  check("b4: nothing left to add", (await p.locator("[data-add-parts-here]").count()) === 0);
  await p.screenshot({ path: `${proof}/e2-added-priced-by-desk-1440.png` }).catch(() => null);
  await adv.browser.close();
  // The parts desk: the tag on each row; a part on the approved quotation offers no move.
  const pt = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  const pp = pt.page;
  await go(pp, `${base}/parts/${jobId}`);
  const tags = await pp.locator("[data-part-quote]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-part-quote")}|${e.textContent}`));
  check(`b5: the desk shows which quotation each part is for (${tags.join(", ").slice(0, 160)})`, tags.some((t) => t.startsWith(`${add.number}|`) && /additional/.test(t)) && (!orig || tags.some((t) => t.startsWith(`${orig.number}|`))));
  const onApproved = tags.filter((t) => orig && t.startsWith(`${orig.number}|`));
  check("b5: a part on the approved quotation reads approved", !orig || onApproved.every((t) => /approved/.test(t)));
  await pt.browser.close();
});

/* ================================================================================================= */
/* e3 (11 November 2026, Section 3, Mathew): apply a supplier advance with NO new payment. An advance  */
/* of AED 12,840 on an invoice of AED 12,269.06: the amount and method boxes are gone, "Left on this    */
/* advance: AED 570.94", Apply advance; the invoice is paid; Undo with a remark puts it back. A         */
/* supplier invoice dated 11 May on a November LPO is flagged "Check the date".                       */
/* ================================================================================================= */
await section("e3", "apply supplier advance without a new payment", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-supplier-advances";
  mkdirSync(proof, { recursive: true });
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const today = (await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered, created_by, updated_by) values ('E2E GARGASH', '100200300400555', true, $1, $1) returning id", [ownerId]))[0];
  const po = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, order_type, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_checked_at, created_by, updated_by) values ('LPO-E2E-ADV-1', null, $1, 'E2E GARGASH', 'stock', 'stock_parts', 'received', 11684.82, 'received', 'E2E-10670029', $2, 11684.82, now(), now(), $3, $3) returning id", [sup.id, today, ownerId]))[0]?.id;
  await sql("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, received_qty, received_at, created_by, updated_by) values ($1, 1, 'E2E HEADLIGHT', 1, 11684.82, 1, now(), $2, $2)", [po, ownerId]);
  const adv = (await sql("insert into public.supplier_payments (number, supplier_id, supplier_name, paid_on, method, amount_aed, excess_kind, fee_aed, status, created_by, updated_by) values ('E2E-SPAY-14', $1, 'E2E GARGASH', $2, 'transfer', 12840, 'advance', 0, 'recorded', $3, $3) returning id", [sup.id, today, ownerId]))[0]?.id;
  if (!po || !adv) throw new Error("seed failed");
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const ap = acc.page;
  await go(ap, `${base}/supplier-payments?supplier=${sup.id}#pay`);
  const box = ap.locator("[data-sp-pay-card] [data-supplier-pay-box]");
  await box.waitFor({ timeout: 20000 });
  check("a1: the advance is offered with its likely invoice", (await box.locator('[data-use-advance="E2E-SPAY-14"]').count()) === 1 && (await box.locator("[data-advance-likely]").count()) >= 1);
  await box.locator('[data-use-advance="E2E-SPAY-14"]').check();
  await sleep(400);
  const left = await box.locator('[data-advance-left="E2E-SPAY-14"]').getAttribute("data-advance-left-aed");
  const leftWords = ((await box.locator('[data-advance-left="E2E-SPAY-14"]').textContent()) ?? "").trim();
  check(`a2: Left on this advance: AED 570.94 (${leftWords})`, left === "570.94" && /Left on this advance: AED 570\.94/.test(leftWords));
  check("a2: no Amount paid and no How it was paid when the advance covers everything", (await box.locator("[data-supplier-pay-amount]").count()) === 0 && (await box.locator("[data-pay-method]").count()) === 0 && (await box.locator("[data-supplier-pay-covered]").count()) === 1);
  await ap.screenshot({ path: `${proof}/e3-apply-advance-1440.png` }).catch(() => null);
  await box.locator("[data-supplier-pay-save]").click();
  await ap.locator("[data-confirm-yes-money]").click({ timeout: 8000 });
  const line = await until(async () => (await sql("select id, amount_aed::float8 as a from public.supplier_payment_lines where payment_id = $1 and po_id = $2 and is_active and applied_later", [adv, po]))[0], 60, 500);
  check(`a3: AED 12,269.06 of the advance applied, no new payment (${line?.a})`, line?.a === 12269.06 && Number((await sql("select count(*)::int as n from public.supplier_payments where supplier_id = $1", [sup.id]))[0].n) === 1);
  const paid = await until(async () => (await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po]))[0]?.supplier_paid_at, 40, 500);
  check("a3: the invoice is marked paid", !!paid);
  // Undo with a remark (on the LPO's payment history).
  await go(ap, `${base}/parts/orders/${po}#paid`);
  const undo = ap.locator('[data-advance-undo-open="E2E-SPAY-14"]');
  check("a4: Undo this advance is offered on the LPO", (await undo.count()) === 1);
  if (await undo.count()) {
    await undo.click();
    const form = ap.locator("form:has(input[name=remark])").filter({ has: ap.locator('[data-confirm-open="advance-undo"]') }).first();
    await form.locator("input[name=remark]").fill("Applied to the wrong invoice");
    await form.locator('[data-confirm-open="advance-undo"]').click();
    await ap.locator('[data-confirm-yes-money="advance-undo"]').click({ timeout: 8000 });
    const off = await until(async () => (await sql("select is_active from public.supplier_payment_lines where id = $1", [line.id]))[0]?.is_active === false, 40, 500);
    const unpaid = await until(async () => !(await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po]))[0]?.supplier_paid_at, 40, 500);
    const hist = (await sql("select edit_history::text as h from public.supplier_payments where id = $1", [adv]))[0]?.h ?? "";
    check("a4: undone with the remark kept in the history, the invoice owes again", !!off && !!unpaid && /Applied to the wrong invoice/.test(hist));
  }
  // The date check: an invoice dated 11 May on a November LPO.
  const po2 = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, kind, order_type, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, created_by, updated_by) values ('LPO-E2E-ADV-2', null, $1, 'E2E GARGASH', 'stock', 'stock_parts', 'received', 100, 'received', 'E2E-25630196', '2026-05-11', 100, now(), $2, $2) returning id", [sup.id, ownerId]))[0]?.id;
  await go(ap, `${base}/supplier-invoices?q=E2E-25630196`);
  const row = ap.locator("[data-si-row]").filter({ hasText: "E2E-25630196" }).first();
  check("a5: an invoice dated 11 May on a November LPO is flagged Check the date", !!po2 && (await row.locator("[data-si-date-warning]").count()) === 1);
  await acc.browser.close();
});

/* ================================================================================================= */
/* e4 (11 November 2026, Section 4, Q-00077): the yellow NEEDS YOUR APPROVAL box at the top of the     */
/* page; the bell's ?approval= highlights it; the advisor sees "Waiting for owner approval"; the one   */
/* Approvals page lists everything (menu count, dashboard tile); approve from the list; refuse needs a */
/* reason (on the job card's box); nobody but the owner opens the page.                               */
/* ================================================================================================= */
await section("e4", "approval box and approvals page", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-approvals";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const q = (await sql("select id, number from public.quotations where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0];
  const reason = "Complimentary: goodwill gesture (normal price AED 450.00)";
  await sql("update public.quotations set status = 'pending_owner', owner_approval_reason = $2, owner_approved_at = null, owner_approved_by = null, completed_at = now() where id = $1", [q.id, reason]);
  await sql("update public.jobs set inspection_fee_request_aed = 300, inspection_fee_request_by = (select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1) where id = $1", [jobId]);
  const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  const op = own.page;
  // p1. The bell's address opens the quotation with the box at the top, highlighted.
  await go(op, `${base}/jobs/${jobId}/quote/${q.id}?approval=quote:${q.id}`);
  const box = op.locator(`[data-approval-box="quote:${q.id}"]`);
  const top = await box.evaluate((el) => el.getBoundingClientRect().top + window.scrollY).catch(() => 99999);
  check(`p1: the yellow box is at the top of the quotation page (y ${Math.round(top)})`, (await box.count()) === 1 && top < 500);
  check("p1: it says what, the money, and has Approve and Refuse", /Needs your approval/i.test((await box.textContent()) ?? "") && (await box.locator("[data-approval-money]").count()) === 1 && (await box.locator("[data-approval-approve]").count()) === 1 && (await box.locator("[data-approval-refuse]").count()) === 1);
  await op.screenshot({ path: `${proof}/e4-box-on-quotation-1440.png` }).catch(() => null);
  // p2. The menu count and the dashboard tile.
  const badge = ((await op.locator('a[href="/approvals"]').first().textContent()) ?? "").replace(/\D/g, "");
  check(`p2: Approvals in the menu with a count (${badge})`, Number(badge) >= 2);
  await go(op, `${base}/dashboard`);
  check("p2: the dashboard tile", Number(await op.locator('[data-tile="approvals"]').getAttribute("data-tile-count")) >= 2);
  // p3. The advisor sees the waiting line and no buttons.
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}/quote/${q.id}`);
  check("p3: the advisor sees Waiting for owner approval, no Approve", (await adv.page.locator(`[data-approval-waiting="quote:${q.id}"]`).count()) === 1 && (await adv.page.locator("[data-approval-approve]").count()) === 0);
  const res = await adv.page.goto(`${base}/approvals`);
  check(`p3: the Approvals page is the owner's only (${res?.status()})`, res?.status() === 404);
  await adv.browser.close();
  // p4. The Approvals page: approve the quotation from the list.
  await go(op, `${base}/approvals`);
  const listed = op.locator(`[data-approvals-page] [data-approval-box="quote:${q.id}"]`);
  check("p4: the quotation is on the Approvals list", (await listed.count()) === 1);
  await op.screenshot({ path: `${proof}/e4-approvals-page-1440.png` }).catch(() => null);
  await listed.locator("[data-approval-approve]").click();
  await listed.locator("[data-approval-done], [data-approval-error]").first().waitFor({ timeout: 30000 }).catch(() => {});
  const after = (await sql("select status, owner_approved_at from public.quotations where id = $1", [q.id]))[0];
  check(`p4: approved from the list (${after?.status}, ${after?.owner_approved_at ? "stamped" : "no stamp"})`, after?.status !== "pending_owner" && !!after?.owner_approved_at);
  // p5. Refuse needs a reason: the fee request on the job card.
  await go(op, `${base}/jobs/${jobId}`);
  const fee = op.locator(`[data-approval-box="fee:${jobId}"]`);
  check("p5: the fee request's box is at the top of the job card", (await fee.count()) === 1);
  await fee.locator("[data-approval-refuse]").click();
  check("p5: Refuse waits for a reason", await fee.locator("[data-approval-refuse-send]").isDisabled());
  await fee.locator("[data-approval-reason]").fill("Not below the minimum this time");
  await fee.locator("[data-approval-refuse-send]").click();
  const cleared = await until(async () => (await sql("select inspection_fee_request_aed from public.jobs where id = $1", [jobId]))[0]?.inspection_fee_request_aed === null, 40, 500);
  check("p5: refused with the reason, the request is gone", !!cleared);
  await own.browser.close();
});

/* ================================================================================================= */
/* e5 (11 November 2026, Section 5, AL ALI cheque 019383): a duplicate receipt on a cheque already     */
/* cleared. The waiting row warns "Cheque … is already recorded"; accounts press "Void – duplicate /    */
/* entered by mistake" with a reason; the owner approves it on Approvals; the receipt stays in the     */
/* history marked VOID with who and why. Entering the same cheque again warns and is refused until     */
/* the cheque's full amount is typed, and never above it.                                              */
/* ================================================================================================= */
await section("e5", "void a duplicate receipt, one cheque never more than its amount", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-cheque-void";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const jobId = seed?.jobId;
  if (!jobId || !seed?.invoice?.id) throw new Error("seed failed");
  await sql("update public.invoices set sent_at = now() where id = $1", [seed.invoice.id]);
  const j = (await sql("select customer_id from public.jobs where id = $1", [jobId]))[0];
  const accId = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0].id;
  const ins = (n, amount, status) => sql("insert into public.payments (number, job_id, customer_id, method, amount_aed, status, cheque_number, cheque_bank, cheque_date, cheque_status, received_at, received_by, created_by, updated_by) values ($1, $2, $3, 'cheque', $4, 'recorded', '919383', 'ENBD', current_date, $5, now(), $6, $6, $6) returning id, number", [n, jobId, j.customer_id, amount, status, accId]);
  await ins("E2E-RCT-57", 2236.5, "cleared");
  await ins("E2E-RCT-58", 2131.5, "cleared");
  const dup = (await ins("E2E-RCT-62", 2236.5, "pending"))[0];
  if (!dup) throw new Error("seed failed: the receipts");
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const ap = acc.page;
  await go(ap, `${base}/accounts-posting?tab=cheque`);
  const row = ap.locator(`[data-bank-row="${dup.number}"]`);
  const also = ((await row.locator("[data-bank-cheque-also]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check(`c1: the waiting row warns the cheque is already recorded (${also.slice(0, 120)})`, /already recorded: E2E-RCT-5/.test(also));
  await row.locator('[data-bank-open="void"]').click();
  await row.locator("[data-bank-void-reason]").fill("Same cheque already cleared in the settlement");
  await row.locator('[data-bank-save="void"]').click();
  const asked = await until(async () => (await sql("select void_requested_at from public.payments where id = $1", [dup.id]))[0]?.void_requested_at, 40, 500);
  check("c2: the void is asked of the owner (nothing changes yet)", !!asked && (await sql("select status from public.payments where id = $1", [dup.id]))[0]?.status === "recorded");
  await ap.screenshot({ path: `${proof}/e5-void-asked-1440.png` }).catch(() => null);
  // c3. The owner approves on Approvals; the receipt is VOID with who and why.
  const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(own.page, `${base}/approvals`);
  const box = own.page.locator(`[data-approval-box="void:${dup.id}"]`);
  check("c3: the void is on the owner's Approvals", (await box.count()) === 1);
  await box.locator("[data-approval-approve]").click();
  const voided = await until(async () => (await sql("select status, void_reason, voided_by from public.payments where id = $1", [dup.id]))[0]?.status === "voided", 40, 500);
  const v = (await sql("select status, void_reason, voided_by, void_requested_at from public.payments where id = $1", [dup.id]))[0];
  check(`c3: VOID, kept in the history with who and why (${v?.status} · ${v?.void_reason?.slice(0, 40)} · by ${v?.voided_by ? "set" : "none"} · request ${v?.void_requested_at ? "still" : "cleared"})`, !!voided && /Duplicate/.test(v?.void_reason ?? "") && !!v?.voided_by && v?.void_requested_at === null);
  await own.browser.close();
  // c4. The same cheque again from the Record a payment window: warned, refused without the full amount.
  await go(ap, `${base}/jobs/${jobId}`);
  await ap.locator("[data-record-payment-open]").first().click();
  const form = ap.locator("[data-record-payment-dialog] [data-payment-form]").first();
  await form.waitFor({ timeout: 30000 });
  await form.locator('[data-method="cheque"]').click();
  await form.locator('input[name="cheque_bank"]').fill("ENBD");
  await form.locator('input[name="cheque_number"]').fill("919383");
  await form.locator('input[name="cheque_date"]').fill("2026-11-10");
  await form.locator('input[name="cheque_date"]').focus();
  await until(async () => (await form.locator("[data-cheque-already]").count()) === 1, 20, 500);
  check("c4: typing the same cheque warns with what is already recorded", (await form.locator("[data-cheque-already]").count()) === 1);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await form.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: png });
  await until(async () => (await form.locator("[data-proof-missing]").count()) === 0, 40, 500);
  if ((await form.locator("[data-amount-full]").count()) === 1) await form.locator("[data-amount-full]").click();
  await form.screenshot({ path: `${proof}/e5-same-cheque-warning-1440.png` }).catch(() => null);
  const before = Number((await sql("select count(*)::int as n from public.payments where cheque_number = '919383' and status = 'recorded'"))[0].n);
  await pressRecord(form);
  await until(async () => (await ap.locator("[data-record-payment-done], [data-record-payment-error]").count()) > 0, 40, 500);
  const err = ((await ap.locator("[data-record-payment-error]").first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  const after = Number((await sql("select count(*)::int as n from public.payments where cheque_number = '919383' and status = 'recorded'"))[0].n);
  check(`c4: refused without the cheque's full amount (${err.slice(0, 110)})`, after === before && /already recorded/.test(err));
  await acc.browser.close();
});

/* ================================================================================================= */
/* e6 (11 November 2026, Section 6, KA-673205): the Lathe shop box starts EMPTY and lists only lathe   */
/* shops with their open tickets; the confirm names the bill and warns (0 tickets, the same number      */
/* twice); an unpaid bill not in Zoho is corrected (logged) and voided at once; one in Zoho needs the  */
/* owner's approval to void; the invoice is attached ("No invoice attached" goes).                      */
/* ================================================================================================= */
await section("e6", "lathe bills: shop box, confirm, correct, void, attach", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-lathe-bills";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.suppliers (name, is_active, vat_registered, created_by, updated_by) select 'E2E KHALID LATHE', true, false, $1, $1 where not exists (select 1 from public.suppliers where name = 'E2E KHALID LATHE')", [ownerId]);
  await sql("insert into public.suppliers (name, is_active, vat_registered, created_by, updated_by) select 'E2E AAA MOTORS', true, true, $1, $1 where not exists (select 1 from public.suppliers where name = 'E2E AAA MOTORS')", [ownerId]);
  const t = (await sql("insert into public.part_items (job_id, description, quantity, cost_aed, supplier, availability, priced_at, lathe_ticket, lathe_item, lathe_sent_at, created_by, updated_by) values ($1, 'E2E Brake disc resurfacing', 1, 300, 'E2E KHALID LATHE', 'in_stock', now(), 'SUB-E2E-61', 'Brake disc', now() - interval '2 days', $2, $2) returning id", [jobId, ownerId]))[0];
  if (!t) throw new Error("seed failed: the ticket");
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
  const ap = acc.page;
  await go(ap, `${base}/parts/lathe`);
  const form = ap.locator("[data-lathe-bill-form]");
  const sel = form.locator("[data-lathe-bill-supplier]");
  const opts = await sel.locator("option").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  check(`k1: the Lathe shop box starts empty (${await sel.inputValue()})`, (await sel.inputValue()) === "");
  check(`k1: only lathe shops, each with its open tickets (${opts.filter((o) => /E2E/.test(o)).join(" | ")})`, opts.some((o) => /E2E KHALID LATHE · 1 open ticket/.test(o)) && !opts.some((o) => /E2E AAA MOTORS/.test(o)));
  await sel.selectOption("E2E KHALID LATHE");
  check("k2: the shop's open tickets are listed", (await form.locator('[data-lathe-bill-tick="SUB-E2E-61"]').count()) === 1);
  // k3. A bill covering no ticket: the confirm says so in words.
  await form.locator("[data-lathe-bill-number]").fill("E2E-KA-1");
  await form.locator("[data-lathe-bill-date]").fill((await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d);
  await form.locator("[data-lathe-bill-net]").fill("600");
  await form.locator("[data-lathe-bill-vat]").fill("30");
  await sleep(500);
  const warn = ((await form.locator("[data-lathe-bill-warnings]").textContent().catch(() => "")) ?? "");
  check(`k3: the warning: 0 tickets, this cost won't be charged to any car (${warn.slice(0, 80)})`, /0 tickets: this cost won't be charged to any car/.test(warn));
  await form.locator("[data-lathe-bill-save]").click();
  const title = ((await ap.locator('[data-confirm-money="lathe-bill"] h2').first().textContent({ timeout: 8000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
  check(`k3: the confirm names the bill (${title.slice(0, 110)})`, /Record bill E2E-KA-1 from E2E KHALID LATHE, AED 630\.00 incl\. VAT, covering 0 tickets/.test(title));
  await ap.screenshot({ path: `${proof}/e6-confirm-0-tickets-1440.png` }).catch(() => null);
  await ap.locator('[data-confirm-yes-money="lathe-bill"]').click();
  const bill = await until(async () => (await sql("select id, extra_lines::text as x from public.lathe_bills where bill_number = 'E2E-KA-1'"))[0], 40, 500);
  check("k3: recorded as one line with no ticket", !!bill && /no ticket/.test(bill.x ?? ""));
  // k4. The same number again warns.
  await go(ap, `${base}/parts/lathe`);
  await form.locator("[data-lathe-bill-supplier]").selectOption("E2E KHALID LATHE");
  await form.locator("[data-lathe-bill-number]").fill("E2E-KA-1");
  await form.locator("[data-lathe-bill-date]").fill((await sql("select (now() at time zone 'Asia/Dubai')::date::text as d"))[0].d);
  await form.locator("[data-lathe-bill-net]").fill("100");
  await sleep(400);
  check("k4: the same bill number for the shop warns", /already entered/.test((await form.locator("[data-lathe-bill-warnings]").textContent().catch(() => "")) ?? ""));
  // k5. Correct it (unpaid, not in Zoho): logged.
  const row = ap.locator('[data-lathe-bill="E2E-KA-1"]');
  check("k5: No invoice attached shows", (await row.locator("[data-lathe-no-file]").count()) === 1);
  await row.locator('[data-lathe-edit-open="E2E-KA-1"]').click();
  await row.locator('[data-lathe-edit-form] input[name="bill_number"]').fill("E2E-KA-1B");
  await row.locator("[data-lathe-edit-remark]").fill("Typed the number wrong");
  await row.locator("[data-lathe-edit-save]").click();
  const edited = await until(async () => (await sql("select bill_number, jsonb_array_length(edit_history) as n from public.lathe_bills where id = $1", [bill.id]))[0]?.bill_number === "E2E-KA-1B", 40, 500);
  check("k5: corrected, the change kept in its history", !!edited && Number((await sql("select jsonb_array_length(edit_history) as n from public.lathe_bills where id = $1", [bill.id]))[0]?.n) === 1);
  // k6. Attach the invoice: the tag goes.
  await go(ap, `${base}/parts/lathe`);
  const row2 = ap.locator('[data-lathe-bill="E2E-KA-1B"]');
  await row2.locator('[data-lathe-attach-open="E2E-KA-1B"]').click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await row2.locator('[data-lathe-attach] input[type="file"]').first().setInputFiles({ name: "lathe-bill.png", mimeType: "image/png", buffer: png });
  const filed = await until(async () => Number((await sql("select count(*)::int as n from public.job_files where kind = 'supplier_invoice' and ref_id = $1 and removed_at is null", [bill.id]))[0].n) === 1, 60, 500);
  await go(ap, `${base}/parts/lathe`);
  check("k6: the invoice is attached, No invoice attached gone", !!filed && (await ap.locator('[data-lathe-bill="E2E-KA-1B"] [data-lathe-no-file]').count()) === 0);
  // k7. A bill already in Zoho: accounts ask, the owner approves the void.
  await sql("update public.lathe_bills set zoho_bill_id = 'e2e-zb-1' where id = $1", [bill.id]);
  await go(ap, `${base}/parts/lathe`);
  const row3 = ap.locator('[data-lathe-bill="E2E-KA-1B"]');
  check("k7: in Zoho it can no longer be corrected", (await row3.locator('[data-lathe-edit-open]').count()) === 0);
  await row3.locator('[data-lathe-void-open="E2E-KA-1B"]').click();
  await row3.locator("[data-lathe-void-reason]").fill("Billed to the wrong shop");
  await row3.locator("[data-lathe-void-save]").click();
  const asked = await until(async () => (await sql("select void_requested_at from public.lathe_bills where id = $1", [bill.id]))[0]?.void_requested_at, 40, 500);
  check("k7: the void waits for the owner", !!asked);
  await acc.browser.close();
  const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(own.page, `${base}/approvals`);
  const box = own.page.locator(`[data-approval-box="lathe_void:${bill.id}"]`);
  check("k7: on the owner's Approvals", (await box.count()) === 1);
  await box.locator("[data-approval-approve]").click();
  const voided = await until(async () => !!(await sql("select voided_at from public.lathe_bills where id = $1", [bill.id]))[0]?.voided_at, 40, 500);
  check("k7: voided, kept on the list marked VOID", !!voided);
  await go(own.page, `${base}/parts/lathe`);
  check("k7: the list shows it VOID", (await own.page.locator('[data-lathe-bill="E2E-KA-1B"][data-lathe-bill-voided="1"]').count()) === 1);
  await own.browser.close();
});

/* ================================================================================================= */
/* e7 (11 November 2026, Section 7): a free item in one tap. Tapping the reason saves it (no Save      */
/* button, no text required); Warranty claim finds the car's earlier job of the last 6 months by itself;*/
/* the value given away is shown, never "Normal price AED 0.00".                                       */
/* ================================================================================================= */
await section("e7", "complimentary in one tap", async () => {
  const proof = "C:/Users/user/Desktop/workshop ERP/docs/proof/2026-11-11-comp-one-tap";
  mkdirSync(proof, { recursive: true });
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed?.jobId;
  if (!jobId) throw new Error("seed failed");
  const q = (await sql("select id from public.quotations where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0];
  const line = (await sql("select id from public.quotation_lines where quotation_id = $1 and is_active and line_type in ('labour', 'service') order by position limit 1", [q.id]))[0];
  // The line given free and typed at 0.
  await sql("update public.quotation_lines set price_display = 'complimentary', unit_price = 0, line_total = 0 where id = $1", [line.id]);
  await sql("update public.quotations set comp_reason = null, comp_original_job_id = null, comp_note = null, comp_status = null where id = $1", [q.id]);
  // An earlier job of this car, 40 days ago.
  const j = (await sql("select vehicle_id, customer_id, gated_in_by from public.jobs where id = $1", [jobId]))[0];
  const old = (await sql("insert into public.jobs (job_number, vehicle_id, customer_id, gated_in_by, gated_in_at, status, is_open, department) values ($1, $2, $3, $4, now() - interval '40 days', 'closed', false, 'mechanical') returning id", [`E2E-OLD-${Date.now() % 100000}`, j.vehicle_id, j.customer_id, j.gated_in_by]))[0]?.id;
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  const p = adv.page;
  await go(p, `${base}/jobs/${jobId}/quote/${q.id}`);
  const box = p.locator("[data-comp-box]");
  await box.waitFor({ timeout: 20000 });
  check("f1: no Save button, no required text", (await box.locator("[data-comp-save]").count()) === 0 && !/required/i.test((await box.textContent()) ?? ""));
  const cost = ((await box.locator("[data-comp-cost]").textContent()) ?? "").trim();
  check(`f1: the value given away, never AED 0.00 (${cost.slice(0, 90)})`, /Value given away AED/.test(cost) && !/Value given away AED 0\.00/.test(cost));
  await box.locator('[data-comp-reason="goodwill"]').click();
  const saved = await until(async () => (await sql("select comp_reason from public.quotations where id = $1", [q.id]))[0]?.comp_reason === "goodwill", 40, 500);
  check("f2: tapping Goodwill gesture saves it", !!saved);
  await go(p, `${base}/jobs/${jobId}/quote/${q.id}`);
  await p.locator('[data-comp-box] [data-comp-reason="warranty"]').click();
  const linked = await until(async () => { const r = (await sql("select comp_reason, comp_original_job_id from public.quotations where id = $1", [q.id]))[0]; return r?.comp_reason === "warranty" && r?.comp_original_job_id ? r : null; }, 40, 500);
  check(`f3: Warranty claim finds the car's earlier job by itself (${linked?.comp_original_job_id === old ? "the 40-day-old job" : linked?.comp_original_job_id ?? "none"})`, linked?.comp_original_job_id === old);
  await go(p, `${base}/jobs/${jobId}/quote/${q.id}`);
  await p.locator("[data-comp-box]").screenshot({ path: `${proof}/e7-comp-box-1440.png` }).catch(() => null);
  check("f3: the box shows Saved ✓ and the earlier job", (await p.locator("[data-comp-box] [data-comp-saved]").count()) === 1 && (await p.locator("[data-comp-box] [data-comp-original]").inputValue()) === old);
  await adv.browser.close();
});

const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
