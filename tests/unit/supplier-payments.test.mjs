// Supplier payments with their amount (6 November 2026, Section 4, Mathew): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/supplier-payments.test.mjs        (npm run test:unit)
const { splitOldestFirst, checkAllocations, invoicePaidWords, advanceLeft, advanceWords, SUPPLIER_PAY_METHOD_LABELS } = await import("../../src/lib/supplier-payment-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const inv = [
  { poId: "b", label: "GINV-2", date: "2026-11-02", due: 525 },
  { poId: "a", label: "GINV-1", date: "2026-11-01", due: 1050 },
];
const exact = splitOldestFirst(1575, inv);
check("exact: both invoices settled, oldest first, nothing over", exact.lines[0].poId === "a" && exact.lines[0].amount === 1050 && exact.lines[1].amount === 525 && exact.excess === 0);
const less = splitOldestFirst(1200, inv);
check("less: the oldest in full, the next part paid", less.lines[0].amount === 1050 && less.lines[1].amount === 150 && less.excess === 0);
const more = splitOldestFirst(1600, inv);
check("more: the rest is the excess (25.00)", more.excess === 25 && more.lines.length === 2);
check("no date goes last", splitOldestFirst(10, [{ poId: "x", label: "X", date: null, due: 10 }, { poId: "y", label: "Y", date: "2026-11-01", due: 10 }]).lines[0].poId === "y");

check("the amount is compulsory", checkAllocations(0, [], inv) === "Type the amount paid.");
check("never more on an invoice than it owes", /more than that invoice still owes \(AED 525\.00\)/.test(checkAllocations(600, [{ poId: "b", amount: 600 }], inv) ?? ""));
check("never more in total than paid", /more than the AED 500\.00 paid/.test(checkAllocations(500, [{ poId: "a", amount: 400 }, { poId: "b", amount: 200 }], inv) ?? ""));
check("an invoice no longer open is refused", checkAllocations(10, [{ poId: "z", amount: 10 }], inv) === "One of the invoices is no longer open.");
check("a good spread passes", checkAllocations(1000, [{ poId: "a", amount: 1000 }], inv) === null);

check(`part paid words ("${invoicePaidWords(525, 300).words}")`, invoicePaidWords(525, 300).words === "Part paid · balance AED 225.00" && invoicePaidWords(525, 525).state === "paid" && invoicePaidWords(525, 0).state === "open");

check("an advance left = paid − lines − fee", advanceLeft({ amount: 400, excessKind: "advance", fee: 0, status: "recorded" }, 225) === 175);
check("used later = less left", advanceLeft({ amount: 400, excessKind: "advance", fee: 0, status: "recorded" }, 400) === 0);
check("a fee is never an advance", advanceLeft({ amount: 220, excessKind: "fee", fee: 10, status: "recorded" }, 210) === 0);
check("a voided payment has no advance", advanceLeft({ amount: 400, excessKind: "advance", fee: 0, status: "void" }, 0) === 0);
check(`advance words ("${advanceWords("GARGASH", 175)}")`, advanceWords("GARGASH", 175) === "Advance with GARGASH AED 175.00");
check("payment link is a method of its own", SUPPLIER_PAY_METHOD_LABELS.link === "Payment link");

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
if (failed) process.exit(1);
