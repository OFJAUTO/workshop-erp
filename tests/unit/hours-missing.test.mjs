// Own work with no hours (5 November 2026, E-00056): the profit is not reliable.
//   node --import ./tests/unit/register.mjs tests/unit/hours-missing.test.mjs        (npm run test:unit)
const { hoursMissingLines, quoteTotals } = await import("../../src/lib/quotes.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const line = (id, line_type, extra = {}) => ({ id, line_type, title: id, quantity: 1, hours: null, hours_estimate: null, unit_price: 0, unit_cost: null, labour_rate: null, markup_percent: null, is_active: true, visible_to_customer: true, chosen: true, ...extra });
// E-00056: two typed package lines (painting at 6,000; removal and refix included at 0), no hours on either.
const e56 = [line("paint", "package", { unit_price: 6000 }), line("refix", "package", { unit_price: 0 })];
check("E-00056: both work lines have no hours (the 0-priced one too: it still takes time)", hoursMissingLines(e56).length === 2);
const t = quoteTotals(e56, { discount_percent: 0, vat_percent: 5 }, { technicianCostRate: 50, bodyshopRate: 50 });
check(`E-00056: the shared calculation counts no labour (labour + bodyshop labour = ${t.labourCost + t.bodyshopLabourCost})`, t.labourCost === 0 && t.bodyshopLabourCost === 0);
const fixed = [line("paint", "package", { unit_price: 6000, installer_hours: 16 }), line("refix", "package", { unit_price: 0, installer_hours: 4 })];
const t2 = quoteTotals(fixed, { discount_percent: 0, vat_percent: 5 }, { technicianCostRate: 50, bodyshopRate: 50 });
check(`with hours: none missing, 20 h × AED 50 = ${t2.bodyshopLabourCost}`, hoursMissingLines(fixed).length === 0 && t2.bodyshopLabourCost === 1000);
check("a labour line with no hours is missing; with quoted or estimated hours it is not", hoursMissingLines([line("a", "labour")]).length === 1 && hoursMissingLines([line("b", "labour", { hours: 2 })]).length === 0 && hoursMissingLines([line("c", "labour", { hours_estimate: 1.5 })]).length === 0);
check("once the clocked hours cost the labour, a labour line is costed; a typed fixed-price line still needs its hours", hoursMissingLines([line("a", "labour"), line("p", "package", { unit_price: 900 })], { clockedHours: 3.5 }).map((l) => l.id).join() === "p");
check("outside work, parts, packages from the list, left-off and unchosen lines never count", hoursMissingLines([
  line("o", "package", { outside_work: true }),
  line("p", "part", { unit_cost: 50 }),
  line("k", "package", { package_key: "ppf_full" }),
  line("l", "labour", { left_off: true }),
  line("u", "labour", { option_group: "g", chosen: false }),
  line("f", "fee", { fee_kind: "bank_charge" }),
]).length === 0);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll hours-missing checks passed");
process.exit(failed ? 1 : 0);
