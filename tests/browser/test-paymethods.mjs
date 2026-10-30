// Accounts records money from WAITING ON YOU with every method (26 October 2026, the "pay:<uuid>" fix).
// As Mathew (accounts): a deposit and a proforma payment by cash, card, payment link, bank transfer and cheque.
// Each must save, make a receipt (RCT-nnnnn) and clear its task; card and transfer carry their proof (required), the
// payment link one too (optional, Mathew's case); a cheque turns the task into "Cheque … to clear" with Cleared on the
// row, and clearing it ends the task. A bad file reference gets a plain sentence and lands in app_errors.
//   node --env-file=.env.test.local tests/browser/test-paymethods.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { api, base, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const MATHEW = "e9894031-e253-4fc0-9552-026d3eaf6e88";
const METHODS = ["cash", "card", "link", "transfer", "cheque"];
const WITH_PROOF = new Set(["card", "transfer", "link"]);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const mark = (await sql("select now() as t"))[0].t;
// Test files to remove from storage, gathered before every clean-up (which deletes the rows that name them).
const toDelete = new Set();
const collect = async () => {
  for (const r of await sql("select storage_path as p from public.job_files where job_id::text like '22222222-0000-4000-8000-00000000e%' and kind = 'payment_proof' union select proof_path from public.payments where job_id::text like '22222222-0000-4000-8000-00000000e%' and proof_path is not null")) if (r.p) toDelete.add(r.p);
};
const fresh = async () => { await collect(); cleanupDb(); };
const rowOf = (page, words) => page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" }).filter({ hasText: words });

