// Uploads section 10 (31 October 2026) on the TEST database through the test server:
//  A. THE door (/api/uploads/*): the same file gets the same path on every try, a repeated register gives the same row,
//     a wrong type or another place's path is refused for good (permanent), and a sending permit works without a session.
//  B. The offline queue on the inspection screen: a photo picked with no signal stays on the device (IndexedDB), the page
//     is closed, the signal comes back, ANOTHER page sends it - recorded with the time it was taken, not the time it arrived.
//  C. Signed out before it was sent (the shared tablet's idle lock): it still arrives, under the person who took it.
//  D. A file the place can never take (the report was approved meanwhile): it stops with plain words and can be removed.
// The 200 MB slow-3G video is tests/browser/test-uploads-video.mjs (about 70 minutes). Pictures: tests/browser/shots/uploads/.
//   node --env-file=.env.test.local tests/browser/test-uploads.mjs        (npm run test:uploads)
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { api, base, browserForId, cleanupDb, cookieHeader, here, makeChecks, projectRoot, sql, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "uploads");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);
const one = async (q, p = []) => (await sql(q, p))[0] ?? null;
const until = async (fn, ms = 60000, every = 1000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(every); } return null; };
const PHOTO = fs.readFileSync(path.join(projectRoot, "public", "preview.jpg"));
const uuid = () => crypto.randomUUID();
const post = async (url, body, cookie) => {
  const r = await fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: "manual" });
  const t = await r.text();
  let json = {};
  try { json = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, json };
};
/** How many files wait in this page's queue (IndexedDB "erp-send-queue"). */
const queued = (page) => page.evaluate(() => new Promise((resolve) => {
  // No version: whatever version the page's queue made (2 since the bytes moved to their own store); none yet = 0.
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
}));

