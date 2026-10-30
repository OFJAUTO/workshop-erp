// Browser checks for the morning list of 13 October 2026: the gate-in button that names the missing items, the car
// picture's Uploading / Done / Retry states with the failure log, customer videos that arrive by themselves, the
// Parts table widths at 1366 and 1920, the categorised picker on the Parts desk, the price import (file, paste, totals,
// mapping, apply), part numbers kept off customer PDFs, and the Failed uploads page.
// Run against `npx next dev -p 3100`:
//   node --env-file=.env.test.local tests/browser/test-f.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

const JOB = "22222222-0000-4000-8000-00000000e303";
const PA = "22222222-0000-4000-8000-00000000e306";
const PR1 = "22222222-0000-4000-8000-00000000e309";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) pages.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  return pages.join("\n");
};
const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const waitStatus = (page, item, status) => until(async () => ((await page.locator(`[data-media-item="${item}"]`).first().getAttribute("data-media-status")) === status ? status : null), 80, 400);
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0]?.id;

/** Uploads a few bytes as a gate-in file through the real routes, as the owner. */
async function uploadMedia(jobId, kind, contentType, bytes) {
  const cookies = await cookieHeader("owner");
  const prep = await api("/api/media/prepare", { jobId, kind, contentType }, cookies);
  if (!prep.json?.url) throw new Error(`prepare failed: ${JSON.stringify(prep.json ?? prep.text)}`);
  const put = await fetch(prep.json.url, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "false", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, body: bytes });
  if (!put.ok) throw new Error(`put failed: ${put.status}`);
  const reg = await api("/api/media/register", { jobId, kind, path: prep.json.path }, cookies);
  if (!reg.json?.ok) throw new Error(`register failed: ${JSON.stringify(reg.json ?? reg.text)}`);
  return reg.json.checklist;
}

/* ---------------- B. Customer videos: "getting ready" slots that fill by themselves ---------------- */
let approvalToken = null;
await section("B customer videos", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const { jobId } = seed.json;
  // The seed arrives with a complete gate-in (legacy rows): re-kind them so nothing counts, and take the car's picture away.
  await sql("update public.gate_in_media set kind = 'gate_out_photo' where job_id = $1 and kind <> 'gate_out_photo'", [jobId]);
  await sql("update public.vehicles set photo_path = null where id = (select vehicle_id from public.jobs where id = $1)", [jobId]);
  approvalToken = `e2etok${Date.now()}`;
  await sql("insert into public.approval_requests (job_id, token, status, sent_to_phone, sent_to_name, terms_text, created_by) values ($1, $2, 'sent', '+971500000001', 'E2e Customer', 'Terms', $3)", [jobId, approvalToken, owner]);
  const bad = await fetch(`${base}/api/customer/media?t=nosuchtoken123456`);
  check("B: the media feed refuses a bad token", bad.status === 404);
  const feed = await (await fetch(`${base}/api/customer/media?t=${approvalToken}`)).json();
  check("B: the feed lists the two expected videos and none yet", Array.isArray(feed.expected) && feed.expected.length === 2 && Array.isArray(feed.videos) && feed.videos.length === 0 && feed.complete === false, JSON.stringify(feed).slice(0, 200));
  const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await go(page, `${base}/approve/${approvalToken}`);
  const slots = page.locator("[data-video-slot]");
  check("B: two video slots on the customer page", (await slots.count()) === 2);
  const states = await slots.evaluateAll((els) => els.map((e) => e.getAttribute("data-video-state")));
  check("B: both slots say the video is getting ready", states.every((s) => s === "waiting"), states.join("|"));
  check("B: the slot text is 'Video getting ready…', never an empty player", /Video getting ready/.test((await page.textContent("[data-customer-videos]")) ?? "") && (await page.locator("[data-customer-videos] video").count()) === 0);
  // The exterior video arrives from the phone: the slot becomes a player without a refresh.
  await uploadMedia(jobId, "video_exterior", "video/mp4", Buffer.from("not really a video but a stored file"));
  const ready = await until(async () => ((await page.locator('[data-video-slot="video_exterior"]').getAttribute("data-video-state")) === "ready" ? "ready" : null), 40, 500);
  check("B: the exterior slot swaps to the player by itself within seconds", ready === "ready");
  check("B: the interior slot still waits", (await page.locator('[data-video-slot="video_interior"]').getAttribute("data-video-state")) === "waiting");
  const v = page.locator('[data-video-slot="video_exterior"] video');
  check("B: the player is inline and muted with a Play overlay", (await v.count()) === 1 && (await v.getAttribute("playsinline")) !== null && (await v.evaluate((el) => el.muted)) === true && (await page.locator('[data-video-slot="video_exterior"] [data-play]').count()) === 1);
  const feed2 = await (await fetch(`${base}/api/customer/media?t=${approvalToken}`)).json();
  check("B: the feed now carries the exterior video with a fresh signed address", feed2.videos.length === 1 && /token=/.test(feed2.videos[0].url ?? ""));
  await browser.close();
});

