// Section 2 of 29 October 2026: job profit (the owner's profit page, the bonus and the target read the same jobProfits)
// counts the bank fee WITHOUT the reclaimable VAT, from the one rule - never the approved quotation's frozen hidden
// fee line. A test car with a tax invoice of AED 3,500 and no payment yet, its quotation approved with the old-style
// fee line of 79.10 (2.26%): expected card machine → 2.15% = 75.25; payment link → 1.75% + AED 1.00 = 62.25; cash → 0.
// The real RCT-00036 carries its recalculated figures (read only).
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-fees2.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "fees");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });

/** A ready test car whose quotation was approved expecting `method`, a tax invoice of AED 3,500 and no payment. */
async function carExpecting(method) {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "ready", method })).json;
  const [job] = await sql("select customer_id from public.jobs where id = $1", [seed.jobId]);
  const invNo = `INV-E2EFEE-${method}-${Date.now().toString().slice(-5)}`;
  await sql("insert into public.invoices (number, kind, job_id, customer_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, created_by, updated_by) values ($1, 'tax_invoice', $2, $3, 'issued', now(), 3333.33, 3333.33, 166.67, 3500, $4, $4)", [invNo, seed.jobId, job.customer_id, owner]);
  const m = (await sql("select expected_payment_method m from public.quotations where job_id = $1 and status = 'approved'", [seed.jobId]))[0]?.m;
  return { invNo, method: m };
}
/** The bank fee cell of the invoice's row on the profit page: its figure and its actual/estimate mark. */
async function feeCell(invNo) {
  await go(page, `${base}/profit?period=month`);
  await page.waitForSelector("table", { timeout: 30000 });
  const row = page.locator("tr", { hasText: invNo }).first();
  const cell = row.locator("td:has([data-fee-mark])").first();
  const text = ((await cell.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  return { fee: Number(text.replace(/[^\d.].*$/, "").replace(/,/g, "")), text, mark: await row.locator("[data-fee-mark]").getAttribute("data-fee-mark").catch(() => null), row };
}

try {
  for (const [method, want, words] of [["card", 75.25, "2.15% of AED 3,500"], ["link", 62.25, "1.75% + AED 1.00"], ["cash", 0, "no bank fee"]]) {
    const car = await carExpecting(method);
    // The approved quotation keeps an old-style hidden fee line (2.26% of 3,500), as quotations approved before the change do.
    await sql("update public.quotation_lines set unit_cost = 79.10 where fee_kind = 'bank_charge' and quotation_id in (select id from public.quotations where job_id in (select job_id from public.invoices where number = $1) and status = 'approved')", [car.invNo]);
    const c = await feeCell(car.invNo);
    // The page shows whole dirhams; the estimate itself is checked to the fils by the rule tests (test:fees1).
    check(`${method}: approved expecting ${car.method}; the profit page counts ${words} = ${want.toFixed(2)} before VAT, marked estimated (not the frozen 79.10)`, car.method === method && Math.abs(c.fee - Math.round(want)) <= 0.5 && (want === 0 || c.mark !== "actual"), `${c.mark} · "${c.text}"`);
    if (method === "card") await c.row.screenshot({ path: path.join(SHOTS, "3-profit-card-estimate.png") });
  }
} finally {
  await browser.close();
}

// The real deposit RCT-00036 (payment link, AED 10,000, 24 October) after the recalculation: read only.
const real = (await sql("select bank_charge_aed::text c, fee_msf_aed::text m, fee_txn_aed::text t, fee_vat_aed::text v from public.payments where number = 'RCT-00036' and method = 'link'"))[0];
check("RCT-00036 counts MSF 175.00 + fee 1.00 = 176.00 as cost, VAT 8.80 apart", !real || (real.c === "176.00" && real.m === "175.00" && real.t === "1.00" && real.v === "8.80"), JSON.stringify(real ?? {}));

cleanupDb();
process.exit(summary() ? 1 : 0);
