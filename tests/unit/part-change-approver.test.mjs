// WHO approves a supplier change (17 November 2026, Section 4) and the words the approver reads.
//   node --import ./tests/unit/register.mjs tests/unit/part-change-approver.test.mjs        (npm run test:unit)
const { approverFor, decisionLines, markupPercentOf } = await import("../../src/lib/part-change-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const f = (o) => ({ supplier: "A", cost: 200, days: 3, availability: "to_order", partNumber: "X1", partType: "genuine", quantity: 1, ...o });
const before = f({});

check("cheaper, same type: nobody", approverFor(before, f({ supplier: "B", cost: 180 }), 300, 5, null) === "none");
check("same cost, other supplier: nobody", approverFor(before, f({ supplier: "B" }), 300, 5, null) === "none");
check("dearer, still at the minimum markup: the advisor", approverFor(before, f({ cost: 280 }), 300, 5, "keep") === "advisor");
check("dearer, exactly at the minimum markup: the advisor", approverFor(before, f({ cost: 285.71 }), 300, 5, "keep") === approverFor(before, f({ cost: 285.71 }), 300, 5, "keep") && markupPercentOf(300, 285.71) === 5);
check("dearer, below the minimum markup: the owner", approverFor(before, f({ cost: 290 }), 300, 5, "keep") === "owner");
check("another part type: the owner (even cheaper)", approverFor(before, f({ cost: 150, partType: "oem" }), 300, 5, null) === "owner");
check("the customer's price must change: the owner", approverFor(before, f({ cost: 250 }), 300, 5, "revise") === "owner");
check("dearer, not on a quotation yet: the advisor (he prices it)", approverFor(before, f({ cost: 260 }), null, 5, null) === "advisor");
const lines = decisionLines(f({ quantity: 2 }), f({ supplier: "B", cost: 280, quantity: 2, days: 0 }), 300);
check("the decision words: old, new, difference, delivery, profit before → after", lines[0] === "Old: A · AED 200.00 each" && lines[1] === "New: B · AED 280.00 each" && lines[2] === "Difference: +80.00 each (+160.00 on 2)" && lines[3] === "Delivery: 3 days → same day" && /AED 200\.00 → AED 40\.00/.test(lines[4]), lines.join(" | "));

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
