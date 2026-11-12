// 13 November 2026, Section 2: stock purchases and stock used on jobs reach Zoho (option B), Zoho's refusals in
// plain words. TEST only (the TEST server has no Zoho connection: the posting itself is the stand-in; the queue, the
// words and the order are real).
//   node --env-file=.env.test.local tests/browser/test-s13-2-stock-zoho.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, pageReady, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-stock-zoho";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const ITEM = "22222222-0000-4000-8000-00000000ec01";
const OB1 = "22222222-0000-4000-8000-00000000ec02";

try {
  cleanupDb();
  // The stage seed's car is an open job with a technician.
  const st = await api("/api/e2e/stage", { stage: "approved" });
  if (st.status !== 200) throw new Error(`stage: ${st.status}`);
  const job = "22222222-0000-4000-8000-00000000e303";
  await q("insert into public.stock_items (id, name, unit, quantity, unit_cost, is_active, item_type) values ($1, 'E2E ENGINE OIL 5W30', 'L', 20, 32.50, true, 'consumable') on conflict (id) do update set quantity = 20, unit_cost = 32.50, is_active = true", [ITEM]);

  // 1. Stock used on a job: issued from the stock page, its Zoho posting is queued.
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await page.goto(`${base}/parts/stock`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const form = page.locator("form").filter({ has: page.locator("select[name='stock_item']") }).last();
  await form.locator("select[name='stock_item']").selectOption(ITEM);
  await form.locator("select[name='job']").selectOption(job);
  await form.locator("input[name='quantity']").fill("4");
  const tech = await form.locator("select[name='technician'] option").evaluateAll((os) => os.map((o) => o.value).find((v) => v));
  await form.locator("select[name='technician']").selectOption(tech);
  await form.locator("input[name='pin']").fill("1234").catch(() => null);
  await form.locator("button[type='submit']").last().click();
  await page.waitForURL(/message=|error=/, { timeout: 30000 });
  check("the stock was issued to the job", /message=/.test(page.url()), decodeURIComponent(page.url().split("?")[1] ?? ""));
  const mv = await until(async () => (await q("select id, quantity::float8 q, unit_cost::float8 c from public.stock_movements where stock_item_id = $1 and kind = 'out' order by created_at desc limit 1", [ITEM]))[0]);
  check("the out movement carries the stock cost", mv && mv.q === -4 && mv.c === 32.5, JSON.stringify(mv));
  const row = await until(async () => (await q("select id, kind, status, job_id from public.zoho_outbox where kind = 'stockuse' and record_id = $1", [mv?.id]))[0]);
  check("its Zoho posting (stock used on a job) is queued", row && row.status === "pending" && row.job_id === job, JSON.stringify(row));

  // 2. The Sync to Zoho preview lists it in its own group, with the value moved.
  await page.goto(`${base}/zoho?sync=1`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const group = page.locator("[data-zoho-preview-group='stockuse']");
  await group.waitFor({ timeout: 20000 }).catch(() => null);
  const gText = (await group.textContent().catch(() => "")) ?? "";
  check("the Sync preview shows 'Stock used on jobs' with AED 130.00", /Stock used on jobs/.test(gText) && /130\.00/.test(gText), gText.replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: `${OUT}/s2-sync-preview-1366.png` });
  await page.keyboard.press("Escape").catch(() => null);

  // 3. A Zoho refusal is stored in plain words: what, why and the fix (the stand-in answers with Zoho's raw text).
  await q("insert into public.zoho_outbox (id, kind, record_id, status, zoho_result) values ($1, 'bill', $2, 'pending', jsonb_build_object('e2e_stub', 'fail', 'e2e_words', 'Zoho said: Item field under stock account cannot be empty.')) on conflict (id) do update set status = 'pending', last_error = null, zoho_result = excluded.zoho_result", [OB1, "22222222-0000-4000-8000-00000000ec03"]);
  const run = await api("/api/e2e/zoho", { action: "run_rows", ids: [OB1] });
  check("the stand-in run answered", run.status === 200, JSON.stringify(run.json ?? run.text).slice(0, 200));
  const failed = (await q("select status, last_error from public.zoho_outbox where id = $1", [OB1]))[0];
  check("the refusal is stored in plain words (what, why, the fix)", failed?.status === "failed" && /inventory account/.test(failed.last_error) && /ERP keeps the stock count/.test(failed.last_error) && /Mapping/.test(failed.last_error), failed?.last_error);
  await page.goto(`${base}/zoho?show=failed`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const body = (await page.locator("main").textContent().catch(() => "")) ?? "";
  check("the Zoho tab shows the plain words", /ERP keeps the stock count/.test(body));
  await page.screenshot({ path: `${OUT}/s2-zoho-tab-plain-words-1366.png` });

  // 4. Saving the mapping puts the failed mapping rows back in the queue.
  await page.goto(`${base}/settings/zoho/mapping`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const stockBox = page.locator("[name='map__purchase__stock']");
  const hint = (await page.locator("[data-map-purchases]").textContent().catch(() => "")) ?? "";
  check("the mapping explains the stock value account (option B)", /ERP keeps the count/.test(hint) && /Other Current Asset/.test(hint));
  await page.screenshot({ path: `${OUT}/s2-mapping-1366.png` });
  if (await stockBox.count()) {
    await page.locator("form").filter({ has: stockBox }).locator("button[type='submit']").first().click();
    await page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
    const back = (await q("select status from public.zoho_outbox where id = $1", [OB1]))[0];
    check("after saving the mapping the failed stock bill goes again", back?.status === "pending", JSON.stringify(back));
  } else check("the stock value box is on the mapping page", false);
  await browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await api("/api/e2e/sql", { sql: "delete from public.zoho_outbox where id = $1 or (kind = 'stockuse' and record_id in (select id from public.stock_movements where stock_item_id = $2))", params: [OB1, ITEM] }).catch(() => null);
  await api("/api/e2e/sql", { sql: "update public.stock_items set is_active = false where id = $1", params: [ITEM] }).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
