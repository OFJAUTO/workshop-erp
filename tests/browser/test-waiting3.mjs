// Batch 29 Oct (2), section 3: WAITING ON YOU closed by default.
//  A  the owner at 1440x900 and 800x1280: one slim closed bar "WAITING ON YOU · N · n URGENT  See list ▾", red and bold
//     when anything is urgent; a tap anywhere on the bar opens the list (urgent first), "Hide list ▴" closes it.
//  B  the counts update live while it is closed (a new car waiting appears in the count without a reload).
//  C  the same bar for an advisor (800x1280) and a technician's My jobs.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-waiting3.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "waiting3");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
const until = async (fn, tries = 120, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, gap)); } return null; };
const bar = (page) => page.locator("[data-waiting-panel]").first();

try {
  /* ---------------- A ---------------- */
  for (const [w, h, name] of [[1440, 900, "computer"], [800, 1280, "tablet"]]) {
    const { browser, page } = await browserFor("owner", { viewport: { width: w, height: h }, touch: w < 1100, waitingOpen: false });
    await go(page, `${base}/dashboard`);
    const panel = bar(page);
    const closed = (await panel.locator("details[open]").count()) === 0;
    const summaryEl = panel.locator("[data-waiting-summary]");
    const text = ((await summaryEl.textContent()) ?? "").replace(/\s+/g, " ");
    const urgent = Number(await panel.getAttribute("data-waiting-urgent-count"));
    const style = await summaryEl.evaluate((el) => ({ color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight, height: el.getBoundingClientRect().height }));
    const [r, g, b] = (style.color.match(/\d+/g) ?? []).map(Number);
    const isRed = r >= 150 && g < 90 && b < 90;
    check(`A ${name}: closed by default - one slim bar "Waiting on you · N${urgent ? " · n urgent" : ""}" with "See list ▾"`, closed && /Waiting on you · \d+/.test(text) && /See list ▾/.test(text) && style.height < 80 && !(await panel.locator("[data-waiting-row]").first().isVisible().catch(() => false)), `${text} · ${style.height}px`);
    if (urgent) check(`A ${name}: something is urgent: the bar is RED and bold`, isRed && Number(style.weight) >= 700, `${style.color} · ${style.weight}`);
    else check(`A ${name}: nothing urgent: the bar is black`, !isRed, style.color);
    await page.screenshot({ path: path.join(SHOTS, `A-owner-closed-${w}x${h}.png`) });
    await summaryEl.click({ position: { x: 20, y: 10 } });
    const opened = !!(await until(async () => (await panel.locator("details[open]").count()) === 1));
    const firstUrg = await panel.locator("[data-waiting-row]").first().getAttribute("data-urgency").catch(() => null);
    check(`A ${name}: a tap on the bar opens the list (urgent first) with "Hide list ▴"`, opened && (await panel.locator("[data-waiting-hide]").isVisible()) && (!urgent || firstUrg === "red"));
    await page.screenshot({ path: path.join(SHOTS, `A-owner-open-${w}x${h}.png`) });
    await panel.locator("[data-waiting-hide]").click();
    check(`A ${name}: "Hide list ▴" closes it again`, !!(await until(async () => (await panel.locator("details[open]").count()) === 0)));
    await page.screenshot({ path: path.join(SHOTS, `A-owner-closed-again-${w}x${h}.png`) });
    await browser.close();
  }

  /* ---------------- B ---------------- */
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 }, waitingOpen: false });
    await go(page, `${base}/dashboard`);
    const before = Number(await bar(page).getAttribute("data-waiting-count"));
    // A test car arrives waiting to be assigned: the owner's count moves without a reload, the bar staying closed.
    await api("/api/e2e/stage", { stage: "assign" });
    const moved = await until(async () => Number(await bar(page).getAttribute("data-waiting-count").catch(() => before)) !== before, 120, 500);
    check("B the counts update live while the bar is closed", !!moved && (await bar(page).locator("details[open]").count()) === 0, `${before} → ${await bar(page).getAttribute("data-waiting-count").catch(() => "?")}`);
    await browser.close();
  }

  /* ---------------- C ---------------- */
  {
    const { browser, page } = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 }, touch: true, waitingOpen: false });
    await go(page, `${base}/dashboard`);
    const panel = bar(page);
    const empty = (await panel.locator("[data-waiting-empty]").count()) === 1;
    check("C an advisor gets the same bar, closed (or \"Nothing waiting ✓\" with no arrow)", empty ? !/▾/.test((await panel.textContent()) ?? "") : (await panel.locator("details[open]").count()) === 0 && /See list ▾/.test((await panel.textContent()) ?? ""));
    await page.screenshot({ path: path.join(SHOTS, "C-advisor-800x1280.png") });
    await browser.close();
  }
  {
    const tech = (await sql("select id from public.staff where role_id = 'technician' and is_active order by display_name limit 1"))[0]?.id;
    const { browserForId } = await import("./pw-lib.mjs");
    const { browser, page } = await browserForId(tech, { viewport: { width: 800, height: 1280 }, touch: true, waitingOpen: false });
    await go(page, `${base}/my-jobs`);
    const panel = bar(page);
    const empty = (await panel.locator("[data-waiting-empty]").count()) === 1;
    check("C a technician's My jobs: the same bar, closed (or \"Nothing waiting ✓\")", (await panel.count()) === 1 && (empty || (await panel.locator("details[open]").count()) === 0));
    await page.screenshot({ path: path.join(SHOTS, "C-technician-800x1280.png") });
    await browser.close();
  }
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
