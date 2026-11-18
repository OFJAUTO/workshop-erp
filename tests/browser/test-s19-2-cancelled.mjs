// 19 November 2026, Section 2: CANCELLED DOCUMENTS LEAVE THE ZOHO QUEUE (RCT-00091, a duplicate voided on 17 Nov,
// still waited in the queue). Signed in as the owner (voids) and accounts (the Zoho page).
//  A. A receipt voided before it reached Zoho leaves the queue at once: "NOT SENT – CANCELLED BEFORE SYNC", kept in the
//     history, shown as "Not sent" (never "Posted ✓").
//  B. One voided earlier (the RCT-00091 case) is withdrawn the moment the Zoho page opens; Sync to Zoho never lists it.
//  C. A supplier payment voided before sync: the same rule.
//  D. A receipt voided AFTER it reached Zoho: its reversal is queued by itself and runs (accounts never remove it by hand).
// TEST only (Zoho is the test stand-in).  node --env-file=.env.test.local tests/browser/test-s19-2-cancelled.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-19-cancelled-queue";
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
const rowOf = async (kind, id) => (await sql("select status, zoho_id, zoho_result from public.zoho_outbox where kind = $1 and record_id = $2", [kind, id]))[0];

const SPN = `E2E-SPAY-S19-${Date.now() % 100000}`;
try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [JOB]))[0];
  const pro = (await sql("select id from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' and is_active limit 1", [JOB]))[0];
  const pay = async (number, extra = "") => (await sql(`insert into public.payments (number, customer_id, job_id, invoice_id, vehicle_id, method, amount_aed, status${extra ? ", zoho_payment_id" : ""}) values ($1, $2, $3, $4, $5, 'cash', 100, 'recorded'${extra ? ", $6" : ""}) returning id`, extra ? [number, job.customer_id, JOB, pro.id, job.vehicle_id, extra] : [number, job.customer_id, JOB, pro.id, job.vehicle_id]))[0].id;
  // A: waiting in the queue, then voided by the owner on the invoice page.
  const a = await pay("E2E-RCT-S19A");
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, enqueued_at) values ('payment', $1, $2, 'pending', now() - interval '2 hours')", [a, JOB]);
  // B: voided earlier with its row left waiting (the RCT-00091 case).
  const b = await pay("E2E-RCT-S19B");
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, enqueued_at) values ('payment', $1, $2, 'pending', now() - interval '2 hours')", [b, JOB]);
  await sql("update public.payments set status = 'voided', void_reason = 'Duplicate (e2e)', voided_at = now() where id = $1", [b]);
  // D: already in Zoho, then voided: the reversal must queue by itself (the test stand-in removes it).
  const d = await pay("E2E-RCT-S19D", "E2E-ZP-1");
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, zoho_id, synced_at, zoho_result, enqueued_at) values ('payment', $1, $2, 'synced', 'E2E-ZP-1', now() - interval '1 hour', $3::jsonb, now() - interval '3 hours')", [d, JOB, JSON.stringify({ receipt: "E2E-RCT-S19D", e2e_stub: "reverse" })]);

  // A. The owner voids it.
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/invoices/${pro.id}`);
  for (const [num, id] of [["E2E-RCT-S19A", a], ["E2E-RCT-S19D", d]]) {
    const li = own.page.locator("li").filter({ hasText: num }).filter({ has: own.page.locator('[data-confirm-open="void-receipt"]') }).last();
    await li.waitFor({ timeout: 30000 });
    await li.locator("summary").filter({ hasText: "Void this receipt" }).first().click();
    await li.locator('details:has(summary:has-text("Void this receipt")) [name="reason"]').first().fill("Duplicate entry (e2e)");
    await li.locator('[data-confirm-open="void-receipt"]').first().click();
    await own.page.locator('[data-confirm-yes-money="void-receipt"]').click();
    await until(async () => (await sql("select status from public.payments where id = $1", [id]))[0]?.status === "voided", 40);
    await go(own.page, `${base}/invoices/${pro.id}?v=${num}`);
  }
  const ra = await until(async () => { const r = await rowOf("payment", a); return r?.status === "synced" ? r : null; }, 40);
  check("A1: voided before sync: it leaves the queue at once", !!ra);
  check("A2: NOT SENT – CANCELLED BEFORE SYNC, kept in the history", /^NOT SENT – CANCELLED BEFORE SYNC: E2E-RCT-S19A was voided/.test(String(ra?.zoho_result?.skipped ?? "")), String(ra?.zoho_result?.skipped ?? ""));

  // B. The Zoho page withdraws the old one the moment it opens.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  check("B0: before the page opens it still waits (as RCT-00091 did)", (await rowOf("payment", b))?.status === "pending");
  await go(acc.page, `${base}/zoho?show=all&q=E2E-RCT-S19`);
  const rb = await until(async () => { const r = await rowOf("payment", b); return r?.status === "synced" ? r : null; }, 20);
  check("B1: opening the Zoho page withdraws it", !!rb && /CANCELLED BEFORE SYNC/.test(String(rb.zoho_result?.skipped ?? "")));
  await go(acc.page, `${base}/zoho?show=all&q=E2E-RCT-S19B`);
  const row = acc.page.locator("[data-zoho-row]").filter({ hasText: "E2E-RCT-S19B" }).first();
  await row.waitFor({ timeout: 30000 });
  check("B2: the history says Not sent, never Posted ✓", (await row.locator("[data-zoho-not-sent]").count()) === 1 && /CANCELLED BEFORE SYNC/.test(await text(row)));
  await shots(acc.page, row, "b-not-sent-cancelled");

  // C. A supplier payment voided before sync.
  const sup = (await sql("select id, name from public.suppliers order by name limit 1"))[0];
  const sp = (await sql("insert into public.supplier_payments (number, supplier_id, supplier_name, paid_on, method, amount_aed, status) values ($3, $1, $2, current_date, 'cash', 50, 'void') returning id", [sup.id, sup.name, SPN]))[0].id;
  await sql("insert into public.zoho_outbox (kind, record_id, status) values ('supplierpay', $1, 'pending')", [sp]);
  await go(acc.page, `${base}/zoho?show=all&q=${SPN}`);
  const rc = await until(async () => { const r = await rowOf("supplierpay", sp); return r?.status === "synced" ? r : null; }, 20);
  check("C1: a supplier payment voided before sync: the same rule", !!rc && /CANCELLED BEFORE SYNC: E2E-SPAY-S19-[0-9]+ was voided/.test(String(rc.zoho_result?.skipped ?? "")));

  // D. Voided after it reached Zoho: back in the queue by itself, and the run takes it out of Zoho.
  const rd = await rowOf("payment", d);
  check("D1: voided AFTER Zoho: the reversal is queued by itself (not withdrawn)", rd?.status === "pending" && rd?.zoho_id === "E2E-ZP-1", JSON.stringify(rd ?? {}).slice(0, 160));
  // The run (the same row runner as Sync to Zoho), on the test stand-in.
  await api("/api/e2e/zoho", { action: "run_rows", ids: [(await sql("select id from public.zoho_outbox where kind = 'payment' and record_id = $1", [d]))[0].id] });
  const rd2 = await until(async () => { const r = await rowOf("payment", d); return r?.status === "synced" && r.zoho_result?.reversed ? r : null; }, 60);
  check("D2: the run removes it from Zoho (no work by hand)", !!rd2, JSON.stringify((await rowOf("payment", d)) ?? {}).slice(0, 200));
  await own.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.zoho_outbox where record_id in (select id from public.supplier_payments where number like 'E2E-SPAY-S19%')").catch(() => null);
  await sql("update public.supplier_payments set is_active = false where number like 'E2E-SPAY-S19%'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
