// Zoho Books phase 1, LOCAL proof (26 October 2026, docs/zoho-plan.md): the REAL-organization write guard (test f),
// the enqueue hooks on the real money flow (payment, tax invoice, cheque on clearance), the sync page, the account
// mapping screen and the accounts' Waiting on you. Everything here runs WITHOUT Zoho: the dev machine has no Zoho
// secret, so the worker is exercised live (test-zoho1-live.mjs) and this file proves the local half.
//   node --env-file=.env.test.local tests/browser/test-zoho1.mjs   (dev server on 3100/3101 WITHOUT ZOHO_* env values)
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}

let jobId = null;
let proformaId = null;

/* ---------------- 1. Test (f): a write to the REAL organization is refused by the guard itself ---------------- */
await section("1 the REAL write guard", async () => {
  const r = await api("/api/e2e/zoho", { action: "write_to_real" });
  check("1: the write is REFUSED", r.json?.refused === true, JSON.stringify(r.json).slice(0, 200));
  check("1: the refusal says the real book is read-only until go-live", /read-only until the owner declares go-live/.test(r.json?.message ?? ""));
  const w = await api("/api/e2e/zoho", { action: "write_org" });
  check("1: writes aim at OFJ TEST (944122733) and the go-live switch is OFF", w.json?.org === "944122733" && w.json?.live === false, JSON.stringify(w.json).slice(0, 120));
  check("1: the mapping is stored with names for every line type", !!w.json?.map?.income?.labour && !!w.json?.map?.income?.bodyshop && !!w.json?.map?.depositTo?.card, JSON.stringify(w.json?.map).slice(0, 200));
});

/* ---------------- 2. The hooks: recording money queues it (through the real screens) ---------------- */
await section("2 enqueue hooks", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  proformaId = seed.json.invoice?.id ?? null;
  check("2: the seed made a proforma", seed.json.invoice?.kind === "proforma", JSON.stringify(seed.json.invoice ?? {}));
  // The payment form sits folded until the proforma is sent: the send is not under test here.
  await sql("update public.invoices set sent_at = now(), expected_payment_method = 'transfer' where id = $1", [proformaId]);
  await sql("update public.jobs set invoice_sent_at = now() where id = $1", [jobId]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1200 } });
  try {
    // A cash part-payment on the proforma -> one 'payment' outbox row, pending.
    await go(page, `${base}/jobs/${jobId}/invoice`);
    await page.locator("[data-amount-partial]").click();
    await page.locator("[data-amount-input]").fill("100");
    await page.locator('[data-method="cash"]').click();
    await page.locator("[data-record-payment]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const pay1 = await until(async () => (await sql("select id from public.payments where invoice_id = $1 and method = 'cash' and status = 'recorded'", [proformaId]))[0], 40);
    check("2: the cash payment is recorded", !!pay1, JSON.stringify(pay1));
    const row1 = pay1 ? await until(async () => (await sql("select kind, status from public.zoho_outbox where record_id = $1", [pay1.id]))[0], 20) : null;
    check("2: it joined the Zoho queue as a payment, pending", row1?.kind === "payment" && row1?.status === "pending", JSON.stringify(row1));

    // A cheque: NOTHING queues until it clears (the cheque counts the day it clears).
    await go(page, `${base}/jobs/${jobId}/invoice`);
    await page.locator("[data-amount-partial]").click();
    await page.locator("[data-amount-input]").fill("50");
    await page.locator('[data-method="cheque"]').click();
    await page.locator('[name="cheque_number"]').fill("123456");
    await page.locator('[name="cheque_date"]').fill("2026-10-26");
    await page.locator("[data-record-payment]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const cheque = await until(async () => (await sql("select id, number from public.payments where invoice_id = $1 and method = 'cheque'", [proformaId]))[0], 40);
    check("2: the cheque is recorded (pending clearance)", !!cheque, JSON.stringify(cheque));
    const chequeRow = cheque ? (await sql("select id from public.zoho_outbox where record_id = $1", [cheque.id]))[0] : null;
    check("2: a pending cheque is NOT queued for Zoho", !chequeRow, JSON.stringify(chequeRow));
    // Cleared -> queued (the inline Cleared button on the accounts' Waiting on you).
    if (cheque) {
      await go(page, `${base}/dashboard`);
      await page.locator("[data-cheque-cleared]").first().click();
      await page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      const row2 = await until(async () => (await sql("select kind, status from public.zoho_outbox where record_id = $1", [cheque.id]))[0], 20);
      check("2: the cleared cheque joined the queue", row2?.kind === "payment" && row2?.status === "pending", JSON.stringify(row2));
    }

    // Full payment by transfer -> the tax invoice exists and joined the queue too.
    await go(page, `${base}/jobs/${jobId}/invoice`);
    await page.locator('[data-method="transfer"]').click();
    await page.locator("[data-reference]").fill("E2E-ZOHO");
    await page.locator("[data-proof-input]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    await page.locator("[data-record-payment]").click();
    await page.locator("[data-confirm-yes]").waitFor({ timeout: 10000 });
    await page.locator("[data-confirm-yes]").click();
    const tax = await until(async () => (await sql("select id, number from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued'", [jobId]))[0], 40);
    check("2: the tax invoice was created", !!tax && /^INV-\d{5}$/.test(tax.number), JSON.stringify(tax));
    const invRow = tax ? await until(async () => (await sql("select kind, status from public.zoho_outbox where record_id = $1", [tax.id]))[0], 20) : null;
    check("2: the tax invoice joined the queue the moment it existed", invRow?.kind === "invoice" && invRow?.status === "pending", JSON.stringify(invRow));
    // The payment's own enqueue lands moments after the invoice's (which fires inside the conversion), so wait.
    const payCount = await until(async () => { const n = (await sql("select count(*)::int as n from public.zoho_outbox z join public.payments p on p.id = z.record_id where p.job_id = $1 and z.kind in ('payment','deposit')", [jobId]))[0]?.n; return n === 3 ? n : null; }, 20);
    check("2: every recorded payment is queued exactly once", payCount === 3, String(payCount));
  } finally {
    await browser.close();
  }
});

/* ---------------- 3. The sync page and the accounts' Waiting on you ---------------- */
await section("3 sync page and waiting", async () => {
  // One failed row (a mapping refusal, say) to prove the reason, the Retry and the amber waiting row.
  const inv = (await sql("select id from public.invoices where job_id = $1 and kind = 'tax_invoice' limit 1", [jobId]))[0];
  await sql("update public.zoho_outbox set status = 'failed', last_error = 'Mapping missing: Spare parts. Pick the account on Settings > Zoho Books > Mapping.' where record_id = $1", [inv.id]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1200 } });
  try {
    await go(page, `${base}/zoho`);
    const body = plainText(await page.content());
    check("3: the page says one-way and names OFJ TEST", /One-way/.test(body) && /944122733/.test(body), body.slice(0, 300));
    check("3: the filters carry counts", (await page.locator("[data-zoho-filters] [data-filter]").count()) === 4);
    check("3: the failed row shows the reason in plain words", (await page.locator("[data-zoho-reason]").count()) >= 1 && /Mapping missing: Spare parts/.test(body));
    check("3: Sync now and the mapping link are there", (await page.locator("[data-zoho-sync-now]").count()) === 1 && /Account mapping/.test(body));
    check("3: accounts do not see the owner's backfill", (await page.locator("[data-zoho-backfill]").count()) === 0);
    await page.screenshot({ path: "tests/browser/shots/zoho1-sync-page.png", fullPage: true });

    // The amber row on Waiting on you.
    await go(page, `${base}/dashboard`);
    const dash = plainText(await page.content());
    check("3: Waiting on you carries the failed Zoho row, amber, pointing at the sync page", /Tax invoice: Mapping missing: Spare parts/.test(dash), dash.slice(0, 200));

    // Retry puts it back in the queue (the worker itself is live-only; dev says so instead of pretending).
    await go(page, `${base}/zoho?show=failed`);
    await page.locator("[data-zoho-retry]").first().click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const after = await until(async () => { const r = (await sql("select status from public.zoho_outbox where record_id = $1", [inv.id]))[0]; return r?.status === "pending" ? r : null; }, 20);
    check("3: Retry made the row pending again", after?.status === "pending", JSON.stringify(after));
    const msg = decodeURIComponent(page.url());
    check("3: the answer says the worker is live-only on this machine", /not set up on this server/.test(msg), msg.slice(-160));

    // The owner sees the backfill button.
    const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
    await go(op, `${base}/zoho`);
    check("3: the owner sees Backfill", (await op.locator("[data-zoho-backfill]").count()) === 1);
    check("3: the nav carries Zoho Books", (await op.locator('nav a[href="/zoho"]').count()) >= 1);
    await ob.close();
  } finally {
    await browser.close();
  }
});

