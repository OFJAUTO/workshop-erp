// Section 3 of 29 October 2026: the auth code. When accounts record a card-machine or payment-link payment or
// deposit, the reference box becomes "Auth code" (6 letters or digits, from the card slip or the payment
// confirmation), required; the same code on another live receipt is refused; it shows on the money page and the
// receipt. As Mathew (accounts), from Waiting on you and the job's money page.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.test.local tests/browser/test-fees3.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "fees");
fs.mkdirSync(SHOTS, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const MATHEW = "e9894031-e253-4fc0-9552-026d3eaf6e88";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const mupdf = await import("mupdf");
const pdfText = (buf) => {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return t.replace(/\s+/g, " ");
};

const { browser, page } = await browserForId(MATHEW, { viewport: { width: 1366, height: 1000 } });
try {
  /* A. The deposit panel: card machine without a code is refused; a short code is named; the real code saves. */
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  await sql("update public.quotations set deposit_aed = 1470 where job_id = $1 and status = 'approved'", [seed.jobId]);
  await go(page, `${base}/dashboard`);
  await page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" }).filter({ hasText: "Deposit to record" }).first().locator("[data-record-deposit-open]").click();
  const panel = page.locator("[data-record-deposit-panel]");
  await panel.waitFor();
  await panel.locator('[data-deposit-method="card"]').click();
  check("A1 card machine: the reference box became 'Auth code (from the card slip, required)'", (await panel.locator("[data-auth-code]").count()) === 1 && /Auth code \(from the card slip, required\)/.test((await panel.textContent()) ?? ""));
  await panel.locator('input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await until(async () => (await sql("select count(*)::int as n from public.job_files where job_id = $1 and kind = 'payment_proof' and removed_at is null", [seed.jobId]))[0].n >= 1);
  await panel.locator("[data-deposit-record]").click();
  await panel.locator("[data-deposit-confirm-yes]").click();
  const refused = await until(async () => /Type the auth code from the card slip/.test((await panel.textContent()) ?? ""));
  check("A2 without the code nothing is recorded: 'Type the auth code from the card slip'", !!refused && (await sql("select count(*)::int n from public.payments where job_id = $1", [seed.jobId]))[0].n === 0);
  await panel.locator("[data-auth-code]").fill("21976");
  await panel.locator("[data-deposit-record]").click();
  await panel.locator("[data-deposit-confirm-yes]").click();
  const short = await until(async () => /6 letters or digits/.test((await panel.textContent()) ?? ""));
  check("A3 five characters are refused in words", !!short && (await sql("select count(*)::int n from public.payments where job_id = $1", [seed.jobId]))[0].n === 0);
  await panel.locator("[data-auth-code]").fill("219769");
  await panel.screenshot({ path: path.join(SHOTS, "4-auth-code-deposit.png") });
  await panel.locator("[data-deposit-record]").click();
  await panel.locator("[data-deposit-confirm-yes]").click();
  const dep = await until(async () => (await sql("select number, auth_code from public.payments where job_id = $1 and is_active", [seed.jobId]))[0] ?? null);
  check("A4 with 219769 the deposit is recorded and carries the code", dep?.auth_code === "219769", JSON.stringify(dep));

  /* B. The same code twice is a slip: refused, naming the receipt that has it. */
  const twin = (await sql("select number from public.payments where auth_code = '756117' and method = 'link' and is_active limit 1"))[0];
  if (twin) {
    cleanupDb();
    const s2 = (await api("/api/e2e/stage", { stage: "approved" })).json;
    await sql("update public.quotations set deposit_aed = 500 where job_id = $1 and status = 'approved'", [s2.jobId]);
    await go(page, `${base}/dashboard`);
    await page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" }).filter({ hasText: "Deposit to record" }).first().locator("[data-record-deposit-open]").click();
    await panel.waitFor();
    await panel.locator('[data-deposit-method="link"]').click();
    await panel.locator("[data-auth-code]").fill("756117");
    await panel.locator("[data-deposit-record]").click();
    await panel.locator("[data-deposit-confirm-yes]").click();
    const dup = await until(async () => new RegExp(`Auth code 756117 is already on ${twin.number}`).test((await panel.textContent()) ?? ""));
    check(`B the payment link's code 756117 is already on ${twin.number}: refused`, !!dup && (await sql("select count(*)::int n from public.payments where job_id = $1", [s2.jobId]))[0].n === 0);
  } else check("B duplicate check (skipped: no live payment carries 756117)", true);

  /* C. The proforma payment form: card machine with its code; shown on the money page and the receipt. */
  cleanupDb();
  const s3 = (await api("/api/e2e/stage", { stage: "ready" })).json;
  await sql("update public.invoices set sent_at = now() where id = $1", [s3.invoice.id]);
  await go(page, `${base}/jobs/${s3.jobId}/invoice`);
  const form = page.locator("[data-payment-form]").first();
  await form.waitFor({ timeout: 20000 });
  await form.locator('[data-method="card"]').click();
  check("C1 the payment form asks for the auth code (no 'Terminal slip number')", (await form.locator("[data-auth-code]").count()) === 1 && !/Terminal slip number/.test((await form.textContent()) ?? ""));
  if ((await form.locator("[data-amount-full]").count()) === 1) await form.locator("[data-amount-full]").click();
  await form.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await until(async () => (await form.locator("[data-proof-missing]").count()) === 0);
  // Without the code the browser stops the form at the box (Record opens the full-payment question first).
  await form.locator("[data-record-payment]").click();
  if (await page.locator("[data-confirm-yes]").count()) await page.locator("[data-confirm-yes]").click();
  await sleep(1500);
  if (await page.locator("[data-confirm-full]").count()) await page.keyboard.press("Escape");
  if (await page.locator("[data-confirm-full]").count()) await page.locator("[data-confirm-full] button", { hasText: /No|Cancel|Back/ }).first().click().catch(() => null);
  check("C2 without the code nothing is sent", (await sql("select count(*)::int n from public.payments where job_id = $1", [s3.jobId]))[0].n === 0);
  await form.locator("[data-auth-code]").fill("ab12cd");
  check("C3 the code is typed in capitals", (await form.locator("[data-auth-code]").inputValue()) === "AB12CD");
  await form.locator("[data-record-payment]").click();
  if (await page.locator("[data-confirm-yes]").count()) await page.locator("[data-confirm-yes]").click();
  await page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  await settle(page);
  const pay = (await sql("select id, number, auth_code from public.payments where job_id = $1 and is_active", [s3.jobId]))[0];
  check("C4 recorded with auth code AB12CD", pay?.auth_code === "AB12CD", JSON.stringify(pay));
  check("C5 the money page shows 'Auth AB12CD'", /Auth AB12CD/.test((await page.textContent("body")) ?? ""));
  const res = await fetch(`${base}/api/pdf/receipt/${pay?.id}`, { headers: { cookie: await cookieHeader(MATHEW) } });
  const text = res.status === 200 ? pdfText(Buffer.from(await res.arrayBuffer())) : "";
  check("C6 the receipt prints the auth code", /Auth code\s*AB12CD/i.test(text), text.slice(0, 200));
} finally {
  await browser.close();
}
cleanupDb();
process.exit(summary() ? 1 : 0);
