// THE document layout on real documents (31 October 2026, the owner's mockup "ofj-quotation-mockup.png"). On the TEST
// database through the test server: Q-00039 (package only -> one page like mockup A), a labour + parts quotation (like
// mockup B), the quotation with the most parts (several sensible pages), an invoice with a payment (BALANCE DUE), an
// estimate, an inspection report and a job card. Every PDF goes through the layout check (nothing on top of anything,
// nothing off the page, no split amount, ticks level) and the money check (every amount once, a subtotal only where it
// adds something, AED on every amount, no page with only the totals, bank details or footer). Pictures of every page:
// tests/browser/shots/pdf-docs/.
//   node --env-file=.env.test.local tests/browser/test-docs.mjs        (npm run test:docs)
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, here, makeChecks, sql } from "./pw-lib.mjs";

const { checkPdf, moneyProblems, labelledAmounts, pagePng } = await import("../unit/pdf-check-lib.mjs");
const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "pdf-docs");
fs.mkdirSync(SHOTS, { recursive: true });

async function pdfOf(url) {
  const r = await fetch(`${base}${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { ok: r.ok && buf.slice(0, 4).toString() === "%PDF", buf, status: r.status };
}
function pagesOf(buf) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  return { count: doc.countPages(), text: Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText().asText()).join("\n") };
}
const count = (text, s) => text.split(s).length - 1;

async function document(name, url, { taxDocument = false, expectPages = null } = {}) {
  if (!url) { console.log(`SKIP ${name}: none on the test database`); return null; }
  const { ok, buf, status } = await pdfOf(url);
  check(`${name}: the PDF opens`, ok, ok ? `${buf.length} bytes` : `status ${status}`);
  if (!ok) return null;
  const { count: pages, text } = pagesOf(buf);
  for (let p = 0; p < pages; p++) fs.writeFileSync(path.join(SHOTS, `${name}-p${p + 1}.png`), pagePng(buf, p, 1.2));
  const layout = checkPdf(buf, name);
  check(`${name}: layout clean (${pages} page${pages === 1 ? "" : "s"})`, layout.length === 0, layout.slice(0, 4).join(" | "));
  const money = moneyProblems(buf, name, { taxDocument });
  check(`${name}: every amount once, AED everywhere, no page with only the totals`, money.length === 0, money.slice(0, 4).join(" | "));
  if (expectPages !== null) check(`${name}: ${expectPages} page${expectPages === 1 ? "" : "s"}`, pages === expectPages, `${pages}`);
  check(`${name}: "Page X of ${pages}" on every page`, Array.from({ length: pages }, (_, i) => `Page ${i + 1} of ${pages}`).every((s) => text.includes(s)));
  return { buf, pages, text };
}

try {
  const one = async (q, params = []) => (await sql(q, params))[0] ?? null;

  /* Q-00039: the package alone -> one page, 20,000 once, 21,000 once, the bank details on it */
  // Q-00039 is a draft (never sent, so no link yet): on the TEST database it gets a link token for this check.
  await sql("update public.quotations set token = $1 where number = 'Q-00039' and token is null and is_active and status = 'draft'", [`e2e-q39-${Date.now()}`]);
  const q39 = await one("select token from public.quotations where number = 'Q-00039' and token is not null and is_active order by version desc limit 1");
  const a = await document("Q-00039", q39 ? `/api/pdf/quote/${q39.token}` : null, { expectPages: 1 });
  if (a) {
    check("Q-00039: the package price is printed once", count(a.text, "20,000.00") === 1, `${count(a.text, "20,000.00")} times`);
    check("Q-00039: the total is printed once (TOTAL INCL. VAT)", count(a.text, "21,000.00") === 1 && /TOTAL INCL\. VAT/.test(a.text), `${count(a.text, "21,000.00")} times`);
    check("Q-00039: no package subtotal, no Subtotal before VAT, no second total box", !/Package subtotal|Subtotal before VAT|QUOTATION TOTAL|Grand total/i.test(a.text));
    check("Q-00039: bank details and the note on the same page", /BANK DETAILS/.test(a.text) && /Prices valid until the date above/.test(a.text));
    check("Q-00039: Valid until is a date", /VALID UNTIL[\s\S]{0,40}\d{1,2} [A-Z][a-z]{2} \d{4}/.test(a.text));
    check("Q-00039: AED, never the dirham symbol (every amount in the totals reads AED)", labelledAmounts(a.buf).every((x) => x.aed));
  }

  /* The customer's quotation page on a phone: the package price once, the total once, AED, no package subtotal */
  if (q39) {
    // The customer's page shows a quotation once it is sent: on the TEST database the draft is marked sent for this look.
    await sql("update public.quotations set status = 'sent', sent_at = now() where token = $1 and status = 'draft'", [q39.token]);
    const { browser, page } = await browserFor("owner", { viewport: { width: 390, height: 844 } });
    await page.context().clearCookies();
    await page.goto(`${base}/quote/${q39.token}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1200);
    // What the customer SEES (innerText): the approve window, not open, is not counted.
    const body = ((await page.locator("body").innerText()) ?? "").replace(/\s+/g, " ");
    await page.screenshot({ path: path.join(SHOTS, "Q-00039-customer-page-390.png"), fullPage: true });
    check("customer page (phone): no package subtotal, the package price once", !/Package subtotal/i.test(body) && count(body, "20,000.00") === 1, `${count(body, "20,000.00")} times`);
    check("customer page (phone): the total once, in AED", count(body, "21,000.00") === 1 && /AED 21,000\.00/.test(body), `${count(body, "21,000.00")} times`);
    const valid = body.match(/VALID UNTIL.{0,60}/i)?.[0] ?? "";
    check("customer page (phone): Valid until is a date", /\d{1,2} [A-Z][a-z]{2} \d{4}/.test(valid) && !/\d+ days/.test(valid), valid);
    await browser.close();
  }

  /* A labour + parts quotation (mockup B) */
  // The newest version of each quotation (the one its link shows), with labour and parts on it.
  const lp = await one(`select q.token, q.number from public.quotations q where q.kind = 'quotation' and q.token is not null and q.is_active
    and q.version = (select max(v.version) from public.quotations v where v.number = q.number and v.kind = q.kind and v.is_active)
    and exists (select 1 from public.quotation_lines l where l.quotation_id = q.id and l.is_active and coalesce(l.visible_to_customer, true) and not coalesce(l.left_off, false) and l.line_type in ('labour', 'package') and l.package_key is null)
    and exists (select 1 from public.quotation_lines l where l.quotation_id = q.id and l.is_active and coalesce(l.visible_to_customer, true) and not coalesce(l.left_off, false) and l.line_type = 'part')
    and (select count(*) from public.quotation_lines l where l.quotation_id = q.id and l.is_active) between 3 and 14
    order by q.created_at desc limit 1`);
  const b = await document(`labour-parts-${lp?.number ?? "none"}`, lp ? `/api/pdf/quote/${lp.token}` : null);
  if (b) check("labour + parts: Subtotal before VAT and one TOTAL INCL. VAT", /Subtotal before VAT/.test(b.text) && count(b.text, "TOTAL INCL. VAT") === 1);

  /* The quotation with the most parts (the 105-part Urus quotation on live) */
  const big = await one(`select q.token, q.number, count(*)::int as n from public.quotations q join public.quotation_lines l on l.quotation_id = q.id and l.is_active and l.line_type = 'part'
    where q.token is not null and q.is_active group by q.id order by count(*) desc limit 1`);
  const c = await document(`most-parts-${big?.number ?? "none"}-${big?.n ?? 0}`, big ? `/api/pdf/quote/${big.token}` : null);
  if (c) check(`most parts (${big.n} lines): several pages, the totals with the last lines`, c.pages >= 2 || big.n < 25, `${c.pages} pages`);

  /* An invoice with a payment (BALANCE DUE) */
  const inv = await one(`select i.token, i.number, i.kind from public.invoices i where i.token is not null and i.is_active and i.kind in ('proforma', 'tax_invoice')
    and exists (select 1 from public.payments p where p.invoice_id = i.id and p.is_active and p.status = 'recorded') order by i.created_at desc limit 1`)
    ?? await one("select token, number, kind from public.invoices where token is not null and is_active and kind in ('proforma', 'tax_invoice') order by created_at desc limit 1");
  const d = await document(`invoice-${inv?.number ?? "none"}`, inv ? `/api/pdf/invoice/${inv.token}` : null, { taxDocument: inv?.kind === "tax_invoice" });
  if (d) check("invoice: one TOTAL INCL. VAT, payments and BALANCE DUE (or paid in full) in the same box", count(d.text, "TOTAL INCL. VAT") === 1 && (/BALANCE DUE|PAID IN FULL/.test(d.text) || !/Paid /.test(d.text)));

  /* An estimate */
  const est = await one("select token, number from public.quotations where kind = 'estimate' and token is not null and is_active order by created_at desc limit 1");
  await document(`estimate-${est?.number ?? "none"}`, est ? `/api/pdf/quote/${est.token}` : null);

  /* The receipt, the LPO and the warranty certificate (the same frame: footer row, page numbers, AED) */
  const rc = await one(`select p.id, i.token from public.payments p join public.invoices i on i.id = p.invoice_id where p.is_active and i.token is not null order by p.created_at desc limit 1`);
  const r = await document("receipt", rc ? `/api/pdf/receipt/${rc.id}?t=${rc.token}` : null);
  if (r) check("receipt: AED on the amount, no dirham symbol", /AED/.test(r.text));
  const lpo = await one("select verify_token from public.purchase_orders where verify_token is not null and is_active order by created_at desc limit 1");
  await document("lpo", lpo ? `/api/pdf/lpo/${lpo.verify_token}` : null);
  const war = await one("select warranty_token from public.jobs where warranty_token is not null order by updated_at desc limit 1");
  await document("warranty-certificate", war ? `/api/pdf/warranty/${war.warranty_token}` : null);

  /* An inspection report and a job card (their own layouts on the same frame) */
  const rep = await one("select token from public.report_links where token is not null order by created_at desc limit 1");
  await document("inspection-report", rep ? `/api/pdf/report/${rep.token}` : null);
  const ap = await one("select token from public.approval_requests where token is not null order by created_at desc limit 1");
  await document("job-card", ap ? `/api/pdf/jobcard/${ap.token}` : null);
} catch (e) {
  check("walked without a crash", false, String(e?.stack ?? e).slice(0, 400));
}
summary();