/* ---------------- 4. The mapping screen ---------------- */
await section("4 mapping screen", async () => {
  const zohoConfigured = ((await sql("select count(*)::int as n from public.zoho_tokens where is_active"))[0]?.n ?? 0) > 0 && !!process.env.ZOHO_CLIENT_ID;
  if (zohoConfigured) { console.log("NOTE  skipped: a real connection exists and this dev server carries Zoho values"); return; }
  const stored = (await sql("select value from public.settings where key = 'zoho_account_map'"))[0]?.value;
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1400 } });
  try {
    await go(page, `${base}/settings/zoho/mapping`);
    check("4: accounts may open the mapping screen", (await page.locator("[data-map-income]").count()) === 1);
    check("4: six income boxes, five deposit boxes, charges and advances", (await page.locator("[data-map-income] select").count()) === 6 && (await page.locator("[data-map-deposit] select").count()) === 5 && (await page.locator("[data-map-other] select").count()) === 2);
    const labour = await page.locator('[data-map-box="map__income__labour"]').inputValue();
    check("4: the stored mapping pre-fills the boxes", labour === (stored?.income?.labour ?? ""), labour);
    await page.screenshot({ path: "tests/browser/shots/zoho1-mapping.png", fullPage: true });
    await page.locator("[data-map-save]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const saved = (await sql("select value from public.settings where key = 'zoho_account_map'"))[0]?.value;
    check("4: Save keeps every stored name", JSON.stringify(saved?.income) === JSON.stringify(stored?.income) && JSON.stringify(saved?.depositTo) === JSON.stringify(stored?.depositTo), JSON.stringify(saved).slice(0, 200));
  } finally {
    await browser.close();
  }
});

/* ---------------- clean up ---------------- */
await sql("delete from public.zoho_outbox where job_id = $1 or record_id in (select id from public.payments where job_id = $1) or record_id in (select id from public.invoices where job_id = $1)", [jobId]).catch(() => null);
cleanupDb();
process.exit(summary() ? 1 : 0);
