// A part's quantity changed after approval (9 November 2026, Section 1): THE pure rules in src/lib/qty-after-approval-rules.ts.
//   node --import ./tests/unit/register.mjs tests/unit/qty-after-approval.test.mjs        (npm run test:unit)
const { qtyChangeLine, qtyDirection, roundQty, reducedBy, reduceLineWords, overpaidWords, REDUCED_MARK, QTY_REASONS } = await import("../../src/lib/qty-after-approval-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const line = qtyChangeLine({ name: "rear differential oil", was: 3, now: 2, unit: "pc", by: "Peter", when: "9 Nov 2026, 14:05", reason: "bought fewer" });
check("the history line in the owner's words", line === "REAR DIFFERENTIAL OIL: 3 → 2 by Peter, 9 Nov 2026, 14:05: bought fewer", line);
check("litres carry their unit", qtyChangeLine({ name: "oil", was: 6.5, now: 5, unit: "l", by: "Omar", when: "x", reason: "used fewer" }).includes("6.5 L → 5 L"));
check("a note follows in brackets", qtyChangeLine({ name: "a", was: 2, now: 1, unit: null, by: "P", when: "w", reason: "returned", note: "box damaged" }).endsWith("returned (box damaged)"));
check("down and up", qtyDirection(3, 2) === "down" && qtyDirection(2, 3) === "up");
check("pieces are whole, litres to two decimals", roundQty(2.0004, "pc") === 2 && roundQty(1.236, "l") === 1.24);
check("the saving is the unit price × the pieces dropped", reducedBy(242.5, 3, 2) === 242.5 && reducedBy(10, 2, 3) === 0);
const w = reduceLineWords({ title: "rear differential oil", quoted: 3, now: 2, unit: "pc", unitPrice: 242.5 });
check("the card's line", w.startsWith("REAR DIFFERENTIAL OIL: approved 3") && w.includes("AED 242.50 less before VAT"), w);
check("paid more than the new total: an advance or refund", (overpaidWords(1000, 745.5) ?? "").includes("AED 254.50 more than the new total"));
check("paid less: nothing to say", overpaidWords(500, 745.5) === null);
check("the mark is the owner's wording", REDUCED_MARK === "Reduced after approval – no customer approval needed");
check("four reasons, the owner's", QTY_REASONS.map((r) => r.words).join("|") === "bought fewer|used fewer|supplier short|returned");

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