const made = [];
try {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, inspectionId, technicianId } = seed.json ?? {};
  // Step 1 (the scan report) is done, so the form is open - as after a real pre-scan.
  if (inspectionId) await sql("update public.inspections set scan_read_at = now() where id = $1", [inspectionId]);
  check("seed: an inspection in progress with its technician", !!inspectionId && !!technicianId, JSON.stringify(seed.json ?? seed.text ?? "").slice(0, 160));
  const techCookie = await cookieHeader(technicianId);

  /* A. The door */
  {
    const g = await post("/api/uploads/grant", { target: "inspection", scopeId: inspectionId, contentType: "image/jpeg" }, techCookie);
    check("A1 a sending permit for the technician's inspection", g.status === 200 && !!g.json.grant && g.json.staffId === technicianId, JSON.stringify({ status: g.status, staff: g.json.staffId, error: g.json.error }));
    const fileId = uuid();
    const p1 = await post("/api/uploads/prepare", { target: "inspection", scopeId: inspectionId, fileId, contentType: "image/jpeg", grant: g.json.grant });
    const p2 = await post("/api/uploads/prepare", { target: "inspection", scopeId: inspectionId, fileId, contentType: "image/jpeg", grant: g.json.grant });
    check("A2 the same file gets the same path on every try (with the permit, no session)", p1.status === 200 && p1.json.path === `${inspectionId}/${fileId}.jpg` && p2.json.path === p1.json.path, `${p1.json.path} / ${p2.json.path} ${p1.json.error ?? ""}`);
    const put = await fetch(p1.json.url, { method: "PUT", headers: { "content-type": "image/jpeg", "x-upsert": "false" }, body: PHOTO });
    made.push(["inspection-media", p1.json.path]);
    const p3 = await post("/api/uploads/prepare", { target: "inspection", scopeId: inspectionId, fileId, contentType: "image/jpeg", grant: g.json.grant });
    check("A3 once stored, prepare says it is already there (never sent twice)", put.ok && p3.json.exists === true, `put ${put.status} exists=${p3.json.exists}`);
    const reg = { target: "inspection", scopeId: inspectionId, path: p1.json.path, kind: "photo", itemKey: "tyre.fl", grant: g.json.grant, takenAt: Date.now() - 5 * 60_000 };
    const r1 = await post("/api/uploads/register", reg);
    const r2 = await post("/api/uploads/register", reg);
    const rows = await sql("select id, uploaded_by, taken_at from public.inspection_media where storage_path = $1", [p1.json.path]);
    check("A4 registering twice gives the same row, once", r1.status === 200 && r2.status === 200 && r1.json.id === r2.json.id && rows.length === 1, `${r1.json.id} / ${r2.json.id}, rows ${rows.length}`);
    check("A5 recorded under the technician, at the time it was taken (5 minutes ago)", rows[0]?.uploaded_by === technicianId && Math.abs(Date.parse(rows[0]?.taken_at) - reg.takenAt) < 5000, `${rows[0]?.uploaded_by} ${rows[0]?.taken_at}`);
    const heic = await post("/api/uploads/prepare", { target: "inspection", scopeId: inspectionId, fileId: uuid(), contentType: "image/heic", grant: g.json.grant });
    check("A6 a type the place cannot take is refused for good, in words", heic.status === 400 && heic.json.permanent === true && /not accepted/i.test(heic.json.error ?? ""), JSON.stringify(heic.json));
    const other = await post("/api/uploads/register", { ...reg, path: `${uuid()}/${uuid()}.jpg` });
    check("A7 another place's path is refused for good", other.status === 400 && other.json.permanent === true, JSON.stringify(other));
    const forged = await post("/api/uploads/prepare", { target: "inspection", scopeId: inspectionId, fileId: uuid(), contentType: "image/jpeg", grant: `${g.json.grant.slice(0, -4)}AAAA` });
    check("A8 a forged permit without a session waits for a sign-in (never accepted)", forged.status === 401 && forged.json.permanent === false, JSON.stringify(forged));
    const wrongPlace = await post("/api/uploads/prepare", { target: "job_file", scopeId: jobId, fileId: uuid(), contentType: "image/jpeg", kind: "work_photo", grant: g.json.grant });
    check("A9 a permit for one place does not open another", wrongPlace.status === 401, JSON.stringify(wrongPlace));
  }

  /* B. Offline queue on the inspection screen */
  {
    const { browser, context, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 768 } });
    await page.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector('[data-media-where="tyre.fl"]', { timeout: 30000 });
    await context.setOffline(true);
    const pickedAt = Date.now();
    await page.locator('[data-media-where="tyre.fl"] input[type=file]').first().setInputFiles({ name: "tyre-fl.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    const kept = await until(async () => ((await queued(page)) === 1 ? 1 : null), 15000, 300);
    check("B1 picked with no signal: kept on the device (1 file in the queue)", kept === 1, String(await queued(page)));
    const pill = page.locator("[data-send-queue-pill]");
    await pill.waitFor({ timeout: 15000 }).catch(() => null);
    const pillText = (await pill.textContent().catch(() => "")) ?? "";
    check("B2 the screen says it is on the device, waiting for signal", /saved on this device|waiting to send|no signal/i.test(pillText), pillText);
    await page.locator('[data-media-where="tyre.fl"]').first().scrollIntoViewIfNeeded().catch(() => null);
    await page.screenshot({ path: shot("B-offline-1024.png") });
    const before = await one("select count(*)::int as n from public.inspection_media where inspection_id = $1 and item_key = 'tyre.fl'", [inspectionId]);
    await page.close();
    await context.setOffline(false);
    // Another page of the ERP sends it (the tab with the inspection is closed).
    const page2 = await context.newPage();
    await page2.goto(`${base}/my-jobs`, { waitUntil: "load", timeout: 60000 });
    const arrived = await until(async () => {
      const r = await one("select count(*)::int as n, max(taken_at) as t, max(storage_path) as p from public.inspection_media where inspection_id = $1 and item_key = 'tyre.fl'", [inspectionId]);
      return r && r.n > (before?.n ?? 0) ? r : null;
    }, 90000);
    check("B3 the signal came back: another page sent it, recorded on the tyre", !!arrived, JSON.stringify(arrived));
    if (arrived) made.push(["inspection-media", arrived.p]);
    check("B4 recorded with the time it was picked, not the time it arrived", !!arrived && Math.abs(Date.parse(arrived.t) - pickedAt) < 20000, arrived ? `${new Date(arrived.t).toISOString()} vs picked ${new Date(pickedAt).toISOString()}` : "");
    const gone = await until(async () => ((await queued(page2)) === 0 ? 1 : null), 20000, 500);
    check("B5 the device let it go once the server had it", gone === 1, String(await queued(page2)));
    await page2.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
    await page2.waitForSelector('[data-media-where="tyre.fl"] [data-inspection-thumb]', { timeout: 30000 }).catch(() => null);
    check("B6 the photo shows on the inspection after the reload", (await page2.locator('[data-media-where="tyre.fl"] [data-inspection-thumb]').count()) >= 1);
    await page2.screenshot({ path: shot("B-sent-1024.png") });
    await browser.close();
  }

  /* C. Signed out before it was sent */
  {
    const { browser, context, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 768 } });
    await page.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector('[data-media-where="tyre.rl"]', { timeout: 30000 });
    await sleep(1500); // the screen asks for its sending permit when it opens
    await context.setOffline(true);
    const before = await one("select count(*)::int as n from public.inspection_media where inspection_id = $1 and item_key = 'tyre.rl'", [inspectionId]);
    await page.locator('[data-media-where="tyre.rl"] input[type=file]').first().setInputFiles({ name: "tyre-rl.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    await until(async () => ((await queued(page)) >= 1 ? 1 : null), 15000, 300);
    await page.close();
    await context.clearCookies();
    await context.setOffline(false);
    const page2 = await context.newPage();
    await page2.goto(`${base}/login`, { waitUntil: "load", timeout: 60000 });
    const arrived = await until(async () => {
      const r = await one("select count(*)::int as n, max(storage_path) as p, (array_agg(uploaded_by order by created_at desc))[1] as by from public.inspection_media where inspection_id = $1 and item_key = 'tyre.rl'", [inspectionId]);
      return r && r.n > (before?.n ?? 0) ? r : null;
    }, 90000);
    if (arrived) made.push(["inspection-media", arrived.p]);
    check("C1 signed out (idle lock) before it was sent: it arrived from the sign-in page, under the technician", !!arrived && arrived.by === technicianId, JSON.stringify(arrived));
    await browser.close();
  }

  /* D. A file the place can no longer take */
  {
    const { browser, context, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 768 } });
    await page.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector('[data-media-where="tyre.rr"]', { timeout: 30000 });
    await sleep(1500);
    await context.setOffline(true);
    await page.locator('[data-media-where="tyre.rr"] input[type=file]').first().setInputFiles({ name: "tyre-rr.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    await until(async () => ((await queued(page)) >= 1 ? 1 : null), 15000, 300);
    // Meanwhile the manager approved the report: the technician's photo, taken after... wait - taken BEFORE, so it is late
    // but welcome. To make one the place can never take, the report is approved with an approval time BEFORE the photo.
    await sql("update public.inspections set status = 'approved', submitted_at = now() - interval '1 hour', approved_at = now() - interval '1 hour', unlocked_until = null where id = $1", [inspectionId]);
    await context.setOffline(false);
    const stopped = await until(async () => ((await page.locator('[data-send-queue-pill]').getAttribute("class").catch(() => "")) ?? "").includes("bg-red") ? 1 : null, 60000, 500);
    const pillText = (await page.locator("[data-send-queue-pill]").textContent().catch(() => "")) ?? "";
    check("D1 the photo the approved report can no longer take stops (red), never retried for ever", stopped === 1 && /could not be sent/i.test(pillText), pillText);
    await page.locator("[data-send-queue-pill]").click();
    const words = (await page.locator('[data-send-queue-row] span.text-red').first().textContent().catch(() => "")) ?? "";
    check("D2 it says why, in plain words", /approved and locked/i.test(words), words);
    await page.screenshot({ path: shot("D-stopped-1024.png") });
    // The "Remove this file?" question is answered Yes by pw-lib's own dialog handler.
    await page.locator("[data-send-queue-remove]").first().click();
    const removed = await until(async () => ((await queued(page)) === 0 ? 1 : null), 15000, 300);
    check("D3 Remove takes it off the device", removed === 1);
    await browser.close();
  }

  /* E. A big file goes in resumable pieces through the signed resumable endpoint (the quick version of the 200 MB test) */
  {
    await sql("update public.inspections set status = 'in_progress', submitted_at = null, approved_at = null where id = $1", [inspectionId]);
    const item = await one("select item_key from public.inspection_items where inspection_id = $1 and style = 'grade' and item_key not ilike '%pad%' and item_key not ilike '%tyre%' order by position limit 1", [inspectionId]);
    await sql("update public.inspection_items set status = 'bad', remarks = 'video check' where inspection_id = $1 and item_key = $2", [inspectionId, item.item_key]);
    const { browser, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 768 } });
    const pieces = [];
    const singles = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/upload/resumable/sign")) pieces.push(Number(r.headers()["upload-offset"] ?? -1));
      if (r.method() === "PUT" && r.url().includes("/object/upload/sign/") && r.url().endsWith(".mp4")) singles.push(r.url());
    });
    await page.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
    const where = page.locator(`[data-media-where="${item.item_key}"]`).first();
    await where.waitFor({ timeout: 30000 });
    await sleep(1500);
    const big = Buffer.concat([Buffer.from("0000001866747970697336d000000000697336d0", "hex"), randomBytes(13 * 1024 * 1024)]);
    await where.locator('input[type=file][accept^="video"]').setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: big });
    const row = await until(async () => one("select id, storage_path from public.inspection_media where inspection_id = $1 and item_key = $2 and kind = 'video' order by created_at desc limit 1", [inspectionId, item.item_key]), 120000, 1000);
    if (row) made.push(["inspection-media", row.storage_path]);
    check("E1 a 13 MB video arrived and is recorded on its item", !!row, JSON.stringify(row));
    check("E2 it went in resumable 6 MB pieces through the signed resumable endpoint (never one big send)", pieces.length >= 3 && singles.length === 0 && pieces[0] === 0, `${pieces.length} pieces at ${pieces.map((p) => Math.round(p / 1024 / 1024)).join("/")} MB, ${singles.length} single sends`);
    if (row) {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data } = await admin.storage.from("inspection-media").list(inspectionId, { search: row.storage_path.split("/")[1], limit: 1 });
      check("E3 the stored video is whole, to the byte", Number(data?.[0]?.metadata?.size ?? 0) === big.length, `${data?.[0]?.metadata?.size} of ${big.length}`);
    }
    await browser.close();
  }
} catch (e) {
  check("walked without a crash", false, String(e?.stack ?? e).slice(0, 500));
} finally {
  // Files this test put in TEST storage, then every e2e row.
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  for (const [bucket, p] of made) if (p) await admin.storage.from(bucket).remove([p]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
