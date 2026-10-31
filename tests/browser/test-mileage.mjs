// Final km + the instrument-cluster photo at gate-out (30 October 2026, batch 2 section 2). On the TEST database.
//  A  the gate-out is refused without the final km and without the photo
//  B  a final km lower than at gate-in is red on screen and refused by the server
//  C  45 km driven (gate-in 48,210 -> 48,255): "Driven while with us: 45 km", the car leaves, the owner is told
//     "DUBAI … driven 45 km while with us (gate-in 48,210 → gate-out 48,255)"
//  D  the job card: "Mileage in 48,210 km · out 48,255 km · driven 45 km" with both photos in the photo viewer
//  E  the customer's invoice (page and PDF): Mileage in / Mileage out, no photos
//  F  "Can't read it" (battery dead) with the photo: the car leaves and the owner is told
//   node --env-file=.env.test.local tests/browser/test-mileage.mjs     (npm run test:mileage)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "mileage");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
const until = async (fn, tries = 80, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

/** A dashboard photo at gate-in, put in storage and on the gate-in record (the stage seed's media are old rows). */
async function gateInDashboard(jobId) {
  const p = `${jobId}/e2e-dashboard-${Date.now()}.jpg`;
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/gate-in-media/${p}`, { method: "POST", headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "image/jpeg" }, body: JPEG });
  if (!r.ok) console.log("dashboard upload:", r.status, await r.text());
  await sql("insert into public.gate_in_media (job_id, kind, storage_path) values ($1, 'dashboard_photo', $2)", [jobId, p]);
}
async function carReady(km = 48210) {
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  // One parameter per value: a parameter used as an integer AND in a division is refused ("inconsistent types"),
  // and the e2e sql helper hides the refusal - the reading then silently stays at the seed's 42,000.
  await sql("update public.gate_ins set mileage = $2::int, mileage_unit = 'km', mileage_miles = $3::int where job_id = $1", [seed.jobId, km, Math.round(km / 1.609344)]);
  const set = (await sql("select mileage from public.gate_ins where job_id = $1", [seed.jobId]))[0]?.mileage;
  if (Number(set) !== km) throw new Error(`the gate-in reading was not set (${set})`);
  await gateInDashboard(seed.jobId);
  return seed;
}
/** Everything else on the gate-out form, as a person fills it (owner: releases with a reason when money is due). */
async function fillTheRest(page) {
  for (const name of ["keys_ok", "keychain_ok", "dash_cam_reconnected", "old_parts_handed", "handover_confirmed"]) {
    const box = page.locator(`input[name="${name}"]`);
    if (!(await box.count()) || !(await box.first().isVisible())) continue;
    // React resets the form a moment after the server's answer: a tick made in that moment is undone, so try again.
    for (let i = 0; i < 5 && !(await box.first().isChecked()); i++) {
      await box.first().check({ timeout: 3000 }).catch(() => null);
      if (!(await box.first().isChecked())) await sleep(300);
    }
  }
  const reason = page.locator('textarea[name="release_reason"]');
  if (await reason.count()) await reason.first().fill("E2e test release");
  const collector = page.locator('input[name="collector_name"]');
  if ((await collector.count()) && !(await collector.first().inputValue())) await collector.first().fill("E2e Collector");
}
const submit = (page) => page.getByRole("button", { name: /Gate out and close the job/ }).click();
const photoInBox = (page) => page.locator("[data-final-mileage] input[type=file]").first().setInputFiles({ name: "cluster.jpg", mimeType: "image/jpeg", buffer: JPEG });

try {
  cleanupDb();
  const car = await carReady();
  const jobId = car.jobId;
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });

  /* A: refused without the km and without the photo */
  await go(page, `${base}/jobs/${jobId}/gate-out`);
  check("A the gate-out has the Final km box with the gate-in reading", (await page.locator("[data-final-mileage]").count()) === 1 && /48,210 km/.test(await text(page.locator("[data-final-mileage]"))));
  await fillTheRest(page);
  await submit(page);
  // Wait for the server's own words ("Final km" is always on the page as the box's label).
  await until(async () => /Enter the final km/.test(await text(page.locator("main"))), 40);
  const noRow = (await sql("select count(*)::int as n from public.gate_outs where job_id = $1", [jobId]))[0].n;
  check("A without the final km: refused, nothing saved", /Enter the final km/.test(await text(page.locator("main"))) && noRow === 0, await text(page.locator("[role=alert], .text-red")));
  await page.locator("[data-final-mileage]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "A-refused-no-km-1440.png") });
  await page.locator("[data-mileage-out]").fill("48255");
  await fillTheRest(page);
  await submit(page);
  await until(async () => /Take the photo of the whole instrument cluster/.test(await text(page.locator("main"))), 40);
  check("A with the km but no photo: refused (the photo is required)", /Take the photo of the whole instrument cluster/.test(await text(page.locator("main"))) && (await sql("select count(*)::int as n from public.gate_outs where job_id = $1", [jobId]))[0].n === 0);

  /* B: lower than at gate-in */
  await page.locator("[data-mileage-out]").fill("48100");
  check("B a lower final km is red on screen", /lower than at gate-in \(48,210\)/.test(await text(page.locator("[data-mileage-lower]"))));
  await photoInBox(page);
  const odo = await until(async () => (await sql("select id from public.job_files where job_id = $1 and kind = 'odometer_out' and removed_at is null", [jobId]))[0]);
  check("B the cluster photo goes straight to storage (job file kind odometer_out)", !!odo);
  await fillTheRest(page);
  await submit(page);
  // The server's refusal ends with "Check the reading." (the screen's own red line says "lower than" at once).
  await until(async () => /Check the reading/.test(await text(page.locator("main"))), 40);
  check("B the server refuses it too, nothing saved", (await sql("select count(*)::int as n from public.gate_outs where job_id = $1", [jobId]))[0].n === 0);
  await page.screenshot({ path: path.join(SHOTS, "B-lower-km-refused-1440.png") });

  /* C: 45 km driven */
  await page.locator("[data-mileage-out]").fill("48255");
  check("C \"Driven while with us: 45 km\" with the owner warning", /Driven while with us: 45 km/.test(await text(page.locator("[data-mileage-driven]"))) && /owner is told/.test(await text(page.locator("[data-mileage-driven]"))));
  await page.locator("[data-final-mileage]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "C-driven-45km-1440.png") });
  await fillTheRest(page);
  await submit(page);
  await page.waitForURL((u) => !/gate-out/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const go1 = (await sql("select mileage_out, mileage_out_unit, odometer_file_id is not null as photo, mileage_alert_at is not null as alerted from public.gate_outs where job_id = $1", [jobId]))[0];
  check("C saved: 48,255 km, the photo, the alert stamped; the job is closed", go1?.mileage_out === 48255 && go1.photo && go1.alerted && (await sql("select is_open from public.jobs where id = $1", [jobId]))[0].is_open === false, JSON.stringify(go1));
  const note = (await until(async () => (await sql("select title from public.notifications where job_id = $1 and type = 'mileage_alert' order by created_at desc limit 1", [jobId]))[0]))?.title ?? "";
  check(`C the owner is told: "${note}"`, /^DUBAI .+ driven 45 km while with us \(gate-in 48,210 → gate-out 48,255\)$/.test(note));

  /* D: the job card */
  await go(page, `${base}/jobs/${jobId}`);
  const line = await text(page.locator("[data-mileage-line]"));
  check(`D the job card: "${line}"`, line === "Mileage in 48,210 km · out 48,255 km · driven 45 km");
  check("D both dashboard photos are there", (await page.locator('[data-mileage-photos="2"]').count()) === 1);
  await page.locator("[data-mileage-panel]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "D-job-card-mileage-1440.png") });
  await page.locator("[data-mileage-photos] [data-viewer-item]").first().click();
  const viewer = await until(async () => (await page.locator("[data-lightbox-count]").count()) > 0, 40);
  check("D a photo opens in the photo viewer", !!viewer && /Dashboard at gate-in/i.test(await text(page.locator("[data-lightbox-label]"))));
  await page.screenshot({ path: path.join(SHOTS, "D-viewer-1440.png") });
  await page.keyboard.press("Escape");

  /* E: the customer's invoice */
  const token = car.invoice?.token ?? (await sql("select token from public.invoices where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0]?.token;
  const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await cp.context().clearCookies();
  await go(cp, `${base}/invoice/${token}`);
  const body = await text(cp.locator("body"));
  check("E the invoice page: Mileage in 48,210 km and Mileage out 48,255 km, no dashboard photo", /Mileage in\s*48,210 km/.test(body) && /Mileage out\s*48,255 km/.test(body) && (await cp.locator('img[alt^="Dashboard"]').count()) === 0, body.slice(0, 200));
  await cp.screenshot({ path: path.join(SHOTS, "E-invoice-page-420.png"), fullPage: true });
  await cb.close();
  const pdf = Buffer.from(await (await fetch(`${base}/api/pdf/invoice/${token}`)).arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  let pdfText = "";
  for (let i = 0; i < doc.countPages(); i++) pdfText += doc.loadPage(i).toStructuredText().asText() + "\n";
  check("E the invoice PDF: \"Mileage in 48,210 km · out 48,255 km\"", /Mileage in 48,210 km · out 48,255 km/.test(pdfText.replace(/\s+/g, " ")));
  fs.writeFileSync(path.join(SHOTS, "E-invoice.pdf"), pdf);
  await browser.close();

  /* F: can't read it */
  cleanupDb();
  const car2 = await carReady(30000);
  const { browser: b2, page: p2 } = await browserFor("owner", { viewport: { width: 800, height: 1280 }, touch: true });
  await go(p2, `${base}/jobs/${car2.jobId}/gate-out`);
  await p2.locator("[data-mileage-unreadable]").check();
  await p2.locator('[data-mileage-reason="battery"]').click();
  await photoInBox(p2);
  await until(async () => (await sql("select id from public.job_files where job_id = $1 and kind = 'odometer_out'", [car2.jobId]))[0]);
  await p2.locator("[data-final-mileage]").scrollIntoViewIfNeeded();
  await p2.screenshot({ path: path.join(SHOTS, "F-cant-read-800x1280.png") });
  await fillTheRest(p2);
  await p2.getByRole("button", { name: /Gate out and close the job/ }).click();
  await p2.waitForURL((u) => !/gate-out/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const go2 = (await sql("select mileage_out, mileage_unreadable_reason from public.gate_outs where job_id = $1", [car2.jobId]))[0];
  const note2 = (await until(async () => (await sql("select title, body from public.notifications where job_id = $1 and type = 'mileage_alert' order by created_at desc limit 1", [car2.jobId]))[0])) ?? {};
  check(`F can't read it (battery dead) with the photo: the car leaves, the owner is told "${note2.title}"`, go2?.mileage_out === null && go2?.mileage_unreadable_reason === "battery" && /^Final km not read/.test(note2.title ?? "") && /Battery dead/.test(note2.body ?? ""));
  await go(p2, `${base}/jobs/${car2.jobId}`);
  check("F the job card says Final km not read: Battery dead", /Final km not read: Battery dead/.test(await text(p2.locator("[data-mileage-not-read]"))));
  await b2.close();
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
