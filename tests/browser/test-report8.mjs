// Section 8 of 29 October 2026: the inspection report grouped by part, ONE layout for the customer's link, the PDF
// and the staff preview.
//  A  a test report with known answers (old tyre, disc thickness and minimum, weak battery with CCA, a note): the
//     order Needs attention → note → BRAKES → TYRES → BATTERY → … → CHECKED AND PASSED; OLD TYRE in amber with
//     "Good, but 10 years old"; red only for Replace now / Dangerous; empty fields hidden; the PDF in the same order,
//     "Page X of Y" on every page, no section title alone at the foot of a page, no nearly empty last page;
//     then everything good: NO ISSUES FOUND.
//  B  the newest real report (J-00655, photos and two videos) on a phone (390 px, touch) and a tablet: a photo full
//     screen, zoomed, swiped; a video playing in the viewer; the PDF.
//  C  the oldest real report (J-00016) renders cleanly in the new layout, on a phone and as a PDF.
//  D  the staff preview on the inspection page draws the same report.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.test.local tests/browser/test-report8.mjs
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "report8");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const until = async (fn, tries = 40, gap = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const mupdf = await import("mupdf");

const TITLES = /^(NEEDS ATTENTION · \d+|NO ISSUES FOUND|NOTE FROM THE WORKSHOP|BRAKES|TYRES|BATTERY|AIR CONDITIONING|ROAD TEST|BODY|VIDEOS|CHECKED AND PASSED · \d+|[A-Z][A-Z &/,-]{3,})$/;
/** Reads a report PDF: the pages' text lines with positions, the page count, a PNG of every page. */
async function readPdf(url, name) {
  const r = await fetch(`${base}${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const json = JSON.parse(page.toStructuredText("preserve-whitespace,preserve-images").asJSON());
    const lines = [];
    let lowest = 0;
    for (const b of json.blocks ?? []) {
      if (b.bbox.y >= 66 && b.bbox.y < 732) lowest = Math.max(lowest, b.bbox.y + b.bbox.h);
      for (const l of b.lines ?? []) lines.push({ x: l.bbox.x, y: l.bbox.y, h: l.bbox.h, text: l.text.trim() });
    }
    fs.writeFileSync(path.join(SHOTS, `${name}-p${i + 1}.png`), page.toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
    pages.push({ lines, text: lines.map((l) => l.text).join("\n"), fill: (Math.max(66, lowest) - 66) / (732 - 66) });
  }
  // The block titles in reading order: big titles at the left edge (the section names on the right of the
  // attention lines are not titles).
  const titles = pages.flatMap((p) => p.lines.filter((l) => l.x < 120 && TITLES.test(l.text)).map((l) => l.text.replace(/ · \d+$/, "")));
  return { status: r.status, pages, all: pages.map((p) => p.text).join("\n"), titles };
}
/** The PDF rules: Page X of Y everywhere; no section title alone at the foot of a page; the last page not nearly empty. */
function pdfRules(pdf, label) {
  const n = pdf.pages.length;
  check(`${label}: "Page X of Y" on every page (${n})`, pdf.pages.every((p, i) => p.text.includes(`Page ${i + 1} of ${n}`)));
  const alone = [];
  for (const [i, p] of pdf.pages.entries()) {
    const body = p.lines.filter((l) => l.y >= 66 && l.y < 732);
    for (const t of body.filter((l) => l.x < 120 && TITLES.test(l.text) && /^(NEEDS|NO ISSUES|NOTE|BRAKES|TYRES|BATTERY|AIR|ROAD|BODY|VIDEOS|CHECKED)/.test(l.text))) {
      if (!body.some((l) => l.y > t.y + t.h + 1)) alone.push(`p${i + 1} ${t.text}`);
    }
  }
  check(`${label}: no section title alone at the foot of a page`, alone.length === 0, alone.join(", "));
  check(`${label}: the last page is not nearly empty`, n === 1 || pdf.pages[n - 1].fill >= 0.2, `${n} pages, last ${Math.round(pdf.pages[n - 1].fill * 100)}% full`);
}
/** Where each title sits among the PDF's block titles (-1 when missing). */
const orderOf = (pdf, words) => words.map((w) => pdf.titles.findIndex((t) => t === w));
const ascending = (xs) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;

/* ---------------- A: a test report with known answers ---------------- */
cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "inspection" })).json;
const { jobId, inspectionId: inspId } = seed;
const tech = (await sql("select display_name from public.staff where id = $1", [seed.technicianId]))[0]?.display_name ?? "";
await sql("update public.inspection_items set status = 'good', remarks = null, dangerous = false where inspection_id = $1", [inspId]);
await sql("update public.inspection_items set status = 'bad', remarks = null where inspection_id = $1 and item_label ilike 'Front brake pad%'", [inspId]);
await sql("update public.inspection_items set status = 'average', disc_thickness = 26.5, disc_minimum = 25, disc_condition = 'close_to_minimum', disc_action = 'skim', remarks = null where inspection_id = $1 and item_label ilike 'Front brake disc%'", [inspId]);
const m = {
  tyre_size_front: "245/40 R19", tyre_size_rear: "275/35 R19",
  tyre_fl_tread: "6", tyre_fl_year: "2016", tyre_fl_cond: "good", tyre_fl_action: "none",
  tyre_fr_tread: "2", tyre_fr_year: "2022", tyre_fr_cond: "worn_out", tyre_fr_action: "replace_now",
  tyre_rl_tread: "7", tyre_rl_year: "2024", tyre_rl_cond: "good", tyre_rl_action: "none",
  tyre_rr_tread: "7", tyre_rr_year: "2024", tyre_rr_cond: "good", tyre_rr_action: "none",
  pad_front: "3", pad_rear: "8", battery_voltage: "12.2", battery_health: "weak", battery_cca: "540", vent_temp: "6",
};
await sql("update public.inspections set measurements = $2::jsonb, manager_note = 'Please book the brake job this week.', manager_note_internal = 'INTERNAL-ONLY-WORDS', status = 'approved', approved_at = now(), approved_by = $3, submitted_at = coalesce(submitted_at, now()) where id = $1", [inspId, JSON.stringify(m), owner]);
const tokenA = randomBytes(18).toString("base64url");
await sql("insert into public.report_links (job_id, inspection_id, token, created_by, updated_by, opened_at, status) values ($1, $2, $3, $4, $4, now(), 'opened')", [jobId, inspId, tokenA, owner]);

try {
  const phone = await browserFor("owner", { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  const p = phone.page;
  await go(p, `${base}/report/${tokenA}`);
  const order = await p.evaluate(() => Array.from(document.querySelectorAll("[data-report-attention], [data-report-note], [data-report-section], [data-report-passed]")).map((e) => e.getAttribute("data-report-section") ?? (e.hasAttribute("data-report-attention") ? "attention" : e.hasAttribute("data-report-note") ? "note" : "passed")));
  check("A1 order on the phone: attention → note → brakes → tyres → battery → … → checked and passed", order[0] === "attention" && order[1] === "note" && order[2] === "brakes" && order[3] === "tyres" && order[4] === "battery" && order[order.length - 1] === "passed", order.join(" → "));
  const lines = await p.locator("[data-attention-line]").evaluateAll((els) => els.map((e) => e.getAttribute("data-attention-line")));
  check("A2 needs attention worst first: Replace now, then Bad, then the advisories", lines[0] === "Replace now" && lines.indexOf("Bad") > 0 && lines.indexOf("Bad") < lines.indexOf("Average") && lines.includes("Old tyre") && lines.includes("Weak"), lines.join(", "));
  const text = (await p.locator("[data-inspection-report]").innerText()).replace(/\s+/g, " ");
  check("A3 OLD TYRE in amber with 'Good, but 10 years old'", /Good, but 10 years old/.test(text) && (await p.locator("[data-report-section=tyres] [data-chip=amber]", { hasText: /old tyre/i }).count()) > 0);
  check("A4 the brakes keep the disc thickness, the minimum and the condition together", /26\.5 mm · minimum 25 mm · Close to minimum/.test(text) && /3 mm/.test(text));
  check("A5 the battery: voltage, the test result and the CCA", /12\.2 V/.test(text) && /Weak, recharge and retest/.test(text) && /CCA\s*540/.test(text));
  const reds = await p.locator("[data-inspection-report] [data-chip=red]").allInnerTexts();
  check("A6 red only for Replace now / Dangerous", reds.length > 0 && reds.every((t) => /^(replace now|dangerous)$/i.test(t.trim())), reds.join(", "));
  check("A7 no staff names, internal notes, prices or part numbers", !text.includes(tech) && !/INTERNAL-ONLY-WORDS|AED|Part no/i.test(text), tech);
  check("A8 nothing wider than the phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check("A9 'CHECKED AND PASSED' lists plain OK items only (no pad, disc or brake fluid)", !(await p.locator("[data-report-passed]").innerText()).match(/brake pad|brake disc/i));
  await p.screenshot({ path: path.join(SHOTS, "A-phone-top.png") });
  await p.locator("[data-report-section=tyres]").scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SHOTS, "A-phone-tyres.png") });
  await p.locator("[data-report-passed]").scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SHOTS, "A-phone-passed.png") });

  const pdf = await readPdf(`/api/pdf/report/${tokenA}`, "A-pdf");
  check("A10 the PDF answers", pdf.status === 200 && pdf.pages.length >= 1, String(pdf.status));
  check("A11 the PDF in the same order", ascending(orderOf(pdf, ["NEEDS ATTENTION", "NOTE FROM THE WORKSHOP", "BRAKES", "TYRES", "BATTERY", "CHECKED AND PASSED"])), JSON.stringify(orderOf(pdf, ["NEEDS ATTENTION", "NOTE FROM THE WORKSHOP", "BRAKES", "TYRES", "BATTERY", "CHECKED AND PASSED"])));
  check("A12 the PDF carries the same answers (old tyre, disc minimum, CCA)", /Good, but 10 years old/.test(pdf.all) && /minimum 25 mm/.test(pdf.all) && /540/.test(pdf.all) && /OLD TYRE|Old tyre/i.test(pdf.all));
  check("A13 the PDF has no staff names or internal notes", !pdf.all.includes(tech) && !pdf.all.includes("INTERNAL-ONLY-WORDS"));
  pdfRules(pdf, "A14");

  // Everything good: NO ISSUES FOUND in green, no attention lines.
  await sql("update public.inspection_items set status = 'good', disc_condition = 'good', disc_action = 'none', service_due = false where inspection_id = $1", [inspId]);
  const good = { ...m, tyre_fl_year: "2024", tyre_fr_tread: "7", tyre_fr_year: "2024", tyre_fr_cond: "good", tyre_fr_action: "none", pad_front: "9", battery_health: "good" };
  await sql("update public.inspections set measurements = $2::jsonb, manager_note = null where id = $1", [inspId, JSON.stringify(good)]);
  await go(p, `${base}/report/${tokenA}`);
  check("A15 nothing wrong: NO ISSUES FOUND in green", (await p.locator("[data-report-attention='0']").innerText()).includes("NO ISSUES FOUND") && (await p.locator("[data-attention-line]").count()) === 0);
  await p.screenshot({ path: path.join(SHOTS, "A-phone-no-issues.png") });
  const pdfGood = await readPdf(`/api/pdf/report/${tokenA}`, "A-pdf-good");
  check("A16 the PDF says NO ISSUES FOUND too", /NO ISSUES FOUND/.test(pdfGood.all));
  await phone.browser.close();
} catch (e) {
  check("A walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
}

/* ---------------- B: the newest real report on a phone and a tablet ---------------- */
const real = async (jobNumber) => (await sql("select j.id, l.token from public.jobs j join public.report_links l on l.job_id = j.id where j.job_number = $1 order by l.created_at desc limit 1", [jobNumber]))[0];
const newest = await real("J-00655");
try {
  const phone = await browserFor("owner", { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  const p = phone.page;
  await go(p, `${base}/report/${newest.token}`);
  check("B1 J-00655 on a phone: the new layout (attention first, passed last), nothing wider than the screen", (await p.locator("[data-report-attention]").count()) === 1 && (await p.locator("[data-report-passed]").count()) === 1 && (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await p.screenshot({ path: path.join(SHOTS, "B-phone-top.png") });
  const photos = p.locator("[data-report-photo]");
  const nPhotos = await photos.count();
  const small = await photos.first().locator("img").getAttribute("src");
  check("B2 photos sit with their parts as small pictures (resized), the viewer opens the sharp one", nPhotos > 3 && /\/render\/image\//.test(small ?? ""), `${nPhotos} photos`);
  const firstSection = await photos.first().evaluate((el) => el.closest("[data-report-section]")?.getAttribute("data-report-section"));
  await photos.first().scrollIntoViewIfNeeded();
  await photos.first().tap();
  const lb = p.locator("[data-lightbox]");
  await lb.waitFor({ timeout: 10000 });
  const box = await lb.boundingBox();
  const count = ((await p.locator("[data-lightbox-count]").textContent()) ?? "").trim();
  const label = ((await p.locator("[data-lightbox-label]").textContent()) ?? "").trim();
  check("B3 a tap opens the photo full screen with 'n / N' and the item's name", !!box && box.width >= 389 && /^\d+ \/ \d+$/.test(count) && label.length > 2, `${count} · ${label} · in ${firstSection}`);
  await sleep(1200);
  await p.screenshot({ path: path.join(SHOTS, "B-phone-photo-open.png") });
  const stage = await p.locator("[data-lightbox-stage]").boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await p.touchscreen.tap(cx, cy);
  await sleep(80);
  await p.touchscreen.tap(cx, cy);
  const zoomed = await until(async () => (Number(await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom")) > 1 ? true : null), 15, 200);
  check("B4 double-tap zooms the photo (the page keeps its size)", !!zoomed && (await p.evaluate(() => window.visualViewport?.scale ?? 1)) === 1);
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, "B-phone-photo-zoomed.png") });
  await p.touchscreen.tap(cx, cy);
  await sleep(80);
  await p.touchscreen.tap(cx, cy);
  await until(async () => ((await p.locator("[data-lightbox-zoom]").getAttribute("data-lightbox-zoom")) === "1.00" ? true : null), 15, 200);
  const [n0] = count.split(" / ").map(Number);
  await p.evaluate(({ cx, cy }) => {
    const el = document.querySelector("[data-lightbox-stage]");
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", clientX: x, clientY: cy, bubbles: true, isPrimary: true }));
    ev("pointerdown", cx + 120); ev("pointermove", cx + 20); ev("pointermove", cx - 80); ev("pointerup", cx - 120);
  }, { cx, cy });
  const moved = await until(async () => (Number((((await p.locator("[data-lightbox-count]").textContent()) ?? "").trim().split(" / ")[0])) === n0 + 1 ? true : null), 10, 200);
  check("B5 swipe left: the next photo", !!moved, ((await p.locator("[data-lightbox-count]").textContent()) ?? "").trim());
  await sleep(1000);
  await p.screenshot({ path: path.join(SHOTS, "B-phone-photo-swiped.png") });
  await p.locator("[data-lightbox-close]").tap();
  await until(async () => ((await p.locator("[data-lightbox]").count()) === 0 ? true : null), 15, 200);
  const players = p.locator("[data-player]");
  check("B6 the report's videos sit with their parts", (await players.count()) >= 1, String(await players.count()));
  await players.first().scrollIntoViewIfNeeded();
  await players.first().tap();
  await lb.waitFor();
  const vid = p.locator("[data-lightbox-video]");
  const playing = await until(async () => ((await vid.count()) && (await vid.evaluate((v) => v.currentTime > 0.2 && !v.paused)) ? true : null), 50, 300);
  check("B7 a video plays in the same viewer, muted", !!playing && (await vid.evaluate((v) => v.muted)) === true);
  await sleep(600);
  await p.screenshot({ path: path.join(SHOTS, "B-phone-video.png") });
  await p.locator("[data-lightbox-close]").tap();
  await phone.browser.close();

  const tab = await browserFor("owner", { viewport: { width: 820, height: 1180 }, mobile: true, touch: true });
  await go(tab.page, `${base}/report/${newest.token}`);
  check("B8 tablet: the tables show as tables, nothing wider than the screen", (await tab.page.locator("[data-report-table] table").first().isVisible()) && (await tab.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await tab.page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => i.setAttribute("loading", "eager")));
  await sleep(2500);
  await tab.page.screenshot({ path: path.join(SHOTS, "B-tablet.png"), fullPage: true });
  await tab.browser.close();

  const pdf = await readPdf(`/api/pdf/report/${newest.token}`, "B-pdf-J-00655");
  check("B9 J-00655 PDF in the new order", pdf.status === 200 && ascending(orderOf(pdf, ["NEEDS ATTENTION", "BRAKES", "TYRES", "CHECKED AND PASSED"])), `${pdf.pages.length} pages · ${pdf.titles.join(" | ")}`);
  check("B10 J-00655 PDF: every video has its Watch video link card", (pdf.all.match(/Watch video/g) ?? []).length === (await sql("select count(*)::int n from public.inspection_media where inspection_id = (select id from public.inspections where job_id = $1 and is_active) and kind = 'video' and removed_at is null and not is_prescan", [newest.id]))[0].n);
  pdfRules(pdf, "B11 J-00655");
} catch (e) {
  check("B walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
}

/* ---------------- C: the oldest real report renders cleanly ---------------- */
const oldest = await real("J-00016");
try {
  const phone = await browserFor("owner", { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  await go(phone.page, `${base}/report/${oldest.token}`);
  const sections = await phone.page.locator("[data-report-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-report-section")));
  check("C1 J-00016 (21 October) on a phone in the new layout, brakes / tyres / battery first", sections.slice(0, 3).join(",") === "brakes,tyres,battery" && (await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), sections.join(", "));
  await phone.page.screenshot({ path: path.join(SHOTS, "C-phone-J-00016.png") });
  await phone.browser.close();
  const pdf = await readPdf(`/api/pdf/report/${oldest.token}`, "C-pdf-J-00016");
  check("C2 J-00016 PDF in the new order", pdf.status === 200 && ascending(orderOf(pdf, ["NEEDS ATTENTION", "BRAKES", "TYRES", "BATTERY", "CHECKED AND PASSED"])), `${pdf.pages.length} pages · ${pdf.titles.join(" | ")}`);
  pdfRules(pdf, "C3 J-00016");
} catch (e) {
  check("C walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
}

/* ---------------- D: the staff preview ---------------- */
try {
  const pc = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(pc.page, `${base}/jobs/${newest.id}/inspection`);
  await pc.page.locator("[data-report-preview] button").first().click();
  const shown = await until(async () => ((await pc.page.locator("[data-report-preview] [data-inspection-report]").count()) === 1 ? true : null), 20, 300);
  check("D1 the staff preview draws the same report with the three boxes", !!shown && /Vehicle/i.test(await pc.page.locator("[data-report-preview]").innerText()) && (await pc.page.locator("[data-report-preview] [data-report-section]").count()) > 2);
  // The page loads pictures as they scroll into view; load them all for the picture of the whole preview.
  await pc.page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => i.setAttribute("loading", "eager")));
  await sleep(2500);
  await pc.page.locator("[data-report-preview]").screenshot({ path: path.join(SHOTS, "D-staff-preview.png") });
  await pc.browser.close();
} catch (e) {
  check("D walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
}

cleanupDb();
process.exit(summary() ? 1 : 0);
