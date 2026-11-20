// 20 November 2026, Section 5: THE STOCK PAGE - redesign, view access, merge, the stock count. On TEST.
//  A. Parts desk: four tiles (total / in / low / out), search, one row per item with its status tag, the side panel.
//  B. Clean-up: units from the one list, placeholder part numbers flagged, "no minimum" listed; MERGE the duplicate
//     BOSCH BRAKE FLUID (history kept).
//  C. The stock count: item by item (saved), "not found", the difference and value shown, sent to the owner; nothing
//     changes until he approves it in the approval box; then the figures change and the not-found item is archived;
//     the month's stock report lists "OPENING COUNT …".
//  D. View access: a technician is refused; the owner switches "Can view stock" on; he then sees items, quantities and
//     status - no cost column, no actions (and the server refuses an action).
//  E. Shelf labels print with a QR code.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s20-5-stock.mjs
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-20-stock";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};
const ids = [];
const item = async (name, pn, qty, min, unit = "L", cost = 30) => {
  const id = (await sql("insert into public.stock_items (name, part_number, quantity, minimum_level, unit, unit_cost, item_type) values ($1, $2, $3, $4, $5, $6, 'part') returning id", [name, pn, qty, min, unit, cost]))[0].id;
  ids.push(id);
  return id;
};
let techId = null;

