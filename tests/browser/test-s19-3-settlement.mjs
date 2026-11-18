// 19 November 2026, Section 3: CARD SETTLEMENT - A CLEAR RESULT (the AED 45,229.00 settlement of 18 Nov: four receipts,
// net 44,393.71 + bank fee 791.51 + transaction fee 4.00 + VAT 39.78; the page showed only "The report has no
// transactions in it"). Signed in as accounts.
//  A. Record the settlement: a centre window "RECORDED – STL-… – AED 45,229.00".
//  B. Record pressed again from a second tab: "NOT RECORDED – … already in another settlement" (never twice).
//  C. A file that is not the bank's report: "Could not read this file" with the formats accepted.
//  D. The bank's report for receipts already recorded: "Every transaction in this report is already recorded (STL-…)".
//  E. A report with new transactions: "n transactions found".
// TEST only.  node --env-file=.env.test.local tests/browser/test-s19-3-settlement.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-19-settlement-result";
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
const dubai = (d = 0) => new Date(Date.now() + 4 * 3600000 + d * 86400000).toISOString().slice(0, 10);
const typed = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "s19-3-"));
const tag = String(Date.now() % 100000).padStart(5, "0");
const AMOUNTS = [20000, 15000, 9229, 1000];
const nums = AMOUNTS.map((_, i) => `E2E-RCT-S3${tag}${i}`);
const codes = AMOUNTS.map((_, i) => `S3${tag.slice(-3)}${i}`);

