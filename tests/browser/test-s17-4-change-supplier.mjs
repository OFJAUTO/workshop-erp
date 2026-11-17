// 17 November 2026, Section 4: CHANGE THE SUPPLIER WHEN THE FIRST ONE CANNOT DELIVER. Signed in as the parts desk, the
// advisor and the owner. The seeded car's approved part: FRONT BRAKE PADS, cost 200.00, the customer pays 300.00.
//  A. A VISIBLE button on the part line (not in the ⋯ menu) opens the change window, with the quick reasons.
//  B. Dearer but still at the minimum markup (280.00, 7.1% > 5%): sent to the ADVISOR, whose bell carries the whole
//     decision (old and new supplier and price, difference, delivery, profit before → after); one tap approves it.
//  C. Cheaper, same type: applied at once (logged).
//  D. Below the minimum markup (290.00, 3.4%): the OWNER approves; the advisor sees "Waiting for the owner".
//  E. Another part type (Genuine → OEM): the owner.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s17-4-change-supplier.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-change-supplier";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

async function openChange(page, jobId, partId, v) {
  await go(page, `${base}/parts/${jobId}?v=${v}`);
  const btn = page.locator(`[data-change-supplier-open="${partId}"]`);
  await btn.waitFor({ timeout: 30000 });
  await btn.click();
  const d = page.locator("[data-part-change-dialog]");
  await d.locator("[data-change-cost]").waitFor({ timeout: 20000 });
  return d;
}
async function fill(d, { supplier, cost, reason = "Cannot deliver today", type = null, keep = true }) {
  await d.locator("[data-change-supplier]").selectOption({ label: supplier });
  await d.locator("[data-change-cost]").fill(String(cost));
  if (type) await d.locator("[data-change-type]").selectOption(type);
  await d.locator(`[data-change-reason-chip="${reason}"]`).click();
  if (keep && (await d.locator("[data-change-keep]").count())) await d.locator("[data-change-keep]").click();
}

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  await sql("insert into public.suppliers (name, vat_registered) values ('E2E First Supplier', false), ('E2E Second Supplier', false), ('E2E Third Supplier', false) on conflict do nothing");
  const part = (await sql("select id from public.part_items where job_id = $1 and description ilike '%brake pads%' and is_active limit 1", [JOB]))[0];
  await sql("update public.part_items set supplier = 'E2E First Supplier', order_status = 'to_order' where id = $1", [part.id]);
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });

  // A. The visible button and the quick reasons.
  const d = await openChange(parts.page, JOB, part.id, 1);
  check("A1: \"Change\" is a visible button on the part line (the supplier column)", true);
  const chips = await d.locator("[data-change-reason-chip]").allTextContents();
  check("A2: the quick reasons: Cannot deliver today, Out of stock, Better price, Other", ["Cannot deliver today", "Out of stock", "Better price", "Other"].every((c) => chips.includes(c)), chips.join(" | "));

  // B. Dearer, still at the minimum markup: the advisor.
  await fill(d, { supplier: "E2E Second Supplier", cost: 280 });
  check("B1: the window says the advisor approves it", (await d.locator("[data-change-needs-advisor]").count()) === 1 && (await text(parts.page, "[data-part-change-save]")) === "Send to the advisor");
  await shots(parts.page, d, "b-change-window-advisor");
  await d.locator("[data-part-change-save]").click();
  await d.locator("[data-part-change-done], [data-part-change-error]").first().waitFor({ timeout: 30000 });
  check("B2: sent to the advisor", /Sent to the advisor/.test(await text(parts.page, "[data-part-change-done]")), await text(parts.page, "[data-part-change-done], [data-part-change-error]"));
  const ch = await until(async () => (await sql("select id from public.part_changes where part_item_id = $1 and status = 'pending'", [part.id]))[0]);
  const bell = await until(async () => (await sql("select body, href from public.notifications where type = 'part_change' and href = $1 limit 1", [`/parts/change/${ch.id}`]))[0]);
  check("B3: the advisor's bell carries the whole decision", !!bell && /Old: E2E First Supplier · AED 200\.00 each/.test(bell.body) && /New: E2E Second Supplier · AED 280\.00 each/.test(bell.body) && /Difference: \+80\.00 each/.test(bell.body) && /Delivery:/.test(bell.body) && /Profit on this line: AED 100\.00 → AED 20\.00/.test(bell.body), bell?.body);
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 1000 } });
  await go(adv.page, `${base}/parts/change/${ch.id}`);
  await adv.page.locator("[data-part-change-approve]").waitFor({ timeout: 30000 });
  await shots(adv.page, null, "b-advisor-approves");
  await adv.page.locator("[data-part-change-approve]").click();
  const applied = await until(async () => { const r = (await sql("select supplier, cost_aed from public.part_items where id = $1", [part.id]))[0]; return r?.supplier === "E2E Second Supplier" ? r : null; });
  check("B4: one tap: the advisor approved, the part changed in place", !!applied && Number(applied.cost_aed) === 280, JSON.stringify(applied));
  check("B5: the approved quotation stays as it was (the customer's price 300.00)", Number((await sql("select unit_price from public.quotation_lines where part_item_id = $1 and is_active limit 1", [part.id]))[0]?.unit_price) === 300);

  // C. Cheaper, same type: at once.
  const d2 = await openChange(parts.page, JOB, part.id, 2);
  await fill(d2, { supplier: "E2E Third Supplier", cost: 180, reason: "Better price" });
  check("C1: cheaper, same type: applied at once", (await d2.locator("[data-change-applies-now]").count()) === 1);
  await d2.locator("[data-part-change-save]").click();
  const cheaper = await until(async () => { const r = (await sql("select supplier, cost_aed from public.part_items where id = $1", [part.id]))[0]; return r?.supplier === "E2E Third Supplier" ? r : null; });
  check("C2: changed with no approval, logged", !!cheaper && Number(cheaper.cost_aed) === 180 && (await sql("select count(*)::int as n from public.part_changes where part_item_id = $1 and status = 'applied'", [part.id]))[0].n >= 2);

  // D. Below the minimum markup: the owner.
  const d3 = await openChange(parts.page, JOB, part.id, 3);
  await fill(d3, { supplier: "E2E First Supplier", cost: 290, reason: "Out of stock" });
  check("D1: below the minimum markup: the owner approves", (await d3.locator("[data-change-needs-owner]").count()) === 1 && /Below the minimum markup/.test(await text(parts.page, "[data-change-needs-owner]")));
  await d3.locator("[data-part-change-save]").click();
  const ch2 = await until(async () => (await sql("select id from public.part_changes where part_item_id = $1 and status = 'pending'", [part.id]))[0]);
  await go(adv.page, `${base}/parts/change/${ch2.id}`);
  check("D2: the advisor cannot decide it (\"Waiting for the owner\")", (await adv.page.locator("[data-part-change-approve]").count()) === 0 && /Waiting for the owner/.test(await text(adv.page, "[data-part-change-not-yours]")));
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/parts/change/${ch2.id}`);
  await own.page.locator("[data-part-change-refuse]").click();
  check("D3: the owner refuses: the part stays as it was", !!(await until(async () => (await sql("select status from public.part_changes where id = $1", [ch2.id]))[0]?.status === "refused")) && (await sql("select supplier from public.part_items where id = $1", [part.id]))[0].supplier === "E2E Third Supplier");

  // E. Another part type: the owner.
  const d4 = await openChange(parts.page, JOB, part.id, 4);
  await fill(d4, { supplier: "E2E Third Supplier", cost: 170, reason: "Out of stock", type: "oem" });
  check("E1: another part type (Genuine → OEM): the owner approves", (await d4.locator("[data-change-needs-owner]").count()) === 1 && /part type changes/.test(await text(parts.page, "[data-change-needs-owner]")));
  await parts.browser.close();
  await adv.browser.close();
  await own.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.part_changes where job_id in (select id from public.jobs where id::text like '22222222-0000-4000-8000-00000000e%')").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
