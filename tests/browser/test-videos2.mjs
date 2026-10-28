// Section 2 proof (23 October 2026, afternoon): inspection videos reach the customer. The technician attaches two
// videos to two items on the tablet (each gets its picture, a frame taken at upload); the report is approved and its
// link made; the customer's link shows both videos under their items ("<item> – Bad") and plays both inside the page,
// muted; the PDF shows both pictures with a play sign and "Watch video" links to those videos on the customer page;
// a video without a picture (an older one) still gets its dark card and link; fresh addresses come from the token.
//   node --env-file=.env.local tests/browser/test-videos2.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfOf = async (url) => {
  const r = await fetch(`${base}${url}`);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i);
    pages.push({ page: p, text: p.toStructuredText("preserve-whitespace").asText().replace(/\s+/g, " "), links: p.getLinks().map((l) => l.getURI()) });
  }
  return { status: r.status, pages, mupdf };
};

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "inspection" });
const { jobId, inspectionId: inspId, technicianId } = seed.json;
await sql("update public.inspections set scan_read_at = now() where id = $1", [inspId]);
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;

const { browser, context, page } = await browserForId(technicianId, { viewport: { width: 1100, height: 1300 } });
let token = null;
const extraFiles = [];
try {
  /* 0. Two short test videos, recorded in the browser (moving colours with a frame counter). */
  const makeVideo = async (label, hue) => {
    const b64 = await page.evaluate(async ({ label, hue }) => {
      const c = document.createElement("canvas");
      c.width = 480; c.height = 270;
      const ctx = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm" });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      let f = 0;
      const draw = () => { ctx.fillStyle = `hsl(${(hue + f * 6) % 360},65%,45%)`; ctx.fillRect(0, 0, 480, 270); ctx.fillStyle = "#fff"; ctx.font = "bold 34px sans-serif"; ctx.fillText(`${label} ${f}`, 30, 150); f++; };
      draw();
      const timer = setInterval(draw, 66);
      rec.start(200);
      await new Promise((r) => setTimeout(r, 2200));
      rec.stop();
      await new Promise((r) => { rec.onstop = r; });
      clearInterval(timer);
      const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(s);
    }, { label, hue });
    return Buffer.from(b64, "base64");
  };
  await go(page, `${base}/my-jobs/${jobId}`);
  const vidA = await makeVideo("MOUNT", 10);
  const vidB = await makeVideo("HOSE", 200);
  check("0: two test videos recorded", vidA.length > 2000 && vidB.length > 2000, `${vidA.length} / ${vidB.length} bytes`);

  /* 1. The technician attaches one video to each of two items. */
  const items = await until(async () => { const r = await sql("select item_key, item_label from public.inspection_items where inspection_id = $1 and style = 'grade' and section_key <> 'diagnostics_and_road_test' order by position limit 40", [inspId]); return r.length >= 2 ? r : null; });
  // An item shows its photo and video buttons once it has an answer: the technician marks it Bad first.
  const targets = [];
  for (const it of items ?? []) {
    if (targets.length === 2) break;
    const bad = page.locator(`xpath=//*[normalize-space(text())="${it.item_label}"]/ancestor::*[.//button[normalize-space()="Bad"]][1]//button[normalize-space()="Bad"]`).first();
    if (!(await bad.count())) continue;
    await bad.scrollIntoViewIfNeeded();
    await bad.click();
    const input = page.locator(`[data-media-where="${it.item_key}"] input[accept="video/*"]`);
    if (await until(async () => (await input.count()) === 1, 20, 300)) targets.push(it);
  }
  check("1: two checklist items with a Video button found", targets.length === 2, JSON.stringify(targets));
  for (const [n, it] of targets.entries()) {
    const input = page.locator(`[data-media-where="${it.item_key}"] input[accept="video/*"]`);
    await input.setInputFiles({ name: n === 0 ? "mounts.webm" : "hose.webm", mimeType: "video/webm", buffer: n === 0 ? vidA : vidB });
    const row = await until(async () => (await sql("select id, poster_path from public.inspection_media where inspection_id = $1 and item_key = $2 and kind = 'video' and removed_at is null", [inspId, it.item_key]))[0], 60, 750);
    check(`1: video ${n + 1} stored on "${it.item_label}" with its picture (a frame taken at upload)`, !!row && /\.jpg$/.test(row.poster_path ?? ""), JSON.stringify(row));
    it.mediaId = row?.id;
  }
  await page.locator(`[data-media-where="${targets[0].item_key}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("videos2-1-tablet.png") });

  /* 2. Report approved (both items Bad) and the customer's link made. */
  for (const it of targets) await sql("update public.inspection_items set status = 'bad', remarks = 'See the video' where inspection_id = $1 and item_key = $2", [inspId, it.item_key]);
  await sql("update public.inspections set status = 'approved', approved_at = now(), approved_by = $2, submitted_at = coalesce(submitted_at, now()) where id = $1", [inspId, owner]);
  token = randomBytes(18).toString("base64url");
  await sql("insert into public.report_links (job_id, inspection_id, token, created_by, updated_by) values ($1, $2, $3, $4, $4)", [jobId, inspId, token, owner]);

  /* 3. The customer's link: both videos under their items, playing inside the page, muted. */
  const cust = await context.newPage();
  await cust.setViewportSize({ width: 430, height: 932 });
  await go(cust, `${base}/report/${token}`);
  const list = cust.locator("[data-report-video]");
  check("3: the customer link shows both videos", (await list.count()) === 2);
  const caps = await list.locator("figcaption").allTextContents();
  check("3: each under its item with the answer ('<item> – Bad')", targets.every((it) => caps.some((c) => c.includes(`${it.item_label} – Bad`))), caps.join(" | "));
  // 29 October 2026: each video is a tile with its own picture; a tap plays it in THE viewer (PhotoViewer).
  const posters = await list.locator("[data-player]").evaluateAll((els) => els.map((e) => e.getAttribute("data-viewer-poster") ?? ""));
  check("3: each tile shows the video's own picture", posters.length === 2 && posters.every((p) => /\.jpg/.test(p)), posters.map((p) => p.slice(0, 60)).join(" | "));
  await cust.locator("[data-report-videos]").scrollIntoViewIfNeeded();
  await cust.screenshot({ path: shot("videos2-2-link-before.png"), fullPage: true });
  for (let i = 0; i < 2; i++) {
    await list.nth(i).locator("[data-play]").click();
    const ok = await until(async () => ((await cust.locator("[data-lightbox-video]").count()) ? cust.locator("[data-lightbox-video]").evaluate((v) => v.currentTime > 0.2 && !v.paused && v.muted) : false), 30, 300);
    check(`3: video ${i + 1} plays in the viewer, muted`, !!ok);
    if (i === 1) await cust.screenshot({ path: shot("videos2-3-link-playing.png") });
    await cust.locator("[data-lightbox-close]").click();
    await until(async () => ((await cust.locator("[data-lightbox]").count()) === 0 ? true : null), 15, 200);
  }

  // Fresh addresses on demand: only the link's token opens them.
  const fresh = await (await fetch(`${base}/api/customer/videos?t=${token}`)).json();
  check("3: fresh addresses for both videos (and their pictures) come from the link's token", fresh.videos?.length === 2 && fresh.videos.every((v) => v.url && v.poster));
  check("3: a wrong token gets nothing", (await fetch(`${base}/api/customer/videos?t=wrongwrongwrongwrong`)).status === 404);

  /* 4. The PDF: both pictures with a play sign and "Watch video", each a link to that video on the customer page. */
  const pdf = await pdfOf(`/api/pdf/report/${token}`);
  const allText = pdf.pages.map((p) => p.text).join(" ");
  const links = pdf.pages.flatMap((p) => p.links);
  check("4: the PDF says Watch video twice", (allText.match(/Watch video/g) ?? []).length === 2, `${(allText.match(/Watch video/g) ?? []).length}`);
  check("4: each is a link to that video on the customer's page", targets.every((it) => links.includes(`https://erp.ofjauto.com/report/${token}#v-${it.mediaId}`)), links.filter((l) => /#v-/.test(l)).join(" | "));
  const vPage = pdf.pages.find((p) => /Watch video/.test(p.text));
  if (vPage) {
    const png = vPage.page.toPixmap(pdf.mupdf.Matrix.scale(1.6, 1.6), pdf.mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
    fs.writeFileSync(shot("videos2-4-pdf.png"), png);
  }
  for (const it of targets) {
    await go(cust, `${base}/report/${token}#v-${it.mediaId}`);
    const target = await cust.locator(`#v-${it.mediaId}`).evaluate((el) => el.matches(":target"));
    check(`4: the PDF link opens the customer page on that video (${it.item_label})`, target);
  }

  /* 5. An older video without a picture still gets its card and link (a dark card). */
  extraFiles.push(...(await sql("select poster_path from public.inspection_media where id = $1", [targets[1].mediaId])).map((r) => r.poster_path).filter(Boolean));
  await sql("update public.inspection_media set poster_path = null where id = $1", [targets[1].mediaId]);
  const pdf2 = await pdfOf(`/api/pdf/report/${token}`);
  check("5: without a picture the card and its link are still there", (pdf2.pages.map((p) => p.text).join(" ").match(/Watch video/g) ?? []).length === 2 && pdf2.pages.flatMap((p) => p.links).includes(`https://erp.ofjauto.com/report/${token}#v-${targets[1].mediaId}`));
  await go(cust, `${base}/report/${token}`);
  check("5: on the link the player draws its own picture from the video", (await cust.locator("[data-report-video]").count()) === 2);
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
  // The test files leave the storage too (the clean-up SQL removes the rows only).
  const files = (await sql("select storage_path, poster_path from public.inspection_media where inspection_id = $1", [inspId])).flatMap((r) => [r.storage_path, r.poster_path]).concat(extraFiles).filter(Boolean);
  if (files.length) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/inspection-media`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: files }) });
    console.log(`storage: ${files.length} test files removed (${res.status})`);
  }
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
