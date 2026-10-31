// The PDF layout check (30 October 2026, night batch section 6.2): the shared document parts - the frame, the info
// boxes, the PROTECTION PACKAGE section, the line tables, the totals, the damage block, the job card - rendered with
// short and with very long content, and checked by tests/unit/pdf-check-lib.mjs: no text drawn on top of other text,
// nothing off the page, no number split across lines, every tick level with its line. Proof pictures:
// tests/browser/shots/pdf/. The owner's case (Q-00039): the first package item was printed on top of its cut note.
//   node --import ./tests/unit/register.mjs tests/unit/pdf-layout.test.mjs        (npm run test:unit / npm run test:pdf)
import fs from "node:fs";
import path from "node:path";
const React = (await import("react")).default;
const h = React.createElement;
const { Document, Page, Text, View, renderToBuffer } = await import("@react-pdf/renderer");
const t = await import("../../src/lib/pdf/template.tsx");
const { DamagePdf } = await import("../../src/lib/pdf/damage-pdf.tsx");
const { renderGateInPdf } = await import("../../src/lib/pdf/gate-in-pdf.tsx");
const { checkPdf, pagePng, ticksOf } = await import("./pdf-check-lib.mjs");
const { docMoneyRows } = await import("../../src/lib/doc-totals.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const out = path.join(process.cwd(), "tests", "browser", "shots", "pdf");
fs.mkdirSync(out, { recursive: true });

const company = { tradingName: "OFJ Automotive", legalName: "OFJ Automotive Repair LLC", legalNameAr: "", address: ["Al Quoz Industrial Area 3", "Dubai, United Arab Emirates"], phone: "+971 4 000 0000", email: "info@example.test", website: "erp.ofjauto.com", trn: "100000000000003", bank: { name: "Test Bank", accountName: "OFJ Automotive Repair LLC", accountNumber: "0000000000", iban: "AE000000000000000000000", swift: "TESTAEAD" } };
const LONG = "Lathe charges – cylinder block boring and honing to the next oversize, deck surface skimming, crankshaft regrind front and rear main journals with new main and big-end bearings, oil gallery plugs replaced and the block hot-washed and pressure-tested before assembly";
const pkgDoc = (long) => ({
  title: long ? "OFJ Full Protection Package with Extended Stealth Matte Paint Protection" : "OFJ Full Protection Package",
  subtitle: "Gloss · Mercedes-Benz S 580 2027",
  items: [
    { label: "Full body paint protection film (PPF) – gloss, self healing", warranty: "10 years", note: "Cut: Machine pre-cut" },
    { label: long ? "Exterior ceramic coating (paint, wheels, calipers, exhaust tips, trims and all exterior glass, with a hydrophobic top layer)" : "Exterior ceramic coating (paint and wheels)", warranty: "3 years" },
    { label: "Interior ceramic coating", warranty: "1 year" },
    { label: "OFJ ceramic heat rejection film – rear side windows & rear screen · 30%", warranty: "5 years" },
  ],
  complimentary: ["Complimentary pick-up & drop-off"],
  completion: "5 working days",
  explain: "Machine pre-cut film is cut by a plotter from the car's pattern; hand-cut is shaped on the car by the installer.",
});
const lines = (long) => [
  { description: long ? LONG : "Front brake pads replacement", positions: "FRONT PAIR", details: long ? `${LONG}. ${LONG}` : "Pads and sensor", qty: "2.5 h", rate: 350, amount: 875, discountPercent: 10, discountAmount: 87.5 },
  { description: "PPF front right mirror housing", qty: "1.0 h", rate: 350, amount: 0, complimentary: true, compWord: "COMPLIMENTARY (value AED 12,350.00)" },
  { description: "Wheel alignment check", qty: "1", rate: 0, amount: 0, complimentary: true, compWord: "NO CHARGE" },
  { description: long ? "Engine oil 0W-20 fully synthetic (Mercedes-Benz approval MB 229.71) – 9 litres" : "Engine oil 0W20", qty: "9", rate: 1234567.89, amount: 11111111.01 },
];
const doc = (long) => h(t.PdfDocument, { title: "Quotation", company, logo: null }, [
  h(t.InfoBoxes, { key: "b", boxes: [{ title: "Quotation for", strong: long ? "Al Something Very Long Trading and Contracting Company LLC (Branch 2)" : "Customer", lines: ["+971 50 000 0000"] }, { title: "Vehicle", strong: "Mercedes-Benz S 580 · Dubai A 12345", lines: ["VIN WDD0000000000000"] }] }),
  h(t.PackageSection, { key: "p", doc: pkgDoc(long), price: 20000 }),
  h(t.SectionBox, { key: "s", title: "Labour and services", lines: lines(long), subtotalLabel: "Labour subtotal", showSubtotal: true }),
  // The 31 October layout: the totals box with the amount in words, the bank details and the note, as one block.
  h(t.DocumentTail, { key: "t", words: "Eleven million six hundred eighty-six thousand four hundred twenty-nine dirhams and thirteen fils only", bank: company.bank, note: "Prices valid until the date above. Work starts once the quotation is approved.", rows: docMoneyRows({ sections: [{ key: "pkg", lines: 1 }, { key: "services", lines: 4 }], gross: 11132023.51, green: [{ label: "Package discount (10%)", value: 2000 }, { label: "Discount (labour and services)", value: 87.5 }, { label: "Round-off", value: 3.51 }], net: 11129932.5, vatPercent: 5, vat: 556496.63, total: 11686429.13 }) }),
]);

for (const long of [false, true]) {
  const name = long ? "quotation (long content)" : "quotation (short content)";
  const buf = await renderToBuffer(doc(long));
  const problems = checkPdf(buf, name);
  check(`${name}: nothing on top of anything, nothing off the page, no split numbers, ticks level`, problems.length === 0, problems.slice(0, 6).join(" | "));
  const ticks = ticksOf(buf, 0).filter((x) => x.text);
  check(`${name}: the five package ticks are found and each is level with its line`, ticks.length >= 5 && ticks.every((x) => Math.abs(x.dy) <= 2.6), ticks.map((x) => `${x.text.slice(0, 18)} ${x.dy.toFixed(1)}`).join(" | "));
  fs.writeFileSync(path.join(out, `quotation-${long ? "long" : "short"}.png`), pagePng(buf, 0));
}

// The damage block and the customer's job card.
const pic = { data: fs.readFileSync(path.join(process.cwd(), "public", "preview.jpg")), format: "jpg" };
const damage = { rows: [{ label: "Headlight – front right", words: "Crack · Moderate", note: long2(), tone: "red", photos: [pic, pic, pic, pic] }, { label: "Front bumper", words: "Scratch, Dent · Minor", note: null, tone: "amber", photos: [pic] }], loose: [pic], note: "Stone chips on the bonnet", after: [{ label: "Door – rear left", words: "Dent", note: "Small dent under the handle", tone: "amber", photos: [pic], when: "31 Oct 2026" }], tones: { headlight_r: "red", front_bumper: "amber" } };
function long2() { return "Lens cracked at the outer corner, the washer jet is missing and the bracket behind it is bent; the customer says it happened before the car came in"; }
{
  const buf = await renderToBuffer(h(Document, null, h(Page, { size: "A4", style: { padding: 36 } }, h(DamagePdf, { d: damage }))));
  const problems = checkPdf(buf, "damage block");
  check("damage block: clean", problems.length === 0, problems.slice(0, 6).join(" | "));
}
{
  const buf = await renderGateInPdf({ customer: true, jobNumber: "J-00999", plate: "Dubai A 12345", car: "Mercedes-Benz S 580 2027", vin: "WDD0000000000000", colour: "Black", customerName: "Customer", customerPhone: null, customerNumber: null, gatedIn: "30 Oct 2026, 09:12", gatedInBy: "", details: [["Received at", "Al Quoz branch"], ["Damage noted", "2 panels (see above)"], ["Mileage", "12,345 km"]], requests: [LONG, "Check the noise from the front left when braking"], approval: "Approved by Customer on 30 Oct 2026, 09:30.", feeLine: "Inspection fee AED 750.00 including VAT (AED 714.29 + VAT AED 35.71)", gateOut: null, photos: [], videoCount: 0, damage, printedBy: "", printedAt: "" });
  const problems = checkPdf(buf, "job card");
  check("customer's job card: clean", problems.length === 0, problems.slice(0, 6).join(" | "));
  fs.writeFileSync(path.join(out, "job-card.png"), pagePng(buf, 0));
}

// The check itself catches the old fault: a Text with flex inside a column draws the next line on top of it.
{
  const broken = h(Document, null, h(Page, { size: "A4", style: { padding: 36 } }, h(View, { style: { flexDirection: "row", alignItems: "center", gap: 8 } }, [h(View, { key: "a", style: { flex: 1 } }, [h(Text, { key: "1", style: { flex: 1, fontSize: 11 } }, "Full body paint protection film (PPF) – gloss, self healing"), h(Text, { key: "2", style: { fontSize: 9.5, fontWeight: 700 } }, "Cut: Machine pre-cut")])])));
  const problems = checkPdf(await renderToBuffer(broken), "the old layout");
  check("the check catches text drawn on top of other text (the old package row)", problems.some((p) => /on top of each other/.test(p)), problems[0] ?? "not caught");
}
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
