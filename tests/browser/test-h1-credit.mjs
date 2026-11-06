// Audit H1 (6 November 2026): a credit note comes off the balance the customer is asked for: their invoice page and PDF.
//   node --env-file=.env.test.local tests/browser/test-h1-credit.mjs        (npm run test:h1)
import { api, base, browserFor, cleanupDb, go, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const INV = "22222222-0000-4000-8000-00000000ee01";
const CN = "22222222-0000-4000-8000-00000000ee02";
const token = `e2e-h1-${Date.now()}`;

cleanupDb();
try {
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const job = (await sql("select id, customer_id, vehicle_id from public.jobs where id = $1", [seed?.jobId]))[0];
  if (!job) throw new Error("seed failed");
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, issued_by, created_by, updated_by) values ($1, 'E2E-INV-H1', 'tax_invoice', $2, $3, $4, 'issued', now(), $5, 'itemised', 2000, 0, 2000, 100, 2100, $6, $6, $6)", [INV, job.id, job.customer_id, job.vehicle_id, token, owner]);
  await sql("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, credit_of, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, issued_by, created_by, updated_by) values ($1, 'E2E-CN-H1', 'credit_note', $2, $3, $4, $5, 'issued', now(), $6, 'itemised', 500, 0, 500, 25, 525, $7, $7, $7)", [CN, job.id, job.customer_id, job.vehicle_id, INV, `${token}-cn`, owner]);
  if ((await sql("select id from public.invoices where id in ($1, $2)", [INV, CN])).length !== 2) throw new Error("seed failed: the invoice or the credit note was not created");

  // 1. The customer's invoice page asks for 2,100 − 525 = 1,575 and says why.
  const { browser, page } = await browserFor("owner", { viewport: { width: 390, height: 844 } });
  await go(page, `${base}/invoice/${token}`);
  const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  check("H1: the customer's page asks for the balance after the credit note (AED 1,575.00)", /Amount due\s*AED\s*1,575\.00/.test(body), body.match(/Amount due[^A-Za-z]{0,30}/)?.[0] ?? "");
  check("H1: …and says the credit note was taken off", /Credit note: AED 525\.00 taken off/.test(body));
  await browser.close();

  // 2. The PDF says the same.
  const mupdf = await import("mupdf");
  const res = await fetch(`${base}/api/pdf/invoice/${token}`);
  const doc = mupdf.Document.openDocument(Buffer.from(await res.arrayBuffer()), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText().asText();
  text = text.replace(/\s+/g, " ");
  check("H1: the invoice PDF's balance is after the credit note (1,575.00)", /1,575\.00/.test(text) && !/Balance due AED 2,100\.00/.test(text), text.match(/(Balance due|Amount due)[^A-Za-z]{0,30}/i)?.[0] ?? "");
} finally {
  const failed = summary();
  cleanupDb();
  process.exit(failed ? 1 : 0);
}
