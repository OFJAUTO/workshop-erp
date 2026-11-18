// The purchase return rules (19 November 2026, Section 4: Sparein).
//   node --import ./tests/unit/register.mjs tests/unit/supplier-return-rules.test.mjs        (npm run test:unit)
const { returnWindowOf, returnRulesOf, isElectricalOrBattery, creditTotals, lpoNetOf, replacesWords } = await import("../../src/lib/supplier-return-rules.ts");
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const rules = returnRulesOf({ s1: { returnDays: 7, creditDays: 14, noElectrical: true } }, "s1");
check("the stored rules are read", rules.returnDays === 7 && rules.creditDays === 14 && rules.noElectrical);
check("no rules for another supplier", returnRulesOf({ s1: { returnDays: 7 } }, "s2").returnDays === null);
check("a battery cannot go back to this supplier", returnWindowOf(rules, { name: "BATTERY 80AH", receivedDay: "2026-11-15" }, "2026-11-18").blocked);
check("a bumper can (4 days left)", (() => { const w = returnWindowOf(rules, { name: "FRONT BUMPER", receivedDay: "2026-11-15" }, "2026-11-18"); return !w.blocked && !w.warn && w.words === "4 days left to return it."; })());
check("2 days left warns", returnWindowOf(rules, { name: "FRONT BUMPER", receivedDay: "2026-11-13" }, "2026-11-18").warn);
check("past the window: late, not blocked", (() => { const w = returnWindowOf(rules, { name: "FRONT BUMPER", receivedDay: "2026-11-01" }, "2026-11-18"); return w.late && !w.blocked; })());
check("electrical words", isElectricalOrBattery("ABS SENSOR FRONT") && isElectricalOrBattery("ENGINE CONTROL MODULE") && !isElectricalOrBattery("SIDE MARKER LAMP LH") && !isElectricalOrBattery("FRONT BUMPER"));
check("credit note 1857: 850.00 + 42.50 = 892.50", JSON.stringify(creditTotals(850, null, true)) === JSON.stringify({ net: 850, vat: 42.5, total: 892.5 }));
check("a supplier with no VAT: no VAT", creditTotals(850, null, false).total === 850);
check("the Sparein LPO nets to 1,228.50", lpoNetOf({ invoiced: 1086.75, credited: 892.5, reinvoiced: 1034.25 }).net === 1228.5);
check("the replacement line's words", replacesWords(["Front bumper", "Reinforcement, bumper"]) === "Replaces returned FRONT BUMPER + REINFORCEMENT, BUMPER");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
