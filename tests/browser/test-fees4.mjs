// Section 4 of 29 October 2026: the manual settlement row, saved ANYWAY with a difference. One test card payment of
// AED 1,000 (MSF 21.50, VAT 1.08); the statement shows net 970.00, so AED 7.42 is unexplained: blocked, then saved
// with the reason in the note by accounts - the difference and the reason are kept on the settlement, written in the
// change log, shown in red in the history, and the job's profit switches to the actual MSF.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-fees4.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "fees");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const MATHEW = "e9894031-e253-4fc0-9552-026d3eaf6e88";

cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
const [job] = await sql("select customer_id from public.jobs where id = $1", [seed.jobId]);
const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
const [pay] = await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, fee_msf_aed, fee_txn_aed, fee_vat_aed, auth_code, received_at, received_by, is_deposit, created_by, updated_by) values ($1, $2, $3, 'card', 1000, 21.50, 21.50, 0, 1.08, 'E2E401', $4, $5, false, $5, $5) returning id, number", [seed.jobId, seed.invoice.id, job.customer_id, yesterday, MATHEW]);

const { browser, page } = await browserForId(MATHEW, { viewport: { width: 1366, height: 1000 } });
try {
  await go(page, `${base}/card-settlements?method=card`);
  await page.waitForSelector("[data-settlement-form]", { timeout: 30000 });
  // Never settle a real payment: only this test's own stays ticked.
  for (const box of await page.locator("[data-settle-tick]").all()) {
    const no = await box.getAttribute("data-settle-tick");
    if (no !== pay.number && (await box.isChecked())) await box.uncheck();
  }
  if (!(await page.locator(`[data-settle-tick="${pay.number}"]`).isChecked())) await page.locator(`[data-settle-tick="${pay.number}"]`).check();
  const type = async (sel, v) => { const b = page.locator(sel); await b.click(); await b.fill(""); await b.pressSequentially(v); await b.blur(); };
  await type("[data-settle-msf]", "21.50");
  await type("[data-settle-txn]", "0");
  await type("[data-settle-net]", "970");
  await page.locator("[data-settle-ref]").fill("E2E statement F4");
  await sleep(1300);
  check("1 net 970 + MSF 21.50 + VAT 1.08 ≠ 1,000: 'AED 7.42 difference', the button blocked", /AED 7\.42 difference/.test((await page.locator("[data-settle-diff]").textContent().catch(() => "")) ?? "") && (await page.locator("[data-settle-save]").isDisabled()));
  await page.locator("[data-settle-box]").screenshot({ path: path.join(SHOTS, "5-settlement-difference-blocked.png") });
  await page.locator("[data-settle-override] input").check();
  await page.locator("[data-settle-note]").fill("E2E the bank held 7.42 back, asked on the phone");
  await sleep(400);
  check("2 'Save anyway' with the reason in the note", (await page.locator("[data-settle-save]").textContent())?.includes("Save anyway") && !(await page.locator("[data-settle-save]").isDisabled()));
  await page.locator("[data-settle-save]").click();
  await page.waitForSelector("[data-settle-done]", { timeout: 30000 }).catch(() => null);
  const done = (await page.locator("[data-settle-done]").first().textContent().catch(() => "")) ?? "";
  if (!done) console.log("BOX:", ((await page.locator("[data-settle-box]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 600));
  check("3 the answer under the button names the difference", /saved with an AED 7\.42 difference/.test(done), done);
  const [st] = await sql("select id, number, difference_aed::text d, difference_note n, received_aed::text net, msf_aed::text msf, vat_aed::text vat from public.card_settlements where statement_ref = 'E2E statement F4'");
  check("4 the settlement keeps the difference and the reason", st?.d === "7.42" && /held 7\.42 back/.test(st?.n ?? "") && st?.net === "970.00" && st?.msf === "21.50" && st?.vat === "1.08", JSON.stringify(st));
  const log = await sql("select count(*)::int n from public.audit_log where table_name = 'card_settlements' and record_id = $1 and new_data ? 'saved_with_difference_aed'", [st?.id ?? "00000000-0000-0000-0000-000000000000"]);
  check("5 written in the change log", log[0]?.n === 1);
  const [p] = await sql("select actual_fee_aed::text c, actual_msf_aed::text m, actual_vat_aed::text v from public.payments where id = $1", [pay.id]);
  check("6 the payment carries its actual MSF 21.50 (cost) and VAT 1.08 apart", p?.c === "21.50" && p?.m === "21.50" && p?.v === "1.08", JSON.stringify(p));
  await go(page, `${base}/card-settlements`);
  const row = page.locator(`[data-settle-history-row="${st?.number}"]`);
  check("7 the history shows the parts and the difference in red", /MSF AED 21\.50 \+ fee AED 0\.00 \+ VAT AED 1\.08/.test((await row.textContent()) ?? "") && /Saved with an AED 7\.42 difference/.test((await row.locator("[data-settle-history-diff]").textContent().catch(() => "")) ?? ""));
  await row.screenshot({ path: path.join(SHOTS, "6-settlement-history-difference.png") });
  // No Zoho call from a test: the queued row goes before the five-minute sync can take it.
  await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id = $1", [st?.id ?? "00000000-0000-0000-0000-000000000000"]);
} finally {
  await browser.close();
}
cleanupDb();
process.exit(summary() ? 1 : 0);