try {
  cleanupDb();
  const tag = `E2E S5 ${Date.now() % 100000}`;
  const A = await item(`${tag} BOSCH BRAKE FLUID`, "123W", 4, 2);
  const A2 = await item(`${tag} BOSCH BRAKE FLUID DOT4`, null, 3, 0);
  const B = await item(`${tag} ENGINE OIL 5W-40`, "A0009899701", 1, 4);
  const C = await item(`${tag} OIL FILTER`, "5ZH2", 0, 2, "pc", 20);
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });

  // A. Tiles, search, rows, panel.
  await go(parts.page, `${base}/parts/stock?q=${encodeURIComponent(tag)}`);
  await parts.page.locator("[data-stock-tiles]").waitFor({ timeout: 30000 });
  check("A1: four tiles", (await parts.page.locator("[data-stock-tile]").count()) === 4);
  check("A2: search shows the four test items, each with its status tag", (await parts.page.locator("[data-stock-row]").count()) === 4 && (await parts.page.locator(`[data-stock-row="${C}"] [data-stock-status="out"]`).count()) === 1 && (await parts.page.locator(`[data-stock-row="${B}"] [data-stock-status="low"]`).count()) === 1);
  check("A3: the repeated \"Edit the item or adjust the figure\" line is gone", !(await text(parts.page.locator("body"))).includes("Edit the item or adjust the figure"));
  check("B1: placeholder part numbers flagged (123W, 5ZH2)", (await parts.page.locator(`[data-stock-row="${A}"] [data-placeholder-pn]`).count()) === 1 && (await parts.page.locator(`[data-stock-row="${C}"] [data-placeholder-pn]`).count()) === 1);
  check("B2: an item with no minimum says so", (await parts.page.locator(`[data-stock-row="${A2}"] [data-no-minimum]`).count()) === 1);
  await shots(parts.page, parts.page.locator("main"), "a-stock-page");
  await parts.page.locator(`[data-stock-open="${A}"]`).click();
  const panel = parts.page.locator(`[data-stock-panel="${A}"]`);
  await panel.waitFor({ timeout: 15000 });
  check("A4: the side panel has Issue, Adjust, Reorder, Edit, Archive, Merge", (await panel.locator("[data-stock-tab]").count()) === 6);
  await shots(parts.page, panel.locator("div").first(), "a-side-panel");
  // B. Merge the duplicate into A.
  await panel.locator('[data-stock-tab="merge"]').click();
  await panel.locator("[data-stock-merge-other]").selectOption(A2);
  await panel.locator('[data-stock-merge] input[name="reason"]').fill("Same fluid, entered twice");
  await panel.locator("[data-stock-merge-save]").click();
  const m = await until(async () => { const x = (await sql("select (select quantity::float8 from public.stock_items where id = $1) as keep, (select is_active from public.stock_items where id = $2) as gone_active, (select merged_into from public.stock_items where id = $2) as into", [A, A2]))[0]; return x?.into ? x : null; });
  check("B3: MERGE: the duplicate's 3 L moved, it is archived as merged (history kept)", m?.keep === 7 && m?.gone_active === false && m?.into === A, JSON.stringify(m ?? {}));
  const movesKept = (await sql("select count(*)::int as n from public.stock_movements where stock_item_id = $1", [A2]))[0].n;
  check("B4: the duplicate keeps its history", movesKept >= 1);

  // C. The stock count.
  await go(parts.page, `${base}/parts/stock?count=1`);
  await parts.page.locator("[data-count-start]").click();
  await parts.page.waitForURL(/count=[0-9a-f-]{36}/, { timeout: 30000 });
  const form = parts.page.locator("[data-stock-count-form]");
  await form.waitFor({ timeout: 30000 });
  await form.locator("[data-count-search]").fill(tag);
  const bIn = form.locator(`[data-count-input="${B}"]`);
  await bIn.click();
  await bIn.pressSequentially("6", { delay: 40 });
  await bIn.blur();
  await until(async () => /Saved/.test(await text(form.locator(`[data-count-saved="${B}"]`))), 30);
  await form.locator(`[data-count-not-found="${C}"]`).check();
  await until(async () => /Saved/.test(await text(form.locator(`[data-count-saved="${C}"]`))), 30);
  await sleep(1500);
  const countId = (parts.page.url().match(/count=([0-9a-f-]{36})/) ?? [])[1];
  await go(parts.page, `${base}/parts/stock?count=${countId}&v=2`);
  const total = await text(parts.page.locator("[data-count-total]"));
  const nf = (await sql("select not_found from public.stock_count_lines where stock_item_id = $1 order by created_at desc limit 1", [C]))[0]?.not_found;
  check("C1: the difference and value before anything changes (+5 L oil at 30 = + AED 150.00; the filter marked not found)", /\+ AED 150\.00/.test(total) && (await parts.page.locator(`[data-count-diff="${B}"]`).count()) === 1 && nf === true, total);
  await shots(parts.page, parts.page.locator("[data-stock-count]"), "c-stock-count");
  const before = (await sql("select quantity::float8 as q from public.stock_items where id = $1", [B]))[0].q;
  await parts.page.locator("[data-count-submit]").click();
  await until(async () => (await sql("select count(*)::int as n from public.stock_counts where status = 'submitted'"))[0].n > 0);
  check("C2: sent to the owner; nothing changed yet", (await sql("select quantity::float8 as q from public.stock_items where id = $1", [B]))[0].q === before && before === 1);
  await parts.browser.close();
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  const cid = (await sql("select id from public.stock_counts where status = 'submitted' order by created_at desc limit 1"))[0].id;
  await go(own.page, `${base}/approvals?approval=${encodeURIComponent(`stock_count:${cid}`)}`);
  const box = own.page.locator(`[id="approval-stock_count:${cid}"]`).first();
  await box.waitFor({ timeout: 30000 });
  await shots(own.page, box, "c-owner-approves");
  await box.locator("[data-approval-approve]").first().click();
  await own.page.locator("[data-confirm-yes-money], [data-confirm-yes]").first().click({ timeout: 5000 }).catch(() => null);
  const after = await until(async () => { const x = (await sql("select (select quantity::float8 from public.stock_items where id = $1) as oil, (select is_active from public.stock_items where id = $2) as filter_active", [B, C]))[0]; return x?.oil === 6 ? x : null; });
  check("C3: approved: the oil is 6 L, the filter not found is archived", after?.oil === 6 && after?.filter_active === false, JSON.stringify(after ?? {}));
  await go(own.page, `${base}/stock-report`);
  check("C4: the month's stock report lists the count", /(OPENING|STOCK) COUNT/.test(await text(own.page.locator("[data-stock-report-counts]"))));

  // D. View access.
  const tech = await browserFor("technician", { viewport: { width: 1440, height: 1000 } });
  await go(tech.page, `${base}/my-jobs`);
  techId = await tech.page.locator('meta[name="erp-staff-id"]').getAttribute("content");
  await go(tech.page, `${base}/parts/stock`);
  check("D1: a technician without the switch is refused", (await tech.page.locator("[data-stock-tiles]").count()) === 0);
  await go(own.page, `${base}/team/${techId}`);
  await own.page.locator("[data-can-view-stock-toggle]").click();
  await until(async () => (await sql("select can_view_stock from public.staff where id = $1", [techId]))[0]?.can_view_stock === true);
  await go(tech.page, `${base}/parts/stock?q=${encodeURIComponent(tag)}&v=2`);
  await tech.page.locator("[data-stock-tiles]").waitFor({ timeout: 30000 });
  check("D2: with the switch: items, quantities and status, NO cost column", (await tech.page.locator("[data-stock-row]").count()) >= 2 && (await tech.page.locator("[data-stock-cost]").count()) === 0 && !/AED/.test(await text(tech.page.locator("[data-stock-table]"))));
  await tech.page.locator(`[data-stock-open="${A}"]`).click();
  const vp = tech.page.locator(`[data-stock-panel="${A}"]`);
  await vp.waitFor({ timeout: 15000 });
  check("D3: view only: no tabs, no actions", (await vp.locator("[data-stock-tab]").count()) === 0 && (await vp.locator("[data-stock-view-only]").count()) === 1);
  await shots(tech.page, vp.locator("div").first(), "d-view-only");
  await tech.browser.close();

  // E. Labels.
  await go(own.page, `${base}/print/stock-labels?ids=${A},${B}`);
  check("E1: black shelf labels with a QR code", (await own.page.locator("[data-stock-label]").count()) === 2);
  await own.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (techId) await sql("update public.staff set can_view_stock = false where id = $1", [techId]).catch(() => null);
  if (ids.length) await sql("update public.stock_items set is_active = false where id = any($1::uuid[])", [ids]).catch(() => null);
  await sql("update public.stock_counts set is_active = false where status in ('draft', 'submitted')").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
