// 30 October 2026: the recovery driver's photo did not send ("It did not go through" every time on an Android phone).
// Cause: the page sent the full-size photo through a server function and Vercel refuses any request above 4.5 MB
// (413 FUNCTION_PAYLOAD_TOO_LARGE) before our code runs. Now one shared uploader: shrunk on the phone, straight to
// storage, kept on the phone until OFJ has it.
//  A  an Android phone (412x915): the driver sees the customer's name with Call and WhatsApp, the address and the map.
//  B  a 12 MB photo on slow 3G: "Car loaded" goes through, the photo stored at about 0.5 MB.
//  C  offline: "Saved – will send when the signal is back (1 waiting)" in amber; the page closed and opened again while
//     it waits; back online it arrives by itself (Delivered to OFJ, the price).
//  D  the trip finished: the page shows nothing about the customer.
//  E  the failure is in the owner's upload log with its reason.
//  F  the office's backup: Car loaded and Delivered to OFJ with a photo, from the Recovery page.
//   E2E_BASE=http://localhost:3104 node --env-file=.env.local tests/browser/test-driveupload.mjs
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { base, browserFor, cleanupDb, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "driveupload");
fs.mkdirSync(SHOTS, { recursive: true });
const EDGE = process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const until = async (fn, tries = 120, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 14 * 60 * 1000).unref();

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const make = (await sql("select id from public.vehicle_makes where is_active order by name limit 1"))[0].id;
const maxJ = Number((await sql("select coalesce(max(substring(job_number from 3)::int), 0) as n from public.jobs where job_number ~ '^J-[0-9]+$'"))[0].n);
const madeTrips = [];
async function finish() {
  if (madeTrips.length) {
    await sql("delete from public.upload_failures where kind = 'recovery_photo' and extra->>'trip_id' = any($1::text[])", [madeTrips]);
    // The photos the test sent to storage go too (the trips themselves go with the clean-up SQL: driver "E2e …").
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    for (const id of madeTrips) {
      const { data } = await admin.storage.from("job-files").list("recovery", { search: id, limit: 50 });
      const names = (data ?? []).map((o) => `recovery/${o.name}`);
      if (names.length) await admin.storage.from("job-files").remove(names);
      console.log(`storage: removed ${names.length} test photo(s) of trip ${id.slice(0, 8)}`);
    }
  }
  cleanupDb();
  await sql("select setval('public.job_number_seq', greatest(1, coalesce((select max(substring(job_number from 3)::int) from public.jobs where job_number ~ '^J-[0-9]+$'), 1)))");
  await sql("select setval('public.customer_number_seq', greatest(1, coalesce((select max(substring(customer_number from 3)::int) from public.customers where customer_number ~ '^C-[0-9]+$'), 1)))");
  console.log(`numbering back (J max ${maxJ} before the run)`);
}

/** A real JPEG of at least 12 MB, made in the browser (noise compresses badly, like a busy street photo at full size). */
async function bigJpeg(browser) {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    for (const [w, h, q] of [[4000, 3000, 0.97], [5000, 3750, 0.97], [6000, 4500, 0.98]]) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 300px sans-serif";
      ctx.fillText("DUBAI E2E 99", 200, 600);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      if (blob.size >= 12 * 1024 * 1024) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(s);
      }
    }
    return null;
  });
  await page.close();
  return Buffer.from(b64, "base64");
}

