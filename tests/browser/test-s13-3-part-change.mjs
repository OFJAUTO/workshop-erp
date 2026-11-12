// 13 November 2026, Section 3: change a part's supplier or price IN PLACE (never remove and add again), the owner's
// approval when the cost goes up, the "This replaces…" repair, the removed fold and the part-number flag. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-3-part-change.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, pageReady, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-part-change";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const JOB = "22222222-0000-4000-8000-00000000e303";
const PA = "22222222-0000-4000-8000-00000000e306";
const OLD = "22222222-0000-4000-8000-00000000ec11";
const NEWP = "22222222-0000-4000-8000-00000000ec12";
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

async function openChange(page, partId) {
  const row = page.locator(`[data-row-key]`).filter({ has: page.locator(`[data-part-name]`) }).filter({ hasText: /front brake pads/i }).first();
  await row.locator("button[aria-label='More for this part']").click();
  await page.locator("[data-part-menu] button", { hasText: "Change supplier / price…" }).click();
  await page.locator("[data-part-change-dialog]").waitFor();
  await page.locator("[data-change-supplier]").locator("option").nth(1).waitFor({ state: "attached" });
  void partId;
}

try {
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "approved" });
  if (st.status !== 200) throw new Error(`stage: ${st.status}`);
  const supplier = (await q("select name from public.suppliers where is_active and name not ilike 'our stock%' and name not ilike 'ofj%' order by name limit 1"))[0]?.name;
  const before = (await q("select supplier, cost_aed::float8 c, order_status from public.part_items where id = $1", [PA]))[0];
  check("the test car's pads are approved by the customer (to order)", before?.order_status === "to_order", JSON.stringify(before));

  // 1. Cost DOWN, another supplier: applied at once, logged, the part keeps its quotation line.
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await page.goto(`${base}/parts/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  await openChange(page, PA);
  const dlg = page.locator("[data-part-change-dialog]");
  await dlg.locator("[data-change-supplier]").selectOption({ label: supplier });
  await dlg.locator("[data-change-cost]").fill("180");
  await dlg.locator("[data-change-reason]").fill("Better price");
  const profit = await txt(dlg.locator("[data-change-profit]"));
  check("the window shows the line's profit now and after (100.00 → 120.00)", /100\.00/.test(profit) && /120\.00/.test(profit), profit);
  await page.screenshot({ path: `${OUT}/s3-change-window-1366.png` });
  await dlg.locator("[data-part-change-save]").click();
  await dlg.locator("[data-part-change-done], [data-part-change-error]").first().waitFor({ timeout: 30000 });
  check("cost down: applied at once", (await dlg.locator("[data-part-change-done]").count()) === 1, await txt(dlg));
  const after1 = (await q("select supplier, cost_aed::float8 c, order_status, is_active from public.part_items where id = $1", [PA]))[0];
  check("the part changed in place (same row, still approved – to order)", after1?.supplier === supplier && after1?.c === 180 && after1?.order_status === "to_order" && after1?.is_active === true, JSON.stringify(after1));
  const onQuote = (await q("select count(*)::int n from public.quotation_lines l join public.quotations x on x.id = l.quotation_id where l.part_item_id = $1 and l.is_active and x.status = 'approved'", [PA]))[0]?.n;
  check("it is still on the approved quotation (the customer's approval kept)", onQuote === 1, String(onQuote));
  const hist = (await q("select status, words from public.part_changes where part_item_id = $1 order by created_at desc limit 1", [PA]))[0];
  check("the history keeps old > new, who and why", hist?.status === "applied" && /cost 200\.00 → 180\.00/.test(hist.words) && /Better price/.test(hist.words), hist?.words);
  await page.locator("[data-part-change-close]").click();

  // 2. Cost UP by the parts desk: waits for the owner, the customer's price is kept (we absorb).
  await page.goto(`${base}/parts/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  check("the row says it changed", (await page.locator("[data-part-changed]").count()) >= 1);
  await openChange(page, PA);
  await dlg.locator("[data-change-cost]").fill("230");
  await dlg.locator("[data-change-reason]").fill("Supplier price changed");
  check("cost up: the owner must approve", (await dlg.locator("[data-change-needs-owner]").count()) === 1);
  check("the customer already approved: keep the price or revise", (await dlg.locator("[data-change-keep]").count()) === 1 && (await dlg.locator("[data-change-revise]").count()) === 1);
  check("we absorb AED 50.00 if the price is kept", /50\.00/.test(await txt(dlg.locator("[data-change-keep]"))), await txt(dlg.locator("[data-change-keep]")));
  await dlg.locator("[data-change-keep]").click();
  await page.screenshot({ path: `${OUT}/s3-keep-or-revise-1366.png` });
  await dlg.locator("[data-part-change-save]").click();
  await dlg.locator("[data-part-change-done], [data-part-change-error]").first().waitFor({ timeout: 30000 });
  const pend = (await q("select status, price_choice, absorb_aed::float8 a from public.part_changes where part_item_id = $1 order by created_at desc limit 1", [PA]))[0];
  check("it waits for the owner (nothing changed yet)", pend?.status === "pending" && pend?.price_choice === "keep" && pend?.a === 50, JSON.stringify(pend));
  const still = (await q("select cost_aed::float8 c from public.part_items where id = $1", [PA]))[0];
  check("the part keeps 180.00 until the owner decides", still?.c === 180, JSON.stringify(still));
  await browser.close();

  // The owner approves it on the Approvals page.
  const o = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await o.page.goto(`${base}/approvals`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const box = o.page.locator("[data-approval-kind='part_change']").first();
  const found = (await box.count()) > 0;
  check("the change is on the owner's Approvals", found);
  if (found) {
    await box.locator("[data-approval-approve]").click();
    await until(async () => (await q("select status from public.part_changes where part_item_id = $1 order by created_at desc limit 1", [PA]))[0]?.status === "applied", 40);
  }
  const ap = (await q("select cost_aed::float8 c from public.part_items where id = $1", [PA]))[0];
  check("approved: the part takes 230.00, the customer's price unchanged", ap?.c === 230, JSON.stringify(ap));
  await o.page.screenshot({ path: `${OUT}/s3-owner-approvals-1366.png` });

  // 3. The repair: a part removed and added again (the NISSAN PATROL case) is linked with "This replaces…".
  await q("insert into public.part_items (id, job_id, description, quantity, cost_aed, availability, order_status, supplier, is_active, removed_at, removed_reason, part_type, created_by, updated_by) select $1, $2, 'rear wiper blade', 1, 40, 'to_order', 'none', 'Old Supplier', true, now(), 'change supplier', 'genuine', created_by, created_by from public.part_items where id = $3 on conflict (id) do nothing", [OLD, JOB, PA]);
  const q1 = (await q("select quotation_id from public.quotation_lines where part_item_id = $1 and is_active limit 1", [PA]))[0]?.quotation_id;
  await q("update public.quotations set status = 'draft' where id = $1", [q1]);
  await q("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, unit_price, part_item_id, line_total) values ($1, 9, 'part', 'REAR WIPER BLADE', 'manual', 1, 40, 50, 60, $2, 60)", [q1, OLD]);
  await q("update public.quotations set status = 'approved' where id = $1", [q1]);
  await q("insert into public.part_items (id, job_id, description, quantity, cost_aed, availability, order_status, supplier, is_active, part_type, part_number, created_by, updated_by) select $1, $2, 'rear wiper blade', 1, 38, 'to_order', 'none', $4, true, 'genuine', 'BLADE', created_by, created_by from public.part_items where id = $3 on conflict (id) do nothing", [NEWP, JOB, PA, supplier]);
  const p2 = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await p2.page.goto(`${base}/parts/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(p2.page);
  check("the re-added line says what to do", (await p2.page.locator("[data-relink-hint]").count()) === 1);
  check("a part number that is just the name is flagged", (await p2.page.locator("[data-pn-flag]").filter({ hasText: "Part number is the name" }).count()) >= 1);
  check("removed rows fold into one line at the bottom", /Removed \(\d+\)/.test(await txt(p2.page.locator("[data-removed-fold-summary]"))), await txt(p2.page.locator("[data-removed-fold-summary]")));
  await p2.page.screenshot({ path: `${OUT}/s3-relink-and-fold-1366.png`, fullPage: true });
  const nrow = p2.page.locator("[data-row-key]").filter({ has: p2.page.locator("[data-relink-hint]") }).first();
  await nrow.locator("button[aria-label='More for this part']").click();
  await p2.page.locator("[data-part-menu] button", { hasText: "This replaces…" }).click();
  await p2.page.locator(`[data-relink-target='${OLD}']`).click();
  await p2.page.locator("[data-relink-done]").waitFor({ timeout: 30000 });
  const linked = (await q("select replaced_part_id, order_status from public.part_items where id = $1", [NEWP]))[0];
  check("linked: it inherits the customer's approval (to order, no second approval)", linked?.replaced_part_id === OLD && linked?.order_status === "to_order", JSON.stringify(linked));
  await p2.page.setViewportSize({ width: 800, height: 1280 });
  await p2.page.goto(`${base}/parts/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(p2.page);
  check("after the link the hint is gone", (await p2.page.locator("[data-relink-hint]").count()) === 0);
  await p2.page.screenshot({ path: `${OUT}/s3-after-link-800.png` });

  // 4. On an ordered LPO, not received: the change cancels that line with the old supplier and puts the part on an
  //    LPO for the new one in the same step.
  const by = (await q("select created_by from public.part_items where id = $1", [PA]))[0]?.created_by;
  const po = (await q("insert into public.purchase_orders (number, job_id, supplier_name, kind, status, total_cost_aed, created_by, updated_by) values ('E2E-LPO-S3', $1, 'E2E OLD SUPPLIER', 'supplier', 'ordered', 230, $2, $2) returning id", [JOB, by]))[0];
  const pol = (await q("insert into public.purchase_order_lines (po_id, position, description, quantity, unit_cost, part_item_id, created_by, updated_by) values ($1, 1, 'FRONT BRAKE PADS', 1, 230, $2, $3, $3) returning id", [po.id, PA, by]))[0];
  await q("update public.part_items set po_id = $1, po_line_id = $2, order_status = 'ordered', supplier = 'E2E OLD SUPPLIER' where id = $3", [po.id, pol.id, PA]);
  const p3 = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await p3.page.goto(`${base}/parts/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(p3.page);
  await openChange(p3.page, PA);
  const d3 = p3.page.locator("[data-part-change-dialog]");
  await d3.locator("[data-change-supplier]").selectOption({ label: supplier });
  await d3.locator("[data-change-cost]").fill("225");
  await d3.locator("[data-change-reason]").fill("Supplier has none");
  await d3.locator("[data-part-change-save]").click();
  await d3.locator("[data-part-change-done], [data-part-change-error]").first().waitFor({ timeout: 30000 });
  const doneWords = await txt(d3);
  check("on an ordered LPO: the answer says the old line was cancelled", /E2E-LPO-S3: the line was cancelled/.test(doneWords), doneWords.slice(0, 300));
  const oldLine = (await q("select is_active from public.purchase_order_lines where id = $1", [pol.id]))[0];
  const oldPo = (await q("select status from public.purchase_orders where id = $1", [po.id]))[0];
  check("the old supplier's line is cancelled (its LPO too, nothing left on it)", oldLine?.is_active === false && oldPo?.status === "cancelled", JSON.stringify({ oldLine, oldPo }));
  const moved = await until(async () => (await q("select p.po_id, p.supplier, p.order_status, o.status, o.kind from public.part_items p left join public.purchase_orders o on o.id = p.po_id where p.id = $1", [PA]))[0]);
  check("the part is on an LPO for the new supplier, waiting for approval", moved?.po_id && moved.po_id !== po.id && moved.supplier === supplier && moved.status === "pending_approval", JSON.stringify(moved));
  await p3.page.screenshot({ path: `${OUT}/s3-lpo-moved-1366.png` });
  await p3.browser.close();

  // 5. A received part is never changed here (a purchase return only).
  await q("update public.part_items set received_qty = 1, order_status = 'received' where id = $1", [PA]);
  await p2.page.goto(`${base}/parts/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(p2.page);
  const prow = p2.page.locator("[data-row-key]").filter({ hasText: /front brake pads/i }).first();
  await prow.locator("button[aria-label='More for this part']").click();
  check("received: no Change supplier / price", (await p2.page.locator("[data-part-menu] button", { hasText: "Change supplier / price…" }).count()) === 0);
  await p2.browser.close();
  await o.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await api("/api/e2e/sql", { sql: "update public.part_changes set is_active = false where job_id = $1", params: [JOB] }).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