const fill = async (page) => {
  const form = page.locator("[data-settlement-form]").first();
  await form.waitFor({ timeout: 30000 });
  await form.locator('[data-settle-method="link"]').click();
  await form.locator("[data-settle-date]").fill("");
  await form.locator("[data-settle-date]").pressSequentially(typed(dubai(0)));
  for (let i = 0; i < 60 && (await form.locator("[data-settle-tick]:checked").count()) > 0; i++) { await form.locator("[data-settle-tick]:checked").first().click(); await sleep(120); }
  for (const n of nums) await form.locator(`[data-settle-tick="${n}"]`).check();
  await form.locator("[data-settle-net]").fill("44393.71");
  await form.locator("[data-settle-msf]").fill("791.51");
  await form.locator("[data-settle-txn]").fill("4.00");
  await form.locator("[data-settle-vat]").fill("39.78");
  await form.locator("[data-settle-ref]").fill("E2E-STATEMENT-18NOV");
  return form;
};

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const JOB = seed.jobId;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [JOB]))[0];
  const ids = [];
  for (let i = 0; i < AMOUNTS.length; i++) ids.push((await sql("insert into public.payments (number, customer_id, job_id, vehicle_id, method, amount_aed, received_at, status, auth_code) values ($1, $2, $3, $4, 'link', $5, now() - interval '1 day', 'recorded', $6) returning id", [nums[i], job.customer_id, JOB, job.vehicle_id, AMOUNTS[i], codes[i]]))[0].id);

  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  const tab2 = await acc.context.newPage();
  await go(acc.page, `${base}/accounts-posting?tab=link`);
  await go(tab2, `${base}/accounts-posting?tab=link`);
  const form = await fill(acc.page);
  const form2 = await fill(tab2);
  await form.locator("[data-settle-save]").click();
  await acc.page.locator('[data-confirm-yes-money="settlement"]').click();
  const win = acc.page.locator("[data-settle-recorded]");
  await win.waitFor({ timeout: 60000 });
  const head = await text(win.locator("[data-settle-recorded-head]"));
  check("A1: a centre window: RECORDED – STL-… – AED 45,229.00", /^RECORDED – STL-\d{5} – AED 45,229\.00$/.test(head), head);
  await shots(acc.page, win.locator("div").first(), "a-recorded-window");
  const stl = head.match(/STL-\d{5}/)?.[0] ?? "";
  await win.locator("[data-settle-recorded-ok]").click();
  // B. The same four receipts again from the second tab.
  await form2.locator("[data-settle-save]").click();
  await tab2.locator('[data-confirm-yes-money="settlement"]').click();
  const err = tab2.locator("[data-settlement-form] [class*='red'], [data-settlement-form] [role='alert']").filter({ hasText: "NOT RECORDED" }).first();
  await err.waitFor({ timeout: 60000 }).catch(() => null);
  const errWords = await text(tab2.locator("[data-settlement-form]").locator(":text('NOT RECORDED')"));
  check("B1: pressed again: NOT RECORDED with the plain reason", /NOT RECORDED – .*already in another settlement/.test(errWords), errWords.slice(0, 200));
  const n = (await sql("select count(distinct settlement_id)::int as n from public.payments where id = any($1::uuid[])", [ids]))[0].n;
  check("B2: the four receipts are in ONE settlement", n === 1, String(n));
  await shots(tab2, tab2.locator("[data-settlement-form]"), "b-not-recorded-twice");

  // C. A file that is not the report.
  const junk = path.join(TMP, "_junk.csv");
  fs.writeFileSync(junk, "hello,world\n1,2\n");
  await acc.page.locator("[data-report-file]").setInputFiles(junk);
  await acc.page.locator("[data-report-upload-button]").click();
  const ans = acc.page.locator("[data-report-answer]");
  await ans.waitFor({ timeout: 60000 });
  check("C1: \"Could not read this file\" with the formats accepted", (await ans.getAttribute("data-report-answer")) === "unreadable" && /^Could not read this file \(_junk\.csv\)\. Accepted: the bank's settlement report as PDF, CSV or Excel/.test(await text(ans)), await text(ans));
  await shots(acc.page, acc.page.locator("[data-settle-upload]"), "c-could-not-read");

  // D. The bank's report of the four, already recorded.
  const csv = (lines) => [
    "MERCHANT TRANSACTION REPORT",
    `FROM : ${typed(dubai(-1))},TO : ${typed(dubai(-1))},DATE : ${typed(dubai(0))}`,
    "MERCHANT NO : XXXXXX4401,CHAIN ID : XXXX17",
    "",
    "TRANSACTION DETAILS",
    "DTOF TRN,TRMNL ID,CARD NUMBER,TRXN TYPE,ACQ_REF_NBR,AUTH CODE,TRAN AMT,MSF AMT,TXN FEE,VAT AMT,NET AMT,TRXN DESP",
    ...lines.map((l, i) => `${typed(dubai(-1))},XXXX7701,4XXXXXXXXXXX000${i},SALES,XXXXXXXXXXXXXXXXXXX000${i},${l.code},${l.amount.toFixed(2)},-0.00,-0.00,-0.00,${l.amount.toFixed(2)},M/D/C/CN`),
    "",
    "SUMMARY",
    `POS TRANSACTIONS,${lines.length},"${lines.reduce((a, l) => a + l.amount, 0).toFixed(2)}"`,
    "COMMISSION,,0.00", "FEE TRANSACTIONS,,0.00", "VAT,,0.00", "ADJUSTMENTS,,0.00", "CHARGEBACKS,,0.00", "SUSPENDED,,0.00", "REBATES,,0.00", "BNPL / INSTALMENT FEES,,0.00",
    `NET PAYABLE / RECEIVABLE,,"${lines.reduce((a, l) => a + l.amount, 0).toFixed(2)}"`,
  ].join("\n");
  const done = path.join(TMP, "_done.csv");
  fs.writeFileSync(done, csv(AMOUNTS.map((a, i) => ({ amount: a, code: codes[i] }))));
  await go(acc.page, `${base}/accounts-posting?tab=link&v=2`);
  await acc.page.locator("[data-report-file]").setInputFiles(done);
  await acc.page.locator("[data-report-upload-button]").click();
  const ans2 = acc.page.locator("[data-report-answer]");
  await ans2.waitFor({ timeout: 60000 });
  check("D1: \"Every transaction in this report is already recorded\" (with the STL number)", (await ans2.getAttribute("data-report-answer")) === "all_recorded" && (await text(ans2)).includes(`Every transaction in this report is already recorded (${stl})`), await text(ans2));
  await shots(acc.page, acc.page.locator("[data-settle-upload]"), "d-all-recorded");

  // E. A report with a new transaction.
  const newId = (await sql("insert into public.payments (number, customer_id, job_id, vehicle_id, method, amount_aed, received_at, status, auth_code) values ($1, $2, $3, $4, 'link', 777, now() - interval '1 day', 'recorded', $5) returning id", [`E2E-RCT-S3${tag}N`, job.customer_id, JOB, job.vehicle_id, `N${tag}`]))[0].id;
  const fresh = path.join(TMP, "_new.csv");
  fs.writeFileSync(fresh, csv([{ amount: 777, code: `N${tag}` }]));
  await go(acc.page, `${base}/accounts-posting?tab=link&v=3`);
  await acc.page.locator("[data-report-file]").setInputFiles(fresh);
  await acc.page.locator("[data-report-upload-button]").click();
  await acc.page.locator("[data-report-found]").waitFor({ timeout: 60000 });
  check("E1: \"1 transaction found\"", /^1 transaction found/.test(await text(acc.page.locator("[data-report-found]"))), await text(acc.page.locator("[data-report-found]")));
  void newId;
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* the browser may still hold a file */ }
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
