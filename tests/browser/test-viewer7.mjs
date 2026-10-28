// Section 7 of 29 October 2026: tap a photo to enlarge, on the customer's approval page of a test car with real
// photos and a real video. At phone width (390 px, touch) and on a tablet:
//  - a tap opens THE viewer full screen on black with ✕, "n / N" and the item's name;
//  - double-tap and pinch zoom the PHOTO (the page keeps its size); a zoomed photo goes back on a second double-tap;
//  - swiping moves to the next photo (and on from one item to the next); swipe down and the phone's back button close;
//  - the video opens in the same viewer and plays, muted;
//  - the page shows small pictures (resized by Supabase), the viewer the sharp one; arrows/Escape on a computer.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-viewer7.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "viewer");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const until = async (fn, tries = 40, gap = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;

async function uploadMedia(jobId, kind, contentType, bytes) {
  const cookies = await cookieHeader("owner");
  const prep = await api("/api/media/prepare", { jobId, kind, contentType }, cookies);
  if (!prep.json?.url) throw new Error(`prepare failed: ${JSON.stringify(prep.json ?? prep.text)}`);
  const put = await fetch(prep.json.url, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "false", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, body: bytes });
  if (!put.ok) throw new Error(`put failed: ${put.status}`);
  const reg = await api("/api/media/register", { jobId, kind, path: prep.json.path }, cookies);
  if (!reg.json?.ok) throw new Error(`register failed: ${JSON.stringify(reg.json ?? reg.text)}`);
}

cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "assign" })).json;
const jobId = seed.jobId;
await sql("update public.gate_in_media set kind = 'gate_out_photo', is_active = false where job_id = $1", [jobId]);
const token = `e2eview${Date.now()}`;
await sql("insert into public.approval_requests (job_id, token, status, sent_to_phone, sent_to_name, terms_text, created_by) values ($1, $2, 'sent', '+971500000001', 'E2e Customer', 'Terms', $3)", [jobId, token, owner]);

