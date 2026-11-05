// Supplier amounts with VAT (5 November 2026, Mathew): THE rule and THE calculation.
//   node --import ./tests/unit/register.mjs tests/unit/supplier-money.test.mjs        (npm run test:unit)
const { supplierMoney, supplierMoneyWords, supplierMoneyText, addSupplierMoney, lpoMoney, originalNetOf, moneyFrom } = await import("../../src/lib/supplier-money.ts");
const { supplierChargesVat, NO_VAT_WORDS } = await import("../../src/lib/supplier-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const TRN = "100200300400500";
check("VAT only from a supplier VAT registered WITH a 15-digit TRN", supplierChargesVat({ name: "GARGASH", trn: TRN, vat_registered: true }));
check("no TRN = no VAT (even when ticked VAT registered)", !supplierChargesVat({ name: "SPARE HUB", trn: null, vat_registered: true }) && !supplierChargesVat({ name: "SPARE HUB", trn: "1234", vat_registered: true }));
check("not VAT registered = no VAT (even with a TRN typed)", !supplierChargesVat({ name: "X", trn: TRN, vat_registered: false }));
check("Our stock never VAT", !supplierChargesVat({ name: "Our Stock", trn: TRN, vat_registered: true }));

const m = supplierMoney(963, { chargesVat: true });
const w = supplierMoneyWords(m);
check(`963.00 → "AED 1,011.15 incl. VAT" with "963.00 + VAT 48.15" (${w.main} | ${w.sub})`, w.main === "AED 1,011.15 incl. VAT" && w.sub === "963.00 + VAT 48.15" && m.gross === 1011.15);
const n = supplierMoneyWords(supplierMoney(963, { chargesVat: false }));
check(`no VAT: "AED 963.00" with "${NO_VAT_WORDS}"`, n.main === "AED 963.00" && n.sub === NO_VAT_WORDS);
check("VAT on the total, half up to the fils (0.10 → 0.01, 1.30 → 0.07, 4.48 → 0.22)", supplierMoney(0.1, { chargesVat: true }).vat === 0.01 && supplierMoney(1.3, { chargesVat: true }).vat === 0.07 && supplierMoney(4.48, { chargesVat: true }).vat === 0.22);
check("never line by line: two lines of 0.10 → VAT on 0.20 = 0.01, not 0.02", supplierMoney(0.1 + 0.1, { chargesVat: true }).vat === 0.01);
check("the entered invoice's own VAT replaces the estimate (584.24 on 11,684.82)", supplierMoney(11684.82, { chargesVat: true, typedVat: 584.24 }).gross === 12269.06);
check("a supplier that is not VAT registered stays at 0 even with a typed VAT", supplierMoney(800, { chargesVat: false, typedVat: 40 }).vat === 0);
check("one line of text for copies", supplierMoneyText(m) === "AED 1,011.15 incl. VAT (963.00 + VAT 48.15)" && supplierMoneyText(supplierMoney(10, { chargesVat: false })) === "AED 10.00 (no VAT – supplier not VAT-registered)");
const sum = addSupplierMoney([supplierMoney(963, { chargesVat: true }), supplierMoney(100, { chargesVat: false })]);
check(`a main LPO adds its suppliers (1,063.00 + VAT 48.15 = 1,111.15) (${sum.net} + ${sum.vat} = ${sum.gross})`, sum.net === 1063 && sum.vat === 48.15 && sum.gross === 1111.15 && sum.vatCharged);

// Cancelled LPOs (LPO-00041 kept its 4.48 with the line active; LPO-00042 was re-totalled to 0 with its line inactive).
const l41 = lpoMoney({ status: "cancelled", total_cost_aed: 4.48 }, true, originalNetOf([{ quantity: 1, unit_cost: 4.48 }]));
const l42 = lpoMoney({ status: "cancelled", total_cost_aed: 0 }, true, originalNetOf([{ quantity: "1.00", unit_cost: "4.48" }]));
check("LPO-00041 and LPO-00042 both show their ORIGINAL 4.48 (+ VAT), marked cancelled", l41.cancelled && l42.cancelled && l41.net === 4.48 && l42.net === 4.48 && l42.gross === 4.7);
const inv = lpoMoney({ status: "received", total_cost_aed: 12228.3, supplier_invoice_status: "received", supplier_invoice_number: "SI-1", supplier_invoice_amount: 11684.82, supplier_invoice_vat_aed: 584.24 }, true);
check("an LPO with its invoice entered shows the invoice's figures", inv.fromInvoice && inv.net === 11684.82 && inv.vat === 584.24);
const open = lpoMoney({ status: "ordered", total_cost_aed: 963 }, true);
check("an open LPO: its total with the 5% estimate", !open.cancelled && !open.fromInvoice && open.gross === 1011.15);
check("figures from elsewhere in the same shape", moneyFrom(963, 48.15, true).gross === 1011.15 && !moneyFrom(963, 0, false).vatCharged);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll supplier-money checks passed");
process.exit(failed ? 1 : 0);
