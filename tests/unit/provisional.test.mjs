// 20 November 2026, Section 4: the provisional "additional parts" amount is PARTS, counts as zero profit until it is
// converted, never counts toward a commission, and the profit line says "plus AED 370.00 provisional, not yet costed".
import { quoteTotals, blockOf, isProvisional, provisionalProfitWords } from "../../src/lib/quotes.ts";
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!ok) failed++; };
const line = (id, line_type, extra = {}) => ({ id, line_type, title: id, quantity: 1, hours: null, hours_estimate: null, unit_price: 0, unit_cost: null, labour_rate: null, markup_percent: null, is_active: true, visible_to_customer: true, chosen: true, ...extra });
const part = line("brake pads", "part", { unit_price: 600, unit_cost: 400, markup_percent: 0.5 });
const prov = line("ADDITIONAL PARTS IF REQUIRED – UP TO AED 370.00", "other", { unit_price: 370, source_key: "provisional" });
check("a provisional line is in the PARTS block", blockOf(prov) === "parts" && isProvisional(prov));
const without = quoteTotals([part], { discount_percent: 0, vat_percent: 5 }, {});
const withProv = quoteTotals([part, prov], { discount_percent: 0, vat_percent: 5 }, {});
check("it counts as parts in the totals", withProv.partsSell === without.partsSell + 370 && withProv.provisionalSell === 370, `${withProv.partsSell}`);
check("it adds zero profit until converted", Math.abs(withProv.profit - without.profit) < 0.005, `${withProv.profit} vs ${without.profit}`);
check("it never counts as an unpriced part", withProv.partsUnpriced === without.partsUnpriced);
const com = quoteTotals([part, prov], { discount_percent: 0, vat_percent: 5, commission_kind: "percent", commission_value: 10 }, {});
check("a commission % never counts the provisional amount", Math.abs(com.commission - Math.round(without.net * 10) / 100) < 0.005, String(com.commission));
check("the profit words", provisionalProfitWords(33.3, 370) === "Profit 33% – plus AED 370.00 provisional, not yet costed");
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
