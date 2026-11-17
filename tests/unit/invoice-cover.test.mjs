// One supplier invoice for several LPOs (17 November 2026, Section 2): THE share-out and number rules.
//   node --import ./tests/unit/register.mjs tests/unit/invoice-cover.test.mjs        (npm run test:unit)
const { compactInvoiceNumber, splitInvoiceTotal, togetherWords, leadOf } = await import("../../src/lib/invoice-cover-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("the same paper typed with spaces or dashes is one number", compactInvoiceNumber("INV 262817342") === compactInvoiceNumber("inv-262817342") && compactInvoiceNumber(null) === "");

// AL TAYER: LPO-00039-1 3,224.00 + LPO-00039-3 637.00 before VAT = 3,861.00 (4,054.05 with VAT).
const s = splitInvoiceTotal(3861, [{ id: "a", total: 3224 }, { id: "b", total: 637 }]);
check("the AL TAYER paper shares exactly by the LPO totals", s.get("a") === 3224 && s.get("b") === 637, JSON.stringify([...s]));
const odd = splitInvoiceTotal(100, [{ id: "a", total: 1 }, { id: "b", total: 1 }, { id: "c", total: 1 }]);
const sum = Math.round([...odd.values()].reduce((x, v) => x + v, 0) * 100) / 100;
check("thirds land on the typed total to the fils (the fils on the largest)", sum === 100, JSON.stringify([...odd]));
const off = splitInvoiceTotal(3850, [{ id: "a", total: 3224 }, { id: "b", total: 637 }]);
check("a paper 11.00 lower is shared by the totals too", Math.round(((off.get("a") ?? 0) + (off.get("b") ?? 0)) * 100) / 100 === 3850 && (off.get("a") ?? 0) > (off.get("b") ?? 0));
const zero = splitInvoiceTotal(50, [{ id: "a", total: 0 }, { id: "b", total: 0 }]);
check("LPOs with no total share equally", zero.get("a") === 25 && zero.get("b") === 25);
check("no LPOs = no shares", splitInvoiceTotal(10, []).size === 0);
check("the Together line names each LPO", togetherWords([{ number: "LPO-00039-1", total: 3224 }, { number: "LPO-00039-3", total: 637 }]) === "Together: AED 3,861.00 before VAT (LPO-00039-1 AED 3,224.00 + LPO-00039-3 AED 637.00)");
check("the oldest LPO carries the Zoho bill", leadOf([{ id: "b", created_at: "2026-11-10" }, { id: "a", created_at: "2026-11-09" }])?.id === "a" && leadOf([]) === null);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
