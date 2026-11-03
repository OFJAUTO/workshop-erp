// Section 9 of 2 November 2026 (built 3 November): quantity and unit on every parts form. E-00058 (Rolls-Royce
// Cullinan 2021): "ENGINE OIL – ROLLS ROYCE GENUINE ×1" with no way to change it; "7" meant litres only in people's heads.
//   node --import ./tests/unit/register.mjs tests/unit/part-units.test.mjs        (npm run test:unit)
const U = await import("../../src/lib/part-units.ts");
const Q = await import("../../src/lib/quotes.ts");
const T = await import("../../src/lib/pdf/qty-text.ts");
const { cleanUnit, unitOf, defaultUnitFor, isLitrePart, qtyWithUnit, unitSuffix, perUnitWords, perUnitMark, checkQuantity, parseQuantity, quantityChangeWords, whoOfRole, partKindOf, lastQuantity, qtyMemoryWords } = U;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// Units: three of them, whatever was typed or stored.
check("cleanUnit reads litres in any spelling", ["l", "L", "Ltr", "litres", "LITRE", "liter"].every((x) => cleanUnit(x) === "l"));
check("cleanUnit reads sets and pieces ('each' is pieces)", cleanUnit("sets") === "set" && cleanUnit("Kit") === "set" && cleanUnit("each") === "pc" && cleanUnit("pcs") === "pc" && cleanUnit("NOS") === "pc");
check("an unknown unit is none, and unitOf gives pieces", cleanUnit("kg") === null && cleanUnit("") === null && unitOf("kg") === "pc" && unitOf(null) === "pc");

// E-00058's names.
check("ENGINE OIL - ROLLS ROYCE GENUINE starts in litres", defaultUnitFor("ENGINE OIL - ROLLS ROYCE GENUINE") === "l");
check("OW-30 FE GENUINE OIL LL-01-2L (an oil grade) starts in litres", defaultUnitFor("OW-30 FE GENUINE OIL LL-01-2L") === "l");
check("SET OIL-FILTER ELEMENT, DRAIN PLUG and PLUG WASHER stay pieces", ["SET OIL-FILTER ELEMENT", "DRAIN PLUG", "PLUG WASHER"].every((n) => defaultUnitFor(n) === "pc"));
check("coolant, brake fluid, transmission fluid, ATF and gear oil 75W-90 start in litres", ["Coolant", "BRAKE FLUID DOT 4", "Transmission fluid", "ATF", "75W-90 gear oil", "Rear differential oil"].every((n) => defaultUnitFor(n) === "l"));
check("a part that only carries a fluid's name is pieces (oil pan gasket, coolant hose, ATF filter, coolant level sensor)", ["OIL PAN GASKET", "Coolant hose", "ATF filter", "Coolant level sensor", "Oil filter"].every((n) => defaultUnitFor(n) === "pc"));
check("the catalogue's sets and litres win; its old 'each' never forces pieces on a fluid", defaultUnitFor("Brake pads", "set") === "set" && defaultUnitFor("Compressor oil", "l") === "l" && defaultUnitFor("ENGINE OIL", "each") === "l" && defaultUnitFor("Brake pads", "each") === "pc");
check("isLitrePart on a plain part is false", !isLitrePart("Front brake pads") && !isLitrePart("Headlight") && !isLitrePart(""));

