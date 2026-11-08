// No Supabase image transformations on the busy pages (8 November 2026): the dashboard, job pages with photos and the
// gate-in page are opened as the owner on the TEST server and every request is watched for /render/image/.
//   node --env-file=.env.test.local tests/browser/check-no-render.mjs
import { base, browserFor, go, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const jobs = await sql(`select distinct j.id from jobs j join gate_in_media m on m.job_id = j.id where m.removed_at is null order by j.id desc limit 2`);
const pages = ["/dashboard", "/jobs", ...jobs.map((j) => `/jobs/${j.id}`), ...jobs.map((j) => `/jobs/${j.id}/gate-in`), "/gate-in", "/vehicles"];
const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
const render = [];
let images = 0;
page.on("request", (r) => {
  const u = r.url();
  if (/\/render\/image\//.test(u)) render.push(u.slice(0, 120));
  if (r.resourceType() === "image" && /supabase/.test(u)) images += 1;
});
for (const p of pages) {
  await go(page, `${base}${p}`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
}
check(`no /render/image/ request on ${pages.length} pages (${pages.join(", ")})`, render.length === 0, render.slice(0, 3).join(" | "));
check(`the pages still load their Supabase photos (${images} image requests)`, images > 0);
await browser.close();
process.exitCode = summary() ? 1 : 0;
