// Overnight 22-23 October 2026, section 7: "+ Add bodyshop findings" in the inspection. The technician opens it,
// taps the front bumper on the car outline (Dent, Crack, Severe, Replace, a photo, a remark, 4 h), answers the
// accident questions (airbags, structural -> chassis measurement needed); the bodyshop manager is told, checks it,
// and after that the technician cannot change it; the customer's report gets a Body section with the outline; the
// quotation gets a BODYSHOP line and the job becomes Both; the same outline marks gate-in damage and the PPF
// pre-work check.
// Run: node --env-file=.env.local tests/browser/test-body7.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
// A small photo of "damage" (a red square) for the required photo.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "inspection" });
const jobId = seed.json.jobId;
const inspId = seed.json.inspectionId;
await sql("update public.inspections set scan_read_at = now() where id = $1", [inspId]);
const bodyMgr = (await sql("select id, display_name from public.staff where role_id = 'workshop_manager' and department_id in ('bodyshop', 'paint', 'ppf_tint') and is_active order by display_name limit 1"))[0];

/* 1. The technician opens the section and records the front bumper */
const { browser, page } = await browserForId(seed.json.technicianId, { viewport: { width: 1100, height: 1200 } });
await go(page, `${base}/my-jobs/${jobId}`);
const openBtn = page.locator("[data-body-open]");
await openBtn.scrollIntoViewIfNeeded();
check("1: '+ Add bodyshop findings' sits at the bottom, closed by default", (await page.locator('[data-body-findings="closed"]').count()) === 1);
await openBtn.click();
await page.locator('[data-body-findings="open"]').waitFor({ timeout: 10000 });
await page.locator('[data-body-findings="open"] [data-panel="front_bumper"]').click();
const ed = page.locator('[data-body-editor="front_bumper"]');
await ed.locator('[data-body-chip="damage-dent"]').click();
await ed.locator('[data-body-chip="damage-crack"]').click();
await ed.locator('[data-body-chip="severity-severe"]').click();
await ed.locator('[data-body-chip="action-replace"]').click();
await ed.locator("[data-body-remark]").fill("Pushed in from the impact, mounts broken");
await ed.locator('[data-body-chip="hours-4"]').click();
const f1 = await until(async () => { const r = (await sql("select damage, severity, action, remark, labour_hours::float8 as h from public.bodyshop_findings where inspection_id = $1 and panel = 'front_bumper' and is_active", [inspId]))[0]; return r && r.h === 4 && r.remark ? r : null; });
check("1: the finding is saved: Dent + Crack, Severe, Replace, the remark, 4 h", !!f1 && f1.damage.join(",") === "dent,crack" && f1.severity === "severe" && f1.action === "replace" && /Pushed in/.test(f1.remark), JSON.stringify(f1));
check("1: 'Photos (required)' is red until a photo is added", /text-red/.test((await ed.locator("[data-body-photo-label]").getAttribute("class")) ?? ""));
const fileInput = ed.locator('input[type="file"]').first();
await fileInput.setInputFiles({ name: "front-bumper.png", mimeType: "image/png", buffer: png });
const photo = await until(async () => ((await sql("select count(*)::int as n from public.inspection_media where inspection_id = $1 and item_key = 'body.front_bumper' and removed_at is null", [inspId]))[0].n > 0 ? 1 : null), 40, 750);
check("1: the photo is stored on the finding (item body.front_bumper)", !!photo);
const fill = await page.locator('[data-body-findings="open"] [data-panel="front_bumper"]').getAttribute("fill");
check("1: the damaged panel lights up red on the outline", (fill ?? "").toUpperCase() === "#F6D1CE", fill);
await page.locator('[data-body-chip="airbags-yes"]').click();
await page.locator('[data-body-chip="structural-yes"]').click();
check("1: structural damage suspected shows CHASSIS MEASUREMENT NEEDED", (await page.locator("[data-chassis-needed]").count()) === 1);
const acc = await until(async () => { const r = (await sql("select airbags_deployed, structural_damage from public.inspections where id = $1", [inspId]))[0]; return r?.airbags_deployed && r?.structural_damage ? r : null; });
check("1: the accident answers are saved", !!acc);
await page.locator('[data-body-findings="open"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("body7-1-technician.png"), clip: (await page.locator('[data-body-findings="open"]').boundingBox()) ?? undefined });
await browser.close();

/* 2. The bodyshop manager is told, checks it; the technician can no longer change it */
const note = (await sql("select title from public.notifications where job_id = $1 and type = 'bodyshop_assessment' order by created_at desc limit 1", [jobId]))[0];
check("2: the bodyshop manager is told 'Bodyshop assessment needed – Dubai S 30303 …'", /^Bodyshop assessment needed – Dubai S 30303/.test(note?.title ?? ""), note?.title);
if (bodyMgr) {
  await sql("update public.inspections set status = 'submitted', submitted_at = now() where id = $1", [inspId]);
  const { browser: mb, page: mp } = await browserForId(bodyMgr.id, { viewport: { width: 1366, height: 1100 } });
  await go(mp, `${base}/jobs/${jobId}/inspection`);
  const card = mp.locator('[data-body-findings="open"]');
  await card.waitFor({ timeout: 15000 });
  check(`2: ${bodyMgr.display_name} (bodyshop manager) opens the report and sees the finding`, /Front bumper/.test(await text(card)));
  await card.locator("[data-body-check]").click();
  check("2: 'Mark the bodyshop assessment checked' is stamped", !!(await until(async () => ((await sql("select bodyshop_checked_at from public.inspections where id = $1", [inspId]))[0]?.bodyshop_checked_at ? 1 : null))));
  await mp.screenshot({ path: shot("body7-2-bodyshop-manager.png"), clip: (await card.boundingBox()) ?? undefined });
  await mb.close();
  await sql("update public.inspections set status = 'in_progress' where id = $1", [inspId]);
  const r = await fetch(`${base}/api/inspection/body`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader(seed.json.technicianId) }, body: JSON.stringify({ inspectionId: inspId, op: "save", finding: { panel: "bonnet", damage: ["scratch"] } }) });
  check("2: after the check the technician can no longer change the bodyshop part (403)", r.status === 403, String(r.status));
} else check("2: a bodyshop manager exists to check it", false, "no bodyshop workshop manager on staff");