/* ---------------- A. Gate-in: the button names what is missing; the car picture's states ---------------- */
await section("A gate-in missing items", async () => {
  const jobId = JOB;
  // The exterior video is in (B). Add the dashboard and keys front: left are the car picture, the interior video and keys back.
  for (const k of ["dashboard_photo", "keys_photo_front"]) await uploadMedia(jobId, k, "image/png", PNG);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/media`);
  const btn = page.locator("[data-finish-button]");
  check("A: the button names every missing item", (await btn.textContent())?.trim() === "3 items missing: car picture, interior video, keys back", await btn.textContent());
  check("A: the grey line reads 'n items left: names'", (await page.locator("[data-items-left]").textContent())?.trim() === "3 items left: car picture, interior video, keys back", await page.locator("[data-items-left]").textContent());
  check("A: nothing is red before the press", (await page.locator('[data-media-item="car_picture"] [data-car-tile].border-red-bar').count()) === 0);
  await btn.click();
  await sleep(400);
  check("A: pressing shows Go to next and Leave it for now under the button", (await page.locator("[data-finish-result]").count()) === 1 && /Go to next/.test((await page.locator("[data-finish-result]").textContent()) ?? "") && /Leave it for now/.test((await page.locator("[data-finish-result]").textContent()) ?? ""));
  check("A: the missing items turn red", (await page.locator('[data-media-item="car_picture"] [data-car-tile].border-red-bar').count()) === 1 && (await page.locator('[data-media-item="video_interior"].border-red-bar').count()) === 1 && (await page.locator('[data-media-item="keys_photo_back"] button.border-red-bar').count()) === 1);
  check("A: the done items stay green", (await page.locator('[data-media-item="video_exterior"].border-green').count()) === 1 && (await page.locator('[data-media-item="dashboard_photo"] button.border-green').count()) === 1);
  check("A: the grey line turned red", /text-red/.test((await page.locator("[data-items-left]").getAttribute("class")) ?? ""));
  // Finish the interior video and keys back: only the car picture is left.
  await uploadMedia(jobId, "video_interior", "video/mp4", Buffer.from("second stored file"));
  await uploadMedia(jobId, "keys_photo_back", "image/png", PNG);
  await go(page, `${base}/jobs/${jobId}/media`);
  check("A: one item left: 'Finish later: car picture missing'", (await page.locator("[data-finish-button]").textContent())?.trim() === "Finish later: car picture missing", await page.locator("[data-finish-button]").textContent());
  check("A: 'video pending' appears nowhere when no video is missing", !/video pending/i.test((await page.textContent("body")) ?? ""));
  await go(page, `${base}/jobs/${jobId}`);
  check("A: the job card button names the missing item too", /Finish gate-in: car picture missing/.test((await page.textContent("body")) ?? ""));

  // The car picture: preview, Uploading…, Done only when the server confirms.
  await go(page, `${base}/jobs/${jobId}/media`);
  const car = page.locator('[data-media-item="car_picture"]');
  await car.locator("[data-car-tile]").click();
  await sleep(300);
  check("A2: the crop panel opens with Take a photo and From gallery as real buttons", (await page.locator("[data-car-crop] [data-photo-button='camera']").count()) === 1 && (await page.locator("[data-car-crop] [data-photo-button='gallery']").count()) === 1);
  await page.locator("[data-car-crop] input[type=file][capture]").setInputFiles({ name: "car.png", mimeType: "image/png", buffer: PNG });
  await sleep(600);
  check("A2: the photo shows in the frame", (await page.locator("[data-car-crop] canvas").count()) === 1);
  // Closing without Use photo asks first.
  await page.locator("[data-car-crop]").getByRole("button", { name: "Cancel" }).click();
  await sleep(200);
  check("A2: closing the crop asks 'Use this photo as it is?'", (await page.locator("[data-ask-close]").count()) === 1 && /Use this photo as it is\?/.test((await page.locator("[data-ask-close]").textContent()) ?? ""));
  await page.locator("[data-ask-close]").getByRole("button", { name: "Keep framing" }).click();
  // A failed upload: the register step is cut off.
  await page.route("**/api/media/register", (r) => r.abort());
  await page.locator("[data-car-crop]").getByRole("button", { name: "Use photo" }).click();
  const failed = await waitStatus(page, "car_picture", "failed");
  check("A2: a cut-off upload shows red with the preview and Retry, never 'Waiting'", failed === "failed" && (await car.locator("[data-car-preview]").count()) === 1 && (await car.locator("[data-retry]").count()) === 1 && /border-red-bar/.test((await car.locator("[data-car-tile]").getAttribute("class")) ?? ""));
  const logged = await until(async () => (await sql("select step, error, user_agent, staff_id from public.upload_failures where job_id = $1 and kind = 'car_picture' order by created_at desc limit 1", [jobId]))[0] ?? null, 20, 500);
  check("A2: the failure is recorded with the step, the error, the person and the browser", !!logged && logged.step === "register" && !!logged.error && !!logged.user_agent && !!logged.staff_id, JSON.stringify(logged));
  await page.unroute("**/api/media/register");
  await car.locator("[data-retry]").click();
  const done = await waitStatus(page, "car_picture", "done");
  check("A2: Retry uploads and the item is Done only once the server confirms", done === "done" && (await car.locator("> button.border-green").count()) === 1);
  const rows = await sql("select count(*)::int as n from public.gate_in_media where job_id = $1 and kind = 'car_picture'", [jobId]);
  check("A2: one car picture recorded", rows[0]?.n === 1, JSON.stringify(rows));
  check("A2: the preview stays on the item after Done", (await car.locator("[data-car-preview]").count()) === 1);
  const after = await until(async () => ((await page.locator("[data-finish-button], [data-finish-gate-in] a").first().textContent())?.trim().startsWith("Open job card") ? "yes" : null), 30, 500);
  check("A2: with every item in, the header button becomes 'Open job card'", after === "yes");
  await browser.close();
});

/* ---------------- G. Inspection photo buttons are real buttons that work ---------------- */
await section("G inspection photo buttons", async () => {
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, inspectionId, technicianId } = seed.json;
  await sql("update public.inspections set scan_read_at = now(), status = 'in_progress' where id = $1", [inspectionId]);
  const { browser, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 1366 } });
  await go(page, `${base}/my-jobs/${jobId}`);
  const cams = page.locator("[data-inspection-media] [data-photo-button='camera']");
  check("G: '+ Photo' and '+ From gallery' are real buttons, none disabled", (await cams.count()) > 0 && (await page.locator("[data-inspection-media] [data-photo-button='gallery']").count()) > 0 && (await page.locator("[data-inspection-media] button[data-photo-button]:disabled").count()) === 0, `${await cams.count()} camera buttons`);
  check("G: the camera button opens the camera directly (capture) and the gallery button does not", (await page.locator("[data-inspection-media] input[type=file][capture='environment'][accept^='image']").count()) > 0 && (await page.locator("[data-inspection-media] input[type=file][multiple][accept^='image']:not([capture])").count()) > 0);
  const block = page.locator("[data-inspection-media]", { has: page.locator("input[type=file][multiple][accept^='image']:not([capture])") }).first();
  const before = (await sql("select count(*)::int as n from public.inspection_media where inspection_id = $1", [inspectionId]))[0]?.n ?? 0;
  await block.locator("input[type=file][multiple][accept^='image']:not([capture])").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PNG });
  const added = await until(async () => { const n = (await sql("select count(*)::int as n from public.inspection_media where inspection_id = $1", [inspectionId]))[0]?.n ?? 0; return n > before ? n : null; }, 40, 500);
  check("G: a gallery photo uploads and is recorded", added !== null, `${before} → ${added}`);
  check("G: the buttons come back after the upload", (await until(async () => ((await page.locator("[data-inspection-media] button[data-photo-button]:disabled").count()) === 0 ? "ok" : null), 20, 300)) === "ok");
  await browser.close();
});

/* ---------------- C. Parts table widths and the categorised picker ---------------- */
const fits = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const cs = getComputedStyle(el);
  const c = document.createElement("canvas").getContext("2d");
  c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = el.tagName === "SELECT" ? (el.options[el.selectedIndex]?.textContent ?? "") : el.value;
  const w = c.measureText(text).width;
  const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el.tagName === "SELECT" ? 22 : 0);
  return { text, w: Math.round(w), inner: Math.round(inner), ok: w <= inner };
});
const settled = async (row) => { for (let i = 0; i < 80; i++) { const t = (await row.locator("[data-row-tag]").textContent().catch(() => "")) ?? ""; if (t !== "Saving…") break; await sleep(250); } await sleep(400); };
await section("C parts widths and picker", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId } = seed.json;
  await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) values ('E2e Al Futtaim Auto Centre', 10, '{}'::jsonb, $1) on conflict do nothing", [owner]);
  for (const width of [1366, 1920]) {
    const { browser, page } = await browserFor("parts", { viewport: { width, height: 900 } });
    await go(page, `${base}/parts/${jobId}`);
    const row = page.locator(`[data-row-key="req:${PR1}"]`);
    const pn = row.locator("input[aria-label='Part number']");
    await pn.fill("ABCDEFGHIJK 1234567 89");
    await settled(row);
    const f = await fits(page, `[data-row-key="req:${PR1}"] input[aria-label='Part number']`);
    check(`C@${width}: a 22-character part number with spaces shows in full`, f.ok && f.text.length === 22, JSON.stringify(f));
    await pn.fill("A 222 320 04 38 80");
    await settled(row);
    const sup = row.locator("select[aria-label='Supplier']");
    const val = await sup.locator("option").evaluateAll((os) => (os.find((o) => /E2e Al Futtaim Auto Centre/.test(o.textContent ?? "")) ?? {}).value ?? "");
    await sup.focus();
    await sup.selectOption(val);
    await settled(row);
    const fs2 = await fits(page, `[data-row-key="req:${PR1}"] select[aria-label='Supplier']`);
    check(`C@${width}: the supplier dropdown shows 'E2e Al Futtaim Auto Centre' in full`, fs2.ok && fs2.text === "E2e Al Futtaim Auto Centre", JSON.stringify(fs2));
    if (width === 1920) {
      const oneLine = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      // Part, Qty, Part number, Type, List, Disc %, Net each, Supplier, Availability, Line total, menu
      check("C@1920: everything on one line (eleven columns)", oneLine === 11, `${oneLine} columns`);
    } else {
      const twoLines = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      // The same without Part number and Type, which take the second line
      check("C@1366: the part number and type take a second line (nine columns)", twoLines === 9, `${twoLines} columns`);
    }
    const fa = await fits(page, `[data-row-key="req:${PR1}"] select[aria-label='Availability']`);
    check(`C@${width}: the availability dropdown shows its text in full`, fa.ok, JSON.stringify(fa));
    const heights = await page.locator("[data-row-key]").evaluateAll((els) => els.map((e) => e.offsetHeight));
    check(`C@${width}: every row has the same height`, heights.length >= 2 && heights.every((h) => h === heights[0]), heights.join(","));
    // The Part column's own cap is 14 rem (224 px) on two lines and 16 rem (256 px) on one line; the name button sits
    // inside it after the tick box and the ✓, so it stays below the cap and never stretches across the table.
    const partCol = await row.locator("[data-part-name]").evaluate((el) => el.getBoundingClientRect().width);
    const partCap = width === 1920 ? 256 : 224;
    check(`C@${width}: the Part column stays within its cap (under ${partCap} px)`, partCol < partCap, `${Math.round(partCol)} px`);
    const strip = await row.evaluate((el) => { const s = el.closest(".overflow-x-auto"); return s ? { scroll: s.scrollWidth, client: s.clientWidth } : null; });
    check(`C@${width}: the whole table fits without scrolling sideways`, !!strip && strip.scroll <= strip.client, JSON.stringify(strip));
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `test-f-parts-${width}.png`), fullPage: false });
    await browser.close();
  }
  // The picker: rename with one tap, add several, custom names.
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const row = page.locator(`[data-row-key="req:${PR1}"]`);
  const heightBefore = await row.evaluate((el) => el.offsetHeight);
  await row.locator("[data-part-name]").click();
  await sleep(300);
  const picker = page.locator("[data-part-picker='rename']");
  check("C6: tapping the name opens the categorised picker in rename mode", (await picker.count()) === 1);
  const cats = await picker.locator("[data-categories] button").allTextContents();
  check("C6: categories on the left in the owner's order", ["Servicing", "Brakes", "Wheels and tyres", "Suspension and steering", "Engine", "Fuel and exhaust", "Cooling", "Air conditioning", "Transmission and driveline", "Electrical", "Other"].every((c) => cats.includes(c)) && cats.indexOf("Servicing") < cats.indexOf("Brakes") && cats.indexOf("Brakes") < cats.indexOf("Wheels and tyres"), cats.join("|"));
  check("C6: a search box on top and Custom part at the bottom", (await picker.locator("input[aria-label='Find a part']").count()) === 1 && (await picker.locator("[data-custom-part-button]").count()) === 1);
  await picker.locator("[data-categories] button[data-category='Suspension and steering']").click();
  await sleep(200);
  const first = picker.locator("[data-part-list] [data-part-row]").first();
  const newName = (await first.getAttribute("data-part-row")) ?? "";
  await first.locator("button").first().click();
  await sleep(300);
  check("C6: one tap picks the new name and closes the picker", (await page.locator("[data-part-picker]").count()) === 0 && (await row.locator("[data-part-name]").textContent())?.trim() === newName, `${newName} / ${await row.locator("[data-part-name]").textContent()}`);
  await settled(row);
  check("C6: the row keeps 'Technician wrote: rear brake discs'", /Technician wrote: rear brake discs/i.test((await row.locator("[data-status-line]").textContent()) ?? ""), await row.locator("[data-status-line]").textContent());
  const saved = await until(async () => (await sql("select description, original_description from public.part_items where part_request_id = $1 and is_active order by created_at desc limit 1", [PR1]))[0] ?? null, 30, 500);
  check("C6: the new name is saved with the technician's words kept", !!saved && saved.description.toLowerCase() === newName.toLowerCase() && /rear brake discs/i.test(saved.original_description ?? ""), JSON.stringify(saved));
  check("C6: a long name wraps inside the same row height", (await row.evaluate((el) => el.offsetHeight)) === heightBefore);
  // Add several from the picker, with a custom one.
  const rowsBefore = await page.locator("[data-row-key]").count();
  await page.locator("[data-add-part]").click();
  await sleep(300);
  const pick = page.locator("[data-part-picker='pick']");
  check("C6: '+ Add a part the technician did not list' opens the picker", (await pick.count()) === 1);
  await pick.locator("[data-categories] button[data-category='Servicing']").click();
  await sleep(200);
  const servicing = pick.locator("[data-part-list] [data-part-row]");
  const n1 = (await servicing.nth(0).getAttribute("data-part-row")) ?? "";
  const n2 = (await servicing.nth(1).getAttribute("data-part-row")) ?? "";
  await servicing.nth(0).locator("button").first().click();
  await servicing.nth(1).locator("button").first().click();
  await sleep(200);
  check("C6: tapped parts turn light green with a tick", (await pick.locator("[data-part-row].border-green").count()) === 2);
  await pick.locator("input[aria-label='Find a part']").fill("Zzz custom widget e2e");
  await sleep(200);
  check("C6: a search with no match offers to use the typed text as a custom part", /Use "Zzz custom widget e2e" as a custom part/.test((await pick.locator("[data-use-custom]").textContent()) ?? ""));
  await pick.locator("[data-use-custom]").click();
  await sleep(200);
  await pick.getByRole("button", { name: "Done" }).click();
  await sleep(400);
  check("C6: Done adds one row per picked part", (await page.locator("[data-row-key]").count()) === rowsBefore + 3, `${rowsBefore} → ${await page.locator("[data-row-key]").count()}`);
  const names = await page.locator("[data-row-key] [data-part-name]").allTextContents();
  check("C6: the picked names and the custom name are on the list", names.some((n) => n.trim() === n1) && names.some((n) => n.trim() === n2) && names.some((n) => /zzz custom widget e2e/i.test(n)), names.join("|"));
  const pool = await until(async () => { const s = (await sql("select value from public.settings where key = 'part_pool_custom'"))[0]?.value ?? {}; return s["Zzz custom widget e2e"] ? s : null; }, 20, 500);
  check("C6: a custom name is counted for the owner's pool", !!pool);
  await browser.close();
});

/* ---------------- D. Import prices ---------------- */
await section("D import prices", async () => {
  const jobId = JOB;
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  check("D: the Parts page has an Import prices button", (await page.locator("[data-import-prices]").count()) === 1);
  await go(page, `${base}/parts/${jobId}/import`);
  check("D: the import page offers Upload file, Paste from email and Upload screenshot", (await page.locator("[data-way='file']").count()) === 1 && (await page.locator("[data-way='paste']").count()) === 1 && (await page.locator("[data-way='image']").count()) === 1);
  // a) The B2BConnect spreadsheet.
  await page.locator("[data-file-input]").setInputFiles(path.join(projectRoot, "docs", "B2BConnect_Format_9.xlsx"));
  const lines = await until(async () => { const n = await page.locator("[data-import-line]").count(); return n ? n : null; }, 60, 500);
  check("D-a: the Mercedes file is recognised and its 98 lines read", lines === 98 && /Mercedes B2BConnect/.test((await page.locator("[data-check-screen]").textContent()) ?? ""), `${lines} lines`);
  const firstLine = (await page.locator("[data-import-line]").first().textContent()) ?? "";
  check("D-a: part numbers normalised to single spaces, net and 55% read", /N910105 012018/.test(firstLine) && /55%/.test(firstLine) && /1 × 32\.85 = 32\.85/.test(firstLine), firstLine.slice(0, 160));
  check("D-a: the file's VIN is compared with the car and a warning shown", (await page.locator("[data-vin-warning]").count()) === 1 && /WDDHF7HB3BA429944/.test((await page.locator("[data-vin-warning]").textContent()) ?? ""));
  check("D-a: no total in the file to check against", /No total in the file/.test((await page.locator("[data-totals-check]").textContent()) ?? ""));
  check("D-a: Apply is off until the lines are confirmed", await page.locator("[data-apply]").isDisabled());
  await page.locator("[data-confirm-all]").click();
  await sleep(200);
  check("D-a: with a VIN mismatch Apply stays off until the tick", await page.locator("[data-apply]").isDisabled());
  await page.getByRole("button", { name: "Start again" }).click();
  // b) Paste, one value per line (Land Rover).
  await page.locator("[data-way='paste']").click();
  await page.locator("[data-paste-box]").fill(fs.readFileSync(path.join(projectRoot, "docs", "landrover-paste-sample.txt"), "utf8"));
  await page.locator("[data-read-text]").click();
  const n2 = await until(async () => { const n = await page.locator("[data-import-line]").count(); return n ? n : null; }, 40, 500);
  check("D-b: the one-value-per-line paste gives 3 lines", n2 === 3 && /Land Rover/.test((await page.locator("[data-check-screen]").textContent()) ?? ""));
  check("D-b: the totals add up to the Gross Amount", /✓/.test((await page.locator("[data-totals-check]").textContent()) ?? "") && /11,853\.00/.test((await page.locator("[data-totals-check]").textContent()) ?? ""), await page.locator("[data-totals-check]").textContent());
  const texts = await page.locator("[data-import-line]").allTextContents();
  check("D-b: availability read as Same day, Next day and Supplier to confirm", /Same day/.test(texts[0]) && /Next day/.test(texts[1]) && /Supplier to confirm/.test(texts[2]), texts.map((t) => t.slice(0, 80)).join(" || "));
  const sel0 = page.locator("[data-import-line]").first().locator("[data-match-select]");
  check("D-b: 'FRONT BRAKE PAD SET' is matched to 'front brake pads' by name", (await sel0.inputValue()) === PA, await sel0.inputValue());
  const supplierSel = page.locator("[data-import-supplier]");
  const supVal = await supplierSel.locator("option").evaluateAll((os) => (os.find((o) => /E2e Al Futtaim Auto Centre/.test(o.textContent ?? "")) ?? {}).value ?? "");
  await supplierSel.selectOption(supVal);
  await page.locator("[data-confirm-all]").click();
  await sleep(200);
  check("D-b: Apply is on once the supplier is chosen and every line confirmed", !(await page.locator("[data-apply]").isDisabled()));
  await page.locator("[data-apply]").click();
  await page.waitForURL((u) => /\/parts\/.*message=/.test(u.toString()), { timeout: 60000 }).catch(() => null);
  check("D-b: Apply lands back on the Parts page with the count", /3 prices imported/.test(decodeURIComponent(page.url())), page.url());
  const pa = (await sql("select part_number, cost_aed, supplier, availability from public.part_items where id = $1", [PA]))[0];
  check("D-b: the matched part got the number, the net cost and the supplier", !!pa && pa.part_number === "LR123456" && Number(pa.cost_aed) === 7849 && /E2e Al Futtaim/.test(pa.supplier ?? "") && pa.availability === "to_order", JSON.stringify(pa));
  const disc = (await sql("select part_number, cost_aed, availability, delivery_date, description, part_type from public.part_items where job_id = $1 and part_number = 'LR098765'", [jobId]))[0];
  check("D-b: 'BRAKE DISC FRONT' (1 day) landed with Next day and genuine", !!disc && Number(disc.cost_aed) === 1250.5 && disc.availability === "to_order" && !!disc.delivery_date && disc.part_type === "genuine", JSON.stringify(disc));
  const sensor = (await sql("select part_number, cost_aed, availability from public.part_items where job_id = $1 and part_number = 'LR555111'", [jobId]))[0];
  check("D-b: 'will update' leaves the availability open (Supplier to confirm)", !!sensor && sensor.availability === null, JSON.stringify(sensor));
  // Totals mismatch (22 October 2026 safety lock): Apply stays locked even with every price confirmed, until Parts types why.
  await go(page, `${base}/parts/${jobId}/import`);
  await page.locator("[data-way='paste']").click();
  await page.locator("[data-paste-box]").fill(fs.readFileSync(path.join(projectRoot, "docs", "landrover-paste-sample-tabs.txt"), "utf8").replace("11,853.00", "11,000.00"));
  await page.locator("[data-read-text]").click();
  await until(async () => ((await page.locator("[data-import-line]").count()) ? 1 : null), 40, 500);
  check("D-tabs: the tab-separated paste reads 3 lines", (await page.locator("[data-import-line]").count()) === 3);
  check("D: 'Lines add up to … but the pasted text total is …' in red, no Confirm all, Apply locked", /Lines add up to AED 11,853 but the pasted text total is AED 11,000/.test((await page.locator("[data-totals-check]").textContent()) ?? "") && /text-red/.test((await page.locator("[data-totals-check]").getAttribute("class")) ?? "") && (await page.locator("[data-confirm-all]").count()) === 0 && (await page.locator("[data-apply]").isDisabled()), (await page.locator("[data-totals-check]").textContent()) ?? "");
  for (const b of await page.locator("[data-confirm-line]").all()) await b.click();
  await page.locator("[data-import-supplier]").selectOption(supVal);
  await sleep(200);
  check("D: confirming each price by hand still leaves Apply locked", await page.locator("[data-apply]").isDisabled());
  await page.locator("[data-totals-override-open]").click();
  await page.locator("[data-totals-override]").fill("E2e: the supplier's total leaves out one line");
  await sleep(200);
  check("D: the typed reason frees Apply", !(await page.locator("[data-apply]").isDisabled()));
  // d) Unknown format: the mapping step, saved for the supplier and reused.
  await page.getByRole("button", { name: "Start again" }).click();
  await page.locator("[data-paste-box]").fill("Ref#\tStuff\tPcs\tCharge\nX9\tE2e widget\t2\t10.00\nX8\tE2e gadget\t1\t5.50");
  await page.locator("[data-read-text]").click();
  await until(async () => ((await page.locator("[data-mapping-step]").count()) ? 1 : null), 40, 500);
  check("D-d: an unknown format offers the column mapping step", (await page.locator("[data-mapping-step]").count()) === 1);
  const selects = page.locator("[data-mapping-step] thead select");
  await selects.nth(1).selectOption("description");
  await selects.nth(3).selectOption("net");
  check("D-d: one Import button on the mapping screen", (await page.locator("[data-apply-mapping]").textContent())?.trim() === "Import");
  await page.locator("[data-apply-mapping]").click();
  await until(async () => ((await page.locator("[data-import-line]").count()) ? 1 : null), 40, 500);
  const mapped = await page.locator("[data-import-line]").allTextContents();
  check("D-d: Import reads the lines with the chosen meanings", mapped.length === 2 && /E2e widget/.test(mapped[0]) && /2 × 10\.00 = 20\.00/.test(mapped[0]), mapped.join(" || ").slice(0, 200));
  // Applying with a supplier chosen remembers the mapping for that supplier.
  await page.locator("[data-import-supplier]").selectOption(supVal);
  await page.locator("[data-confirm-all]").click();
  await page.locator("[data-apply]").click();
  await page.waitForURL((u) => /\/parts\/.*message=/.test(u.toString()), { timeout: 60000 }).catch(() => null);
  const mappingSaved = await until(async () => (await sql("select import_mapping from public.suppliers where id = $1", [supVal]))[0]?.import_mapping ?? null, 20, 500);
  check("D-d: the mapping is remembered on the supplier when applied", !!mappingSaved && mappingSaved.mapping?.net === 3 && mappingSaved.mapping?.description === 1, JSON.stringify(mappingSaved));
  await go(page, `${base}/parts/${jobId}/import`);
  await page.locator("[data-way='paste']").click();
  await page.locator("[data-paste-box]").fill("Ref#\tStuff\tPcs\tCharge\nX7\tE2e gizmo\t3\t7.00");
  await page.locator("[data-read-text]").click();
  await until(async () => ((await page.locator("[data-import-line]").count()) ? 1 : null), 40, 500);
  check("D-d: the second time the supplier's format is recognised by itself", (await page.locator("[data-mapping-step]").count()) === 0 && /saved mapping/.test((await page.locator("[data-check-screen]").textContent()) ?? ""));
  // c) Screenshots: off until the key exists, said plainly.
  await page.locator("[data-way='image']").click();
  await sleep(200);
  const imgText = (await page.textContent("[data-import-wizard]")) ?? "";
  check("D-c: the screenshot way says plainly whether it is switched on", /not switched on yet|Choose picture/.test(imgText));
  const ocr = await fetch(`${base}/api/import/ocr`, { method: "POST", headers: { cookie: await cookieHeader("parts") }, body: new FormData() });
  check("D-c: the reading route refuses without a picture or a key", ocr.status === 400 || ocr.status === 503);
  await browser.close();
});

/* ---------------- E. Part numbers off customer documents ---------------- */
await section("E no part numbers for customers", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { token } = seed.json;
  const r = await fetch(`${base}/api/pdf/quote/${token}`);
  check("E: the quotation PDF opens", r.ok && (r.headers.get("content-type") ?? "").includes("pdf"), String(r.status));
  if (r.ok) {
    const text = await pdfText(Buffer.from(await r.arrayBuffer()));
    check("E: the customer's quotation PDF shows no part number", !/pad-stage-1/i.test(text) && /front brake pads/i.test(text), text.replace(/\s+/g, " ").slice(0, 200));
  }
  const titles = await sql("select l.title from public.quotation_lines l join public.part_items p on p.id = l.part_item_id where p.part_number is not null and l.title like '% (' || p.part_number || ')' and p.id <> '22222222-0000-4000-8000-00000000e306'");
  check("E: no quotation line title carries a part number any more (data fix)", titles.length === 0, `${titles.length} left`);
});

/* ---------------- F. The owner's Failed uploads page ---------------- */
await section("F failed uploads page", async () => {
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/settings/uploads`);
  const rows = await page.locator("[data-failure-row]").count();
  const body = (await page.textContent("body")) ?? "";
  check("F: Settings > Failed uploads lists the recorded failure with its step", rows >= 1 && /Recording the file/.test(body) && /car picture/.test(body), `${rows} rows`);
  await go(page, `${base}/settings`);
  check("F: Settings links to Failed uploads", (await page.locator("a[href='/settings/uploads']").count()) === 1);
  await browser.close();
});

await sql("update public.settings set value = (value::jsonb - 'Zzz custom widget e2e') where key = 'part_pool_custom'");
cleanupDb();
const failed = summary();
process.exit(failed ? 1 : 0);