// Words.
check("qtyWithUnit: 8 L, 6.5 L, 1 set, 2 sets, 4 (pieces print the number alone)", qtyWithUnit(8, "l") === "8 L" && qtyWithUnit(6.5, "l") === "6.5 L" && qtyWithUnit(1, "set") === "1 set" && qtyWithUnit(2, "set") === "2 sets" && qtyWithUnit(4, "pc") === "4" && qtyWithUnit(7.0, null) === "7");
check("unitSuffix for documents: ' · 8 L', ' · 2 SETS', nothing for pieces", unitSuffix(8, "l") === " · 8 L" && unitSuffix(2, "set") === " · 2 SETS" && unitSuffix(1, "set") === " · 1 SET" && unitSuffix(4, "pc") === "" && unitSuffix(4, undefined) === "");
check("the cost is per unit: each / per litre / per set, /L /set", perUnitWords("pc") === "each" && perUnitWords("l") === "per litre" && perUnitWords("set") === "per set" && perUnitMark("l") === "/L" && perUnitMark("pc") === "");
check("partLineName adds the unit for litres and sets only: ENGINE OIL – ROLLS-ROYCE GENUINE · 8 L", Q.partLineName("Engine oil – Rolls-Royce genuine", null, null, { quantity: 8, unit: "l" }) === "ENGINE OIL – ROLLS-ROYCE GENUINE · 8 L" && Q.partLineName("Headlight", ["Front left"], "Genuine", { quantity: 1, unit: "pc" }) === "HEADLIGHT – FRONT LEFT · GENUINE" && Q.partLineName("Brake pads", null, "OEM", { quantity: 2, unit: "set" }) === "BRAKE PADS · OEM · 2 SETS");
check("partLineName without a unit is unchanged (older callers)", Q.partLineName("Headlight", ["Front left"], "Genuine") === "HEADLIGHT – FRONT LEFT · GENUINE");
check("the QTY column reads 8 L for litres, 2 sets for sets, 4 for pieces, 1.5 h for labour", T.qtyText(8, null, "l") === "8 L" && T.qtyText(2, null, "set") === "2 sets" && T.qtyText(4) === "4" && T.qtyText(1, 1.5) === "1.5 h" && T.qtyText(6.5, null, "l") === "6.5 L");

// The one quantity check.
check("above zero", /above zero/.test(checkQuantity(0, "pc") ?? "") && /above zero/.test(checkQuantity(-1, "l") ?? "") && /above zero/.test(checkQuantity(Number.NaN, "pc") ?? ""));
check("pieces and sets are whole; litres may be 6.5", /whole/.test(checkQuantity(1.5, "pc") ?? "") && /whole/.test(checkQuantity(2.5, "set") ?? "") && checkQuantity(6.5, "l") === null && checkQuantity(8, "pc") === null);
check("an absurd quantity is refused", /too large/.test(checkQuantity(12000, "l") ?? ""));
check("parseQuantity reads 8, 6,5 and ' 7 L '", parseQuantity("8") === 8 && parseQuantity("6,5") === 6.5 && parseQuantity(" 7 L ") === 7 && parseQuantity("") === null && parseQuantity("abc") === null);

// The one wording of a change (the owner's words).
check("Advisor asked 1, Parts changed to 8 L", quantityChangeWords({ askedBy: "advisor", asked: 1, changedBy: "parts", now: 8, unit: "l" }) === "Advisor asked 1, Parts changed to 8 L");
check("Technician asked 1, Parts changed to 4", quantityChangeWords({ askedBy: "technician", asked: 1, changedBy: "parts", now: 4, unit: "pc" }) === "Technician asked 1, Parts changed to 4");
check("an ask with its own unit keeps it: Parts asked 8 L, Advisor changed to 6 L", quantityChangeWords({ askedBy: "parts", asked: 8, askedUnit: "l", changedBy: "advisor", now: 6, unit: "l" }) === "Parts asked 8 L, Advisor changed to 6 L");
check("roles: technician, advisor, parts, owner", whoOfRole("technician") === "technician" && whoOfRole("service_advisor") === "advisor" && whoOfRole("parts") === "parts" && whoOfRole("owner") === "owner" && whoOfRole(null) === "parts");

