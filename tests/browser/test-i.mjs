// Browser checks for the bodyshop of 14 October 2026: the quotation before arrival (PPF warranty block, the old-film tick),
// the booked job, the stages built from the packages with due dates spread to the handover, the team leader's due list,
// the shared section tablet with PIN clocking, the release sign-off and Not ready, the Going out strip, the handover page,
// the warranty certificate, the customer updates, and the electrical task on the mechanical side. Screenshots for the
// owner land in tests/browser/shots/.
// Run against `npx next dev -p 3100`:  node --env-file=.env.test.local tests/browser/test-i.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const HANDOVER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
/** THE stage hand-over (B2): open it, add a photo, the PIN when asked, sign off. */
async function handOver(page, key, pin) {
  await page.locator(`[data-stage-handover-open='${key}']`).click();
  const dlg = page.locator(`[data-stage-handover='${key}']`);
  await dlg.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: `${key}.png`, mimeType: "image/png", buffer: HANDOVER_PNG });
  for (let i = 0; i < 40 && (await dlg.locator("[data-stage-handover-send]").isDisabled()); i++) await new Promise((r) => setTimeout(r, 300));
  if (pin) await dlg.locator("[data-handover-pin]").fill(pin);
  const before = page.url();
  await dlg.locator("[data-stage-handover-send]").click();
  await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 1500));
}

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 20 * 60 * 1000).unref();
cleanupDb();
const SHOTS = path.join(projectRoot, "tests", "browser", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const afterSubmit = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null); await sleep(800); };
const urlText = (page) => decodeURIComponent(page.url());
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
async function pdfText(buf) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return text;
}
async function pdfPng(buf, file) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(file, Buffer.from(pix.asPNG()));
}

