// Warranty batch only for PPF and tint (9 November 2026, Section 6): THE rules in src/lib/warranty.ts and src/lib/tint.ts.
//   node --import ./tests/unit/register.mjs tests/unit/warranty-batch.test.mjs        (npm run test:unit)
const { batchCell, hasBatch } = await import("../../src/lib/warranty.ts");
const { isTintText } = await import("../../src/lib/tint.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("PPF and tint carry a batch", hasBatch("ppf") && hasBatch("tint") && !hasBatch("ceramic"));
check("ceramic shows no batch row", batchCell({ product: "ceramic", rollBatch: "X" }) === "");
check("PPF never prints a dash", batchCell({ product: "ppf", rollBatch: null }) === "To be confirmed" && batchCell({ product: "ppf", rollBatch: "R-12, R-13" }) === "R-12, R-13");
// J-00974's package: the window film is tint, never a ceramic coating.
check("heat rejection film on side & rear windows is tint", isTintText("OFJ ceramic heat rejection film – side & rear windows"));
check("…on the windshield", isTintText("OFJ ceramic heat rejection film - windshield"));
check("…on the glass roof", isTintText("OFJ ceramic heat rejection film -  glass roof"));
check("a ceramic coating is not tint", !isTintText("PPF specific ceramic coating") && !isTintText("Interior ceramic protection – leather & surfaces"));
check("interior screens film is not tint", !isTintText("Interior screens & trims protection film"));
check("a tint recheck is not tint work", !isTintText("Tint recheck visit"));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
