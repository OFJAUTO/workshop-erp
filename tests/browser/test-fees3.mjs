// Section 3 of 29 October 2026: the auth code. When accounts record a card-machine or payment-link payment or
// deposit, the reference box becomes "Auth code" (6 letters or digits, from the card slip or the payment
// confirmation); the same code on another live receipt is refused; it shows on the money page and the receipt.
// 3 November 2026 (section 5): the code is OPTIONAL ("Optional – helps match the bank report"). Without it, or with a
// made-up one (111111), the payment is SAVED and flagged "Auth code missing"; only a wrong length is refused.
// As Mathew (accounts), from Waiting on you and the job's money page.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.test.local tests/browser/test-fees3.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql, pressRecord } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "fees");
fs.mkdirSync(SHOTS, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const MATHEW = "e9894031-e253-4fc0-9552-026d3eaf6e88";
const HINT = "Optional – helps match the bank report";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const mupdf = await import("mupdf");
const pdfText = (buf) => {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return t.replace(/\s+/g, " ");
};
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

const { browser, page } = await browserForId(MATHEW, { viewport: { width: 1366, height: 1000 } });
const openDeposit = async () => {
  await go(page, `${base}/dashboard`);
  await page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" }).filter({ hasText: "Deposit to record" }).first().locator("[data-record-deposit-open]").click();
  const panel = page.locator("[data-record-deposit-panel]");
  await panel.waitFor();
  return panel;
};
try {
  /* A. The deposit panel: optional with the hint; a short code is named; without a code it SAVES (flagged); a real code is kept. */
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  await sql("update public.quotations set deposit_aed = 2940 where job_id = $1 and status = 'approved'", [seed.jobId]);
  let panel = await openDeposit();
  await panel.locator('[data-deposit-method="card"]').click();
  check("A1 card machine: the reference box became 'Auth code (optional)' with the hint 'Optional – helps match the bank report'", (await panel.locator("[data-auth-code]").count()) === 1 && /Auth code \(optional\)/.test((await panel.textContent()) ?? "") && (await text(panel.locator("[data-auth-optional-hint]"))) === HINT);
  await panel.locator('input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await until(async () => (await sql("select count(*)::int as n from public.job_files where job_id = $1 and kind = 'payment_proof' and removed_at is null", [seed.jobId]))[0].n >= 1);
  await panel.locator("[data-deposit-amount]").fill("1000");
  await panel.locator("[data-auth-code]").fill("21976");
  await panel.locator("[data-deposit-record]").click();
  const short = await until(async () => /6 letters or digits/.test((await panel.textContent()) ?? ""));
  check("A3 five characters are refused in words (before the question)", !!short && (await panel.locator("[data-deposit-confirm]").count()) === 0 && (await sql("select count(*)::int n from public.payments where job_id = $1", [seed.jobId]))[0].n === 0);
  await panel.locator("[data-auth-code]").fill("");
  await panel.locator("[data-deposit-record]").click();
  const ask = await text(panel.locator("[data-deposit-confirm-text]"));
  check("A2 without the code the question says 'auth code missing (flagged)'", /\(auth code missing \(flagged\)\)/.test(ask), ask);
  await panel.locator("[data-deposit-confirm-yes]").click();
  const dep0 = await until(async () => (await sql("select number, auth_code, amount_aed::float8 a from public.payments where job_id = $1 and is_active", [seed.jobId]))[0] ?? null);
  check("A2 without the code the deposit is SAVED, with no code (flagged 'Auth code missing')", !!dep0 && dep0.auth_code === null, JSON.stringify(dep0));
  await go(page, `${base}/jobs/${seed.jobId}/invoice`);
  check("A2 the money page flags it in amber with 'Add auth code'", (await page.locator(`[data-auth-missing="${dep0?.number}"]`).count()) === 1 && (await page.locator(`[data-auth-add="${dep0?.number}"]`).count()) === 1);
  // The rest of the deposit with the real code.
  panel = await openDeposit();
  await panel.locator('[data-deposit-method="card"]').click();
  await panel.locator('input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await until(async () => (await panel.locator("[data-deposit-record]").isDisabled()) === false, 60, 500);
  await panel.locator("[data-auth-code]").fill("219769");
  await panel.screenshot({ path: path.join(SHOTS, "4-auth-code-deposit.png") });
  await panel.locator("[data-deposit-record]").click();
  check("A4 the question names the code ('auth 219769')", /\(auth 219769\)/.test(await text(panel.locator("[data-deposit-confirm-text]"))));
  await panel.locator("[data-deposit-confirm-yes]").click();
  const dep = await until(async () => (await sql("select number, auth_code from public.payments where job_id = $1 and is_active and auth_code is not null", [seed.jobId]))[0] ?? null);
  check("A4 with 219769 the deposit is recorded and carries the code", dep?.auth_code === "219769", JSON.stringify(dep));

  /* B. The same code twice is a slip: refused, naming the receipt that has it. */
  const twin = (await sql("select number from public.payments where auth_code = '756117' and method = 'link' and is_active limit 1"))[0];
  if (twin) {
    cleanupDb();
    const s2 = (await api("/api/e2e/stage", { stage: "approved" })).json;
    await sql("update public.quotations set deposit_aed = 500 where job_id = $1 and status = 'approved'", [s2.jobId]);
    panel = await openDeposit();
    await panel.locator('[data-deposit-method="link"]').click();
    await panel.locator("[data-auth-code]").fill("756117");
    await panel.locator("[data-deposit-record]").click();
    await panel.locator("[data-deposit-confirm-yes]").click();
    const dup = await until(async () => new RegExp(`Auth code 756117 is already on ${twin.number}`).test((await panel.textContent()) ?? ""));
    check(`B the payment link's code 756117 is already on ${twin.number}: refused`, !!dup && (await sql("select count(*)::int n from public.payments where job_id = $1", [s2.jobId]))[0].n === 0);
  } else check("B duplicate check (skipped: no live payment carries 756117)", true);

  /* C. The proforma payment form: "111111" saved as missing; then the card machine with its real code. */
  cleanupDb();
  const s3 = (await api("/api/e2e/stage", { stage: "ready" })).json;
  await sql("update public.invoices set sent_at = now() where id = $1", [s3.invoice.id]);
  await go(page, `${base}/jobs/${s3.jobId}/invoice`);
  let form = page.locator("[data-payment-form]").first();
  await form.waitFor({ timeout: 20000 });
  await form.locator('[data-method="card"]').click();
  check("C1 the payment form asks for the auth code (no 'Terminal slip number'), optional", (await form.locator("[data-auth-code]").count()) === 1 && !/Terminal slip number/.test((await form.textContent()) ?? "") && (await form.locator("[data-auth-code]").getAttribute("required")) === null);
  await form.locator("[data-amount-partial]").click();
  await form.locator("[data-amount-input]").fill("100");
  await form.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await until(async () => (await form.locator("[data-proof-missing]").count()) === 0);
  await form.locator("[data-auth-code]").fill("111111");
  await form.locator("[data-record-payment]").first().click();
  const q = page.locator("[data-confirm-full]");
  await q.waitFor({ timeout: 10000 });
  const words = await text(q.locator("[data-confirm-text]"));
  check("C2 '111111': the question says 'auth code missing (flagged)', never the made-up code", /auth code missing \(flagged\)/.test(words) && !/111111/.test(words), words);
  await q.locator("[data-confirm-yes]").click();
  await page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  await settle(page);
  const made = (await sql("select number, auth_code from public.payments where job_id = $1 and is_active and amount_aed = 100", [s3.jobId]))[0];
  check("C2 saved as missing: no code in the column, the amber flag on the money page", !!made && made.auth_code === null && (await page.locator(`[data-auth-missing="${made.number}"]`).count()) === 1, JSON.stringify(made));
  form = page.locator("[data-payment-form]").first();
  await form.locator('[data-method="card"]').click();
  if ((await form.locator("[data-amount-full]").count()) === 1) await form.locator("[data-amount-full]").click();
  await form.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "slip2.png", mimeType: "image/png", buffer: png });
  await until(async () => (await form.locator("[data-proof-missing]").count()) === 0);
  await form.locator("[data-auth-code]").fill("ab12cd");
  check("C3 the code is typed in capitals", (await form.locator("[data-auth-code]").inputValue()) === "AB12CD");
  await pressRecord(form);
  await page.waitForURL(/message=|error=/, { timeout: 30000 }).catch(() => null);
  await settle(page);
  // The address already carries the first payment's message: wait for the receipt itself, then open the page afresh.
  const pay = await until(async () => (await sql("select id, number, auth_code from public.payments where job_id = $1 and is_active and auth_code is not null", [s3.jobId]))[0] ?? null, 40, 500);
  await go(page, `${base}/jobs/${s3.jobId}/invoice`);
  check("C4 recorded with auth code AB12CD", pay?.auth_code === "AB12CD", JSON.stringify(pay));
  check("C5 the money page shows 'Auth AB12CD'", /Auth AB12CD/.test((await page.textContent("body")) ?? ""));
  const res = await fetch(`${base}/api/pdf/receipt/${pay?.id}`, { headers: { cookie: await cookieHeader(MATHEW) } });
  const pdf = res.status === 200 ? pdfText(Buffer.from(await res.arrayBuffer())) : "";
  check("C6 the receipt prints the auth code", /Auth code\s*AB12CD/i.test(pdf), pdf.slice(0, 200));
} finally {
  await browser.close();
}
cleanupDb();
process.exit(summary() ? 1 : 0);
