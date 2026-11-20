// 20 November 2026, Section 5: the stock page rules.
import { cleanStockUnit, stockStatusOf, stockTiles, isPlaceholderStockNumber, filterStock, sortStock, pageOf, countDifferences, countLabel, valueWords } from "../../src/lib/stock-rules.ts";
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!ok) failed++; };
check("units: one list (Ltr = L, pcs = pc, unknown refused)", cleanStockUnit("Ltr") === "L" && cleanStockUnit("pcs") === "pc" && cleanStockUnit("bucket") === null && cleanStockUnit("") === "pc");
check("status: out / low / in", stockStatusOf({ quantity: 0, minimum_level: 2 }) === "out" && stockStatusOf({ quantity: 2, minimum_level: 2 }) === "low" && stockStatusOf({ quantity: 5, minimum_level: 2 }) === "in" && stockStatusOf({ quantity: 1, minimum_level: 0 }) === "in");
const items = [
  { id: "1", name: "BOSCH BRAKE FLUID", part_number: "123W", quantity: 0, minimum_level: 2, unit: "L", unit_cost: 30, category_id: "c1", brand: "BOSCH" },
  { id: "2", name: "Engine oil 5W-40", part_number: "A0009899701", quantity: 1, minimum_level: 4, unit: "L", unit_cost: 45, category_id: "c2", brand: "MOBIL" },
  { id: "3", name: "Oil filter", part_number: "5ZH2", quantity: 12, minimum_level: 0, unit: "pc", unit_cost: 20, category_id: "c3", brand: "MANN" },
];
const t = stockTiles(items);
check("tiles: total 3, in 1, low 1, out 1", t.total === 3 && t.in === 1 && t.low === 1 && t.out === 1, JSON.stringify(t));
check("placeholder part numbers flagged (123W, 5ZH2), real ones not", isPlaceholderStockNumber("123W") && isPlaceholderStockNumber("5ZH2") && !isPlaceholderStockNumber("A0009899701"));
check("search by part number ignoring spaces", filterStock(items, { q: "A000 9899", status: "all", category: "", brand: "" }).length === 1);
check("filters: low, no minimum, placeholder, brand", filterStock(items, { q: "", status: "low", category: "", brand: "" })[0].id === "2" && filterStock(items, { q: "", status: "nomin", category: "", brand: "" })[0].id === "3" && filterStock(items, { q: "", status: "placeholder", category: "", brand: "" }).length === 2 && filterStock(items, { q: "", status: "all", category: "", brand: "bosch" })[0].id === "1");
check("sort by quantity descending", sortStock(items, "qty", true).map((i) => i.id).join() === "3,2,1");
const p = pageOf(Array.from({ length: 120 }, (_, i) => i), 3);
check("paging: page 3 of 3, Showing 101–120 of 120", p.page === 3 && p.pages === 3 && p.words === "Showing 101–120 of 120", p.words);
const d = countDifferences([{ itemId: "a", name: "A", unit: "L", systemQty: 10, countedQty: 8, notFound: false, unitCost: 25 }, { itemId: "b", name: "B", unit: "pc", systemQty: 3, countedQty: null, notFound: true, unitCost: 10 }, { itemId: "c", name: "C", unit: "pc", systemQty: 1, countedQty: null, notFound: false, unitCost: 1 }]);
check("the count: per item difference and value, not found to 0, the total change", d.counted === 2 && d.notFound === 1 && d.totalValue === -80 && d.lines[0].value === -50);
check("the opening count's label", countLabel("2026-11-20", true) === "OPENING COUNT 20 Nov 2026");
check("value words", valueWords(-80) === "− AED 80.00" && valueWords(12.5) === "+ AED 12.50");
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