// Real pictures and a real video, drawn in a browser.
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 800, height: 600 } });
  await go(page, `${base}/login`);
  const photo = async (text, hue) => Buffer.from(await page.evaluate(({ text, hue }) => {
    const c = document.createElement("canvas");
    c.width = 1600; c.height = 1200;
    const x = c.getContext("2d");
    x.fillStyle = `hsl(${hue},55%,40%)`; x.fillRect(0, 0, 1600, 1200);
    x.fillStyle = "#fff"; x.font = "bold 120px sans-serif"; x.fillText(text, 120, 640);
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsla(${(hue + i * 9) % 360},70%,70%,0.4)`; x.fillRect(40 * i, 40 * (i % 10), 30, 30); }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, { text, hue }), "base64");
  const video = async () => Buffer.from(await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 480; c.height = 270;
    const ctx = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    let f = 0;
    const draw = () => { ctx.fillStyle = `hsl(${(f * 9) % 360},65%,45%)`; ctx.fillRect(0, 0, 480, 270); ctx.fillStyle = "#fff"; ctx.font = "bold 34px sans-serif"; ctx.fillText(`WALK-AROUND ${f++}`, 30, 150); };
    draw();
    const timer = setInterval(draw, 66);
    rec.start(200);
    await new Promise((r) => setTimeout(r, 3000));
    rec.stop();
    await new Promise((r) => { rec.onstop = r; });
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
  }), "base64");
  await uploadMedia(jobId, "dashboard_photo", "image/jpeg", await photo("DASHBOARD", 210));
  for (const [i, hue] of [[1, 10], [2, 120], [3, 280]]) await uploadMedia(jobId, "damage_photo", "image/jpeg", await photo(`DAMAGE ${i}`, hue));
  await uploadMedia(jobId, "video", "video/webm", await video());
  await browser.close();
}

const phone = await browserFor("owner", { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
const p = phone.page;
try {
  await go(p, `${base}/approve/${token}`);
  const thumbs = p.locator("[data-viewer-item][data-viewer-kind=image]");
  const n = await thumbs.count();
  check("1 the approval page shows the four photos as viewer thumbnails", n === 4, String(n));
  const smallSrc = await thumbs.first().locator("img").getAttribute("src");
  const sharpSrc = await thumbs.first().getAttribute("data-viewer-src");
  check("2 the page loads a small picture (resized by Supabase), the viewer opens the sharp one", /\/render\/image\//.test(smallSrc ?? "") && /\/object\/sign\//.test(sharpSrc ?? ""), `${(smallSrc ?? "").slice(0, 90)} | ${(sharpSrc ?? "").slice(0, 90)}`);
  const widthBefore = await p.evaluate(() => window.visualViewport?.scale ?? 1);
  await thumbs.nth(1).tap();
  const lb = p.locator("[data-lightbox]");
  await lb.waitFor({ timeout: 10000 });
  const box = await lb.boundingBox();
  check("3 a tap opens the viewer FULL SCREEN on black", !!box && box.width >= 389 && box.height >= 843 && (await lb.evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(0, 0, 0)", JSON.stringify(box));
  const count = (await p.locator("[data-lightbox-count]").textContent()) ?? "";
  const label = (await p.locator("[data-lightbox-label]").textContent()) ?? "";
  check("4 '3 / 5' (the walk-around video first, then the dashboard, then this damage photo) with the item's name", /^3 \/ 5$/.test(count.trim()) && /^Damage/i.test(label.trim()), `${count} · ${label}`);
  await sleep(800);
  check("5 the viewer shows the SHARP picture", /\/object\/sign\//.test((await p.locator("[data-lightbox-img]").getAttribute("src")) ?? ""));
  await p.screenshot({ path: path.join(SHOTS, "1-phone-open.png") });
  // Double-tap zooms the photo (not the page).
  const stage = await p.locator("[data-lightbox-stage]").boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await p.touchscreen.tap(cx, cy);
  await sleep(80);
  await p.touchscreen.tap(cx, cy);
  const zoomed = await until(async () => Number(await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom")) > 1 ? true : null, 15, 200);
  check("6 double-tap zooms the PHOTO (2.5×), the page itself keeps its size", !!zoomed && (await p.evaluate(() => window.visualViewport?.scale ?? 1)) === widthBefore, String(await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom")));
  await sleep(300);
  await p.screenshot({ path: path.join(SHOTS, "2-phone-zoomed.png") });
  await p.touchscreen.tap(cx, cy);
  await sleep(80);
  await p.touchscreen.tap(cx, cy);
  await until(async () => (await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom")) === "1.00" ? true : null, 15, 200);
  // Pinch with two fingers (pointer events, as a phone sends them).
  await p.evaluate(({ cx, cy }) => {
    const el = document.querySelector("[data-lightbox-stage]");
    const ev = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
    ev("pointerdown", 1, cx - 40, cy);
    ev("pointerdown", 2, cx + 40, cy);
    for (let k = 1; k <= 8; k++) { ev("pointermove", 1, cx - 40 - k * 15, cy); ev("pointermove", 2, cx + 40 + k * 15, cy); }
    ev("pointerup", 1, cx - 160, cy);
    ev("pointerup", 2, cx + 160, cy);
  }, { cx, cy });
  const pinched = Number(await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom"));
  check("7 a pinch zooms the photo (fingers 80 → 320 px apart)", pinched > 2.5, String(pinched));
  // Back to normal, then swipe left for the next one.
  await p.touchscreen.tap(cx, cy);
  await sleep(80);
  await p.touchscreen.tap(cx, cy);
  await until(async () => (await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom")) === "1.00" ? true : null, 15, 200);
  await p.evaluate(({ cx, cy }) => {
    const el = document.querySelector("[data-lightbox-stage]");
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", clientX: x, clientY: cy, bubbles: true, isPrimary: true }));
    ev("pointerdown", cx + 120); ev("pointermove", cx + 20); ev("pointermove", cx - 80); ev("pointerup", cx - 120);
  }, { cx, cy });
  const next = await until(async () => /^4 \/ 5$/.test(((await p.locator("[data-lightbox-count]").textContent()) ?? "").trim()) ? true : null, 10, 200);
  check("8 swipe left: the next photo ('4 / 5')", !!next, (await p.locator("[data-lightbox-count]").textContent()) ?? "");
  await p.screenshot({ path: path.join(SHOTS, "3-phone-swiped.png") });
  // The phone's back button closes the viewer and stays on the page.
  const url = p.url();
  await p.goBack();
  const closedByBack = await until(async () => ((await p.locator("[data-lightbox]").count()) === 0 ? true : null), 15, 200);
  check("9 the phone's back button closes the viewer (still on the page)", !!closedByBack && p.url() === url, p.url());
  // Swipe down closes too.
  await thumbs.first().tap();
  await lb.waitFor();
  await p.evaluate(({ cx, cy }) => {
    const el = document.querySelector("[data-lightbox-stage]");
    const ev = (type, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: "touch", clientX: cx, clientY: y, bubbles: true, isPrimary: true }));
    ev("pointerdown", cy - 100); ev("pointermove", cy); ev("pointermove", cy + 60); ev("pointerup", cy + 120);
  }, { cx, cy });
  check("10 swipe down closes the viewer", !!(await until(async () => ((await p.locator("[data-lightbox]").count()) === 0 ? true : null), 15, 200)));
  await sleep(500);
  // The video opens in the same viewer and plays, muted.
  await p.locator("[data-player]").first().tap();
  await lb.waitFor();
  const vid = p.locator("[data-lightbox-video]");
  const playing = await until(async () => ((await vid.count()) && (await vid.evaluate((v) => v.currentTime > 0.2 && !v.paused)) ? true : null), 40, 300);
  check("11 the video plays inside the viewer, muted", !!playing && (await vid.evaluate((v) => v.muted)) === true && /Walk-around video/i.test((await p.locator("[data-lightbox-label]").textContent()) ?? ""));
  await p.screenshot({ path: path.join(SHOTS, "4-phone-video.png") });
  await p.locator("[data-lightbox-close]").tap();
  check("12 ✕ closes it", !!(await until(async () => ((await p.locator("[data-lightbox]").count()) === 0 ? true : null), 15, 200)));
} finally {
  await phone.browser.close();
}

// A tablet, and a computer's keyboard.
{
  const tab = await browserFor("owner", { viewport: { width: 820, height: 1180 }, mobile: true, touch: true });
  await go(tab.page, `${base}/approve/${token}`);
  await tab.page.locator("[data-viewer-item][data-viewer-kind=image]").nth(2).tap();
  await tab.page.locator("[data-lightbox]").waitFor();
  await sleep(600);
  await tab.page.screenshot({ path: path.join(SHOTS, "5-tablet-open.png") });
  check("13 tablet: the viewer opens full screen", ((await tab.page.locator("[data-lightbox]").boundingBox())?.width ?? 0) >= 819);
  await tab.browser.close();
  const pc = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(pc.page, `${base}/approve/${token}`);
  await pc.page.locator("[data-viewer-item][data-viewer-kind=image]").first().click();
  await pc.page.locator("[data-lightbox]").waitFor();
  await pc.page.keyboard.press("ArrowRight");
  const k = ((await pc.page.locator("[data-lightbox-count]").textContent()) ?? "").trim();
  await pc.page.keyboard.press("Escape");
  const gone = await until(async () => ((await pc.page.locator("[data-lightbox]").count()) === 0 ? true : null), 15, 200);
  check("14 computer: the arrow key moves on, Escape closes", /^3 \/ 5$/.test(k) && !!gone, k);
  await pc.browser.close();
}

// Test files out of storage.
const files = await sql("select storage_path p from public.gate_in_media where job_id = $1 and storage_path not like 'test/%'", [jobId]);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (files.length && key) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/gate-in-media`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: files.map((f) => f.p) }) });
  console.log(`storage: ${files.length} test files removed (${res.status})`);
}
cleanupDb();
process.exit(summary() ? 1 : 0);
