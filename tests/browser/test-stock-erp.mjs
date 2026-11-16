// 16 November 2026, Section 1: STOCK STAYS IN THE ERP ONLY. "Post stock usage to Zoho" is OFF by default (owner and
// accounts change it); stock-usage entries waiting for Zoho are closed as NOT SENT and kept in the history; the stock
// report (owner and accounts): count and value as of any day, the movements, the month-end snapshot, Excel; the parts desk
// cannot open it. Signed in as accounts. TEST only.
//   node --env-file=.env.test.local tests/browser/test-stock-erp.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-16-stock-erp";
fs.mkdirSync(OUT, { recursive: true });
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const NOT_SENT = "NOT SENT - STOCK USAGE IS NOT SYNCED";
const shots = async (page, name, sel = null) => { for (const [w, h] of [[1440, 1000], [800, 1280]]) { await page.setViewportSize({ width: w, height: h }); await (sel ? page.locator(sel).first() : page).screenshot({ path: path.join(OUT, `${name}-${w}.png`), ...(sel ? {} : { fullPage: true }) }); } await page.setViewportSize({ width: 1440, height: 1000 }); };

let item = null;
try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const before = (await sql("select value from public.settings where key = 'zoho_post_stock_usage'"))[0]?.value ?? null;
  await sql("delete from public.settings where key = 'zoho_post_stock_usage'").catch(() => null);

  // A stock item with movements on known days (in 20 at 20 on 2 Oct, 10 out to the job on 10 Oct, in 16 at 25 on 3 Nov).
  item = (await sql("insert into public.stock_items (name, unit, quantity, unit_cost, part_number, item_type) values ('E2E OIL 5W30', 'l', 26, 23.08, 'E2E-OIL-1', 'consumable') returning id"))[0].id;
  // The stamp trigger dates every new row "now": the October rows are written with the triggers off (one raw statement).
  const raw = async (q) => (await api("/api/e2e/sql", { sql: `begin; set local session_replication_role = replica; ${q}; commit;` })).json;
  await raw(`update public.stock_items set created_at = '2026-10-01T06:00:00Z' where id = '${item}'`);
  const mv = async (kind, q, cost, after, at, job = null) => {
    const id = (await sql("select gen_random_uuid()::text as id"))[0].id;
    await raw(`insert into public.stock_movements (id, stock_item_id, kind, quantity, unit_cost, quantity_after, created_at, job_id, note) values ('${id}', '${item}', '${kind}', ${q}, ${cost}, ${after}, '${at}', ${job ? `'${job}'` : "null"}, 'E2E stock report')`);
    return id;
  };
  // A month end no other run has saved (snapshots are kept for good): a test month far back.
  await raw("delete from public.stock_snapshots where as_of = '2026-10-31'");
  await mv("in", 20, 20, 20, "2026-10-02T06:00:00Z");
  const used1 = await mv("out", -10, 20, 10, "2026-10-10T06:00:00Z", JOB);
  await mv("in", 16, 25, 26, "2026-11-03T06:00:00Z");
  const used2 = await mv("out", -2, 23.08, 24, new Date(Date.now() - 3600000).toISOString(), JOB);

  // 1. The switch: OFF by default; two stock-usage entries waiting (the live case) are closed as NOT SENT.
  for (const id of [used1, used2]) await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, attempts) values ('stockuse', $1, $2, 'pending', 0) on conflict (kind, record_id) do update set status = 'pending', zoho_result = null, zoho_id = null", [id, JOB]);
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/settings/zoho/mapping`);
  check("1a: accounts see \"Post stock usage to Zoho\", OFF by default", (await acc.page.locator('[data-stock-usage-state="off"]').count()) === 1 && !(await acc.page.locator("[data-stock-usage-switch]").isChecked()));
  await shots(acc.page, "1-stock-usage-switch-off", "[data-stock-usage-card]");
  await api("/api/e2e/stage", { stage: "stock-usage-close" });
  const rows = await sql("select status, zoho_result from public.zoho_outbox where kind = 'stockuse' and record_id = any($1::uuid[])", [[used1, used2]]);
  check("1b: the two waiting entries are closed as NOT SENT (kept, never sent with Sync to Zoho)", rows.length === 2 && rows.every((r) => r.status === "synced" && r.zoho_result?.skipped === NOT_SENT && r.zoho_result?.not_sent === true), JSON.stringify(rows));
  await go(acc.page, `${base}/zoho?type=stockuse&show=synced`);
  const zt = ((await acc.page.locator("main").textContent()) ?? "").replace(/s+/g, " ");
  check("1c: the Zoho Books tab shows them as NOT SENT - STOCK USAGE IS NOT SYNCED", /NOT SENT - STOCK USAGE IS NOT SYNCED/.test(zt), zt.slice(zt.indexOf("Clear"), zt.indexOf("Clear") + 400));

  // 2. Switching ON then OFF again through the screen (owner and accounts): a waiting entry closes at once.
  await go(acc.page, `${base}/settings/zoho/mapping`);
  await acc.page.locator("[data-stock-usage-switch]").check();
  await acc.page.locator("[data-stock-usage-save]").click();
  await acc.page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
  const on = (await sql("select value from public.settings where key = 'zoho_post_stock_usage'"))[0]?.value;
  check("2a: accounts switch it ON (saved)", on === true || on === "true", JSON.stringify(on));
  await sql("update public.zoho_outbox set status = 'pending', zoho_result = null where kind = 'stockuse' and record_id = $1", [used2]);
  await acc.page.locator("[data-stock-usage-switch]").uncheck();
  await acc.page.locator("[data-stock-usage-save]").click();
  await acc.page.waitForURL(/NOT\+synced|NOT%20synced|not\+synced/i, { timeout: 20000 }).catch(() => null);
  const off = (await sql("select value from public.settings where key = 'zoho_post_stock_usage'"))[0]?.value;
  const r2 = (await sql("select status, zoho_result from public.zoho_outbox where kind = 'stockuse' and record_id = $1", [used2]))[0];
  check("2b: OFF again: the waiting entry is closed as NOT SENT at once", (off === false || off === "false") && r2?.zoho_result?.skipped === NOT_SENT, JSON.stringify({ off, r2 }));

  // 3. The stock report: count and value as of any day, the movements, Excel.
  await go(acc.page, `${base}/stock-report?asof=2026-10-31&from=2026-10-01&to=2026-10-31`);
  const oct = acc.page.locator(`[data-stock-row="${item}"]`);
  check("3a: as of 31 Oct: E2E OIL 10 l at 20.00 = AED 200.00", /10 l/.test(await text(acc.page, `[data-stock-row="${item}"]`)) && /AED 200\.00/.test(await text(acc.page, `[data-stock-row="${item}"]`)), await text(acc.page, `[data-stock-row="${item}"]`));
  check("3b: the October movements: in from 2 Oct and out to the job on 10 Oct", (await acc.page.locator('[data-stock-movement="in"]').filter({ hasText: "E2E OIL" }).count()) >= 1 && (await acc.page.locator('[data-stock-movement="out"]').filter({ hasText: "E2E OIL" }).count()) >= 1);
  await shots(acc.page, "2-stock-report-31-oct");
  void oct;
  await go(acc.page, `${base}/stock-report`);
  check("3c: today: 24 l at the weighted average (23.08)", /24 l/.test(await text(acc.page, `[data-stock-row="${item}"]`)) && /23\.08/.test(await text(acc.page, `[data-stock-row="${item}"]`)), await text(acc.page, `[data-stock-row="${item}"]`));
  const resp = await acc.page.request.get(`${base}/api/export/stock?asof=2026-10-31&from=2026-10-01&to=2026-10-31`);
  const body = await resp.body();
  check("3d: Export to Excel answers with the file", resp.status() === 200 && body.subarray(0, 2).toString() === "PK");

  // 4. The month-end snapshot (the hourly job on the 1st): saved once, listed, with its own Excel.
  await api("/api/e2e/stage", { stage: "stock-snapshot", now: Date.parse("2026-11-01T06:00:00Z") });
  const snap = (await sql("select as_of::text as d, total_value::float as v, rows from public.stock_snapshots where as_of = '2026-10-31'"))[0];
  check("4a: the 31 Oct snapshot is saved (with the E2E OIL at 200.00)", !!snap && (snap.rows ?? []).some((r) => r.itemId === item && Math.abs(r.value - 200) < 0.01), JSON.stringify({ d: snap?.d, v: snap?.v }));
  const again = (await api("/api/e2e/stage", { stage: "stock-snapshot", now: Date.parse("2026-11-01T07:00:00Z") })).json?.saved;
  check("4b: never twice for the same month end", again === false);
  await go(acc.page, `${base}/stock-report`);
  check("4c: the report lists the saved month-end snapshot", (await acc.page.locator('[data-stock-snapshot="2026-10-31"]').count()) === 1);
  await acc.browser.close();

  // 5. The parts desk cannot open the stock report.
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(parts.page, `${base}/stock-report`);
  check("5: the parts desk cannot open the stock report", (await parts.page.locator("[data-stock-report]").count()) === 0);
  const ex = await parts.page.request.get(`${base}/api/export/stock`);
  check("5b: nor its export", ex.status() === 403);
  await parts.browser.close();
  if (before !== null) await sql("insert into public.settings (key, label, value) values ('zoho_post_stock_usage', 'Post stock usage to Zoho (stock lives in the ERP)', $1::jsonb) on conflict (key) do update set value = excluded.value", [JSON.stringify(before)]);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (item) {
    await sql("delete from public.zoho_outbox where kind = 'stockuse' and record_id in (select id from public.stock_movements where stock_item_id = $1)", [item]).catch(() => null);
    await sql("update public.stock_movements set is_active = false where stock_item_id = $1", [item]).catch(() => null);
    await sql("update public.stock_items set is_active = false, quantity = 0, name = 'E2E OIL (test, retired)' where id = $1", [item]).catch(() => null);
  }
  cleanupDb();
  await sleep(10);
}
process.exit(summary() ? 1 : 0);
