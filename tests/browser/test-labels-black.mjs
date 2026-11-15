// 15 November 2026, Section 6: LABELS PRINT BLACK ONLY. Each label type (part, battery, oil service) is printed to PDF
// with "Background graphics" OFF (Chromium's print with printBackground: false) and rasterized: the date lines and every
// word are there in solid black; no element has a background fill, a non-black colour or an opacity below 1; the PDF
// stickers and the part-label PDF carry no grey and no filled box. Signed in as the owner (Settings > Labels). TEST only.
//   node --env-file=.env.test.local tests/browser/test-labels-black.mjs
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, go, makeChecks } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-15-labels-black";
fs.mkdirSync(OUT, { recursive: true });

/** Rasterize page 1 of a PDF: the PNG, the share of mid-grey pixels (not near black, not near white), the text. */
function look(buf, name) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(path.join(OUT, `${name}.png`), pix.asPNG());
  const px = pix.getPixels();
  const n = pix.getNumberOfComponents();
  let grey = 0;
  let dark = 0;
  const total = pix.getWidth() * pix.getHeight();
  for (let i = 0; i < total; i++) {
    const v = (px[i * n] + px[i * n + 1] + px[i * n + 2]) / 3;
    if (v < 60) dark++;
    else if (v < 200) grey++;
  }
  return { grey: grey / total, dark: dark / total, text: page.toStructuredText().asText().replace(/\s+/g, " ").trim() };
}

try {
  const own = await browserFor("owner", { viewport: { width: 1200, height: 1000 } });
  for (const kind of ["part", "battery", "service"]) {
    await go(own.page, `${base}/print/label-test?kind=${kind}`);
    // Every element of the label: black text, no fill (white or none), opacity 1, no shadow.
    const bad = await own.page.evaluate(() => {
      const root = document.querySelector("[data-part-sticker], [data-battery-sticker], [data-service-sticker]");
      if (!root) return ["no label on the page"];
      const out = [];
      for (const el of [root, ...root.querySelectorAll("*")]) {
        if (el.tagName === "IMG") continue;
        const cs = getComputedStyle(el);
        const hasText = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
        if (hasText && cs.color !== "rgb(0, 0, 0)") out.push(`${el.textContent.trim().slice(0, 30)}: colour ${cs.color}`);
        const bg = cs.backgroundColor;
        if (!(bg === "rgba(0, 0, 0, 0)" || bg === "rgb(255, 255, 255)" || bg === "transparent")) out.push(`${el.tagName}: fill ${bg}`);
        if (Number(cs.opacity) < 1) out.push(`${el.tagName}: opacity ${cs.opacity}`);
        if (cs.boxShadow !== "none" || cs.textShadow !== "none") out.push(`${el.tagName}: shadow`);
        if (Number(cs.borderTopWidth) > 0 && cs.borderTopColor !== "rgb(0, 0, 0)") out.push(`${el.tagName}: border ${cs.borderTopColor}`);
      }
      return out;
    });
    check(`${kind}: every word solid black, no fill, no opacity, no shadow`, bad.length === 0, bad.slice(0, 4).join(" | "));
    // The print preview with "Background graphics" OFF.
    await own.page.emulateMedia({ media: "print" });
    const pdf = await own.page.pdf({ printBackground: false, preferCSSPageSize: true });
    await own.page.emulateMedia({ media: "screen" });
    const r = look(pdf, `${kind}-print-preview-background-graphics-off`);
    if (kind === "battery") {
      check("battery: INSTALLED, VALID UNTIL and 24 MONTHS WARRANTY all print (background graphics off)", /INSTALLED 16 OCT 2026/.test(r.text) && /VALID UNTIL 16 OCT 2028/.test(r.text) && /24 MONTHS WARRANTY/i.test(r.text), r.text.slice(0, 160));
      const sizes = await own.page.evaluate(() => {
        const px = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
        return { title: px("[data-battery-title]"), installed: px("[data-battery-installed]"), until: px("[data-battery-valid-until]"), vin: px("[data-battery-vin]") };
      });
      check("battery: the date lines are the biggest text after the title", sizes.installed === sizes.until && sizes.installed < sizes.title && sizes.installed > sizes.vin, JSON.stringify(sizes));
    }
    if (kind === "service") check("service: the next-service date prints (background graphics off)", /16 Oct 2027/i.test(r.text), r.text.slice(0, 160));
    check(`${kind}: the print preview has no grey area (grey pixels ${(r.grey * 100).toFixed(2)}% - only the edges of letters)`, r.grey < 0.05, `dark ${(r.dark * 100).toFixed(1)}%`);
  }
  // The part-label PDF (a test label): black only.
  const resp = await own.page.request.get(`${base}/api/pdf/part-labels?test=1`);
  const pl = look(Buffer.from(await resp.body()), "part-label-pdf");
  check("part-label PDF: black only, no grey area", resp.status() === 200 && pl.grey < 0.05, `grey ${(pl.grey * 100).toFixed(2)}%`);
  await own.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
}
process.exit(summary() ? 1 : 0);
