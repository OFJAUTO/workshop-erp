// Evening section 9 proof: the package has its own PROTECTION PACKAGE section on every customer
// document - the estimate/quotation PDF and link, the proforma and the tax invoice (PDF and link) -
// from ONE model: name large, "finish · car", package price, what's included with ticks and the
// warranty column, complimentary badges (never twice), estimated completion, package subtotal.
// Run: node --env-file=.env.test.local tests/browser/test-pkgdisplay9.mjs   (dev server on :3100)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const mupdfP = import("mupdf");
async function pdfOf(url, cookie) {
  const r = await fetch(`${base}${url}`, cookie ? { headers: { cookie } } : undefined);
  const buf = Buffer.from(await r.arrayBuffer());
  const mupdf = await mupdfP;
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return { status: r.status, text: text.replace(/\s+/g, " "), doc };
}
async function pageShot(doc, file) {
  const mupdf = await mupdfP;
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB);
  fs.writeFileSync(shot(file), Buffer.from(pix.asPNG()));
}
const SNAP = { key: "ofj_platinum", name: "OFJ Full Protection Package - Matte Finish", time_in_workshop: "3-5 working days", pickup_dropoff: true, aftercare_check: true, items: [{ label: "Full body PPF", warranty: "10-year warranty" }, { label: "Ceramic heat-rejection tint - sides & rear", warranty: "5-year warranty" }, { label: "Ceramic coating for PPF", warranty: null }, { label: "Complimentary pick-up & drop-off", warranty: null }, { label: "Complimentary 10-day check", warranty: null }] };

function expectDoc(name, text) {
  check(`${name}: its own PROTECTION PACKAGE section, the name and "finish · car"`, /PROTECTION PACKAGE/i.test(text) && /OFJ Full Protection Package/i.test(text) && /Matte Finish · Porsche/i.test(text), text.match(/PROTECTION PACKAGE.{0,140}/i)?.[0] ?? "");
  check(`${name}: package price, what's included with the warranty column`, /PACKAGE PRICE/i.test(text) && /WHAT.S INCLUDED/i.test(text) && /WARRANTY/i.test(text) && /Full body PPF/i.test(text) && /10-year warranty/i.test(text));
  const comp = (text.match(/Complimentary pick-up & drop-off/gi) ?? []).length;
  check(`${name}: complimentary extras appear once each`, comp === 1 && /Complimentary 10-day check/i.test(text) && !/10-day after-care check/i.test(text), `${comp}× pick-up`);
  check(`${name}: Estimated completion and Package subtotal`, /Estimated completion: 3-5 working days/i.test(text) && /Package subtotal/i.test(text));
}

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const qid = seed.json?.quotationId;
if (!qid) { console.error("seed failed"); process.exit(1); }
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, package_key, package_items, created_by, updated_by) values ($1, 0, 'package', 'OFJ Full Protection Package - Matte Finish', 'manual', 1, 18000, 'ofj_platinum', $2::jsonb, $3, $3)", [qid, JSON.stringify(SNAP), advisor]);
await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and package_key is null", [qid]);

/* ---------------- 1. The quotation PDF ---------------- */
const cookie = await cookieHeader("service_advisor");
const q = await pdfOf(`/api/pdf/quotation/${qid}`, cookie);
check("1: the quotation PDF renders", q.status === 200, `${q.status}`);
expectDoc("1 quotation PDF", q.text);
check("1: the totals say Protection package, not a Labour section", /Protection package/i.test(q.text) && !/Labour and services subtotal/i.test(q.text));
await pageShot(q.doc, "pkg9-1-quote-pdf.png");

/* ---------------- 2. The customer's quotation link ---------------- */
await sql("update public.quotations set status = 'sent', sent_at = now(), token = coalesce(token, 'e2e-pkg9-tok'), valid_until = now() + interval '7 days' where id = $1", [qid]);
const token = (await sql("select token from public.quotations where id = $1", [qid]))[0].token;
const { browser, page } = await browserFor("owner", { viewport: { width: 480, height: 1400 } });
await go(page, `${base}/quote/${token}`);
check("2: the link shows the package card", (await page.locator("[data-package-doc]").count()) === 1);
const card = ((await page.locator("[data-package-doc]").textContent()) ?? "").replace(/\s+/g, " ");
expectDoc("2 quotation link", card);
await page.locator("[data-package-doc]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("pkg9-2-link-card.png"), clip: (await page.locator("[data-package-doc]").boundingBox()) ?? undefined });

/* ---------------- 3. The proforma and the tax invoice ---------------- */
const ready = await api("/api/e2e/stage", { stage: "ready" });
const inv = ready.json?.invoice;
check("3: a proforma exists for the proof", !!inv?.token, JSON.stringify(ready.json ?? {}).slice(0, 160));
if (inv?.token) {
  // The proforma built from the approved quotation should carry the package line by itself.
  const carried = await sql("select count(*)::int as n from public.invoice_lines where invoice_id = $1 and package_items is not null", [inv.id]);
  check("3: the proforma copied the package snapshot from the quotation by itself", (carried[0]?.n ?? 0) === 1, JSON.stringify(carried));
  if (!(carried[0]?.n ?? 0)) await sql("insert into public.invoice_lines (invoice_id, position, section, description, details, quantity, unit_price, amount_aed, vat_aed, total_aed, package_items) values ($1, 0, 'services', 'OFJ Full Protection Package - Matte Finish', null, 1, 18000, 18000, 900, 18900, $2::jsonb)", [inv.id, JSON.stringify(SNAP)]);
  const p = await pdfOf(`/api/pdf/invoice/${inv.token}`);
  check("3: the proforma PDF renders", p.status === 200, `${p.status}`);
  expectDoc("3 proforma PDF", p.text);
  await pageShot(p.doc, "pkg9-3-proforma-pdf.png");
  await go(page, `${base}/proforma/${inv.token}`);
  check("3: the proforma link shows the same card", (await page.locator("[data-package-doc]").count()) === 1);
  expectDoc("3 proforma link", ((await page.locator("[data-package-doc]").textContent()) ?? "").replace(/\s+/g, " "));
  await sql("update public.invoices set kind = 'tax_invoice' where id = $1", [inv.id]);
  const t = await pdfOf(`/api/pdf/invoice/${inv.token}`);
  expectDoc("3 tax invoice PDF", t.text);
}

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
