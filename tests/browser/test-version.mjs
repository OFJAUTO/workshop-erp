// Section 4 of 27 October (afternoon): a new version tells the user, no dead clicks, nothing typed is lost.
// Needs the dev server started as version "e2e-v1":  APP_VERSION_OVERRIDE=e2e-v1 npx next dev -p 3101
// The test writes public/version.json as "e2e-v2" (the "newer deploy") and removes it at the end.
//   node --env-file=.env.local tests/browser/test-version.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const VERSION_FILE = "public/version.json";
const done = (code) => { try { fs.rmSync(VERSION_FILE, { force: true }); } catch {} cleanupDb(); process.exit(code); };
setTimeout(() => { console.log("TIMEOUT: stopping"); done(2); }, 12 * 60 * 1000).unref();
cleanupDb();
fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: "e2e-v2" }));

const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); done(1); }
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const [line] = await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, created_by, updated_by) values ($1, 50, 'labour', 'E2E VERSION LINE', 'manual', 1, 1, 350, $2, $2) returning id", [qid, owner]);

const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
try {
  // 1. The bar.
  await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
  await page.waitForSelector(`#name-${line.id}`, { timeout: 30000 });
  const bar = await page.waitForSelector("[data-new-version]", { timeout: 40000 }).catch(() => null);
  check("1: a newer version on the server shows the bar", !!bar && /A new version is available – tap to refresh/.test((await bar.textContent()) ?? ""));
  await page.screenshot({ path: "tests/browser/shots/version-bar.png" });

  // 2. Typing, then tapping the bar at once (inside the half-second wait): the text is not lost.
  const name = page.locator(`#name-${line.id}`);
  await name.click();
  await name.fill("E2E TYPED JUST BEFORE THE REFRESH");
  await page.evaluate(() => { window.__beforeReload = true; });
  await page.locator("[data-new-version]").click();
  await page.waitForFunction(() => !window.__beforeReload, null, { timeout: 20000 }).catch(() => null);
  check("2: tapping the bar reloads the page", await page.evaluate(() => !window.__beforeReload));
  let title = "";
  for (let i = 0; i < 10 && title !== "E2E TYPED JUST BEFORE THE REFRESH"; i++) {
    await sleep(1000);
    title = (await sql("select title from public.quotation_lines where id = $1", [line.id]))[0]?.title ?? "";
  }
  check("2: what was typed in the quotation reached the server across the reload", title === "E2E TYPED JUST BEFORE THE REFRESH", title);

  // 3a. An old tab asking for a code chunk the new deploy no longer has reloads by itself.
  const marker = async () => page.evaluate(() => { try { sessionStorage.removeItem("erp-version-reload-at"); } catch {} window.__oldTab = true; });
  const reloadedSoon = () => page.waitForFunction(() => !window.__oldTab, null, { timeout: 20000 }).then(() => true).catch(() => false);
  await go(page, `${base}/home`);
  await page.waitForLoadState("domcontentloaded");
  await sleep(1500);
  await marker();
  await page.evaluate(() => { void import(/* webpackIgnore: true */ "/_next/static/chunks/e2e-gone-after-deploy.js"); });
  check("3: a missing code chunk (old tab after a deploy) reloads the page by itself", await reloadedSoon());
  // 3b. A form whose server action the new deploy no longer has (the card settlements form, as accounts): no dead
  // click, the page reloads by itself.
} finally {
  await browser.close();
}

// 3b. As accounts: a server action the new deploy no longer has.
{
  const [cust3] = await sql("select customer_id from public.jobs where id = $1", [jobId]);
  const [p3] = await sql("insert into public.payments (job_id, customer_id, method, amount_aed, bank_charge_aed, received_at, received_by, is_deposit, created_by, updated_by) values ($1, $2, 'card', 500, 11.3, now() - interval '1 day', $3, true, $3, $3) returning id, number", [jobId, cust3.customer_id, owner]);
  const ab = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
  try {
    await go(ab.page, `${base}/card-settlements?method=card`);
    await ab.page.waitForSelector(`[data-settle-row="${p3.number}"]`, { timeout: 30000 });
    for (const box of await ab.page.locator("[data-settle-tick]").all()) {
      const no = await box.getAttribute("data-settle-tick");
      if (no !== p3.number && (await box.isChecked())) await box.uncheck();
    }
    const rec = ab.page.locator("[data-settle-received]");
    await rec.click();
    await rec.pressSequentially("490");
    await rec.blur();
    await sleep(800);
    await ab.page.evaluate(() => { try { sessionStorage.removeItem("erp-version-reload-at"); } catch {} window.__oldTab = true; });
    await ab.page.route("**/*", (r) => (r.request().method() === "POST" && r.request().headers()["next-action"] ? r.fulfill({ status: 404, headers: { "x-nextjs-action-not-found": "1", "content-type": "text/plain" }, body: "Server action not found." }) : r.continue()));
    await ab.page.locator("[data-settle-save]").click();
    const ok3b = await ab.page.waitForFunction(() => !window.__oldTab, null, { timeout: 20000 }).then(() => true).catch(() => false);
    await ab.page.unroute("**/*");
    if (!ok3b) await ab.page.screenshot({ path: "tests/browser/shots/version-action-debug.png" });
    check("3: a form whose server action the new deploy no longer has reloads the page instead of a dead click", ok3b);
    const settled = await sql("select settlement_id from public.payments where id = $1", [p3.id]);
    check("3: nothing was recorded by the refused click", !settled[0]?.settlement_id);
  } finally {
    await ab.browser.close();
  }
}

// 4. The gate-in form: a note typed just before the reload is put back.
const [cust] = await sql("select customer_id from public.jobs where id = $1", [jobId]);
const [make] = await sql("select id from public.vehicle_makes limit 1");
const [car] = await sql("insert into public.vehicles (customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, created_by, updated_by) values ($1, 'UAE', 'Dubai', 'V', $2, true, $3, $4, $4) returning id", [cust.customer_id, String(Date.now()).slice(-5), make.id, owner]);
const gb = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
try {
  await go(gb.page, `${base}/gate-in/new?vehicle=${car.id}`);
  const notes = gb.page.locator('textarea[name="notes"]').first();
  await notes.waitFor({ timeout: 30000 });
  await notes.fill("E2E NOTE TYPED BEFORE THE RELOAD");
  await gb.page.evaluate(() => { window.dispatchEvent(new Event("erp:before-reload")); location.reload(); });
  await gb.page.waitForLoadState("domcontentloaded");
  await gb.page.locator('textarea[name="notes"]').first().waitFor({ timeout: 30000 });
  await sleep(1500);
  const back = await gb.page.locator('textarea[name="notes"]').first().inputValue();
  check("4: the gate-in note typed just before the reload is put back", back === "E2E NOTE TYPED BEFORE THE RELOAD", back);
  await gb.page.screenshot({ path: "tests/browser/shots/version-gatein-draft.png" });
  await gb.page.evaluate((id) => { try { localStorage.removeItem(`erp-draft-gate-in-${id}`); } catch {} }, car.id);
} finally {
  await gb.browser.close();
}

done(summary() ? 1 : 0);
