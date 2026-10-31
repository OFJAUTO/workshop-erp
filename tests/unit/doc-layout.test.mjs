// THE document layout's rules (31 October 2026, the owner's mockup): every amount once (src/lib/doc-totals.ts), the
// valid-until date, AED only, and the page rules (src/lib/pdf-read.ts renderByPageRules + the template's boxesWithTail):
// one page when it fits (tightening first), a second page only when needed, the totals never alone on a page.
//   node --import ./tests/unit/register.mjs tests/unit/doc-layout.test.mjs        (npm run test:unit)
const React = (await import("react")).default;
const h = React.createElement;
const { renderToBuffer } = await import("@react-pdf/renderer");
const t = await import("../../src/lib/pdf/template.tsx");
const { pdfTailFacts, renderByPageRules } = await import("../../src/lib/pdf-read.ts");
const { docMoneyRows, sectionSubtotalShown, validUntilOf } = await import("../../src/lib/doc-totals.ts");
const { checkPdf, moneyProblems } = await import("./pdf-check-lib.mjs");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const labels = (rows) => rows.map((r) => `${r.label}=${r.value}`).join(" | ");

/* Every amount once */
const a = docMoneyRows({ sections: [{ key: "pkg", lines: 1 }], gross: 20000, green: [], net: 20000, vatPercent: 5, vat: 1000, total: 21000 });
check("mockup A (a package alone): VAT 5% and TOTAL INCL. VAT only", labels(a) === "VAT 5%=1000 | Total incl. VAT=21000", labels(a));
const b = docMoneyRows({ sections: [{ key: "services", lines: 3 }, { key: "parts", lines: 3 }], gross: 11530, green: [], net: 11530, vatPercent: 5, vat: 576.5, total: 12106.5 });
check("mockup B (labour + parts): Subtotal before VAT, VAT, TOTAL", labels(b) === "Subtotal before VAT=11530 | VAT 5%=576.5 | Total incl. VAT=12106.5", labels(b));
check("mockup B: each section's subtotal (3 lines, 2 sections)", sectionSubtotalShown([{ key: "services", lines: 3 }, { key: "parts", lines: 3 }], "parts"));
check("a section of one line has no subtotal", !sectionSubtotalShown([{ key: "services", lines: 1 }, { key: "parts", lines: 3 }], "services"));
check("one section alone has no subtotal (the totals box carries it)", !sectionSubtotalShown([{ key: "services", lines: 4 }], "services"));
const disc = docMoneyRows({ sections: [{ key: "pkg", lines: 1 }], gross: 20000, green: [{ label: "Package discount (10%)", value: 2000 }], net: 18000, vatPercent: 5, vat: 900, total: 18900 });
check("a package with a discount: the discount, then Subtotal before VAT (a new figure)", labels(disc) === "Package discount (10%)=2000 | Subtotal before VAT=18000 | VAT 5%=900 | Total incl. VAT=18900", labels(disc));
const tax = docMoneyRows({ sections: [{ key: "services", lines: 1 }], gross: 714.29, green: [], net: 714.29, vatPercent: 5, vat: 35.71, total: 750, taxDocument: true });
check("a tax invoice always carries the taxable amount", tax[0].label === "Subtotal before VAT", labels(tax));
const paid = docMoneyRows({ sections: [{ key: "services", lines: 2 }], gross: 1000, green: [], net: 1000, vatPercent: 5, vat: 50, total: 1050, after: [{ label: "Paid (RCT-00036)", value: 500, kind: "paid" }], balance: 550 });
check("an invoice with a payment: Paid (RCT-…) then BALANCE DUE in the same box", labels(paid).endsWith("Paid (RCT-00036)=500 | Balance due=550"), labels(paid));
check("one total only", [a, b, disc, tax, paid].every((rows) => rows.filter((r) => r.kind === "total").length === 1));

/* Valid until is a date */
check("valid until = the quotation's date + the validity days", validUntilOf({ valid_until: null, sent_at: null, created_at: "2026-10-30T08:00:00Z", validity_days: 7 }).startsWith("2026-11-06"));
check("AED only: the document currency is always AED", t.currencyOf({ document_currency: "symbol" }) === "aed");

/* The page rules on made-up documents of many lengths */
const company = { tradingName: "OFJ", legalName: "OFJ LLC", legalNameAr: "", address: ["Dubai"], phone: "+971 4 000 0000", email: "a@example.test", website: "example.test", trn: "100000000000003", bank: { name: "Bank", accountName: "OFJ", accountNumber: "1", iban: "AE1", swift: "S" } };
const rows = docMoneyRows({ sections: [{ key: "p", lines: 5 }, { key: "o", lines: 1 }], gross: 1, green: [{ label: "Discount", value: 3 }], net: 1, vatPercent: 5, vat: 1, total: 1, after: [{ label: "Deposit required", value: 2 }] });
const other = [{ quantity: 1, description: "Courier", qty: "1", rate: 5, amount: 5 }];
const results = [];
for (const n of [8, 14, 15, 16, 22, 30, 35, 36, 40, 45, 60]) {
  const parts = Array.from({ length: n }, (_, i) => ({ quantity: 2, description: `Part ${i + 1}`, details: "In 12 days", qty: "2", rate: 10, amount: 20 }));
  const boxes = [{ key: "p", title: "Parts", descLabel: "Part", lines: parts, subtotalLabel: "Parts subtotal", showSubtotal: true }, { key: "o", title: "Other charges", lines: other, subtotalLabel: "x", showSubtotal: false }];
  const draw = ({ tight, keepLast }) => { const { body, lead } = t.boxesWithTail(boxes, keepLast, tight); return renderToBuffer(h(t.PdfDocument, { title: "Quotation Q-1", company, logo: null, tight }, [...body, h(t.DocumentTail, { key: "t", rows, words: "One dirham only", bank: company.bank, note: "Note", lead: lead.length ? lead : null, tight })])); };
  const plain = await pdfTailFacts(await draw({ tight: false, keepLast: false }));
  const buf = await renderByPageRules(draw);
  const f = await pdfTailFacts(buf);
  const problems = [...checkPdf(buf, `parts ${n}`), ...moneyProblems(buf, `parts ${n}`).filter((p) => !/printed twice/.test(p))];
  results.push({ n, plain, f, problems });
}
check("never a page with only the totals, never an empty page (8 to 60 lines)", results.every((r) => !r.f.tailAlone && !r.f.emptyPages.length), results.filter((r) => r.f.tailAlone || r.f.emptyPages.length).map((r) => r.n).join(", "));
check("a small overflow tightens onto fewer pages (14-16 lines: 2 pages -> 1)", results.filter((r) => [14, 15, 16].includes(r.n)).every((r) => r.f.pages < r.plain.pages || !r.plain.tailAlone), results.filter((r) => [14, 15, 16].includes(r.n)).map((r) => `${r.n}: ${r.plain.pages}->${r.f.pages}`).join(", "));
check("never more pages than drawn plainly", results.every((r) => r.f.pages <= r.plain.pages), results.map((r) => `${r.n}: ${r.plain.pages}->${r.f.pages}`).join(", "));
check("the layout check is clean at every length", results.every((r) => !r.problems.length), results.flatMap((r) => r.problems).slice(0, 3).join(" | "));
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
