// One payment for several cars (9 November 2026, Section 3): THE rules in src/lib/combined-pay-rules.ts.
//   node --import ./tests/unit/register.mjs tests/unit/combined-pay.test.mjs        (npm run test:unit)
const { splitPayment, checkShares, partOfWords, leftoverWords } = await import("../../src/lib/combined-pay-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// AL ALI: one cheque of 4,368.00 for PRO-00015 (2,236.50, J-00860) and PRO-00016 (2,131.50, J-00858).
const docs = [
  { invoiceId: "b", number: "PRO-00016", issuedAt: "2026-11-09T09:00:00Z", due: 2131.5 },
  { invoiceId: "a", number: "PRO-00015", issuedAt: "2026-11-09T08:00:00Z", due: 2236.5 },
];
const exact = splitPayment(4368, docs);
check("oldest first, every document paid, nothing left", JSON.stringify(exact) === JSON.stringify({ shares: [{ invoiceId: "a", amount: 2236.5 }, { invoiceId: "b", amount: 2131.5 }], leftover: 0 }), JSON.stringify(exact));
const more = splitPayment(4868, docs);
check("more than owed: the rest is left over (an advance)", more.leftover === 500 && more.shares.length === 2);
const less = splitPayment(3000, docs);
check("less than owed: the newest is part paid", JSON.stringify(less.shares) === JSON.stringify([{ invoiceId: "a", amount: 2236.5 }, { invoiceId: "b", amount: 763.5 }]) && less.leftover === 0);
check("no documents: everything left over", splitPayment(250, []).leftover === 250);
check("a share above what a document owes is refused", (checkShares(4368, [{ invoiceId: "a", amount: 2300 }], docs) ?? "").includes("PRO-00015 owes AED 2,236.50"));
check("shares above the payment are refused", (checkShares(1000, [{ invoiceId: "a", amount: 900 }, { invoiceId: "b", amount: 200 }], docs) ?? "").includes("more than the AED 1,000.00"));
check("a good spread passes", checkShares(4368, exact.shares, docs) === null);
check("the receipt words", partOfWords("cheque", 4368, "019383") === "Part of cheque 019383 (AED 4,368.00 total)");
check("transfer words", partOfWords("transfer", 1000, null, "TT55") === "Part of transfer TT55 (AED 1,000.00 total)");
check("left over words", leftoverWords(500) === "AED 500.00 left over becomes an advance on the customer's account." && leftoverWords(0) === null);

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
