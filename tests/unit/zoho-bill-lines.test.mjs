// Section 7 of 13 November 2026 (Zoho supplier bills, one line per part): THE rule.
//   node --import ./tests/unit/register.mjs tests/unit/zoho-bill-lines.test.mjs        (npm run test:unit)
const { billLines, sameLayout, lineDescription } = await import("../../src/lib/zoho-bill-lines.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const ref = { lpo: "LPO-00076-2", job: "J-01007", plate: "Dubai X 12345" };
const accounts = { parts: "ACC-PARTS", courier: "ACC-COURIER" };
// LPO-00076-2 (bill 1260925425): three lines delivered, three not delivered (received 0).
const lpo76 = [
  { description: "spark plugs", partNumber: "S&S", quantity: 8, unit: 67 },
  { description: "WIPER BLADE", partNumber: "BLADE", quantity: 1, unit: 110 },
  { description: "Transmission mounts", partNumber: "MOUNT - GEAR", quantity: 0, unit: 148 },
  { description: "DIFFERENTIAL OIL", partNumber: "FLUID", quantity: 4, unit: 58 },
  { description: "ENGINE MOUNTING -2", partNumber: "MOUNT-2", quantity: 0, unit: 199 },
  { description: "ENGINE MOUNT", partNumber: "MOUNT", quantity: 0, unit: 198 },
];
const b = billLines({ lines: lpo76, charges: [], expectedNet: 878, expectedVat: 43.9, taxed: true, ref, accounts, taxId: "TAX5" });
check("LPO-00076-2: one line per delivered part (3), none for the undelivered", b.items.length === 3, b.items.map((i) => i.name).join(" | "));
check("LPO-00076-2: net 878.00 + VAT 43.90 = 921.90, no round-off, no adjustment", b.zohoNet === 878 && b.zohoVat === 43.9 && b.roundOff === 0 && b.adjustment === 0 && Math.round((b.zohoNet + b.zohoVat + b.adjustment) * 100) / 100 === 921.9);
check("each line: name, quantity, unit cost, part account, 5% tax", b.items[0].name === "spark plugs" && b.items[0].quantity === 8 && b.items[0].rate === 67 && b.items[0].account_id === "ACC-PARTS" && b.items[0].tax_id === "TAX5");
check("the description carries part number, LPO, job and plate", b.items[0].description === "Part no. S&S · LPO-00076-2 · J-01007 · Dubai X 12345", b.items[0].description);
check("the list price less the discount is shown when the supplier gave one", lineDescription({ description: "PAD", partNumber: null, quantity: 1, unit: 90, listPrice: 100, discountPercent: 10 }, ref).endsWith("list 100.00 less 10%"));

// A courier charge and an invoice discount on the paper: each its own line; the total lands to the fils.
const c = billLines({ lines: [{ description: "BRAKE PADS", partNumber: "A123", quantity: 2, unit: 250.25 }], charges: [{ description: "Courier", amount: 25 }], expectedNet: 520, expectedVat: 26, taxed: true, ref, accounts, taxId: "TAX5" });
check("courier on the courier account", c.items.find((i) => i.name === "Courier")?.account_id === "ACC-COURIER");
check("invoice discount as its own line: 525.50 → 520.00 (−5.50)", c.roundOff === -5.5 && c.items.at(-1).name === "Invoice discount / round-off" && c.items.at(-1).rate === -5.5, JSON.stringify(c.items.at(-1)));
check("net lands exactly on the paper's 520.00", c.zohoNet === 520);
check("VAT per line, the fils to the paper's VAT in the adjustment", Math.round((c.zohoVat + c.adjustment) * 100) / 100 === 26, `${c.zohoVat} + ${c.adjustment}`);

// A supplier without VAT: no tax on any line, no adjustment.
const n = billLines({ lines: [{ description: "USED DOOR", partNumber: null, quantity: 1, unit: 400 }], charges: [], expectedNet: 400, expectedVat: 0, taxed: false, ref, accounts, taxId: "TAX5" });
check("no VAT supplier: no tax_id, VAT 0, no adjustment", !("tax_id" in n.items[0]) && n.zohoVat === 0 && n.adjustment === 0);

// Odd per-line VAT rounding: three lines at 0.10 each → per-line VAT 0.01 ×3 = 0.03 vs 5% of 0.30 = 0.02 (half up 0.015 → 0.02).
const o = billLines({ lines: [1, 2, 3].map((i) => ({ description: `CLIP ${i}`, partNumber: null, quantity: 1, unit: 0.1 })), charges: [], expectedNet: 0.3, expectedVat: 0.02, taxed: true, ref, accounts, taxId: "TAX5" });
check("rounding fils go to the adjustment so the total is the paper's", Math.round((o.zohoNet + o.zohoVat + o.adjustment) * 100) / 100 === 0.32, `${o.zohoNet} + ${o.zohoVat} + ${o.adjustment}`);

check("same layout: an old one-line bill is not the same → re-posted", !sameLayout([{ name: "Parts per LPO-00076-2 – 6 items", rate: 878, quantity: 1 }], b.items));
check("same layout: the same lines → left alone", sameLayout(b.items.map((i) => ({ name: i.name, rate: i.rate, quantity: i.quantity })), b.items));

console.log(`${failed ? "FAILED" : "passed"}: ${failed} failed`);
process.exit(failed ? 1 : 0);
