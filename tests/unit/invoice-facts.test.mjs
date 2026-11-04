// The invoice reader (4 November 2026): number, date and the money rows out of a supplier invoice's words.
//   node --import ./tests/unit/register.mjs tests/unit/invoice-facts.test.mjs        (npm run test:unit)
const P = await import("../../src/lib/price-import.ts");
const { invoiceFacts, invoiceDateIso } = P;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const SPARE_HUB = [
  "SPARE HUB AUTO SPARE PARTS TRADING L.L.C",
  "TRN 100123456700003",
  "TAX INVOICE",
  "Invoice No: 2374",
  "Date: 28/10/2026",
  "FRONT HUB ASSEMBLY 2 520.00 1,040.00",
  "Gross Amount 1,240.00",
  "Discount 200.00",
  "Total before VAT 1,040.00",
  "VAT 5% 52.00",
  "Net Total 1,092.00",
].join("\n");

const f = invoiceFacts(SPARE_HUB);
check("the invoice number (never the TRN)", f.number === "2374", f.number ?? "null");
check("the date, day first", f.date === "2026-10-28", f.date ?? "null");
check("gross, discount, before VAT, VAT and net total", f.gross === 1240 && f.discount === 200 && f.beforeVat === 1040 && f.vat === 52 && f.net === 1092, JSON.stringify(f));

const PLAIN = ["GARGASH ENTERPRISES", "INV. 88123", "15-Oct-2026", "Subtotal 3,000.00", "VAT 150.00", "Grand Total 3,150.00"].join("\n");
const g = invoiceFacts(PLAIN);
check("another layout: INV., a word date, Subtotal/Grand Total", g.number === "88123" && g.date === "2026-10-15" && g.beforeVat === 3000 && g.vat === 150 && g.net === 3150, JSON.stringify(g));

const GAPS = ["Tax Invoice # A-771", "Invoice date 03/11/2026", "Total 950.00", "VAT 47.50", "Total incl. VAT 997.50"].join("\n");
const h = invoiceFacts(GAPS);
check("a plain Total before a VAT row is the before-VAT figure", h.beforeVat === 950 && h.net === 997.5 && h.number === "A-771", JSON.stringify(h));

const MISSING = ["Invoice 55", "Date: 01/11/2026", "Net Total 2,100.00", "VAT 100.00"].join("\n");
const m = invoiceFacts(MISSING);
check("a missing before-VAT figure is worked out (net − VAT)", m.beforeVat === 2000 && m.net === 2100, JSON.stringify(m));

check("dates in every shape", invoiceDateIso("2026-11-04") === "2026-11-04" && invoiceDateIso("4/11/26") === "2026-11-04" && invoiceDateIso("11/28/2026") === "2026-11-28" && invoiceDateIso("28 Oct 2026") === "2026-10-28" && invoiceDateIso("nothing") === null);
check("no words, no facts (the OCR path takes over)", JSON.stringify(invoiceFacts("")) === JSON.stringify({ number: null, date: null, gross: null, discount: null, beforeVat: null, vat: null, net: null }));

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
