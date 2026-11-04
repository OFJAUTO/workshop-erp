// Part stickers 50 x 25 mm (the owner, 4 November 2026): the label is 50 x 25 landscape with the QR
// on the left (about 21 mm), on the right the OFJ logo, the job number BIG, the position and the
// black bar with the part name and "1 OF n" - everything on ONE label, nothing cut off. Proven on
// the real print page's test sample and the Settings preview (the TEST database stores 50 x 25).
//   node --env-file=.env.test.local tests/browser/test-sticker50.mjs   (test server on 3102)
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, here, makeChecks } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "sticker-50x25");
fs.mkdirSync(dir, { recursive: true });

const { browser, page } = await browserFor("parts", { viewport: { width: 1100, height: 800 }, deviceScaleFactor: 3 });
try {
  /* ---------- A. The real print page's test sample ---------- */
  await page.goto(`${base}/parts/labels/00000000-0000-4000-8000-000000000000?test=1`, { waitUntil: "load" });
  const sticker = page.locator("[data-part-sticker]").first();
  await sticker.waitFor();
  const facts = await sticker.evaluate((el) => ({
    w: el.style.width,
    h: el.style.height,
    qr: el.querySelector("[data-sticker-qr]")?.style.width ?? "",
    pos: el.querySelector("[data-sticker-pos]")?.textContent?.trim() ?? "",
    overflowX: el.scrollWidth - el.clientWidth,
    overflowY: el.scrollHeight - el.clientHeight,
    text: el.textContent ?? "",
  }));
  check("A1: the label is 50 x 25 mm", facts.w === "50mm" && facts.h === "25mm", `${facts.w} x ${facts.h}`);
  check("A2: the QR is about 21 mm square", facts.qr === "21mm", facts.qr);
  check("A3: the position is on it", facts.pos === "FRONT LEFT", facts.pos);
  check("A4: the black bar carries the name and 1 OF 2", /FRONT BRAKE PADS SET \(SAMPLE\)/i.test(facts.text.toUpperCase()) && /1 OF 2/.test(facts.text));
  check("A5: nothing is cut off", facts.overflowX <= 1 && facts.overflowY <= 1, `${facts.overflowX}/${facts.overflowY}`);
  const css = await page.content();
  check("A6: the print page sets the paper to 50 x 25", /size:\s*50mm 25mm/.test(css));
  await sticker.screenshot({ path: path.join(dir, "print-test-sample.png") });

  /* ---------- B. The Settings preview shows the same sticker ---------- */
  const ow = await browserFor("owner", { viewport: { width: 1200, height: 900 }, deviceScaleFactor: 3 });
  try {
    await ow.page.goto(`${base}/settings/stickers`, { waitUntil: "load" });
    const prev = ow.page.locator("[data-part-sticker]").first();
    await prev.waitFor();
    const b = await prev.evaluate((el) => ({ w: el.style.width, h: el.style.height, pos: el.querySelector("[data-sticker-pos]")?.textContent?.trim() ?? "" }));
    check("B1: the Settings preview is the same 50 x 25 layout with the position", b.w === "50mm" && b.h === "25mm" && b.pos === "FRONT LEFT", JSON.stringify(b));
  } finally {
    await ow.browser.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
}
process.exit(summary() ? 1 : 0);
