// Screens update by themselves (19 October 2026, section 10): change a job in one place and the open
// dashboard shows it within seconds - no reload, no scroll jump, nothing typed is lost.
//   node --env-file=.env.test.local tests/browser/test-live.mjs
import { api, browserFor, base, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";

await cleanupDb();
const { jobId } = (await api("/api/e2e/stage", { stage: "quote" })).json;

const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(3500); // let the realtime channel subscribe
check("the seeded car is on the dashboard", (await page.locator(`[data-flash-id="${jobId}"]`).count()) === 1);
const before = (await page.locator(`[data-flash-id="${jobId}"]`).textContent()) ?? "";
await page.evaluate(() => { window.__noReload = 1; window.scrollTo(0, 400); });
const scrollBefore = await page.evaluate(() => window.scrollY);

// The other side: the job moves on (as if another person changed it on their screen).
await sql("update public.jobs set status = 'waiting_parts', stage = 'parts', stage_entered_at = now() where id = $1", [jobId]);

// Within seconds the open dashboard says so - without a reload and without moving.
let changed = null;
for (let i = 0; i < 40; i++) {
  const text = (await page.locator(`[data-flash-id="${jobId}"]`).textContent().catch(() => "")) ?? "";
  if (text !== before && /in Parts|Planning/i.test(text)) { changed = text; break; }
  await sleep(500);
}
check("the dashboard shows the new stage within seconds", !!changed, (changed ?? "").slice(0, 80));
check("no page reload happened", (await page.evaluate(() => window.__noReload)) === 1);
const scrollAfter = await page.evaluate(() => window.scrollY);
check("the scroll position did not move", Math.abs(scrollAfter - scrollBefore) < 2, `${scrollBefore} -> ${scrollAfter}`);
check("the grey Updated chip is there", (await page.locator("[data-live-updated]").count()) === 1, await page.locator("[data-live-updated]").textContent().catch(() => ""));
await page.screenshot({ path: `${shots}/live-dashboard.png` });
await browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