try {
  cleanupDb();
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e Driver Customer', '+971500000097') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id) values ($1, true, 'UAE', 'Dubai', 'E', '99977', $2) returning id", [cust, make]))[0].id;
  const job = (await sql("insert into public.jobs (vehicle_id, customer_id, department, status, stage, gated_in_by, advisor_id) values ($1, $2, 'mechanical', 'gate_in_pending', 'gate_in', $3, $3) returning id, job_number", [car, cust, owner]))[0];
  const trip = (await sql("insert into public.recovery_trips (job_id, kind, driver_name, driver_phone, token, location_details, location_url, scheduled_date, status, created_by, updated_by) values ($1, 'pickup', 'E2e Driver', '+971500000098', 'e2etrip' || md5(random()::text), 'E2e Villa 2, Al Barari', 'https://maps.google.com/maps?q=25.100362,55.320000', current_date, 'open', $2, $2) returning id, token", [job.id, owner]))[0];
  madeTrips.push(trip.id);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const big = await bigJpeg(browser);
  check(`the test photo is a real JPEG of ${(big.length / 1048576).toFixed(1)} MB (at least 12 MB)`, big.length >= 12 * 1024 * 1024);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA, deviceScaleFactor: 2 });
  let page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  /* ---------------- A ---------------- */
  await page.goto(`${base}/drive/${trip.token}`, { waitUntil: "load", timeout: 60000 });
  const contact = page.locator("[data-drive-contact]");
  check("A the driver sees the customer's name with [Call] and [WhatsApp], the address and the map", /E2e Driver Customer/i.test(await text(contact)) && (await contact.locator("[data-drive-call]").getAttribute("href")) === "tel:+971500000097" && (await contact.locator("[data-drive-whatsapp]").getAttribute("href")) === "https://wa.me/971500000097" && /Al Barari/.test(await text(contact)) && (await contact.locator("[data-drive-map]").count()) === 1, await text(contact));
  await page.screenshot({ path: path.join(SHOTS, "A-driver-contact-412x915.png"), fullPage: true });

  /* ---------------- B ---------------- */
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((400 * 1024) / 8) });
  await page.locator("[data-drive-file]").setInputFiles({ name: "IMG_20261030_114612.jpg", mimeType: "image/jpeg", buffer: big });
  const t0 = Date.now();
  await page.locator("[data-drive-send]").click();
  await page.screenshot({ path: path.join(SHOTS, "B-sending-slow-3g-412x915.png"), fullPage: true });
  const loaded = await until(async () => (await sql("select loaded_at, loaded_photo_path from public.recovery_trips where id = $1", [trip.id]))[0]?.loaded_at ? (await sql("select loaded_photo_path from public.recovery_trips where id = $1", [trip.id]))[0] : null, 180, 500);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const objName = loaded?.loaded_photo_path?.slice("recovery/".length) ?? "";
  const obj = objName ? (await sql("select (metadata->>'size')::bigint as size from storage.objects where bucket_id = 'job-files' and name = $1", [loaded.loaded_photo_path]))[0] : null;
  check(`B a ${(big.length / 1048576).toFixed(1)} MB photo on slow 3G: "Car loaded" went through in ${secs} s, stored at ${obj ? (Number(obj.size) / 1024).toFixed(0) : "?"} KB`, !!loaded && !!obj && Number(obj.size) < 1.5 * 1024 * 1024, JSON.stringify(loaded));
  check("B the page moved on to step 2 (Delivered to OFJ)", /1 · Car loaded ✓/.test(await text(page.locator("[data-drive-steps]"))));
  await page.screenshot({ path: path.join(SHOTS, "B-loaded-412x915.png"), fullPage: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* ---------------- C ---------------- */
  await ctx.setOffline(true);
  await page.locator("[data-drive-file]").setInputFiles({ name: "IMG_20261030_120102.jpg", mimeType: "image/jpeg", buffer: big });
  await page.locator("[data-drive-price]").fill("350");
  await page.locator("[data-drive-send]").click();
  const amber = page.locator('[data-drive-waiting="1"]');
  await amber.waitFor({ timeout: 30000 }).catch(() => null);
  check('C offline: amber "Saved – will send when the signal is back (1 waiting)" with "No internet – will retry automatically"', /Saved – will send when the signal is back \(1 waiting\)/.test(await text(amber)) && /No internet – will retry automatically/.test(await text(amber)), await text(amber));
  await page.screenshot({ path: path.join(SHOTS, "C-offline-saved-412x915.png"), fullPage: true });
  // The page is closed while the photo waits, and opened again with the signal back but OFJ not reachable yet.
  await page.close();
  await ctx.setOffline(false);
  await ctx.route("**/api/drive/*/prepare", (r) => r.abort());
  page = await ctx.newPage();
  await page.goto(`${base}/drive/${trip.token}`, { waitUntil: "load", timeout: 60000 });
  const again = page.locator('[data-drive-waiting="1"]');
  await again.waitFor({ timeout: 30000 }).catch(() => null);
  check("C the page closed and opened again: the photo is still waiting on the phone (1 waiting)", /\(1 waiting\)/.test(await text(again)));
  await page.screenshot({ path: path.join(SHOTS, "C-reopened-still-waiting-412x915.png"), fullPage: true });
  await ctx.unroute("**/api/drive/*/prepare");
  const doneEl = page.locator("[data-drive-done]");
  await doneEl.waitFor({ timeout: 45000 }).catch(() => null);
  const final = (await sql("select delivered_at, price_aed, photo_path from public.recovery_trips where id = $1", [trip.id]))[0];
  check("C back online: it arrived by itself - Delivered to OFJ, AED 350, the photo", (await doneEl.count()) === 1 && !!final.delivered_at && Number(final.price_aed) === 350 && !!final.photo_path, JSON.stringify(final));
  await page.screenshot({ path: path.join(SHOTS, "C-arrived-412x915.png"), fullPage: true });

  /* ---------------- D ---------------- */
  await page.goto(`${base}/drive/${trip.token}`, { waitUntil: "load" });
  const body = (await page.textContent("body")) ?? "";
  check("D the trip finished: \"Done. Thank you!\" and nothing about the customer (no name, no phone, no address)", /Done\. Thank you!/.test(body) && !/E2e Driver Customer/i.test(body) && !/500000097/.test(body) && !/Al Barari/.test(body) && (await page.locator("[data-drive-contact]").count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, "D-finished-412x915.png"), fullPage: true });

  /* ---------------- E ---------------- */
  const logs = await sql("select step, error from public.upload_failures where kind = 'recovery_photo' and extra->>'trip_id' = $1 order by created_at", [trip.id]);
  check("E the failure is in the owner's upload log with its reason (written once the signal was back)", logs.some((l) => /^offline:/.test(l.error)), JSON.stringify(logs));
  await ctx.close();

  /* ---------------- F ---------------- */
  const trip2 = (await sql("insert into public.recovery_trips (job_id, kind, driver_name, token, location_details, scheduled_date, status, created_by, updated_by) values ($1, 'pickup', 'E2e Driver', 'e2etrip' || md5(random()::text), 'E2e office backup', current_date, 'open', $2, $2) returning id", [job.id, owner]))[0];
  madeTrips.push(trip2.id);
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await op.goto(`${base}/recovery`, { waitUntil: "load", timeout: 60000 });
  const box = op.locator(`[data-trip-office="${trip2.id}"]`);
  await box.locator("summary").click();
  await box.locator("[data-office-loaded]").click();
  await box.locator("[data-office-photo]").setInputFiles({ name: "from-whatsapp.jpg", mimeType: "image/jpeg", buffer: big });
  await box.locator("[data-office-confirm]").click();
  const off = await until(async () => { const r = (await sql("select loaded_at, loaded_photo_path from public.recovery_trips where id = $1", [trip2.id]))[0]; return r?.loaded_at && r.loaded_photo_path ? r : null; }, 120, 500);
  check("F the office marks \"Car loaded\" for the driver, with the photo (shrunk, straight to storage)", !!off && off.loaded_photo_path.startsWith(`recovery/${trip2.id}-office-`), JSON.stringify(off));
  await op.screenshot({ path: path.join(SHOTS, "F-office-backup-1440.png") });
  await op.goto(`${base}/recovery`, { waitUntil: "load" });
  const box2 = op.locator(`[data-trip-office="${trip2.id}"]`);
  await box2.locator("summary").click();
  await box2.locator("[data-office-delivered]").click();
  await box2.locator("[data-office-confirm]").click();
  const off2 = await until(async () => { const r = (await sql("select delivered_at, marked_by from public.recovery_trips where id = $1", [trip2.id]))[0]; return r?.delivered_at ? r : null; }, 60, 500);
  check("F and \"Delivered to OFJ\" (marked by the office)", !!off2 && off2.marked_by === owner);
  await ob.close();
  await browser.close();
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
