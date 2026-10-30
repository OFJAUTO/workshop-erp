// A full-page screenshot of one page as one role, into tests/browser/shots/<name>.png.
//   node --env-file=.env.test.local tests/browser/shot-page.mjs <role> <path> <name> [width] [height]
import path from "node:path";
import { base, browserFor, projectRoot } from "./pw-lib.mjs";

const [role, pathname, name, w, h] = process.argv.slice(2);
const { browser, page } = await browserFor(role, { viewport: { width: Number(w) || 1366, height: Number(h) || 1200 } });
await page.goto(`${base}${pathname}`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `${name}.png`), fullPage: true });
console.log("saved", name);
await browser.close();
process.exit(0);
