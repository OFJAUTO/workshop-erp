// 13 November 2026, Section 1 (screen sweep): proof screenshots of the pages fixed, at a computer (1366x768) and a
// tablet held upright (800x1280), as the owner. TEST only. Every page is also measured with THE layout rules
// (spill, split amounts, overlaps), so the proof is a check too.
//   node --env-file=.env.test.local tests/browser/proof-s1-sweep.mjs
import fs from "node:fs";
import { browserFor, pageReady, cleanupDb } from "./pw-lib.mjs";
import { measurePage } from "./layout-rules.mjs";

const OUT = "docs/proof/2026-11-13-screen-sweep";
fs.mkdirSync(OUT, { recursive: true });
const base = process.env.E2E_BASE ?? "http://localhost:3102";
const q64 = process.env.Q64 ?? "/jobs/ffc5c614-6cea-4a3c-935b-6eb5eacc8e51/quote/aa22bb3a-669b-460f-8d85-ba1e0512d1ce";
const e65 = "/estimates/51caded9-65e4-4e67-b0af-4b840952b57d";
const PAGES = [
  ["01-quotation-parts", q64],
  ["02-estimate-parts", e65],
  ["03-team-form", "/team/new"],
  ["04-labels-warranty", "/stickers?tab=warranty"],
  ["05-parts-table", "/parts/22222222-0000-4000-8000-00000000e303"],
  ["06-settings-breaks", "/settings"],
  ["07-scoreboard", "/scoreboard"],
  ["08-parts-accounts", "/parts-accounts"],
  ["09-invoices-and-payments", "/invoices"],
  ["10-profit", "/profit"],
];
const SIZES = [[1366, 768, false], [800, 1280, true]];
let failed = 0;
for (const [w, h, touch] of SIZES) {
  const { browser, page } = await browserFor("owner", { viewport: { width: w, height: h }, touch });
  for (const [name, path] of PAGES) {
    await page.goto(base + path, { waitUntil: "domcontentloaded" });
    await pageReady(page);
    // The quotation pages: scroll the parts table into view, that is the part being proven.
    if (name.includes("parts") && path.includes("quote") || path.includes("estimates/")) await page.locator("[data-part-line]").first().scrollIntoViewIfNeeded().catch(() => null);
    const problems = await page.evaluate(measurePage, { touch, limit: 20 });
    if (problems.length) { failed++; console.log(`FAIL ${name} @${w}x${h}\n  - ${problems.join("\n  - ")}`); } else console.log(`OK   ${name} @${w}x${h}`);
    await page.screenshot({ path: `${OUT}/${name}-${w}x${h}.png`, fullPage: false });
  }
  await browser.close();
}
if (process.env.CLEANUP) cleanupDb();
console.log(failed ? `${failed} pages with problems` : "all pages clean");
process.exit(failed ? 1 : 0);
