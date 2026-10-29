// Batch of 29 October 2026, section 2: the tablet layout.
//  A  800x1280 (an Android tablet held upright) and 390x844 (a phone): no sidebar, the black top bar with ☰, the logo,
//     the search and the bell; ☰ slides the menu over the page; ✕, a tap outside and the back button close it; picking
//     a page closes it and opens the page.
//  B  1280x800 (the tablet sideways) and 1440x900 (a computer): the sidebar as before, no top bar.
//  C  the car card: the plate always on one line, the stage bar with its labels, the "2 quotations" picker on a car
//     with two quotations; Jobs and Bodyshop at 800x1280.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-tablet2.mjs
import path from "node:path";
import fs from "node:fs";
import { base, browserFor, browserForId, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "tablet2");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); process.exit(2); }, 12 * 60 * 1000).unref();
const until = async (fn, tries = 30, gap = 300) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

// The dashboard as Arsalan when he has an account (the person in the photo), else as an advisor.
const arsalan = (await sql("select id, display_name, role_id from public.staff where is_active and display_name ilike 'arsalan%' order by created_at limit 1"))[0] ?? null;
const open = async (vp) => (arsalan ? browserForId(arsalan.id, { viewport: vp, touch: vp.width < 1100, mobile: vp.width < 768 }) : browserFor("service_advisor", { viewport: vp, touch: vp.width < 1100, mobile: vp.width < 768 }));
console.log(`dashboard as: ${arsalan ? `${arsalan.display_name} (${arsalan.role_id})` : "an advisor"}`);

try {
  /* ---------------- A ---------------- */
  for (const [w, h, name] of [[800, 1280, "tablet-upright"], [390, 844, "phone"]]) {
    const { browser, page } = await open({ width: w, height: h });
    await go(page, `${base}/dashboard`);
    check(`A ${name}: no sidebar, the black top bar instead`, !(await page.locator("[data-sidebar]").isVisible()) && (await page.locator("[data-top-bar]").isVisible()));
    check(`A ${name}: the bell sits in the top bar`, (await page.locator("#topbar-bell-slot button").count()) >= 1);
    check(`A ${name}: the page never scrolls sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: path.join(SHOTS, `A-${name}-menu-closed.png`) });
    await page.locator("[data-menu-open]").click();
    await page.locator("[data-menu-drawer]").waitFor({ timeout: 5000 });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, `A-${name}-menu-open.png`) });
    await page.locator("[data-menu-close]").click();
    check(`A ${name}: ✕ closes the menu`, !!(await until(async () => ((await page.locator("[data-menu-drawer]").count()) === 0 ? 1 : null))));
    await page.locator("[data-menu-open]").click();
    await page.locator("[data-menu-backdrop]").click({ position: { x: w - 10, y: Math.round(h / 2) } });
    check(`A ${name}: a tap outside closes it`, !!(await until(async () => ((await page.locator("[data-menu-drawer]").count()) === 0 ? 1 : null))));
    const url = page.url();
    await page.locator("[data-menu-open]").click();
    await page.locator("[data-menu-drawer]").waitFor();
    await page.goBack();
    check(`A ${name}: the phone's back button closes it (still on the page)`, !!(await until(async () => ((await page.locator("[data-menu-drawer]").count()) === 0 ? 1 : null))) && page.url() === url, page.url());
    await page.locator("[data-menu-open]").click();
    await page.locator("[data-menu-drawer] a[href='/jobs']").click();
    await page.waitForURL(/\/jobs$/, { timeout: 15000 });
    check(`A ${name}: picking a page opens it and closes the menu`, !!(await until(async () => ((await page.locator("[data-menu-drawer]").count()) === 0 ? 1 : null))));
    await browser.close();
  }

  /* ---------------- B ---------------- */
  for (const [w, h, name] of [[1280, 800, "tablet-sideways"], [1440, 900, "computer"]]) {
    const { browser, page } = await open({ width: w, height: h });
    await go(page, `${base}/dashboard`);
    check(`B ${name}: the sidebar as before, no top bar`, (await page.locator("[data-sidebar]").isVisible()) && !(await page.locator("[data-top-bar]").isVisible()));
    await page.screenshot({ path: path.join(SHOTS, `B-${name}-dashboard.png`) });
    await browser.close();
  }

  /* ---------------- C ---------------- */
  const { browser, page } = await open({ width: 800, height: 1280 });
  await go(page, `${base}/dashboard`);
  const plates = await page.locator("[data-car-plate]").evaluateAll((els) => els.map((e) => ({ t: e.textContent, lines: new Set([...e.getClientRects()].map((r) => Math.round(r.top))).size, h: e.getBoundingClientRect().height })));
  check("C1 every plate on one line at 800x1280", plates.length > 0 && plates.every((p) => p.h < 30), plates.filter((p) => p.h >= 30).map((p) => p.t).join(", "));
  const steps = await page.locator("[data-stage-bar]").first().locator("[data-stage-step]").count();
  check("C2 the slim stage bar with a label under every step", steps >= 7);
  // Quotations are shown to the owner and advisors only, so the picker is proved on an advisor's dashboard.
  const adv = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 }, touch: true });
  await go(adv.page, `${base}/dashboard`);
  const picker = adv.page.locator("[data-quote-picker='2']").first();
  if (await picker.count()) {
    const page = adv.page;
    // The car may sit in a folded group of the list: unfold it first, as a person would.
    await picker.evaluate((el) => { for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true; el.closest("[data-car-card]").scrollIntoView({ block: "center" }); });
    await sleep(300);
    await picker.click();
    await page.locator("[data-quote-picker-menu]").waitFor({ timeout: 5000 });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "C-dashboard-quotation-picker-800x1280.png") });
    check("C3 the quotation picker opens on the car card at 800x1280 (the card is not opened)", page.url().endsWith("/dashboard") && (await page.locator("[data-quote-pick]").count()) === 2);
    await page.keyboard.press("Escape");
  } else check("C3 a car with two quotations is on the dashboard (J-00017)", false, "no picker found on the advisor's dashboard");
  await adv.browser.close();
  for (const p of ["/jobs", "/bodyshop"]) {
    await go(page, `${base}${p}`);
    check(`C4 ${p} at 800x1280: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: path.join(SHOTS, `C-${p.slice(1)}-800x1280.png`) });
  }
  await browser.close();
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
}
process.exit(summary() ? 1 : 0);
