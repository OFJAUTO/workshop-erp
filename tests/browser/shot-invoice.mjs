// Screenshots of the invoice page (and the job card tile) for a job, as several roles.
//   node --env-file=.env.local tests/browser/shot-invoice.mjs <jobId> [roles]
import path from "node:path";
import { base, browserFor, projectRoot } from "./pw-lib.mjs";

const jobId = process.argv[2];
const roles = (process.argv[3] ?? "owner,service_advisor,accounts").split(",");
for (const role of roles) {
  const { browser, page } = await browserFor(role, { viewport: { width: 1366, height: 1400 } });
  await page.goto(`${base}/jobs/${jobId}/invoice`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `invoice-${role}.png`), fullPage: true });
  await page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  const tile = page.locator("[data-money-tile]").first();
  if (await tile.count()) await tile.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `tile-${role}.png`) });
  console.log(role, "done");
  await browser.close();
}
process.exit(0);
