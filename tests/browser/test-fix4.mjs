// Fix 4 of 4 November 2026: the proof of a supplier payment is always visible.
//   A. A paid invoice shows its PROOF OF PAYMENT box (method, reference, date, who) on the Supplier invoices card.
//   B. Paid without proof: the red "Proof missing – upload" tag on the row and in the opened card (with the uploader
//      for accounts), the "Paid without proof" filter, and the line in accounts' WAITING ON YOU.
//   C. Parts accounts > Payments to suppliers flags the supplier and the invoice.
//   D. The LPO page shows the same box.
// Run: node --env-file=.env.test.local tests/browser/test-fix4.mjs   (test server on 3102: npm run test:server)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "fix4");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "approved" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
const [owner] = await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1");

// Two paid supplier LPOs with their invoices entered: one WITH the proof on file, one WITHOUT.
const [poA] = await sql(
  "insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_checked_at, supplier_paid_at, supplier_paid_method, supplier_paid_reference, supplier_paid_by, supplier_paid_proof_path) values ('LPO-E2E-F41', 'supplier', $1, 'E2E PROOF SUPPLIER', 'received', 500, 'received', 'E2EINV741', current_date, 500, now(), now(), 'transfer', 'TT-991', $2, 'supplier-payments/e2e/proof-f41.jpg') returning id",
  [jobId, owner.id],
);
const [poB] = await sql(
  "insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_checked_at, supplier_paid_at, supplier_paid_method, supplier_paid_by) values ('LPO-E2E-F42', 'supplier', $1, 'E2E NOPROOF SUPPLIER', 'received', 300, 'received', 'E2EINV742', current_date, 300, now(), now(), 'cash', $2) returning id",
  [jobId, owner.id],
);
if (!poA?.id || !poB?.id) { console.error("po seed failed (the sql route hides errors)"); process.exit(1); }

const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });

/* ---------------- A + B: the Supplier invoices page ---------------- */
await go(page, `${base}/supplier-invoices`);
check("B1: the paid-without-proof row carries the red tag", (await page.locator(`[data-si-row] [data-si-proof-missing-tag]`).count()) >= 1);
check("B2: the \"Paid without proof\" count chip shows", /Paid without proof · \d+/.test((await page.locator("[data-si-no-proof-count]").textContent().catch(() => "")) ?? ""));
await page.locator("[data-si-no-proof-count]").click();
await page.waitForURL(/no_proof=1/, { timeout: 15000 });
const shown = await page.locator("[data-si-row]").allTextContents();
check("B3: the filter keeps only invoices paid without proof", shown.length >= 1 && shown.every((t) => /E2E NOPROOF SUPPLIER/i.test(t) || !/E2E PROOF SUPPLIER/i.test(t)), `${shown.length} rows`);
await page.screenshot({ path: shot("b3-filter.png"), fullPage: false });

// The WITH-proof invoice opened: the PROOF OF PAYMENT box with method, reference and who paid.
await go(page, `${base}/supplier-invoices?q=E2EINV741`);
await page.locator("[data-si-open]").first().click();
await page.waitForSelector("[data-si-opened]", { timeout: 15000 });
const openedA = (await page.locator("[data-si-opened]").textContent()) ?? "";
check("A1: the opened invoice shows the PROOF OF PAYMENT box", (await page.locator(`[data-si-proof="${poA.id}"]`).count()) === 1);
check("A2: with method, reference and who paid", /transfer/.test(openedA) && /TT-991/.test(openedA) && new RegExp(`by ${owner.display_name}`).test(openedA), openedA.slice(0, 240));
await page.screenshot({ path: shot("a1-proof-box.png"), clip: (await page.locator("[data-si-opened]").boundingBox()) ?? undefined });

// The WITHOUT-proof invoice opened: red words + the uploader for accounts.
await go(page, `${base}/supplier-invoices?q=E2EINV742`);
await page.locator("[data-si-open]").first().click();
await page.waitForSelector("[data-si-opened]", { timeout: 15000 });
check("B4: the opened card says Proof missing – upload, with the uploader", (await page.locator(`[data-si-proof-missing="${poB.id}"]`).count()) === 1 && (await page.locator(`[data-si-proof-missing="${poB.id}"] [data-supplier-proof-upload]`).count()) === 1);
await page.screenshot({ path: shot("b4-proof-missing.png"), clip: (await page.locator("[data-si-opened]").boundingBox()) ?? undefined });

/* ---------------- B5: accounts' Waiting on you ---------------- */
await go(page, `${base}/dashboard`);
const waiting = (await page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "";
check("B5: WAITING ON YOU carries the proof-missing line", /proof of payment missing/i.test(waiting) && /E2E NOPROOF SUPPLIER/i.test(waiting), waiting.slice(0, 200));

/* ---------------- C: Parts accounts > Payments to suppliers ---------------- */
await go(page, `${base}/parts-accounts?tab=payments&q=E2E`);
const payTab = (await page.locator("[data-pa-list='payments']").textContent().catch(() => "")) ?? "";
check("C1: the supplier is flagged \"paid without proof\"", (await page.locator("[data-pa-proof-missing]").count()) >= 1, payTab.slice(0, 160));
await page.screenshot({ path: shot("c1-payments-tab.png"), fullPage: false });

/* ---------------- D: the LPO page ---------------- */
await go(page, `${base}/parts/orders/${poA.id}`);
check("D1: the LPO page shows the PROOF OF PAYMENT box with who paid", (await page.locator("[data-paid-proof]").count()) === 1 && new RegExp(`by ${owner.display_name}`).test((await page.locator("[data-paid-line]").textContent()) ?? ""));
await go(page, `${base}/parts/orders/${poB.id}`);
check("D2: the unproven LPO says Proof missing – upload", (await page.locator("[data-paid-proof-missing]").count()) === 1);

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
