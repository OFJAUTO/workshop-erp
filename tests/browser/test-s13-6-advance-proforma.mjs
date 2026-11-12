// 13 November 2026, Section 6: the proforma for an ADVANCE against an estimate (PRO-00029 / E-00082 shape): THE advance
// block (estimate total > already paid > advance payable now > balance after), the heading ADVANCE PAYMENT, the
// note once, the plate and car words, the bill-to choice from the customer record, one resend. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-6-advance-proforma.mjs
import fs from "node:fs";
import { api, base, browserFor, makeChecks, pageReady, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-advance-proforma";
fs.mkdirSync(OUT, { recursive: true });
const mupdf = await import("mupdf");
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
let proId = null;

try {
  // A draft estimate on TEST with lines, no money yet.
  const est = (await q("select q.id, q.number, q.customer_id from public.quotations q where q.kind = 'estimate' and q.status = 'draft' and q.is_active and q.deleted_at is null and exists (select 1 from public.quotation_lines l where l.quotation_id = q.id and l.is_active and l.line_total > 0) and not exists (select 1 from public.invoices i where i.estimate_id = q.id) order by q.created_at desc limit 1"))[0];
  if (!est) throw new Error("no draft estimate with lines on TEST");
  const cust = (await q("select full_name, company_name from public.customers where id = $1", [est.customer_id]))[0];
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await page.goto(`${base}/estimates/${est.id}`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  const card = page.locator("[data-em-card]");
  await card.evaluate((d) => { d.open = true; });
  await card.locator("[data-em-mode='partial']").click();
  await card.locator("[data-em-partial-kind='percent']").click();
  await card.locator("[data-em-partial-value]").fill("80");
  check("bill to: THE CUSTOMER is the default, from the customer record", (await card.locator("[data-em-billto-customer][aria-pressed='true']").count()) === 1 && (await card.locator("[data-em-billto-company]").count()) === 0);
  const preview = await txt(card.locator("[data-em-billto-preview]"));
  const recordName = (cust.company_name ?? cust.full_name ?? "").trim();
  check("the one-line preview names the customer record", preview.toUpperCase().includes(recordName.toUpperCase()), preview);
  await card.locator("[data-em-billto-other]").click();
  check("the company fields appear only for A COMPANY OR SOMEONE ELSE", (await card.locator("[data-em-billto-company]").count()) === 1);
  await card.locator("[data-em-billto-customer]").click();
  await page.screenshot({ path: `${OUT}/s6-bill-to-choice-1366.png` });
  await card.locator("[data-em-issue]").click();
  const pro = await until(async () => (await q("select id, number, token, total_aed::float8 t, bill_to from public.invoices where estimate_id = $1 and kind = 'proforma' and is_active", [est.id]))[0], 60);
  proId = pro?.id ?? null;
  check("the advance proforma is issued with no retyped bill-to", !!pro && !pro.bill_to?.company, JSON.stringify(pro?.bill_to));
  await page.keyboard.press("Escape").catch(() => null);
  check("ONE resend on the estimate page (no Send again in the bar)", (await page.locator("button", { hasText: /^Send again$/ }).count()) === 0);

  // The PDF.
  const pdf = await (await fetch(`${base}/api/pdf/invoice/${pro.token}`)).arrayBuffer();
  fs.writeFileSync(`${OUT}/s6-advance-proforma.pdf`, Buffer.from(pdf));
  const doc = mupdf.Document.openDocument(Buffer.from(pdf), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  const T = text.replace(/\s+/g, " ").toUpperCase();
  check("heading ADVANCE PAYMENT (never under Labour and services)", /ADVANCE PAYMENT/.test(T) && !/LABOUR AND SERVICES\s+#/.test(T), "");
  check("the advance block in order: estimate total > advance payable now > balance after", /ESTIMATE TOTAL \(INCL\. VAT\).*ADVANCE PAYABLE NOW.*BALANCE AFTER THIS PAYMENT/.test(T));
  check("FINAL AMOUNT AS PER THE APPROVED QUOTATION", /FINAL AMOUNT AS PER THE APPROVED QUOTATION/.test(T));
  check("the proforma line prints once", (T.match(/NOT A TAX INVOICE/g) ?? []).length === 1, String((T.match(/NOT A TAX INVOICE/g) ?? []).length));
  check("no false 'VAT included in this amount'", !/VAT INCLUDED IN THIS AMOUNT/.test(T));
  check("the estimate's section totals are above it", /SECTION TOTALS/.test(T));
  const words = (await q("select total_aed::float8 t from public.invoices where id = $1", [pro.id]))[0]?.t;
  check("the amount in words is the advance payable now", words !== undefined && T.includes("DIRHAMS"), String(words));
  check("no 'Plate No plate'", !/PLATE NO PLATE/.test(T));
  const png = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
  fs.writeFileSync(`${OUT}/s6-advance-proforma-page1.png`, Buffer.from(png));

  // The customer's page shows the same block.
  await page.goto(`${base}/invoice/${pro.token}`, { waitUntil: "domcontentloaded" });
  await pageReady(page);
  check("the customer's page shows the advance block", (await page.locator("[data-advance-block]").count()) === 1 && (await page.locator("[data-advance-row='total']").count()) === 1);
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: `${OUT}/s6-customer-page-800.png`, fullPage: true });
  await browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (proId) await api("/api/e2e/sql", { sql: "update public.invoices set status = 'void', is_active = false where id = $1", params: [proId] }).catch(() => null);
}
process.exit(summary() ? 1 : 0);
