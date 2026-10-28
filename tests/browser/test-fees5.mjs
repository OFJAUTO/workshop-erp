// Section 5 of 29 October 2026: the settlement report upload. As Mathew (accounts) on Card settlements:
//  A. the payment-link report (PDF) → its line matched ✓ to the REAL RCT-00036 by auth 756117, MSF 175.00 / fee 1.00 /
//     VAT 8.80 / net 9,815.20, the lines adding up to the net payable - reviewed only, never recorded by a test;
//  B. the card-machine report → auth 219769 has no payment in the ERP: unmatched, offered to pick by hand;
//  C. test copies (auth codes of their own, test payments on a test car) recorded: each payment gets its EXACT
//     MSF, fee and VAT, the settlement its net, the report remembers its settlement;
//  D. a report with an adjustment and a refund: red, and Record waits for "checked with the bank".
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-fees5.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "fees");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const MATHEW = "e9894031-e253-4fc0-9552-026d3eaf6e88";
const FIX = path.join(here, "..", "fixtures");
const TMP = path.join(here, "shots", "fees", "tmp");
fs.mkdirSync(TMP, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
// Test copies of the reports with auth codes of their own (a real code is a real payment).
const copy = (from, to, swaps) => { let t = fs.readFileSync(path.join(FIX, from), "utf8"); for (const [a, b] of swaps) t = t.split(a).join(b); fs.writeFileSync(path.join(TMP, to), t); return path.join(TMP, to); };
const storedFiles = new Set();
const remember = async () => { for (const r of await sql("select storage_path p from public.settlement_reports where file_name ilike 'e2e%' or file_name ilike 'ni-mtr-%'")) storedFiles.add(r.p); };

const { browser, page } = await browserForId(MATHEW, { viewport: { width: 1366, height: 1000 } });
/** A report line: its figures row and its match row below it. */
const lineOf = (i) => ({ figures: page.locator(`[data-report-line="${i}"]`), match: page.locator(`[data-report-line-match="${i}"]`), text: async () => `${(await page.locator(`[data-report-line="${i}"]`).textContent().catch(() => "")) ?? ""} ${(await page.locator(`[data-report-line-match="${i}"]`).textContent().catch(() => "")) ?? ""}`.replace(/\s+/g, " ") });
const upload = async (file) => {
  await go(page, `${base}/card-settlements`);
  await page.locator("[data-report-file]").setInputFiles(file);
  await page.locator("[data-report-upload-button]").click();
  await page.waitForURL(/report=/, { timeout: 30000 }).catch(() => null);
  await page.waitForSelector("[data-report-review]", { timeout: 30000 }).catch(() => null);
};
try {
  cleanupDb();
  /* A. The real payment-link report against the real RCT-00036 (review only). */
  const real = (await sql("select number from public.payments where auth_code = '756117' and method = 'link' and is_active and settlement_id is null limit 1"))[0];
  await upload(path.join(FIX, "ni-mtr-link-24oct.pdf"));
  const lineA = lineOf(1);
  const textA = await lineA.text();
  check("A1 the PDF is read: one SALES line, auth 756117, 10,000.00 − 175.00 − 1.00 − 8.80 = 9,815.20", /756117/.test(textA) && /10,000\.00/.test(textA) && /175\.00/.test(textA) && /1\.00/.test(textA) && /8\.80/.test(textA) && /9,815\.20/.test(textA), textA);
  if (real) check(`A2 matched ✓ to ${real.number} by auth + amount + date`, (await lineA.match.locator("[data-report-matched]").count()) === 1 && new RegExp(real.number).test((await lineA.match.locator("[data-report-matched]").textContent()) ?? ""));
  else check("A2 (skipped: RCT-00036 is no longer waiting for a settlement)", true);
  check("A3 the lines add up to the net payable ✓, nothing red", /= the net payable ✓/.test((await page.locator("[data-report-check]").textContent()) ?? "") && (await page.locator('[data-report-flag="red"]').count()) === 0);
  check("A4 the method: payment link (from TRXN DESP M/D/C/CN until the terminal IDs are in Settings)", /Payment link/.test(textA) && /from M\/D\/C\/CN/.test(textA));
  await page.locator("[data-report-review]").screenshot({ path: path.join(SHOTS, "7-report-link-matched.png") });

  /* B. The card-machine report: auth 219769 is not in the ERP. */
  await upload(path.join(FIX, "ni-mtr-pos-24oct.pdf"));
  const lineB = lineOf(1);
  const textB = await lineB.text();
  check("B1 the card machine line: auth 219769, 1,470.00 − 31.61 − 0.00 − 1.58 = 1,436.81", /219769/.test(textB) && /1,470\.00/.test(textB) && /31\.61/.test(textB) && /1\.58/.test(textB) && /1,436\.81/.test(textB), textB);
  check("B2 no payment carries 219769: unmatched, to pick by hand or mark not ours, Record waits", /No payment in the ERP carries auth 219769/.test(textB) && (await lineB.match.locator("[data-report-pick]").count()) === 1 && (await page.locator("[data-report-record]").isDisabled()));
  await page.locator("[data-report-review]").screenshot({ path: path.join(SHOTS, "8-report-pos-unmatched.png") });

  /* C. Test copies recorded against test payments. */
  const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const [job] = await sql("select customer_id from public.jobs where id = $1", [seed.jobId]);
  const on24 = "2026-10-24T10:00:00+04:00";
  const ins = (method, amount, auth, msf, txn, vat) => sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, fee_msf_aed, fee_txn_aed, fee_vat_aed, auth_code, received_at, received_by, is_deposit, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $12, $12) returning id, number", [seed.jobId, seed.invoice.id, job.customer_id, method, amount, msf + txn, msf, txn, vat, auth, on24, MATHEW]);
  const [pl] = await ins("link", 10000, "E2EL17", 175, 1, 8.8);
  const [pc] = await ins("card", 1470, "E2EC69", 31.61, 0, 1.58);
  const linkCsv = copy("ni-mtr-link-24oct.csv", "e2e-ni-mtr-link.csv", [["756117", "E2EL17"]]);
  const posCsv = copy("ni-mtr-pos-24oct.csv", "e2e-ni-mtr-pos.csv", [["219769", "E2EC69"]]);
  for (const [file, pay, method, want] of [[linkCsv, pl, "link", { msf: "175.00", txn: "1.00", vat: "8.80", cost: "176.00", net: "9815.20" }], [posCsv, pc, "card", { msf: "31.61", txn: "0.00", vat: "1.58", cost: "31.61", net: "1436.81" }]]) {
    await upload(file);
    const line = lineOf(1);
    check(`C ${method}: the CSV copy matches the test payment ${pay.number} ✓`, (await line.match.locator("[data-report-matched]").count()) === 1 && new RegExp(pay.number).test((await line.match.locator("[data-report-matched]").textContent()) ?? ""));
    await page.locator("[data-report-ref]").fill(`E2E NI ${method}`);
    await page.locator("[data-report-date]").fill("2026-10-25");
    await page.locator("[data-report-record]").click();
    const done = await until(async () => ((await page.locator("[data-report-done]").count()) ? (await page.locator("[data-report-done]").textContent()) : null));
    check(`C ${method}: recorded from the report (the answer under the button)`, !!done && /STL-\d{5} recorded from the bank's report/.test(done), done ?? ((await page.locator("[data-report-review]").textContent()) ?? "").slice(-300));
    const [p] = await sql("select actual_msf_aed::text m, actual_txn_fee_aed::text t, actual_vat_aed::text v, actual_fee_aed::text c, settlement_id from public.payments where id = $1", [pay.id]);
    check(`C ${method}: the payment carries the bank's EXACT MSF ${want.msf}, fee ${want.txn}, VAT ${want.vat} (cost ${want.cost})`, p?.m === want.msf && p?.t === want.txn && p?.v === want.vat && p?.c === want.cost, JSON.stringify(p));
    const [st] = await sql("select number, received_aed::text net, source, report_id from public.card_settlements where id = $1", [p?.settlement_id ?? "00000000-0000-0000-0000-000000000000"]);
    const rep = st?.report_id ? (await sql("select recorded_at is not null r, $2 = any(settlement_ids) has from public.settlement_reports where id = $1", [st.report_id, p.settlement_id]))[0] : null;
    check(`C ${method}: the settlement nets ${want.net}, made from the report, which remembers it`, st?.net === want.net && st?.source === "report" && !!rep?.r && !!rep?.has, JSON.stringify({ st, rep }));
    if (method === "link") await page.locator("[data-report-review]").screenshot({ path: path.join(SHOTS, "9-report-recorded.png") });
    // No Zoho call from this test (section 6 has its own live test).
    await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id = $1", [p?.settlement_id ?? "00000000-0000-0000-0000-000000000000"]);
  }

  /* D. An adjustment and a refund: red, and Record waits for the tick. */
  {
    let t = fs.readFileSync(path.join(FIX, "ni-mtr-pos-24oct.csv"), "utf8").replace("219769", "E2EC70");
    t = t.replace(/ADJUSTMENTS,,0\.00/, "ADJUSTMENTS,,-50.00").replace(/(E\/D\/C\/CN\r?\n)/, `$1"24/10/2026",XXXX7702,5XXXXXXXXXXX0009,REFUND,XXXX0009,A1B2C3,200.00,0.00,0.00,0.00,-200.00,E/D/C/CN\r\n`);
    const f = path.join(TMP, "e2e-ni-mtr-flagged.csv");
    fs.writeFileSync(f, t);
    const [pf] = await ins("card", 1470, "E2EC70", 31.61, 0, 1.58);
    await upload(f);
    const reds = await page.locator('[data-report-flag="red"]').allTextContents();
    check("D1 the adjustment and the refund are flagged red", reds.some((x) => /Adjustments/.test(x)) && reds.some((x) => /refund/i.test(x)), JSON.stringify(reds));
    check("D2 Record waits for 'I have checked the red items with the bank'", (await page.locator("[data-report-flags-seen]").count()) === 1 && (await page.locator("[data-report-record]").isDisabled()));
    await page.locator("[data-report-review]").screenshot({ path: path.join(SHOTS, "10-report-flagged.png") });
    void pf;
  }
} finally {
  await browser.close();
  await remember();
  // The test reports' files out of storage.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (storedFiles.size && key) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/settlement-reports`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [...storedFiles] }) });
    console.log(`storage: ${storedFiles.size} test report files removed (${res.status})`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
cleanupDb();
process.exit(summary() ? 1 : 0);
