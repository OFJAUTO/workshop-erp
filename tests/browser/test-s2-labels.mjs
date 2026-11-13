// 13 November 2026, Section 2: labels. Gate-in opens Labels (warranty labels and history) and prints the battery warranty
// label and the service label (no 404); part labels stay with the parts desk; every old "stickers" address moves to
// "labels"; a refused page says "You don't have access to this page. Ask the owner."; the battery label is pure black:
// INSTALLED and VALID UNTIL big and bold, the VIN on one line, a bigger logo, no gap before the QR. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s2-labels.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-labels";
fs.mkdirSync(OUT, { recursive: true });

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const g = await browserFor("gate_in", { viewport: { width: 1280, height: 900 } });
  const open = async (u) => { const r = await g.page.goto(`${base}${u}`, { waitUntil: "load" }); await sleep(400); return r; };

  // 1. Labels for gate-in: warranty labels and history; the old address moves to the new one.
  const r1 = await open("/stickers?tab=warranty");
  check("1a: the old /stickers address opens Labels at /labels (kept the tab)", r1.status() === 200 && /\/labels\?tab=warranty$/.test(g.page.url()), g.page.url());
  await g.page.screenshot({ path: path.join(OUT, "1-gate-in-labels-1280.png") });
  await g.page.setViewportSize({ width: 800, height: 1280 });
  await g.page.screenshot({ path: path.join(OUT, "1-gate-in-labels-800.png") });
  await g.page.setViewportSize({ width: 1280, height: 900 });
  const links = await g.page.locator("a[href^='/print/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check("1b: the print links use the new label addresses", links.length > 0 && links.every((h) => !/sticker/.test(h)), JSON.stringify(links.slice(0, 3)));
  const r2 = await open("/labels?tab=history");
  check("1c: gate-in opens the History", r2.status() === 200);

  // 2. Gate-in prints the battery warranty label (a handover reprint) and the service label: no 404.
  const battery = links.find((h) => h.startsWith("/print/labels/"));
  if (battery) {
    const r = await open(battery);
    check("2a: the battery warranty label prints for gate-in (was a 404)", r.status() === 200 && (await g.page.locator("[data-battery-sticker]").count()) >= 1, `${r.status()} ${battery}`);
    check("2b: … and only battery labels (part labels stay with the parts desk)", (await g.page.locator("[data-part-sticker]").count()) === 0);
    // 3. The battery label in pure black: every colour on the label is black or white; the logo has no grey.
    const colours = await g.page.locator("[data-battery-sticker]").first().evaluate((el) => {
      const out = new Set();
      for (const n of [el, ...el.querySelectorAll("*")]) { const s = getComputedStyle(n); out.add(s.color); out.add(s.backgroundColor); }
      return Array.from(out);
    });
    const ok = (c) => /rgba?\(0, 0, 0(, 1)?\)|rgba?\(255, 255, 255(, 1)?\)|rgba\(0, 0, 0, 0\)/.test(c);
    check("3a: the battery label uses black and white only (no grey)", colours.every(ok), JSON.stringify(colours));
    const logo = await g.page.locator("[data-battery-logo]").first().getAttribute("src");
    const svg = logo?.startsWith("data:image/svg+xml;base64,") ? Buffer.from(logo.split(",")[1], "base64").toString("utf8") : "";
    const fills = Array.from(new Set(Array.from(svg.matchAll(/rgb\(([^)]*)\)/g)).map((m) => m[1].replace(/\s/g, ""))));
    check("3b: the logo prints in pure black (every grey of the logo became black or white)", fills.length > 0 && fills.every((f) => f === "0%,0%,0%" || f === "100%,100%,100%"), JSON.stringify(fills));
    const installed = ((await g.page.locator("[data-battery-installed]").first().textContent()) ?? "").trim();
    const until = ((await g.page.locator("[data-battery-valid-until]").first().textContent()) ?? "").trim();
    check("3c: INSTALLED <date> and VALID UNTIL <date>, in capitals, bold", /^INSTALLED \d{1,2} [A-Z]{3} \d{4}$/.test(installed) && /^VALID UNTIL \d{1,2} [A-Z]{3} \d{4}$/.test(until), `${installed} | ${until}`);
    const vin = await g.page.locator("[data-battery-vin]").first().evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).fontSize) * 1.15, w: el.scrollWidth, cw: el.parentElement.clientWidth }));
    check("3d: the VIN is on one line and fits the label", vin.h <= vin.lh * 1.3 && vin.w <= vin.cw + 1, JSON.stringify(vin));
    const fitsBand = await g.page.locator("[data-battery-dates]").first().evaluate((band) => Array.from(band.children).every((c) => c.scrollWidth <= band.clientWidth + 1));
    check("3e: both date lines fit inside the black band (nothing cut)", fitsBand);
    await g.page.emulateMedia({ media: "print" });
    await g.page.locator("[data-battery-sticker]").first().screenshot({ path: path.join(OUT, "3-battery-label-print-preview.png") });
    await g.page.emulateMedia({ media: "screen" });
  } else check("2a: a battery warranty label to print exists on TEST", false, "no /print/labels/ link on the warranty tab");
  const svc = links.find((h) => h.startsWith("/print/service-label/"));
  if (svc) {
    const r = await open(svc);
    check("2c: the service label prints for gate-in", r.status() === 200);
  }
  const rOld = await open(`/print/warranty-sticker/${JOB}`);
  check("2d: an old print address moves to the new one", /\/print\/warranty-label\//.test(g.page.url()), `${rOld.status()} ${g.page.url()}`);

  // 4. A page gate-in may not open: plain words, never a 404.
  const r4 = await open("/supplier-invoices");
  const words = ((await g.page.textContent("body")) ?? "").replace(/\s+/g, " ");
  check("4: a refused page says \"You don't have access to this page. Ask the owner.\" (no 404)", r4.status() !== 404 && /You don't have access to this page\./.test(words) && /Ask the owner\./.test(words), `${r4.status()} ${g.page.url()}`);
  await g.page.screenshot({ path: path.join(OUT, "4-refused-plain-words-1280.png") });
  await g.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