const { browser, page } = await browserForId(MATHEW, { viewport: { width: 1500, height: 1100 } });
try {
  /* A. Deposits from the Record the deposit panel. */
  for (const m of METHODS) {
    await fresh();
    const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
    const jobId = seed.jobId;
    await sql("update public.quotations set deposit_aed = 10000 where job_id = $1 and status = 'approved'", [jobId]);
    await go(page, `${base}/dashboard`);
    check(`A ${m}: "Deposit to record" is on Mathew's Waiting on you`, (await rowOf(page, "Deposit to record").count()) === 1);
    await rowOf(page, "Deposit to record").first().locator("[data-record-deposit-open]").click();
    const panel = page.locator("[data-record-deposit-panel]");
    await panel.waitFor();
    await panel.locator(`[data-deposit-method="${m}"]`).click();
    // Card and payment link need the bank auth code (29 October 2026).
    if (m === "card" || m === "link") await panel.locator("[data-auth-code]").fill(`T${m === "card" ? "C" : "L"}${String(Date.now()).slice(-4)}`);
    if (WITH_PROOF.has(m)) {
      await panel.locator('input[type="file"]').first().setInputFiles({ name: `${m}-proof.png`, mimeType: "image/png", buffer: png });
      const up = await until(async () => (await sql("select count(*)::int as n from public.job_files where job_id = $1 and kind = 'payment_proof' and removed_at is null", [jobId]))[0].n >= 1, 40, 500);
      check(`A ${m}: the proof attaches (no "invalid input syntax for type uuid")`, !!up && !/invalid input syntax/i.test((await panel.textContent()) ?? ""));
    }
    if (m === "cheque") await panel.locator("label", { hasText: "Cheque number" }).locator("input").fill("100234");
    await panel.locator("[data-deposit-record]").click();
    // Two quick taps on Yes: still one receipt.
    await panel.locator("[data-deposit-confirm-yes]").evaluate((b) => { b.click(); b.click(); });
    const done = await until(async () => ((await panel.locator("[data-deposit-done]").count()) ? (await panel.locator("[data-deposit-done]").textContent()) : null), 40, 500);
    check(`A ${m}: saved, the receipt number shows`, !!done && /RCT-\d{5} recorded ✓/.test(done), (done ?? (await panel.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 160));
    if (m === "link") await panel.screenshot({ path: shot("paymethods-deposit-link-done.png") });
    const pays = await sql("select id, number, method, amount_aed::float8 as a, proof_path, cheque_status from public.payments where job_id = $1 and is_active", [jobId]);
    check(`A ${m}: exactly one receipt, ${m}, AED 10,000`, pays.length === 1 && pays[0].method === m && pays[0].a === 10000, JSON.stringify(pays));
    if (WITH_PROOF.has(m)) {
      const f = (await sql("select ref_id::text as r from public.job_files where job_id = $1 and kind = 'payment_proof' and removed_at is null", [jobId]))[0];
      check(`A ${m}: the proof sits on the receipt`, !!pays[0]?.proof_path && f?.r === pays[0]?.id);
    }
    await go(page, `${base}/dashboard`);
    check(`A ${m}: the "Deposit to record" line is gone`, (await rowOf(page, "Deposit to record").count()) === 0);
    if (m === "cheque") {
      const cq = rowOf(page, "to clear");
      check("A cheque: the task became 'Cheque 100234 (RCT-…) to clear' with Cleared on the row", (await cq.count()) === 1 && /Cheque 100234 \(RCT-\d{5}\) to clear/.test((await cq.first().textContent()) ?? ""));
      await cq.first().locator("[data-cheque-cleared]").click();
      await page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
      await settle(page);
      const st = (await sql("select cheque_status from public.payments where job_id = $1 and is_active", [jobId]))[0];
      check("A cheque: Cleared clears it and the task is gone", st?.cheque_status === "cleared" && (await rowOf(page, "to clear").count()) === 0);
      check("A cheque: Parts and the owner hear the deposit is in", (await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'deposit_received'", [jobId]))[0].n >= 1);
    }
  }

  /* B. Proforma payments: from the Awaiting payment line to the money page. */
  for (const m of METHODS) {
    await fresh();
    const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
    const jobId = seed.jobId;
    await sql("update public.invoices set sent_at = now() where id = $1", [seed.invoice.id]);
    await go(page, `${base}/dashboard`);
    const line = rowOf(page, "Awaiting payment");
    check(`B ${m}: "Awaiting payment" is on Mathew's Waiting on you`, (await line.count()) === 1);
    await line.first().locator("a").last().click();
    await settle(page);
    if (!/\/invoice/.test(page.url())) {
      await page.locator(`a[href="/jobs/${jobId}/invoice"]`, { hasText: /Record payment/i }).first().click();
      await settle(page);
    }
    const form = page.locator("[data-payment-form]");
    await form.waitFor({ timeout: 20000 });
    await form.locator(`[data-method="${m}"]`).click();
    if (m === "card" || m === "link") await form.locator("[data-auth-code]").fill(`P${m === "card" ? "C" : "L"}${String(Date.now()).slice(-4)}`);
    if ((await form.locator("[data-amount-full]").count()) === 1) await form.locator("[data-amount-full]").click();
    // 28 Oct: the slip goes straight to storage (no 1 MB form limit); the form sends only its key.
    if (m === "card" || m === "transfer") {
      await form.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: `${m}-slip.png`, mimeType: "image/png", buffer: png });
      await until(async () => (await form.locator("[data-proof-missing]").count()) === 0, 40, 500);
    }
    if (m === "cheque") {
      await form.locator('input[name="cheque_number"]').fill("200567");
      await form.locator('input[name="cheque_date"]').fill("2026-10-26");
    }
    await form.locator("[data-record-payment]").click();
    if (await page.locator("[data-confirm-yes]").count()) await page.locator("[data-confirm-yes]").click();
    await page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
    await settle(page);
    const pays = await sql("select number, method, amount_aed::float8 as a, proof_path from public.payments where job_id = $1 and is_active", [jobId]);
    check(`B ${m}: one receipt, ${m}, the full balance`, pays.length === 1 && pays[0].method === m && /^RCT-\d{5}$/.test(pays[0].number) && pays[0].a === Number(seed.invoice.total), JSON.stringify(pays) + " " + page.url().slice(-90));
    if (m === "card" || m === "transfer") check(`B ${m}: the proof is kept with it`, !!pays[0]?.proof_path);
    await go(page, `${base}/dashboard`);
    check(`B ${m}: the "Awaiting payment" line is gone`, (await rowOf(page, "Awaiting payment").count()) === 0);
    if (m === "cheque") {
      const cq = rowOf(page, "to clear");
      check("B cheque: the task became 'Cheque 200567 (RCT-…) to clear'", (await cq.count()) === 1);
      await cq.first().locator("[data-cheque-cleared]").click();
      await page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
      await settle(page);
      check("B cheque: Cleared ends the task", (await rowOf(page, "to clear").count()) === 0);
    }
    const tax = await until(async () => (await sql("select count(*)::int as n from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued'", [jobId]))[0].n === 1, 20, 500);
    check(`B ${m}: paid in full, the tax invoice is made`, !!tax);
  }
  await go(page, `${base}/dashboard`);
  await page.locator("[data-waiting-panel]").screenshot({ path: shot("paymethods-waiting-after.png") });

  /* C. A bad file reference: a plain sentence for staff, the technical error kept for us. */
  {
    const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
    const r = await fetch(`${base}/api/files/register`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader(MATHEW) }, body: JSON.stringify({ jobId: seed.jobId, path: `${seed.jobId}/x.png`, kind: "payment_proof", refId: "pay:bd614843-6386-48b9-822c-8d4e57ad9f40" }) });
    const j = await r.json();
    check("C: a bad reference gets a plain sentence, no database words", r.status === 400 && /^Couldn't attach the file – nothing was saved/.test(j.error ?? "") && !/uuid|syntax/i.test(j.error ?? ""), j.error);
    check("C: the technical error is kept in app_errors", (await sql("select count(*)::int as n from public.app_errors where at > $1 and place like 'file register%' and message like '%pay:%'", [mark]))[0].n >= 1);
  }
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
  // Test files out of storage, the test log rows out of app_errors.
  await collect();
  const all = [...toDelete];
  if (all.length) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: all }) });
    console.log(`storage: ${all.length} test files removed (${res.status})`);
  }
  await sql("delete from public.app_errors where at > $1 and (job_id::text like '22222222-0000-4000-8000-00000000e%' or message like '%pay:%')", [mark]);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
