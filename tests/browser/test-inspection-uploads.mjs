// Inspection photos and videos never lost (12 November 2026), on the TEST database through the test server.
// A technician on a shared tablet (800 x 1280, touch, a registered tablet "E2e Mech 3") takes 10 photos and records 1 video
// on the inspection report while the line is slow. Midway: the screen is "locked" (the page frozen, as Android does), then
// the page is closed, then ANOTHER technician signs in on the same tablet, and the network is cut off and comes back.
// All 11 files must arrive on the right car and item, recorded under the technician who took them; the server knew about
// every file from the moment it was saved ("11 files still uploading from E2e Mech 3"), the report cannot go to the
// customer while one is missing, a file that cannot be sent is red with "Try again", and the advisor hears after 15 minutes.
//   node --env-file=.env.test.local tests/browser/test-inspection-uploads.mjs      (npm run test:inspuploads)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { api, base, cleanupDb, loginCookiesById, makeChecks, projectRoot, sql, sleep } from "./pw-lib.mjs";
import { chromium } from "playwright-core";

const { check, summary } = makeChecks();
const PROOF = path.join(projectRoot, "docs", "proof", "2026-11-12-inspection-uploads");
fs.mkdirSync(PROOF, { recursive: true });
const one = async (q, p = []) => (await sql(q, p))[0] ?? null;
const until = async (fn, ms = 60000, every = 1000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(every); } return null; };
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/** A camera feed for the recorder: a few moving grey frames at 1920 x 1080. */
function y4m(w, h, frames) {
  const dir = path.join(os.tmpdir(), "ofj-fake-camera");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `insp-${w}x${h}.y4m`);
  const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < frames; f++) {
    const y = Buffer.alloc(w * h);
    for (let r = 0; r < h; r++) y.fill(((r + f * 37) % 220) + 20, r * w, (r + 1) * w);
    parts.push(Buffer.from("FRAME\n"), y, Buffer.alloc((w / 2) * (h / 2), 128), Buffer.alloc((w / 2) * (h / 2), 128));
  }
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

/** Files waiting in the page's queue (IndexedDB "erp-send-queue"). */
const queued = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open("erp-send-queue");
  req.onsuccess = () => {
    const d = req.result;
    try {
      if (!d.objectStoreNames.contains("files")) { d.close(); return resolve(0); }
      const t = d.transaction("files", "readonly").objectStore("files").count();
      t.onsuccess = () => { d.close(); resolve(t.result); };
      t.onerror = () => { d.close(); resolve(-1); };
    } catch { d.close(); resolve(-1); }
  };
  req.onerror = () => resolve(-1);
})).catch(() => -1);

/** A noisy JPEG of about half a megabyte, made by the browser (so each photo takes real time on a slow line). */
const makePhoto = (page, n) => page.evaluate(async (n) => {
  const c = document.createElement("canvas");
  c.width = 1600; c.height = 1200;
  const x = c.getContext("2d");
  const img = x.createImageData(c.width, c.height);
  let s = 12345 + n * 977;
  for (let i = 0; i < img.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = s & 255; img.data[i] = v; img.data[i + 1] = (v * 3) & 255; img.data[i + 2] = (v * 7) & 255; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  x.fillStyle = "#000"; x.font = "bold 120px sans-serif"; x.fillText(`PHOTO ${n}`, 80, 200);
  const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}, n).then((b64) => Buffer.from(b64, "base64"));

async function throttle(context, page, bytesPerSecond) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: bytesPerSecond > 0 ? bytesPerSecond * 4 : -1, uploadThroughput: bytesPerSecond });
  return cdp;
}

