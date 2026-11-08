// Send LPO for selected (8 November 2026, Peter): THE tick rule, repeated part numbers and the preview per supplier.
//   node --import ./tests/unit/register.mjs tests/unit/lpo-select.test.mjs        (npm run test:unit)
const { repeatedPartNumbers, selectRowOf, previewBySupplier, selectionProblem, compactNumber } = await import("../../src/lib/lpo-select.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// Item 5: 1234AA on four different parts, 123AA on tyres and a windshield.
const rep = repeatedPartNumbers([
  { id: "a", name: "Air filter", partNumber: "1234AA" },
  { id: "b", name: "Battery 95Ah", partNumber: "1234 AA" },
  { id: "c", name: "Oil filter", partNumber: "1234-AA" },
  { id: "d", name: "Wiper blades", partNumber: "1234AA" },
  { id: "e", name: "Tyre front left", partNumber: "123AA" },
  { id: "f", name: "Windshield", partNumber: "123AA" },
  { id: "g", name: "Headlight front left", partNumber: "A2229060000" },
  { id: "h", name: "Headlight front right", partNumber: "A2229060000" },
  { id: "i", name: "Brake pads", partNumber: "NO NUMBER" },
  { id: "j", name: "Brake discs", partNumber: "NO NUMBER" },
  { id: "k", name: "Spark plug", partNumber: "12" },
  { id: "l", name: "Coil", partNumber: "12" },
]);
check("1234AA flags all four different parts (spaces and dashes ignored)", ["a", "b", "c", "d"].every((x) => rep.has(x)));
check("123AA flags the tyre and the windshield", rep.has("e") && rep.has("f"));
check("the words name the other parts", /AIR FILTER/.test(rep.get("b") ?? "") && /No part number/.test(rep.get("b") ?? ""), rep.get("b"));
check("the same part split left/right is never a repeat", !rep.has("g") && !rep.has("h"));
check("NO NUMBER and line numbers never count", !rep.has("i") && !rep.has("j") && !rep.has("k") && !rep.has("l"));
check("compactNumber", compactNumber("A 167 330.68/00") === "A1673306800");

const base = { id: "p1", name: "Air filter", supplier: "Sparein", quantity: 2, cost: 100, orderStatus: "to_order", onLpo: false, inStock: false, received: false, removed: false, missing: [], costProblem: null, repeated: null };
check("an approved, finished line on no LPO can be ticked", selectRowOf(base).eligible);
check("not approved", selectRowOf({ ...base, orderStatus: "none" }).why === "Not approved yet");
check("already on an LPO", selectRowOf({ ...base, onLpo: true }).why === "Already on an LPO");
check("from stock", !selectRowOf({ ...base, inStock: true }).eligible);
check("received", selectRowOf({ ...base, received: true }).why === "Already received");
const unf = selectRowOf({ ...base, name: "Bridgestone 275/50 R22", missing: ["tyre size and brand needed"] });
check("item 6: unfinished is red and says why", !unf.eligible && unf.red && unf.why === "Not finished: tyre size and brand needed", unf.why);
const cheap = selectRowOf({ ...base, name: "BMS MODULE", cost: 1, costProblem: "BMS MODULE: AED 1.00 is not a real price" });
check("a cost under AED 5 cannot be ticked", !cheap.eligible && cheap.red);
check("a repeated number cannot be ticked", !selectRowOf({ ...base, repeated: "Part number 1234AA is also on BATTERY" }).eligible);

// Item 8: 3 of 6 across two suppliers.
const rows = [
  selectRowOf({ ...base, id: "1", supplier: "Sparein", cost: 100 }),
  selectRowOf({ ...base, id: "2", supplier: "Sparein", cost: 78.5, quantity: 1 }),
  selectRowOf({ ...base, id: "3", supplier: "Al Ghandi", cost: 934.5, quantity: 1 }),
  selectRowOf({ ...base, id: "4", supplier: "Al Ghandi", cost: 10, quantity: 1 }),
  selectRowOf({ ...base, id: "5", supplier: "Mezan", cost: 6510, quantity: 1 }),
  selectRowOf({ ...base, id: "6", supplier: "Mezan", cost: 1, costProblem: "AED 1.00 is not a real price" }),
];
const pv = previewBySupplier(rows, new Set(["1", "2", "3"]));
check("the preview has the two ticked suppliers only", pv.length === 2 && pv[0].supplier === "Al Ghandi" && pv[1].supplier === "Sparein", pv.map((p) => p.supplier).join(","));
check("Sparein: 2 × 100 + 78.50 = 278.50 before VAT", pv[1].net === 278.5, String(pv[1].net));
check("a ticked line that cannot go is refused with its reason", /AED 1\.00/.test(selectionProblem(rows, ["1", "6"]) ?? ""));
check("nothing ticked", selectionProblem(rows, []) === "Tick the parts to order now.");
check("three good lines pass", selectionProblem(rows, ["1", "2", "3"]) === null);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
if (failed) process.exitCode = 1;