// 9.3: the same part across cars.
check("every engine oil name is one kind", ["ENGINE OIL", "Engine oil - 5W30", "OW-30 FE GENUINE OIL LL-01-2L", "ENGINE OIL - ROLLS ROYCE GENUINE"].every((n) => partKindOf(n) === "fluid:engine_oil"));
check("transmission, coolant, brake, front and rear differential each have their own kind", partKindOf("Transmission fluid") === "fluid:transmission" && partKindOf("ATF") === "fluid:transmission" && partKindOf("Coolant") === "fluid:coolant" && partKindOf("Brake fluid") === "fluid:brake" && partKindOf("Front differential oil") === "fluid:diff_front" && partKindOf("Rear diff oil") === "fluid:diff_rear" && partKindOf("Gear oil 75W-90") === "fluid:diff");
check("a plain part: its catalogue entry, else its cleaned name", partKindOf("Brake pads", "c1") === "cat:c1" && partKindOf("Front brake pads") === "name:FRONT BRAKE PADS" && partKindOf("") === null);
const rows = [
  { name: "Engine oil", qty: 6, unit: "l", ref: "J-00017", at: "2026-10-10T08:00:00Z", makeId: "rr", modelId: "ghost", car: "Rolls-Royce Ghost 2012" },
  { name: "OW-30 FE GENUINE OIL LL-01-2L", qty: 7, unit: "l", ref: "E-00058", at: "2026-11-02T06:31:00Z", makeId: "rr", modelId: "cullinan", car: "Rolls-Royce Cullinan 2021" },
  { name: "Oil filter", qty: 1, unit: "pc", ref: "E-00058", at: "2026-11-02T06:31:00Z", makeId: "rr", modelId: "cullinan", car: "Rolls-Royce Cullinan 2021" },
  { name: "Engine oil", qty: 5, unit: "l", ref: "J-00860", at: "2026-11-01T08:00:00Z", makeId: "toyota", modelId: "corolla", car: "Toyota Corolla 2020" },
];
const cull = lastQuantity(rows, { name: "ENGINE OIL - ROLLS ROYCE GENUINE" }, { makeId: "rr", modelId: "cullinan" });
check("the next Cullinan is offered 7 L from E-00058 (the same model)", !!cull && cull.qty === 7 && cull.unit === "l" && cull.ref === "E-00058" && cull.sameModel && qtyMemoryWords(cull) === "Last time on ROLLS-ROYCE CULLINAN 2021: 7 L (E-00058)", JSON.stringify(cull));
const phantom = lastQuantity(rows, { name: "Engine oil" }, { makeId: "rr", modelId: "phantom" });
check("a Phantom (no history on its model) gets the same make, naming the model it came from", !!phantom && phantom.qty === 7 && !phantom.sameModel && qtyMemoryWords(phantom) === "On ROLLS-ROYCE CULLINAN 2021: 7 L (E-00058)", JSON.stringify(phantom));
check("the screen's own estimate never suggests to itself", lastQuantity(rows, { name: "Engine oil" }, { makeId: "rr", modelId: "cullinan" }, ["E-00058"])?.ref === "J-00017");
check("another make with no history gets nothing", lastQuantity(rows, { name: "Engine oil" }, { makeId: "bmw", modelId: "x5" }) === null);
check("an oil filter is never answered with the oil's litres", lastQuantity(rows, { name: "Oil filter" }, { makeId: "rr", modelId: "cullinan" })?.qty === 1);

// Review of 3 November 2026.
const { requestUnitOf, stepQuantity, askerOfRequest } = U;
check("a request's stored 'pc' never hides the litre rule (the technician's ENGINE OIL 0W-20 reaches Parts in litres)", requestUnitOf("ENGINE OIL 0W-20", "pc") === "l" && requestUnitOf("Coolant", "pcs") === "l" && requestUnitOf("Brake pads", "set") === "set" && requestUnitOf("Oil filter", "pc") === "pc" && requestUnitOf("Front brake pads", null) === "pc");
check("− and + step one unit from the number itself: 6.5 L + 1 = 7.5 L, − 1 = 5.5 L (never a jump to 8 or 6)", stepQuantity(6.5, 1) === 7.5 && stepQuantity(6.5, -1) === 5.5 && stepQuantity(3, 1) === 4 && stepQuantity(3, -1) === 2 && stepQuantity(1.5, -1) === 1 && stepQuantity(1, -1) === 1);
check("an inspection request is the technician's whoever approved it onto the list (the manager, the advisor)", askerOfRequest({ inspection_id: "i1", source_key: "brakes#pads" }, "workshop_manager") === "technician" && askerOfRequest({ inspection_id: "i1", source_key: "x" }, "service_advisor") === "technician");
check("additional work the technician raised is his; the advisor's '+ Add a part' is the advisor's; a part with no request is who added it", askerOfRequest({ inspection_id: null, source_key: "additional:abc" }, "workshop_manager") === "technician" && askerOfRequest({ inspection_id: null, source_key: "q1:123" }, "service_advisor") === "advisor" && askerOfRequest(null, null, "parts") === "parts" && askerOfRequest(null, null, "owner") === "owner");
check("the row and the history name the person who changed the quantity: Technician asked 1, Advisor changed to 8 L", quantityChangeWords({ askedBy: askerOfRequest({ inspection_id: "i1" }, "workshop_manager"), asked: 1, changedBy: "advisor", now: 8, unit: "l" }) === "Technician asked 1, Advisor changed to 8 L");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll part-unit checks passed");
process.exit(failed ? 1 : 0);