const DEVICE_TOKEN = randomBytes(24).toString("hex");
const PHOTO_PLAN = [["tyre.fl", 3], ["tyre.fr", 3], ["tyre.rl", 2], ["tyre.rr", 2]];
let browser = null;
const made = [];
try {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, inspectionId, technicianId } = seed.json ?? {};
  if (inspectionId) await sql("update public.inspections set scan_read_at = now() where id = $1", [inspectionId]);
  const other = await one("select id, display_name from public.staff where role_id = 'technician' and is_active and id <> $1 order by display_name limit 1", [technicianId]);
  check("seed: an inspection in progress, its technician and a second technician", !!inspectionId && !!technicianId && !!other?.id, JSON.stringify({ inspectionId, technicianId, other: other?.id }));
  // A registered shared tablet, as in the workshop.
  await sql("insert into public.devices (name, location, token_hash, kind) values ('E2e Mech 3', 'workshop', $1, 'shared')", [createHash("sha256").update(DEVICE_TOKEN).digest("hex")]);
  check("seed: a registered shared tablet \"E2e Mech 3\"", !!(await one("select id from public.devices where name = 'E2e Mech 3' and is_active")));
  const deviceCookie = { name: "erp_device", value: DEVICE_TOKEN, domain: "localhost", path: "/" };

  const cam = y4m(1920, 1080, 6);
  browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${cam}`] });
  const context = await browser.newContext({ viewport: { width: 800, height: 1280 }, hasTouch: true });
  await context.grantPermissions(["camera", "microphone"], { origin: base });
  await context.addCookies([...(await loginCookiesById(technicianId)), deviceCookie]);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", (d) => d.accept().catch(() => null));
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('[data-media-where="tyre.fl"]', { timeout: 30000 });
  await sleep(2000); // the screen asks for its sending permit when it opens

  /* 1. Ten photos and one video, on a slow line (about 1 Mbit/s up) */
  const photos = [];
  for (let i = 0; i < 10; i += 1) photos.push(await makePhoto(page, i + 1));
  const cdp1 = await throttle(context, page, 100_000);
  let n = 0;
  for (const [key, count] of PHOTO_PLAN) {
    const files = photos.slice(n, n + count).map((buffer, i) => ({ name: `${key}-${i + 1}.jpg`, mimeType: "image/jpeg", buffer }));
    n += count;
    await page.locator(`[data-media-where="${key}"] input[type=file]`).first().setInputFiles(files);
  }
  // The video: a checklist item marked Bad shows its Video button; on a tablet it opens the recorder INSIDE the page.
  const items = await sql("select item_key, item_label from public.inspection_items where inspection_id = $1 and style = 'grade' and section_key <> 'diagnostics_and_road_test' order by position limit 40", [inspectionId]);
  let videoItem = null;
  for (const it of items) {
    const bad = page.locator(`xpath=//*[normalize-space(text())="${it.item_label}"]/ancestor::*[.//button[normalize-space()="Bad"]][1]//button[normalize-space()="Bad"]`).first();
    if (!(await bad.count())) continue;
    await bad.scrollIntoViewIfNeeded();
    await bad.click();
    const btn = page.locator(`[data-media-where="${it.item_key}"] [data-inspection-video]`);
    if (await until(async () => (await btn.count()) === 1, 8000, 300)) { videoItem = it; break; }
  }
  check("1a a checklist item with the Video button", !!videoItem, JSON.stringify(videoItem));
  await page.locator(`[data-media-where="${videoItem.item_key}"] [data-inspection-video]`).click();
  const quality = (await page.locator("[data-recorder-quality]").textContent({ timeout: 20000 }).catch(() => "")) ?? "";
  check(`1b the video records inside the page at full HD, not through the camera app (${quality})`, quality.startsWith("1920 × 1080"));
  await page.locator("[data-recorder-start]").click();
  await sleep(4000);
  await page.locator("[data-recorder-stop]").click();
  const all = await until(async () => ((await queued(page)) === 11 ? 11 : null), 30000, 300);
  check("1c all 11 files saved on the tablet at once", all === 11, String(await queued(page)));
  const told = await until(async () => { const r = await one("select count(*)::int n, count(*) filter (where device_name = 'E2e Mech 3')::int dev, count(*) filter (where staff_id = $2)::int mine from public.upload_pending where inspection_id = $1 and arrived_at is null", [inspectionId, technicianId]); return r?.n >= 11 ? r : null; }, 30000, 500);
  check("1d the server knows about the files from the moment they were saved, from which tablet and who took them", !!told && told.dev === told.n && told.mine === told.n, JSON.stringify(told));
  const pill = page.locator("[data-send-queue-pill]");
  await until(async () => /of 11 uploaded/.test((await pill.textContent().catch(() => "")) ?? ""), 20000, 300);
  const pillText = (await pill.textContent().catch(() => "")) ?? "";
  check(`1e clear progress on the tablet ("${pillText.trim()}")`, /\d+ of 11 uploaded/.test(pillText));
  const wake = await page.evaluate(() => document.documentElement.dataset.sendingFiles ?? null);
  check("1f the screen is kept awake while files are on their way", Number(wake) >= 1, String(wake));
  await page.locator(`[data-media-where="tyre.fl"]`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(PROOF, "1-progress-tablet-800.png") });

  /* 2. The screen locks (the page frozen) for 15 seconds, then the page is closed while files are still on their way */
  const arrivedNow = async () => (await one("select count(*)::int n from public.inspection_media where inspection_id = $1 and removed_at is null", [inspectionId]))?.n ?? 0;
  await until(async () => (await arrivedNow()) >= 1, 60000, 500);
  const cdpLife = await context.newCDPSession(page);
  const frozen = await cdpLife.send("Page.setWebLifecycleState", { state: "frozen" }).then(() => true).catch((e) => String(e?.message ?? e));
  await sleep(15000);
  await cdpLife.send("Page.setWebLifecycleState", { state: "active" }).catch(() => null);
  check("2a the screen was locked (page frozen) midway", frozen === true, String(frozen));
  await sleep(4000);
  const beforeClose = await arrivedNow();
  const leftOnTablet = await queued(page);
  check(`2b after the lock the upload carried on (${beforeClose} of 11 in, ${leftOnTablet} still on the tablet)`, beforeClose >= 1 && leftOnTablet >= 1 && beforeClose + leftOnTablet >= 11, `${beforeClose} + ${leftOnTablet}`);
  void cdp1;
  await page.close({ runBeforeUnload: false });

  /* 3. Another technician signs in on the same tablet; then the network goes off and comes back */
  await context.clearCookies();
  await context.addCookies([...(await loginCookiesById(other.id)), deviceCookie]);
  const page2 = await context.newPage();
  page2.setDefaultTimeout(20000);
  page2.on("dialog", (d) => d.accept().catch(() => null));
  await page2.goto(`${base}/my-jobs`, { waitUntil: "load", timeout: 60000 });
  await throttle(context, page2, 100_000);
  await until(async () => (await arrivedNow()) > beforeClose, 90000, 500);
  const midway = await arrivedNow();
  check(`3a ${other.display_name} signed in: the files left by the first technician carry on (${midway} of 11)`, midway > beforeClose, `${beforeClose} → ${midway}`);
  await context.setOffline(true);
  // A send already on its way when the line went may still land; after that nothing moves until the signal is back.
  await sleep(10000);
  const atCut = await arrivedNow();
  await sleep(15000);
  const offPill = (await page2.locator("[data-send-queue-pill]").textContent().catch(() => "")) ?? "";
  const duringCut = await arrivedNow();
  check(`3b network off: nothing is lost, the tablet says so ("${offPill.trim()}")`, duringCut === atCut && /no signal/i.test(offPill) && (await queued(page2)) + duringCut >= 11, `${atCut} → ${duringCut}, ${await queued(page2)} on the tablet`);
  await context.setOffline(false);
  const done = await until(async () => ((await arrivedNow()) >= 11 ? await arrivedNow() : null), 240000, 1000);
  check("3c network back: the upload resumed by itself and all 11 files arrived", done === 11, String(await arrivedNow()));
  const rows = await sql("select item_key, kind, uploaded_by from public.inspection_media where inspection_id = $1 and removed_at is null order by item_key", [inspectionId]);
  for (const r of rows) made.push(r);
  const byItem = Object.fromEntries(PHOTO_PLAN.map(([k]) => [k, rows.filter((r) => r.item_key === k && r.kind === "photo").length]));
  const videoRow = rows.filter((r) => r.kind === "video" && r.item_key === videoItem.item_key).length;
  check("3d each file on the right item: tyres 3 / 3 / 2 / 2 photos and the video on its item", PHOTO_PLAN.every(([k, c]) => byItem[k] === c) && videoRow === 1, JSON.stringify({ byItem, videoRow }));
  check("3e every file recorded under the technician who took it, never the one signed in now", rows.length === 11 && rows.every((r) => r.uploaded_by === technicianId), JSON.stringify(rows.map((r) => r.uploaded_by === technicianId)));
  const pend = await one("select count(*) filter (where arrived_at is null and removed_at is null)::int open, count(*) filter (where arrived_at is not null)::int arrived from public.upload_pending where inspection_id = $1", [inspectionId]);
  check("3f the server's list shows every file arrived, nothing left on the way", pend?.open === 0 && pend?.arrived === 11, JSON.stringify(pend));
  const left = await until(async () => ((await queued(page2)) === 0 ? 1 : null), 20000, 500);
  check("3g the tablet let every file go once the server had it", left === 1, String(await queued(page2)));

  /* 4. A file that cannot be sent: red, "Try again"; the report waits for it; the advisor hears after 15 minutes */
  await context.clearCookies();
  await context.addCookies([...(await loginCookiesById(technicianId)), deviceCookie]);
  const page3 = await context.newPage();
  page3.on("dialog", (d) => d.accept().catch(() => null));
  await page3.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
  await page3.waitForSelector('[data-media-where="tyre.fl"]', { timeout: 30000 });
  await sleep(1500);
  await context.setOffline(true);
  await page3.locator('[data-media-where="tyre.fl"] input[type=file]').first().setInputFiles({ name: "late.jpg", mimeType: "image/jpeg", buffer: photos[0] });
  await until(async () => ((await queued(page3)) === 1 ? 1 : null), 15000, 300);
  // Meanwhile the report was approved with a time BEFORE this photo: the place can never take it.
  await sql("update public.inspections set status = 'approved', submitted_at = now() - interval '1 hour', approved_at = now() - interval '1 hour', unlocked_until = null where id = $1", [inspectionId]);
  await context.setOffline(false);
  const red = await until(async () => ((await page3.locator('[data-media-where="tyre.fl"] [data-pending-state="stopped"]').count()) >= 1 ? 1 : null), 60000, 500);
  const retry = page3.locator('[data-media-where="tyre.fl"] [data-pending-line] [data-retry]');
  check("4a a file that cannot be sent shows red with \"Try again\"", red === 1 && /Try again/.test((await retry.first().textContent().catch(() => "")) ?? ""));
  check("4b it is not shown as attached (only the server's 3 tyre photos count)", (await page3.locator('[data-media-where="tyre.fl"] [data-inspection-thumb]').count()) === 3);
  await page3.locator('[data-media-where="tyre.fl"]').scrollIntoViewIfNeeded();
  await page3.screenshot({ path: path.join(PROOF, "2-failed-try-again-800.png") });
  const stoppedRow = await until(async () => { const r = await one("select id, state from public.upload_pending where inspection_id = $1 and arrived_at is null and removed_at is null", [inspectionId]); return r?.state === "stopped" ? r : null; }, 20000, 500);
  check("4c the server knows it could not be sent", stoppedRow?.state === "stopped", JSON.stringify(stoppedRow));
  // The job card as the owner: the report cannot go to the customer while it waits.
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await owner.addCookies(await (await import("./pw-lib.mjs")).loginCookies("owner"));
  const op = await owner.newPage();
  await op.goto(`${base}/jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
  const waitsLine = (await op.locator("[data-uploads-waiting]").first().textContent({ timeout: 20000 }).catch(() => "")) ?? "";
  const sendBtn = op.locator("[data-report-send]");
  check(`4d the job card says "${waitsLine.trim()}"`, /1 file still uploading from E2e Mech 3/.test(waitsLine));
  check("4e the report cannot go to the customer while its media is still on the way", (await sendBtn.count()) === 1 && (await sendBtn.isDisabled()) && /arrived/i.test((await op.locator("[data-report-waits]").textContent().catch(() => "")) ?? ""));
  await op.locator("[data-uploads-waiting]").first().scrollIntoViewIfNeeded().catch(() => null);
  await op.screenshot({ path: path.join(PROOF, "3-job-card-waits-1440.png") });
  // 15 minutes later (the row's time moved back): the advisor's bell.
  await sql("update public.upload_pending set created_at = now() - interval '16 minutes' where id = $1", [stoppedRow.id]);
  await sql("update public.jobs set advisor_id = coalesce(advisor_id, (select id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1)) where id = $1", [jobId]);
  const late = await api("/api/e2e/late-uploads", { jobIds: [jobId] });
  const bell = await one("select count(*)::int n, max(title) t from public.notifications where job_id = $1 and type = 'uploads_late'", [jobId]);
  check(`4f after 15 minutes the advisor is told ("${bell?.t ?? ""}")`, late.json?.told === 1 && bell?.n >= 1 && /not arrived after 15 minutes/.test(bell?.t ?? ""), JSON.stringify({ late: late.json, bell }));
  await owner.close();
  // Try again now that the report is open again: it arrives.
  await sql("update public.inspections set status = 'in_progress', approved_at = null, submitted_at = null where id = $1", [inspectionId]);
  // The tablet's idle lock may have signed out meanwhile (two minutes untouched): the technician opens the report again.
  await page3.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
  await page3.locator('[data-media-where="tyre.fl"] [data-pending-line] [data-retry]').first().waitFor({ timeout: 30000 });
  await retry.first().click();
  const fourth = await until(async () => ((await one("select count(*)::int n from public.inspection_media where inspection_id = $1 and item_key = 'tyre.fl' and removed_at is null", [inspectionId]))?.n === 4 ? 1 : null), 60000, 1000);
  check("4g Try again: it arrives and only then shows as attached", fourth === 1 && (await until(async () => (await page3.locator('[data-media-where="tyre.fl"] [data-inspection-thumb]').count()) === 4 ? 1 : null, 20000, 500)) === 1);
} catch (e) {
  check("walked without a crash", false, String(e?.stack ?? e).slice(0, 600));
} finally {
  await browser?.close().catch(() => null);
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const paths = (await sql("select storage_path, poster_path from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id::text like '22222222-0000-4000-8000-00000000e%'")).flatMap((r) => [r.storage_path, r.poster_path]).filter(Boolean);
  if (paths.length) await admin.storage.from("inspection-media").remove(paths).catch(() => null);
  void made;
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
