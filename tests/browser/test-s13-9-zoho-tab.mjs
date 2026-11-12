// 13 November 2026, Section 9: the Zoho Books tab - one search box (number, name, plate, job, amount) with the type,
// date and status filters; failed documents at the top in their own box with Try again; Last syncs folded. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-9-zoho-tab.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, pageReady } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-zoho-tab";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const OB1 = "22222222-0000-4000-8000-00000000ed01";
const OB2 = "22222222-0000-4000-8000-00000000ed02";

try {
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "approved" });
  if (st.status !== 200) throw new Error(`stage: ${st.status}`);
  const job = (await q("select job_number from public.jobs where id = '22222222-0000-4000-8000-00000000e303'"))[0].job_number;
  const sup = (await q("select id, name from public.suppliers where is_active and name not ilike 'e2e%' order by name limit 1"))[0];
  await q("insert into public.zoho_outbox (id, kind, record_id, job_id, status, last_error, attempts) values ($1, 'contact', '22222222-0000-4000-8000-00000000e301', '22222222-0000-4000-8000-00000000e303', 'failed', 'Zoho refused this bill: its parts went to a Zoho inventory account. Fix: pick a Stock value account, then press Retry.', 1) on conflict (id) do update set status = 'failed'", [OB1]);
  await q("insert into public.zoho_outbox (id, kind, record_id, status, zoho_id, synced_at, attempts) values ($1, 'vendor', $2, 'synced', 'E2E-ZV', now(), 1) on conflict (id) do update set status = 'synced'", [OB2, sup.id]);

  const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 900 } });
  await page.goto(`${base}/zoho`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const box = page.locator("[data-zoho-failed-box]");
  check("failed documents sit at the top in their own box", (await box.count()) === 1 && (await box.locator(`#z-${OB1}`).count()) === 1);
  check("…with the reason in plain words and Try again", /inventory account/.test(await txt(box.locator(`#z-${OB1} [data-zoho-reason]`))) && (await box.locator(`#z-${OB1} [data-zoho-retry]`).count()) === 1);
  check("a failed row is never shown twice", (await page.locator(`#z-${OB1}`).count()) === 1);
  check("Last syncs is one folded line", (await page.locator("details[data-zoho-runs]").count()) <= 1);
  await page.screenshot({ path: `${OUT}/s9-failed-box-1366.png` });

  // The search: by job number (failed row), by supplier name (posted row), with the type filter.
  await page.locator("[data-zoho-search-input]").fill(job);
  await page.locator("[data-zoho-search-go]").click();
  await page.waitForURL(/q=/);
  await pageReady(page);
  check("search by job number finds the document", (await page.locator(`#z-${OB1}`).count()) === 1, page.url());
  check("…and only the matching ones", (await page.locator(`#z-${OB2}`).count()) === 0);
  await page.goto(`${base}/zoho?q=${encodeURIComponent(sup.name.slice(0, 12))}&type=vendor`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const vrow = page.locator(`#z-${OB2}`);
  check("search by supplier name with the type filter finds it", (await vrow.count()) === 1);
  check("each result shows its Zoho status and when it was posted", /Posted/.test(await txt(vrow)) && /posted \d/.test(await txt(vrow)), (await txt(vrow)).slice(0, 160));
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: `${OUT}/s9-search-800.png` });
  await browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await api("/api/e2e/sql", { sql: "delete from public.zoho_outbox where id in ($1, $2)", params: [OB1, OB2] }).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
