// Small fixes of 1 November 2026, on the TEST database:
//  C1. A supplier ticked VAT registered with no TRN shows a red warning on the supplier and on its LPOs; typing the
//      TRN puts its red Zoho rows (the vendor, its LPO bills) back in the queue by themselves.
//  C2. Clear test data: hidden and refused on the server while the Testing phase is off; while on, it needs DELETE.
//   node --env-file=.env.test.local tests/browser/test-c12.mjs   (test server on :3102)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "c12");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 10 * 60 * 1000).unref();

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;

/* ---------- C1 ---------- */
const [sup] = await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2e Notrn Supplier', true, null) returning id");
const [po] = await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date) values ('LPO-E2EC1-1', 'supplier', $1, $2, 'E2e Notrn Supplier', 'received', 300, 'received', 'E2E-C1-9', current_date) returning id", [jobId, sup.id]);
await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, last_error, attempts) values ('vendor', $1, null, 'failed', 'E2e Notrn Supplier needs its 15-digit TRN', 1), ('bill', $2, $3, 'failed', 'The supplier needs its TRN', 1)", [sup.id, po.id, jobId]);
const parts = await browserFor("parts", { viewport: { width: 1366, height: 1000 } });
const page = parts.page;
await go(page, `${base}/parts/suppliers`);
const card = page.locator("details", { hasText: "E2e Notrn Supplier" }).first();
check("C1: the supplier shows the red 'VAT registered but no TRN' warning", (await card.locator("[data-no-trn]").count()) === 1 && /no TRN/i.test((await card.locator("[data-no-trn]").textContent()) ?? ""));
await go(page, `${base}/parts/orders/${po.id}`);
check("C1: its LPO shows the red warning too", (await page.locator("[data-no-trn]").count()) === 1 && /cannot go to Zoho/i.test((await page.locator("[data-no-trn]").textContent()) ?? ""));
await page.screenshot({ path: shot("c1-lpo-warning.png") });
await go(page, `${base}/parts/suppliers`);
const c2 = page.locator("details", { hasText: "E2e Notrn Supplier" }).first();
await c2.locator("summary").click();
await c2.locator('input[name="trn"]').fill("100000000000003");
await c2.getByRole("button", { name: "Save" }).click();
await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
const msg = decodeURIComponent(page.url().replace(/\+/g, " "));
check(`C1: saving the TRN says the Zoho items try again (${msg.split("message=")[1]?.slice(0, 80)})`, /2 Zoho items try again now/.test(msg));
const rows = await sql("select kind, status, last_error from public.zoho_outbox where record_id in ($1, $2) order by kind", [sup.id, po.id]);
check("C1: the vendor row and the bill went back in the queue", rows.length === 2 && rows.every((r) => r.status === "pending" && !r.last_error), JSON.stringify(rows));
await go(page, `${base}/parts/orders/${po.id}`);
check("C1: the LPO warning is gone", (await page.locator("[data-no-trn]").count()) === 0);
await parts.browser.close();

/* ---------- C2 ---------- */
const before = (await sql("select value::text as v from public.settings where key = 'test_mode_enabled'"))[0]?.v ?? null;
const setMode = (on) => sql("insert into public.settings (key, label, value) values ('test_mode_enabled', 'Testing phase', to_jsonb($1::boolean)) on conflict (key) do update set value = excluded.value", [on]);
const jobsCount = async () => (await sql("select count(*)::int as n from public.jobs"))[0].n;
const own = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
const op = own.page;
try {
  await setMode(true);
  await go(op, `${base}/settings`);
  const box = op.locator("[data-clear-confirm]");
  check("C2: with the Testing phase on, the owner sees Clear test data asking for DELETE", (await box.count()) === 1 && /Type DELETE to confirm/i.test((await op.locator("form:has([data-clear-confirm])").textContent()) ?? ""));
  const n0 = await jobsCount();
  await box.fill("CLEAR TEST DATA");
  await op.locator("form:has([data-clear-confirm])").getByRole("button", { name: "Clear test data" }).click();
  await until(async () => /Type DELETE to confirm\./.test((await op.locator("form:has([data-clear-confirm])").textContent()) ?? "") && (await op.locator("form:has([data-clear-confirm]) .text-red, form:has([data-clear-confirm]) [role=alert]").count()) >= 0, 20, 500);
  const said = (await op.locator("form:has([data-clear-confirm])").textContent()) ?? "";
  check("C2: anything but DELETE is refused", /Type DELETE to confirm\./.test(said) && (await jobsCount()) === n0);
  // The switch goes off while the page is open: the server refuses even DELETE.
  await setMode(false);
  await op.locator("[data-clear-confirm]").fill("DELETE");
  await op.locator("form:has([data-clear-confirm])").getByRole("button", { name: "Clear test data" }).click();
  await until(async () => /switched off/i.test((await op.locator("form:has([data-clear-confirm])").textContent()) ?? ""), 30, 500);
  check("C2: with the Testing phase off the server refuses, even with DELETE", /switched off/i.test((await op.locator("form:has([data-clear-confirm])").textContent()) ?? "") && (await jobsCount()) === n0);
  await op.screenshot({ path: shot("c2-refused.png") });
  await go(op, `${base}/settings`);
  check("C2: with the Testing phase off the button is not there", (await op.locator("[data-clear-confirm]").count()) === 0);
} finally {
  if (before !== null) await sql("update public.settings set value = $1::jsonb where key = 'test_mode_enabled'", [before]);
  await own.browser.close();
}

await cleanupDb();
summary();