/* 3. The customer's report: the Body section with the outline */
await sql("update public.inspections set status = 'approved', approved_at = now(), submitted_at = coalesce(submitted_at, now()) where id = $1", [inspId]);
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const tok = `e2ebody${Math.random().toString(36).slice(2, 12)}`;
await sql("insert into public.report_links (job_id, inspection_id, token, status, created_by, updated_by) values ($1, $2, $3, 'sent', $4, $4)", [jobId, inspId, tok, owner]);
const pdf = await fetch(`${base}/api/pdf/report/${tok}`);
const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(Buffer.from(await pdf.arrayBuffer()), "application/pdf");
let t = "";
for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
t = t.replace(/\s+/g, " ");
check("3: the report has a Body section: front bumper, Dent, Crack, Severe, Replace", /BODY · 1 PANEL/i.test(t) && /Front bumper/i.test(t) && /Dent, Crack/i.test(t) && /Severe/i.test(t) && /Replace/i.test(t), t.match(/BODY.{0,200}/i)?.[0] ?? String(pdf.status));
check("3: and says airbags deployed, chassis measurement needed", /Airbags deployed/i.test(t) && /chassis measurement needed/i.test(t));
const pageIdx = Array.from({ length: doc.countPages() }, (_, i) => i).find((i) => /BODY/i.test(doc.loadPage(i).toStructuredText("preserve-whitespace").asText())) ?? 0;
fs.writeFileSync(shot("body7-3-report-body.png"), Buffer.from(doc.loadPage(pageIdx).toPixmap(mupdf.Matrix.scale(1.3, 1.3), mupdf.ColorSpace.DeviceRGB, false, true).asPNG()));

