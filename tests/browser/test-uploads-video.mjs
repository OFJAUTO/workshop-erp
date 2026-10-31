// Uploads section 10.2 (31 October 2026): a 200 MB inspection video on slow 3G (400 kbit/s, 400 ms), sent straight to
// storage in resumable 6 MB pieces, with the signal cut for a minute part-way: it must carry on from where it stopped
// (never start again from zero) and arrive whole. On the TEST database through the test server; about 70 minutes.
//   node --env-file=.env.test.local tests/browser/test-uploads-video.mjs        (npm run test:uploads-video)
//   VIDEO=<path to a big file> (default: the scratchpad's video-200mb.mp4, made by the test if missing)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { api, base, browserForId, cleanupDb, here, makeChecks, sql, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "uploads");
fs.mkdirSync(SHOTS, { recursive: true });
const MB = 1024 * 1024;
const SLOW_3G = { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 };
const one = async (q, p = []) => (await sql(q, p))[0] ?? null;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let file = process.env.VIDEO;
if (!file) {
  file = path.join(os.tmpdir(), "erp-video-200mb.mp4");
  if (!fs.existsSync(file) || fs.statSync(file).size < 200 * MB) {
    const fd = fs.openSync(file, "w");
    const chunk = crypto.randomBytes(MB);
    fs.writeSync(fd, Buffer.from("0000001866747970697336d000000000697336d0", "hex"));
    for (let i = 0; i < 200; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
  }
}
const size = fs.statSync(file).size;
let storagePath = null;
const t0 = Date.now();
try {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, inspectionId, technicianId } = seed.json ?? {};
  // Step 1 (the scan report) is done, so the form is open - as after a real pre-scan.
  if (inspectionId) await sql("update public.inspections set scan_read_at = now() where id = $1", [inspectionId]);
  const item = await one("select item_key, item_label from public.inspection_items where inspection_id = $1 and style = 'grade' and item_key not ilike '%pad%' and item_key not ilike '%tyre%' order by position limit 1", [inspectionId]);
  await sql("update public.inspection_items set status = 'bad', remarks = 'video test' where inspection_id = $1 and item_key = $2", [inspectionId, item.item_key]);
  check("seed: an inspection with one Bad item to film", !!item, item?.item_label ?? "");

  const { browser, context, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 768 } });
  await page.goto(`${base}/my-jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
  const where = page.locator(`[data-media-where="${item.item_key}"]`).first();
  await where.waitFor({ timeout: 30000 });
  await sleep(1500); // the permit for the inspection
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
  const patches = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/upload/resumable")) patches.push({ at: Date.now(), offset: Number(r.headers()["upload-offset"] ?? -1) });
  });
  const singlePut = { n: 0 };
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/object/upload/sign/")) singlePut.n++; });
  log(`sending ${(size / MB).toFixed(1)} MB on slow 3G (400 kbit/s)…`);
  await where.locator('input[type=file][accept^="video"]').setInputFiles(file);

  // Cut the signal for a minute once about a third has gone.
  let cut = null;
  const maxOffset = () => patches.reduce((m, p) => Math.max(m, p.offset), 0);
  while (Date.now() - t0 < 30 * 60_000 && maxOffset() < size / 3) await sleep(5000);
  if (maxOffset() >= size / 3) {
    cut = { before: maxOffset(), at: Date.now() };
    log(`cutting the signal at ${(cut.before / MB).toFixed(0)} MB for 60 s`);
    await cdp.send("Network.emulateNetworkConditions", { ...SLOW_3G, offline: true });
    await sleep(60_000);
    await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
    log("signal back");
  }

  // Wait for the server's record (up to two and a half hours).
  let row = null;
  let lastLog = 0;
  while (Date.now() - t0 < 150 * 60_000) {
    row = await one("select id, storage_path, duration_s, uploaded_by from public.inspection_media where inspection_id = $1 and item_key = $2 and kind = 'video' order by created_at desc limit 1", [inspectionId, item.item_key]);
    if (row) break;
    if (Date.now() - lastLog > 5 * 60_000) { lastLog = Date.now(); log(`… ${(maxOffset() / MB).toFixed(0)} of ${(size / MB).toFixed(0)} MB, ${patches.length} pieces`); }
    await sleep(20_000);
  }
  storagePath = row?.storage_path ?? null;
  const minutes = ((Date.now() - t0) / 60_000).toFixed(1);
  check(`the 200 MB video arrived and is recorded on "${item.item_label}" (${minutes} min on slow 3G)`, !!row && row.uploaded_by === technicianId, JSON.stringify(row));
  check("it went in resumable pieces, never one big request", patches.length >= Math.floor(size / (6 * MB)) && singlePut.n === 0, `${patches.length} pieces, ${singlePut.n} single sends`);
  if (cut) {
    const after = patches.filter((p) => p.at > cut.at + 60_000);
    const firstAfter = after.length ? Math.min(...after.map((p) => p.offset)) : -1;
    check("after the signal came back it carried on from where it stopped (not from zero)", firstAfter > 0 && firstAfter >= cut.before - 6 * MB, `stopped at ${(cut.before / MB).toFixed(1)} MB, carried on at ${(firstAfter / MB).toFixed(1)} MB`);
  } else {
    check("the signal was cut part-way", false, "the upload did not reach a third within 30 minutes");
  }
  if (storagePath) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const folder = storagePath.slice(0, storagePath.lastIndexOf("/"));
    const name = storagePath.slice(storagePath.lastIndexOf("/") + 1);
    const { data } = await admin.storage.from("inspection-media").list(folder, { search: name, limit: 1 });
    const stored = Number(data?.[0]?.metadata?.size ?? 0);
    check("the stored video is whole (the same size, to the byte)", stored === size, `${stored} of ${size} bytes`);
  }
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.reload({ waitUntil: "load" });
  await where.waitFor({ timeout: 30000 }).catch(() => null);
  await where.scrollIntoViewIfNeeded().catch(() => null);
  await page.screenshot({ path: path.join(SHOTS, "video-200mb-arrived-1024.png") });
  fs.writeFileSync(path.join(SHOTS, "video-200mb-pieces.json"), JSON.stringify({ size, minutes, cut, pieces: patches }, null, 1));
  await browser.close();
} catch (e) {
  check("walked without a crash", false, String(e?.stack ?? e).slice(0, 500));
} finally {
  if (storagePath) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await admin.storage.from("inspection-media").remove([storagePath]).catch(() => null);
  }
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
