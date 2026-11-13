// Check before you send (13 November 2026): THE flag rules.
//   node --import ./tests/unit/register.mjs tests/unit/send-check-rules.test.mjs        (npm run test:unit)
const { placeholderReason, priceReason, lineFlags, flagsOf, flagCount } = await import("../../src/lib/send-check-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("a real part number passes", placeholderReason({ partNumber: "A1673306800", name: "FRONT PAD" }) === null);
check("no number without the tick is flagged; with it, not", !!placeholderReason({ partNumber: "", name: "X" }) && placeholderReason({ partNumber: "NO NUMBER", name: "X" }) === null && placeholderReason({ partNumber: "", name: "X", noNumberTicked: true }) === null);
check("the part's own name as its number", !!placeholderReason({ partNumber: "Brake disc", name: "BRAKE DISC" }));
check("words PAD, DISC, BLADE", ["PAD", "disc", "Blade"].every((w) => !!placeholderReason({ partNumber: w, name: "Something" })));
check("patterns 1234AA and 123AA", !!placeholderReason({ partNumber: "1234AA", name: "X" }) && !!placeholderReason({ partNumber: "123aa", name: "X" }));
check("AED 0 and AED 1 are slips", !!priceReason({ price: 0 }) && !!priceReason({ price: 1 }) && priceReason({ price: 1.5 }) === null);
check("far below or above the last price", !!priceReason({ price: 40, lastPrice: 100 }) && !!priceReason({ price: 250, lastPrice: 100 }) && priceReason({ price: 120, lastPrice: 100 }) === null);
const l = { key: "a", name: "MOUNT", partNumber: "A123456", qty: 2, price: 300, quotedQty: 1, quotedCost: 250, quotedSell: 700, supplier: "Al Futtaim", pricedSupplier: "Al Tayer" };
const f = lineFlags(l);
check("quantity different from the quote", f.some((x) => /Quantity 2 but the customer's quote says 1/.test(x)));
check("cost above the quote, with the difference and the new profit", f.some((x) => /above the AED 250\.00/.test(x) && /\+100\.00/.test(x) && /profit on this line now AED 100\.00/.test(x)));
check("another supplier than the one it was priced with", f.some((x) => /not the one it was priced with \(Al Tayer\)/.test(x)));
const dup = flagsOf([{ key: "1", name: "FILTER", partNumber: "F-100", qty: 1, price: 10 }, { key: "2", name: "FILTER", partNumber: "f100", qty: 1, price: 10 }, { key: "3", name: "BELT", partNumber: "B-1", qty: 1, price: 50 }]);
check("the same part twice is flagged on both, never on the third", dup["1"].includes("The same part is listed twice") && dup["2"].includes("The same part is listed twice") && dup["3"].length === 0);
check("a clean list has no flags", flagCount(flagsOf([{ key: "1", name: "A", partNumber: "A1673306800", qty: 1, price: 200, lastPrice: 190, quotedQty: 1, quotedCost: 200 }])) === 0);

process.exit(failed ? 1 : 0);
