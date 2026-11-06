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
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, freeTech, go, makeChecks, setPin, settle, sleep, sql, submitted, pickPerson } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots/sim";
mkdirSync(shots, { recursive: true });
const PATHS = (process.env.PATHS ?? "a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s").split(",").map((s) => s.trim());
const want = (k) => PATHS.includes(k);
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
/** A 1×1 PNG for the gate-out's instrument-cluster photo (30 October 2026 rule). */
const CLUSTER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQCJ9dvEAAAAAElFTkSuQmCC", "base64");
const shot = (page, name) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }).catch(() => null);
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 55 * 60 * 1000).unref();

/* ---- R3: who was told since a mark ---- */
const mark = async () => Number((await sql("select coalesce(max(id), 0) as m from public.notifications"))[0]?.m ?? 0);
async function told(step, m, jobId, wants) {
  const rows = await sql("select n.type, s.display_name as who, s.role_id as role, s.id as staff_id from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and (n.job_id = $2 or n.job_id is null) order by n.id", [m, jobId]);
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
  const done = page.locator("[data-pricing-done], button:has-text('Pricing done')").first();
  if (await done.count()) { await done.click(); await sleep(2500); }
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
  check(`${pathKey}: Send after Complete (R5)`, (await sendBtn.count()) >= 1, diag);
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
    await page.locator("[data-send-lpo]").click();
    await submitted(page);
    check("a11: LPO sent, confirmed on screen — R1", /message=/.test(page.url()));
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
    check("h4: moved to Paid — R1/R4", /Paid .*transfer/i.test(((await page.locator("[data-commissions-paid]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ")));
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
    await page.locator("[data-send-lpo]").click();
    // "Send anyway?" when a line is still open (answered: send).
    await page.locator("[data-lpo-unfinished-send]").click({ timeout: 3000 }).catch(() => null);
    await page.waitForURL(/message=|error=/, { timeout: 25000 }).catch(() => null);
    const err = decodeURIComponent(page.url()).split("error=")[1];
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
    await page.locator("[data-send-lpo]").click();
    await page.locator("[data-lpo-unfinished-send]").click({ timeout: 3000 }).catch(() => null);
    await page.waitForURL(/message=|error=/, { timeout: 25000 }).catch(() => null);
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

const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