/* ---------------- 1. The quotation before the car arrives ---------------- */
await section("1 quote before arrival", async () => {
  const seed = await api("/api/e2e/stage", { stage: "bodyshop", at: "sent" });
  const { jobId, token, quotationId } = seed.json;
  check("1: the seed made a booked job with a sent quotation", !!jobId && !!token, JSON.stringify(seed.json).slice(0, 120));
  const job = (await sql("select status, is_open, department from public.jobs where id = $1", [jobId]))[0];
  check("1: a booked job is closed to the floor until the car arrives (status booked, not open, bodyshop)", job?.status === "booked" && job?.is_open === false && job?.department === "bodyshop", JSON.stringify(job));
  // The customer's link: PPF warranty block, old-film note, Approve needs the tick.
  const { browser, page } = await browserFor("owner", { viewport: { width: 430, height: 900 } });
  await go(page, `${base}/quote/${token}`);
  check("7: the PPF quote link shows the OFJ Bespoke PPF 10-year warranty block", (await page.locator("[data-ppf-warranty]").count()) === 1 && /10-year warranty/i.test((await page.locator("[data-ppf-warranty]").textContent()) ?? ""));
  check("1: the old-film note is on the link", /paint underneath can occasionally lift/i.test((await page.locator("[data-removal-note]").textContent().catch(() => "")) ?? ""));
  await shot(page, "05-ppf-quote-link");
  await page.getByRole("button", { name: "Approved" }).click();
  await until(async () => ((await page.locator("[data-removal-ack]").count()) ? 1 : null), 20, 300);
  check("1: Approve asks for the 'I understand old film removal may lift paint' tick", (await page.locator("[data-removal-ack] input").count()) === 1);
  // Without the tick the browser blocks the submit (required); the server refuses too: post straight to the route.
  const res = await fetch(`${base}/api/quote/${token}`, { method: "POST", body: new URLSearchParams({ action: "approve", approver_name: "Stage Customer", agree: "on", approved_amount: "23100" }), redirect: "manual" });
  check("1: the server refuses an approval without the tick", /lift paint/i.test(decodeURIComponent(res.headers.get("location") ?? "")), decodeURIComponent(res.headers.get("location") ?? "").slice(-120));
  const res2 = await fetch(`${base}/api/quote/${token}`, { method: "POST", body: new URLSearchParams({ action: "approve", approver_name: "Stage Customer", agree: "on", removal_ack: "on", approved_amount: "23100" }), redirect: "manual" });
  check("1: with the tick the approval goes through", res2.status === 303 && !/error=/.test(res2.headers.get("location") ?? ""));
  const q = (await sql("select status, removal_ack_at, removal_ack_name from public.quotations where id = $1", [quotationId]))[0];
  check("1: who ticked and when is saved on the quotation", q?.status === "approved" && !!q?.removal_ack_at && q?.removal_ack_name === "Stage Customer", JSON.stringify(q));
  const afterJob = (await sql("select status, is_open from public.jobs where id = $1", [jobId]))[0];
  check("2: approval before arrival keeps the job booked (nothing moves in the workshop)", afterJob?.status === "booked" && afterJob?.is_open === false, JSON.stringify(afterJob));
  check("2: the advisor is told to book the arrival and ask for a deposit", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'bodyshop_booked'", [jobId]))[0]?.n ?? 0) >= 1);
  await browser.close();
  // The advisor books the arrival and requests a 30% deposit.
  const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(ap, `${base}/bodyshop/${jobId}`);
  check("2: the booked job's page shows the three steps (quotation, arrival, deposit)", (await ap.locator("[data-booking-card]").count()) === 1 && (await ap.locator("[data-book-card]").count()) === 1);
  const d7 = (await sql("select to_char((now() at time zone 'Asia/Dubai')::date + 2, 'YYYY-MM-DD') as d"))[0].d;
  const d12 = (await sql("select to_char((now() at time zone 'Asia/Dubai')::date + 7, 'YYYY-MM-DD') as d"))[0].d;
  await ap.locator("input[name='arrival_date']").fill(d7);
  await ap.locator("input[name='promised_at']").fill(d12);
  await ap.locator("[data-book-submit]").click();
  await afterSubmit(ap);
  const booked = (await sql("select promised_at::text as p, booked_arrival_at from public.jobs where id = $1", [jobId]))[0];
  const appt = (await sql("select kind, department, status from public.appointments where job_id = $1 and kind = 'car_drop' and status = 'booked'", [jobId]))[0];
  check("2: the booking saves the promised handover and a car-drop appointment for the bodyshop", booked?.p === d12 && !!booked?.booked_arrival_at && appt?.department === "bodyshop", JSON.stringify({ booked, appt }));
  await ap.locator("[data-deposit-amount]").fill("30");
  await ap.locator("select[name='kind']").selectOption("percent");
  await ap.locator("[data-deposit-submit]").click();
  await afterSubmit(ap);
  const dep = (await sql("select number, kind, total_aed, deposit_for_quotation_id from public.invoices where job_id = $1 and deposit_for_quotation_id is not null", [jobId]))[0];
  check("2: Request deposit makes a proforma for 30% of the quotation, tied to it", dep?.kind === "proforma" && Math.abs(Number(dep?.total_aed) - 6930) < 1 && dep?.deposit_for_quotation_id === quotationId, JSON.stringify(dep));
  await ab.close();
});

/* ---------------- 2. In work: stages, leader list, tablet, electrical, updates ---------------- */
let handoverToken = null;
await section("3-10 stages, leader, tablet, updates", async () => {
  const seed = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
  const { jobId, people, promised } = seed.json;
  handoverToken = seed.json.handoverToken;
  const stages = await sql("select key, label, section, due_date::text as due, status, position from public.bodyshop_stages where job_id = $1 and is_active order by position", [jobId]);
  check("3: PPF + tint + old removal build the right stages in order", stages.map((s) => s.key).join(",") === "removal,strip,prep,ppf,refit,detail,electrical,qc,handover", stages.map((s) => s.key).join(","));
  check("3: the PPF stage reads 'PPF install and tint'", stages.find((s) => s.key === "ppf")?.label === "PPF install and tint");
  check("5: due dates run from today to the handover, never after it, handover on the promised day", stages.every((s) => s.due && s.due <= promised) && stages.at(-1)?.due === promised, stages.map((s) => `${s.key}:${s.due}`).join(" "));
  check("3: the first stage is active and the car is in work", stages[0]?.status === "active" && (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status === "in_work");
  check("5: the first section was told, the next got the heads-up", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'bodyshop_heads_up'", [jobId]))[0]?.n ?? 0) >= 1);

  // The bodyshop manager: the job page, the removed items, a due date change, a stage done.
  const { browser: mb, page: mp } = await browserForId(people.manager, { viewport: { width: 1366, height: 900 } });
  await go(mp, `${base}/bodyshop/${jobId}`);
  check("3: the manager sees the stages with due dates and controls", (await mp.locator("[data-stage]").count()) === 9 && (await mp.locator("[data-stage-due]").count()) >= 8 && (await mp.locator("[data-add-stage]").count()) === 1);
  // Removed items at Strip (the removal stage comes first here; the checklist is open on the page).
  await mp.locator("[data-removed-label]").fill("Front badge");
  await mp.locator("[data-removed-add]").click();
  await afterSubmit(mp);
  check("3: a removed item is written down", (await sql("select count(*)::int as n from public.bodyshop_removed_items where job_id = $1 and is_active", [jobId]))[0]?.n === 1);
  // The first stage signed off (28 Oct, B2: a team stage is handed over with photos and the leader's PIN; the owner
  // signs without a PIN, so no real person's PIN is touched).
  {
    const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
    await go(op, `${base}/bodyshop/${jobId}`);
    await handOver(op, "removal", null);
    await ob.close();
  }
  const after1 = await sql("select key, status from public.bodyshop_stages where job_id = $1 and is_active order by position limit 2", [jobId]);
  check("3: Done moves the car to the next stage", after1[0]?.status === "done" && after1[1]?.status === "active", JSON.stringify(after1));
  // Change the handover date: everyone is told.
  const d9 = (await sql("select to_char((now() at time zone 'Asia/Dubai')::date + 6, 'YYYY-MM-DD') as d"))[0].d;
  const handoverStage = stages.find((s) => s.key === "handover");
  const hid = (await sql("select id from public.bodyshop_stages where job_id = $1 and key = 'handover'", [jobId]))[0]?.id;
  await mp.locator(`[data-stage='handover'] [data-stage-due]`).fill(d9);
  await mp.locator(`[data-stage='handover'] button[type='submit']`).first().click();
  await afterSubmit(mp);
  const moved = (await sql("select promised_at::text as p from public.jobs where id = $1", [jobId]))[0];
  check("5/12: changing the handover due date moves the promised date and tells everyone involved", moved?.p === d9 && ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'bodyshop_handover_moved'", [jobId]))[0]?.n ?? 0) >= 1, `${moved?.p} (was ${handoverStage?.due}) hid=${hid}`);
  await shot(mp, "08-bodyshop-job-page");
  await mb.close();

  // The PPF leader's due list.
  const { browser: lb, page: lp } = await browserForId(people.ppfLeader, { viewport: { width: 1366, height: 900 } });
  await go(lp, `${base}/bodyshop/mine`);
  check("4/5: the leader's screen lists the car as coming to PPF, in due order, with who is on it", (await lp.locator("[data-mine-car]").count()) >= 1 && /E2e Installer/.test((await lp.locator("[data-mine-people]").first().textContent()) ?? ""), ((await lp.locator("[data-mine-people]").first().textContent()) ?? "").slice(0, 120));
  check("4: the leader sees no prices anywhere on the page", !/AED/.test((await lp.textContent("body")) ?? ""));
  // 28 October (B2): a leader picks from their own team only (the leader first); no "Need help" from other teams.
  check("4: the leader's own team only, the leader at the top, no Need help", (await lp.locator("details summary", { hasText: "Need help" }).count()) === 0 && (await lp.locator(`[data-mine-car] [data-pick-person="${people.detailer}"]`).count()) === 0 && (await lp.locator("[data-mine-car] [data-staff-mode=chips] [data-pick-person]").first().getAttribute("data-pick-person")) === people.ppfLeader);
  // One tap puts the leader himself on the car.
  await lp.locator(`[data-mine-car] [data-pick-person="${people.ppfLeader}"]`).first().click();
  await afterSubmit(lp);
  check("4: one tap puts a person of the team on the car", ((await sql("select count(*)::int as n from public.bodyshop_assignments where job_id = $1 and staff_id = $2 and removed_at is null", [jobId, people.ppfLeader]))[0]?.n ?? 0) === 1);
  await shot(lp, "02-team-leader-due-list");
  // The leader's menu has no money pages.
  const nav = (await lp.locator("aside").textContent()) ?? "";
  check("4: the leader's menu has Bodyshop and My team, no Invoices or Profit", /My team/.test(nav) && !/Invoices|Profit/.test(nav));
  await lb.close();

  // The shared section tablet: a registered device with section PPF, the installer clocks out with the PIN.
  const devToken = randomBytes(16).toString("hex");
  await sql("insert into public.devices (name, location, kind, section, token_hash) values ('E2e PPF tablet', 'bodyshop', 'shared', 'ppf', $1)", [createHash("sha256").update(devToken).digest("hex")]);
  const { browser: tb, page: tp } = await browserFor("owner", { viewport: { width: 1024, height: 1366 } });
  await tp.context().addCookies([{ name: "erp_device", value: devToken, domain: "localhost", path: "/" }]);
  await go(tp, `${base}/tablet/bodyshop`);
  check("10: the section tablet shows the PPF cars", (await tp.locator("[data-tablet-car]").count()) >= 1, (await tp.textContent("body"))?.slice(0, 160));
  await tp.locator("[data-tablet-car]").first().click();
  await until(async () => ((await tp.locator("[data-tablet-person]").count()) ? 1 : null), 20, 300);
  check("10: a tap on the car shows the section's people with their faces", (await tp.locator("[data-tablet-person]").count()) >= 1);
  await shot(tp, "03-shared-section-tablet");
  // The seed clocked the installer in on Old PPF removal; Done on that stage closed his clocking with its minutes.
  // So the first tap clocks him in on the current stage (Strip) and a second tap clocks him out again.
  const tapPin = async () => {
    await tp.locator(`[data-tablet-person='${people.installer}']`).click();
    await until(async () => ((await tp.locator("[data-pin-pad]").count()) ? 1 : null), 20, 300);
    for (const k of ["1", "2", "3", "4"]) await tp.locator("[data-pin-pad] button", { hasText: new RegExp(`^${k}$`) }).click();
    return until(async () => (await tp.locator("[data-tablet-note]").textContent().catch(() => null)) || null, 30, 300);
  };
  const noteIn = await tapPin();
  check("10: the PIN clocks the installer in on the car's current stage (Done on the first stage had closed the seed's clocking)", /clocked in/i.test(noteIn ?? "") && /strip/i.test(noteIn ?? ""), noteIn ?? "no note");
  const clk = (await sql("select count(*)::int as n from public.bodyshop_clockings where job_id = $1 and staff_id = $2 and ended_at is not null and minutes >= 1", [jobId, people.installer]))[0]?.n ?? 0;
  check("10: Done on a stage closed the open clocking with its minutes", clk >= 1);
  await until(async () => ((await tp.locator("[data-tablet-note]").count()) === 0 ? 1 : null), 30, 300);
  await until(async () => ((await tp.locator(`[data-tablet-car='${jobId}']`).count()) ? 1 : null), 20, 300);
  await tp.locator(`[data-tablet-car='${jobId}']`).click();
  await until(async () => ((await tp.locator(`[data-tablet-person='${people.installer}']`, { hasText: /clock out/i }).count()) ? 1 : null), 30, 300);
  const noteOut = await tapPin();
  check("10: a second tap with the PIN clocks the installer out with his minutes", /clocked out/i.test(noteOut ?? ""), noteOut ?? "no note");
  const openNow = (await sql("select count(*)::int as n from public.bodyshop_clockings where job_id = $1 and staff_id = $2 and ended_at is null and is_active", [jobId, people.installer]))[0]?.n ?? 0;
  check("10: no clocking is left open after the clock-out", openNow === 0);
  await tb.close();

  // The electrical reset lands on the mechanical manager's board.
  await sql("update public.bodyshop_stages set status = 'active', started_at = now() where job_id = $1 and key = 'electrical'", [jobId]);
  const { browser: eb, page: ep } = await browserFor("workshop_manager", { viewport: { width: 1366, height: 900 } });
  await go(ep, `${base}/assign`);
  check("3: the electrical reset shows on the mechanical manager's board with Done", (await ep.locator("[data-electrical-tasks]").count()) === 1 && (await ep.locator("[data-electrical-tasks] button", { hasText: "Done" }).count()) >= 1);
  await eb.close();
  await sql("update public.bodyshop_stages set status = 'pending', started_at = null where job_id = $1 and key = 'electrical'", [jobId]);

  // Customer updates (28 Oct, B2: the bodyshop manager or the advisor, never a leader - the message goes to the customer's phone).
  await sql("insert into public.job_files (job_id, kind, storage_path, content_type, uploaded_by, created_by, updated_by) values ($1, 'bodyshop_photo', $2, 'image/jpeg', $3, $3, $3)", [jobId, `${jobId}/e2e-photo.jpg`, people.ppfLeader]);
  const { browser: ub, page: up } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(up, `${base}/bodyshop/${jobId}`);
  await up.locator("[data-pick-photo='arrived']").click();
  if (!(await until(async () => ((await up.locator("[data-photo-picker]").count()) ? 1 : null), 10, 300))) await up.locator("[data-pick-photo='arrived']").click();
  const choices = await until(async () => ((await up.locator("[data-photo-choice]").count()) ? 1 : null), 20, 300);
  check("7: the job's bodyshop photos are offered as choices", !!choices, (await up.locator("[data-photo-picker]").textContent().catch(() => "no picker"))?.slice(0, 120));
  if (choices) { await up.locator("[data-photo-choice]").first().click(); await afterSubmit(up); }
  const upd = (await sql("select kind, photo_id, token from public.bodyshop_updates where job_id = $1 and kind = 'arrived'", [jobId]))[0];
  check("7: the chosen photo is saved on the 'Your car has arrived' update with its own link", !!upd?.photo_id && !!upd?.token, JSON.stringify(upd));
  check("7: the Send button appears once a photo is chosen", (await up.locator("[data-send-update='arrived']").count()) === 1);
  const prog = upd?.token ? await fetch(`${base}/progress/${upd.token}`) : null;
  const progHtml = prog ? await prog.text() : "";
  check("7: the progress link is public, shows the one line and never a staff name", prog?.status === 200 && /Your car has arrived/.test(progHtml) && !/E2e PPF Leader|E2e Installer/.test(progHtml));
  await ub.close();
});

/* ---------------- 3. Ready: sign-off, Going out, handover, warranty, gate-out ---------------- */
await section("11-12 sign-off and going out", async () => {
  const seed = await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" });
  const { jobId, people } = seed.json;
  handoverToken = seed.json.handoverToken;
  // The board with the Going out strip (handover is tomorrow).
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1600, height: 1000 } });
  await go(op, `${base}/bodyshop`);
  const going = op.locator(`[data-going-out-car='${jobId}']`);
  check("12: the Going out strip shows the car due out tomorrow with its sign-off chips", (await going.count()) === 1 && (await going.locator("[data-signoff-chip]").count()) === 3, `${await going.count()} · ${await going.locator("[data-signoff-chip]").count()} chips`);
  check("11: PPF + detailing + manager are needed, paint is not (no paint stage)", (await going.locator("[data-signoff-chip='paint']").count()) === 0 && (await going.locator("[data-signoff-chip='ppf']").count()) === 1);
  await shot(op, "01-bodyshop-board-going-out");
  // The TV boards were removed on 16 October (bf77037): the Going out strip lives on the in-app board.
  check("5: the bodyshop board carries the Going out strip", (await op.locator("[data-going-out]").count()) === 1 && (await op.locator(`[data-going-out-car='${jobId}']`).count()) === 1);
  // Gate-out is locked before the sign-off.
  await go(op, `${base}/jobs/${jobId}/gate-out`);
  check("11: the gate-out page says the sign-off is still needed", /Release sign-off still needed/.test((await op.textContent("body")) ?? ""));
  // The PPF leader: Not ready sends it back; then signs.
  const { browser: lb, page: lp } = await browserForId(people.ppfLeader, { viewport: { width: 1366, height: 900 } });
  await go(lp, `${base}/bodyshop/${jobId}#signoff`);
  check("11: the sign-off panel shows who is waiting", /Waiting on/.test((await lp.locator("[data-waiting-on]").textContent()) ?? ""));
  check("11: the leader can only act on his own row", (await lp.locator("[data-signoff-open='ppf']").count()) === 1 && (await lp.locator("[data-signoff-open='detailing']").count()) === 0);
  await shot(lp, "04-release-sign-off");
  await lp.locator("[data-not-ready-open='ppf']").click();
  await lp.locator("[data-not-ready-reason]").fill("Edge lifting on the bonnet");
  await lp.locator("[data-not-ready-confirm]").click();
  await afterSubmit(lp);
  const back = (await sql("select j.status, j.promised_at::text as p, (select count(*)::int from public.bodyshop_stages s where s.job_id = j.id and s.section = 'ppf' and s.status = 'active') as ppf_active from public.jobs j where j.id = $1", [jobId]))[0];
  check("11: Not ready sends the car back to the PPF stage, in work again, handover moved later", back?.status === "in_work" && back?.ppf_active === 1 && back?.p > seed.json.promised, JSON.stringify(back));
  check("12: everyone involved is told it was sent back", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'bodyshop_not_ready'", [jobId]))[0]?.n ?? 0) >= 2);
  // Finish the PPF stage again (leader), then the rest (owner), so the sign-off opens.
  await go(lp, `${base}/bodyshop/${jobId}`);
  // Section 12: the PPF stage (with the tint merged in) writes the roll numbers for the warranty card before Done.
  for (const [sel, val] of [['[data-warranty-roll="ppf:"]', "E2E-PPF-ROLL"], ['[data-warranty-roll="tint:"]', "E2E-TINT-ROLL"]]) {
    const box = lp.locator(`[data-stage-warranty-form] ${sel}`);
    if (await box.count()) { await box.click({ clickCount: 3 }); await box.pressSequentially(val); }
  }
  await lp.locator("[data-stage-warranty-save='ppf']").click();
  await afterSubmit(lp);
  await handOver(lp, "ppf", "1234");
  await lb.close();
  await sql("update public.bodyshop_stages set status = 'done', done_at = now() where job_id = $1 and key <> 'handover' and status <> 'done'", [jobId]);
  await sql("update public.jobs set status = 'ready', stage = 'ready' where id = $1", [jobId]);
  // Sign-offs: the PPF leader with his PIN, the owner on behalf of detailing, the manager with his PIN.
  const { browser: lb2, page: lp2 } = await browserForId(people.ppfLeader, { viewport: { width: 1366, height: 900 } });
  await go(lp2, `${base}/bodyshop/${jobId}#signoff`);
  await lp2.locator("[data-signoff-open='ppf']").click();
  await lp2.locator("[data-signoff-pin]").fill("1234");
  await lp2.locator("[data-signoff-confirm]").click();
  await afterSubmit(lp2);
  check("11: the PPF leader signs with his PIN", ((await sql("select count(*)::int as n from public.bodyshop_signoffs where job_id = $1 and role_key = 'ppf' and is_active", [jobId]))[0]?.n ?? 0) === 1, urlText(lp2).slice(-80));
  await lb2.close();
  await go(op, `${base}/bodyshop/${jobId}#signoff`);
  await op.locator("[data-signoff-open='detailing']").click();
  await op.locator("[data-signoff-confirm]").click();
  await afterSubmit(op);
  await go(op, `${base}/bodyshop/${jobId}#signoff`);
  await op.locator("[data-signoff-open='manager']").click();
  await op.locator("[data-signoff-confirm]").click();
  await afterSubmit(op);
  const signed = await sql("select role_key, on_behalf from public.bodyshop_signoffs where job_id = $1 and is_active order by role_key", [jobId]);
  check("11: the owner signs on behalf of the others; every sign-off is in", signed.length === 3 && signed.filter((s) => s.on_behalf).length === 2, JSON.stringify(signed));
  check("11: the page says the car can be handed over", /Every sign-off is in/.test((await op.locator("[data-waiting-on]").textContent()) ?? ""));
  // The handover page and the warranty certificate.
  const hp = await fetch(`${base}/handover/${handoverToken}`);
  const hpHtml = await hp.text();
  check("7: the handover page opens with warranty, care instructions and no staff names", hp.status === 200 && /data-warranty/.test(hpHtml) && /data-care/.test(hpHtml) && !/E2e PPF Leader|E2e Installer|Arsalan/.test(hpHtml));
  await go(op, `${base}/handover/${handoverToken}`);
  await op.setViewportSize({ width: 430, height: 1000 });
  await shot(op, "06-handover-page");
  await op.setViewportSize({ width: 1600, height: 1000 });
  const pdf = await fetch(`${base}/api/pdf/warranty/${handoverToken}`, { headers: { cookie: await cookieHeader("owner") } });
  check("7: the warranty certificate PDF renders", pdf.status === 200);
  if (pdf.ok) {
    const buf = Buffer.from(await pdf.arrayBuffer());
    const text = await pdfText(buf);
    check("7: the certificate carries OFJ Bespoke PPF, the VIN, install and valid-until dates and no staff names", /OFJ Bespoke PPF/i.test(text) && /WDC1234567E2E0001/i.test(text) && /valid until/i.test(text) && !/E2e |Arsalan|Omar/.test(text), text.replace(/\s+/g, " ").slice(0, 160));
    await pdfPng(buf, path.join(SHOTS, "07-warranty-certificate.png"));
  }
  // Gate-out with the final check date: the appointment is made, everyone is told the car left.
  const d10 = (await sql("select to_char((now() at time zone 'Asia/Dubai')::date + 10, 'YYYY-MM-DD') as d"))[0].d;
  await sql("update public.invoices set status = 'issued' where job_id = $1", [jobId]).catch(() => null);
  const payTotal = (await sql("select id, total_aed from public.invoices where job_id = $1 and kind = 'proforma' and deposit_for_quotation_id is null and converted_to is null order by issued_at desc limit 1", [jobId]))[0];
  if (payTotal) await sql("insert into public.payments (job_id, invoice_id, method, amount_aed, status, received_at, recorded_by, created_by) values ($1, $2, 'cash', $3, 'recorded', now(), $4, $4)", [jobId, payTotal.id, payTotal.total_aed, people.advisor]).catch(() => null);
  await go(op, `${base}/jobs/${jobId}/gate-out`);
  check("8: the gate-out offers the final check date (7 to 14 days)", (await op.locator("[data-final-check]").count()) === 1);
  await op.locator("[data-final-check]").fill(d10);
  await op.locator("input[name='collector_name']").fill("Stage Customer");
  await op.locator("input[name='keys_ok']").check();
  if (await op.locator("input[name='keychain_ok']").count()) await op.locator("input[name='keychain_ok']").check();
  await op.locator("input[name='handover_confirmed']").check();
  const releaseBox = op.locator("[name='release_reason']");
  if (await releaseBox.count()) await releaseBox.fill("E2e test: released with the balance noted");
  await op.locator("button[type='submit']", { hasText: /Gate out/ }).click();
  await afterSubmit(op);
  const out = (await sql("select j.is_open, j.status, j.final_check_appointment_id, a.starts_at, a.reason from public.jobs j left join public.appointments a on a.id = j.final_check_appointment_id where j.id = $1", [jobId]))[0];
  check("8: gate-out closes the job and books the final check on the chosen day, linked to the job", out?.is_open === false && !!out?.final_check_appointment_id && String(out?.starts_at ?? "").startsWith(d10) && /final check/i.test(out?.reason ?? ""), `${JSON.stringify(out)} · ${urlText(op).slice(-120)}`);
  check("12: everyone involved is told the car has left", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'bodyshop_left'", [jobId]))[0]?.n ?? 0) >= 2);
  // The owner's monthly summary has the bodyshop block.
  await go(op, `${base}/reports/monthly`);
  check("9: the owner's summary shows the bodyshop block with this car", (await op.locator("[data-bodyshop-report]").count()) === 1 && /Dubai F 63000|63000/.test((await op.locator("[data-bodyshop-report]").textContent()) ?? ""), ((await op.locator("[data-bodyshop-report]").textContent()) ?? "").slice(0, 200));
  await ob.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
