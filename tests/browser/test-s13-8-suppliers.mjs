// 13 November 2026, Section 8: suppliers - a rename always saves (the duplicate check ignores the supplier itself), a
// clash says why and links the other record, an existing TRN shows the existing record, and Merge suppliers moves
// everything across with the old name kept as "also known as". TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-8-suppliers.mjs
import fs from "node:fs";
import { api, base, browserFor, makeChecks, pageReady, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-suppliers";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const ids = [];

try {
  const trn = `1004${String(Date.now()).slice(-11)}`;
  const a = (await q("insert into public.suppliers (name, trn, vat_registered, is_active) values ('E2E SPAREIN AUTO SPARE PARTS', $1, true, true) returning id", [trn]))[0];
  const b = (await q("insert into public.suppliers (name, trn, vat_registered, is_active) values ('E2E SPAREIN AUTOMOTIVE L.L.C', $1, true, true) returning id", [trn]))[0];
  const c = (await q("insert into public.suppliers (name, trn, vat_registered, is_active) values ('E2E THE EMIRATES AMERICAN TRANSMISSION', '100999888777003', true, true) returning id"))[0];
  ids.push(a.id, b.id, c.id);
  const by = (await q("select id from public.staff where role_id = 'owner' limit 1"))[0].id;
  const po = (await q("insert into public.purchase_orders (number, supplier_id, supplier_name, kind, status, total_cost_aed, created_by, updated_by) values ('E2E-LPO-S8', $1, 'E2E SPAREIN AUTOMOTIVE L.L.C', 'stock', 'approved', 357, $2, $2) returning id", [b.id, by]))[0];

  const o = await browserFor("accounts", { viewport: { width: 1366, height: 900 } });
  // 1. A rename with the TRN untouched always saves.
  await o.page.goto(`${base}/parts/suppliers?q=E2E%20THE%20EMIRATES`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const row = o.page.locator(`[data-supplier-row='${c.id}']`);
  await row.locator("summary").click();
  await row.locator("input[name='name']").fill("E2E THE EMIRATES AMERICAN AUTOMATIC TRANSMISSION CO LLC");
  await row.locator("form button[type='submit']").first().click();
  await o.page.waitForURL(/message=|error=/, { timeout: 20000 });
  const renamed = (await q("select name, also_known_as from public.suppliers where id = $1", [c.id]))[0];
  check("the rename saved (TRN untouched)", renamed?.name === "E2E THE EMIRATES AMERICAN AUTOMATIC TRANSMISSION CO LLC", decodeURIComponent(o.page.url().split("?")[1] ?? ""));
  check("the old name stays searchable (also known as)", (renamed?.also_known_as ?? []).includes("E2E THE EMIRATES AMERICAN TRANSMISSION"), JSON.stringify(renamed?.also_known_as));

  // 2. A clash with ANOTHER supplier's name: the refusal says why and links to it.
  await o.page.goto(`${base}/parts/suppliers?q=E2E%20THE%20EMIRATES`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  await o.page.locator(`[data-supplier-row='${c.id}'] summary`).click();
  await o.page.locator(`[data-supplier-row='${c.id}'] input[name='name']`).fill("E2E SPAREIN AUTO SPARE PARTS");
  await o.page.locator(`[data-supplier-row='${c.id}'] form button[type='submit']`).first().click();
  await o.page.waitForURL(/error=/, { timeout: 20000 });
  await pageReady(o.page);
  const err = decodeURIComponent(o.page.url());
  check("the clash says why in plain words", /another supplier is already called/i.test(err), err.slice(0, 200));
  check("…and links to the other record", (await o.page.locator(`[data-supplier-other] a[href='#s-${a.id}']`).count()) === 1);
  await o.page.screenshot({ path: `${OUT}/s8-clash-1366.png` });

  // 3. Adding a supplier with an existing TRN shows the existing record instead.
  await o.page.goto(`${base}/parts/suppliers`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const add = o.page.locator("form").filter({ has: o.page.locator("button", { hasText: "Add supplier" }) }).first();
  await add.locator("input[name='name']").fill("E2E SPAREIN NEW");
  await add.locator("input[name='trn']").fill(trn);
  await add.locator("button", { hasText: "Add supplier" }).click();
  await o.page.waitForURL(/error=/, { timeout: 20000 });
  check("an existing TRN shows the existing record", /already on the list/.test(decodeURIComponent(o.page.url())) && /other=/.test(o.page.url()));
  const extra = (await q("select count(*)::int n from public.suppliers where name = 'E2E SPAREIN NEW'"))[0].n;
  check("no second record was made", extra === 0, String(extra));

  // 4. The two records sharing a TRN: Merge suppliers.
  await o.page.goto(`${base}/parts/suppliers`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const pair = o.page.locator(`[data-trn-pair='${trn}']`);
  check("the pair sharing a TRN is listed", (await pair.count()) === 1);
  await pair.locator(`[data-merge-keep='${a.id}']`).check();
  await pair.locator("[data-merge-reason]").fill("Same company, same TRN");
  await o.page.screenshot({ path: `${OUT}/s8-merge-1366.png` });
  await pair.locator("[data-merge-submit]").click();
  await o.page.waitForURL(/message=|error=/, { timeout: 20000 });
  const gone = (await q("select is_active, merged_into from public.suppliers where id = $1", [b.id]))[0];
  const kept = (await q("select also_known_as from public.suppliers where id = $1", [a.id]))[0];
  const moved = (await q("select supplier_id, supplier_name from public.purchase_orders where id = $1", [po.id]))[0];
  check("merged: the other record stays, inactive, merged into the kept one (nothing deleted)", gone?.is_active === false && gone?.merged_into === a.id, JSON.stringify(gone));
  check("its LPO moved across", moved?.supplier_id === a.id, JSON.stringify(moved));
  check("its name is kept as 'also known as'", (kept?.also_known_as ?? []).includes("E2E SPAREIN AUTOMOTIVE L.L.C"), JSON.stringify(kept?.also_known_as));
  await o.page.goto(`${base}/parts/suppliers?q=AUTOMOTIVE%20L.L.C`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  check("a search by the old name finds the kept supplier", (await o.page.locator(`[data-supplier-row='${a.id}']`).count()) === 1);
  const log = (await q("select count(*)::int n from public.audit_log where table_name = 'suppliers' and record_id = $1 and action = 'MERGE'", [a.id]))[0].n;
  check("the merge is logged", log === 1, String(log));
  await o.page.setViewportSize({ width: 800, height: 1280 });
  await o.page.screenshot({ path: `${OUT}/s8-after-merge-800.png` });
  await o.browser.close();
  ids.push(po.id);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await api("/api/e2e/sql", { sql: "update public.purchase_orders set status = 'cancelled' where number = 'E2E-LPO-S8'" }).catch(() => null);
  for (const id of ids) await api("/api/e2e/sql", { sql: "update public.suppliers set is_active = false where id = $1", params: [id] }).catch(() => null);
}
process.exit(summary() ? 1 : 0);