/* 4. The quotation: a BODYSHOP line, and the job becomes Both */
await sql("update public.jobs set department = 'mechanical' where id = $1", [jobId]);
const { browser: ab, page: ap } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(ap, `${base}/jobs/${jobId}`);
await ap.getByRole("button", { name: "Start quotation" }).first().click();
await ap.waitForURL(/\/quote\//, { timeout: 60000 });
const line = (await sql("select l.title, l.side, l.hours::float8 as h, l.labour_rate::float8 as rate, l.urgency, l.details from public.quotation_lines l join public.quotations q on q.id = l.quotation_id where q.job_id = $1 and l.source_key = 'body.front_bumper' and l.is_active", [jobId]))[0];
check("4: the finding arrives as a BODYSHOP line 'Front bumper – Replace', 4 h, urgent (severe)", !!line && line.title.toLowerCase() === "front bumper – replace" && line.side === "bodyshop" && line.h === 4 && line.urgency === "urgent", JSON.stringify(line));
check("4: the job is now Both (each manager assigns his own side)", (await sql("select department from public.jobs where id = $1", [jobId]))[0].department === "both");
await ap.reload();
await ap.getByText("From the inspection report").first().click();
await sleep(500);
check("4: the report strip on the quotation lists the body finding", /Body · Front bumper – Replace/.test(await text(ap.locator("main"))));
await ap.locator('[data-side-badge="bodyshop"]').first().scrollIntoViewIfNeeded();
await ap.screenshot({ path: shot("body7-4-quote-line.png") });

/* 5. The same outline at gate-in and for the PPF pre-work check */
await go(ap, `${base}/jobs/${jobId}/media`);
const gi = ap.locator('[data-panel-marker="gate-in"]');
await gi.scrollIntoViewIfNeeded();
await gi.locator('[data-panel="door_fl"]').click();
await gi.locator('[data-marker-damage="scratch"]').click();
const gm = await until(async () => { const r = (await sql("select damage_panels from public.gate_ins where job_id = $1", [jobId]))[0]; return r?.damage_panels?.door_fl ? r.damage_panels : null; });
check("5: gate-in damage marked on the same outline (front door left: Scratch)", !!gm && gm.door_fl.damage.includes("scratch"), JSON.stringify(gm));
await ap.screenshot({ path: shot("body7-5-gate-in.png"), clip: (await gi.boundingBox()) ?? undefined });
await go(ap, `${base}/bodyshop/${jobId}`);
const pw = ap.locator('[data-panel-marker="prework"]');
if (await pw.count()) {
  await pw.scrollIntoViewIfNeeded();
  await pw.locator('[data-panel="bonnet"]').click();
  await pw.locator('[data-marker-damage="previous_repair"]').click();
  await until(async () => ((await sql("select prework_panels from public.jobs where id = $1", [jobId]))[0]?.prework_panels?.bonnet ? 1 : null));
  await pw.locator("[data-prework-mark]").click();
  const done = await until(async () => { const r = (await sql("select prework_panels, prework_checked_at from public.jobs where id = $1", [jobId]))[0]; return r?.prework_checked_at ? r : null; });
  check("5: the PPF pre-work check uses the same outline (bonnet: Previous repair) and is stamped done", !!done && done.prework_panels.bonnet?.damage.includes("previous_repair"), JSON.stringify(done));
  await ap.screenshot({ path: shot("body7-6-prework.png"), clip: (await ap.locator('[data-panel-marker="prework"]').boundingBox()) ?? undefined });
} else check("5: the bodyshop page shows the pre-work check", false, ap.url());
await ab.close();

cleanupDb();
process.exit(summary() ? 1 : 0);
