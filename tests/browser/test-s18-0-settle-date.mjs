// 18 November 2026, status fix: THE BANK DAY BEFORE THE RECEIPT DAY. Network International posts "NETWORK COLLECTION
// POSTING ON 13/11" while the receipts were recorded on the 14th, so "Record a settlement" could not be dated the 13th
// (the receipt was greyed out). Now a receipt recorded after the bank day can be ticked; on Record its payment date moves
// to the bank day through THE correction (history kept). Signed in as accounts.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s18-0-settle-date.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-18-settle-date";
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
const dubai = (deltaDays = 0) => new Date(Date.now() + 4 * 3600000 + deltaDays * 86400000).toISOString().slice(0, 10);
const typed = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const dayOf = (ts) => new Date(Date.parse(ts) + 4 * 3600000).toISOString().slice(0, 10);

let payId = null;
try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [JOB]))[0];
  // A payment link payment recorded TODAY (the bank will post it as yesterday).
  payId = (await sql("insert into public.payments (number, customer_id, job_id, vehicle_id, method, amount_aed, received_at, status, auth_code) values ('E2E-RCT-S180', $1, $2, $3, 'link', 1155, now(), 'recorded', 'S18A01') returning id", [job.customer_id, JOB, job.vehicle_id]))[0].id;
  const yesterday = dubai(-1);

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/accounts-posting`);
  const form = acc.page.locator("[data-settlement-form]").first();
  await form.waitFor({ timeout: 30000 });
  await form.locator('[data-settle-method="link"]').click();
  await form.locator("[data-settle-date]").fill("");
  await form.locator("[data-settle-date]").pressSequentially(typed(yesterday));
  const row = form.locator('[data-settle-row="E2E-RCT-S180"]');
  await row.waitFor({ timeout: 20000 });
  check("A1: a receipt recorded after the bank day is NOT pre-ticked", !(await row.locator("[data-settle-tick]").isChecked()));
  check("A2: it can be ticked (no longer greyed out)", await row.locator("[data-settle-tick]").isEnabled());
  check("A3: it says so", /tick it if it is in this amount/.test(await text(row, "[data-settle-after]")));
  // Other unsettled link payments on TEST are pre-ticked by the date: this settlement is ours alone.
  for (let i = 0; i < 40 && (await form.locator("[data-settle-tick]:checked").count()) > 0; i++) {
    await form.locator("[data-settle-tick]:checked").first().click();
    await sleep(150);
  }
  await row.locator("[data-settle-tick]").check();
  check("A4: ticked, it says its payment date moves to the bank day", (await text(row, "[data-settle-after]")).includes(`moves to ${typed(yesterday)}`), await text(row, "[data-settle-after]"));
  await form.locator("[data-settle-net]").fill("1132.73");
  await form.locator("[data-settle-msf]").fill("20.21");
  await form.locator("[data-settle-txn]").fill("1.00");
  await form.locator("[data-settle-vat]").fill("1.06");
  await form.locator("[data-settle-note]").fill("NETWORK COLLECTION POSTING ON " + typed(yesterday));
  await shots(acc.page, form, "a-bank-day-before-receipt");
  await form.locator("[data-settle-save]").click();
  const q = await text(acc.page, "[data-confirm-text]");
  check("B1: the question names the move", q.includes("E2E-RCT-S180") && q.includes(`moves to ${typed(yesterday)}`), q);
  await acc.page.locator('[data-confirm-yes-money="settlement"]').click();
  const p = await until(async () => { const r = (await sql("select received_at, settlement_id from public.payments where id = $1", [payId]))[0]; return r?.settlement_id ? r : null; }, 80);
  check("B2: the settlement is recorded", !!p);
  check("B3: the receipt's payment date moved to the bank day", !!p && dayOf(p.received_at) === yesterday, p ? p.received_at : "none");
  const st = p ? (await sql("select settled_on::text as d from public.card_settlements where id = $1", [p.settlement_id]))[0] : null;
  check("B4: the settlement is dated the bank day", st?.d === yesterday, st?.d);
  const hist = (await sql("select count(*)::int as n from public.audit_log where record_id = $1 and new_data::text ilike '%Paid on or before the bank settlement%'", [payId]))[0]?.n ?? 0;
  check("B5: the move is in the payment's history with its reason", hist > 0, String(hist));
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
