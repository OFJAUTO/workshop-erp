// ONE profit calculation (30 October 2026, night batch section 3.2). The owner's example: OFJ Full Protection Package
// AED 20,000 before VAT, payment link, external recovery 2 x 250, commission 5,000. Every cost counted once:
// 20,000 - (film 1,429 + tint 120 + ceramic 130 + consumables 125 + labour 80 h x 50 = 4,000 + recovery 500 +
// commission 5,000 + bank fee 368.50) = AED 8,327.50 (41.6%). The lines always add up to the total cost.
//   node --import ./tests/unit/register.mjs tests/unit/profit.test.mjs        (npm run test:unit)
const { quoteTotals, profitLines } = await import("../../src/lib/quotes.ts");
const { packageLineCost } = await import("../../src/lib/package-cost.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const near = (a, b) => Math.abs(a - b) < 0.005;

const line = (o) => ({ id: o.id, quotation_id: "q", position: 1, is_active: true, title: "", details: null, line_type: "labour", quantity: 1, hours: null, labour_rate: null, unit_price: null, unit_cost: null, markup_percent: null, discount_percent: 0, visible_to_customer: true, customer_approved: null, option_group: null, chosen: true, left_off: false, fee_kind: null, ...o });
const pkg = line({
  id: "pkg", line_type: "package", title: "OFJ FULL PROTECTION PACKAGE", package_key: "full_protection", unit_price: 20000, quantity: 1,
  package_items: { key: "full_protection", name: "OFJ Full Protection Package", items: [
    { label: "Full body paint protection film (PPF) – gloss, self healing" },
    { label: "Exterior ceramic coating (paint and wheels)" },
    { label: "Interior ceramic coating" },
    { label: "OFJ ceramic heat rejection film – side & rear windows" },
    { label: "Complimentary pick-up & drop-off" },
  ] },
});
const recovery = line({ id: "rec", line_type: "recovery", title: "Complimentary pick-up & drop-off", quantity: 2, recovery_trips: 2, unit_cost: 250, unit_price: 0, recovery_provider_kind: "outside" });
const q = { discount_percent: 0, vat_percent: 5, commission_kind: "aed", commission_value: 5000, commission_status: "approved", materials_cost_aed: 0 };
const costing = { filmRollPriceGloss: 1429, filmRollPriceMatte: 1524, tintPerCar: 120, tintFactor: 1, tintExtraHours: 0, ceramicExteriorPerCar: 75, ceramicInteriorPerCar: 55, consumablesPerCar: 125, packageHours: 80, ratePerHour: 50, rolls: 1 };
const t = quoteTotals([pkg, recovery], q, { technicianCostRate: 30, bankChargePercent: 1.75, bankChargeFixed: 1, packageCosting: costing });
const lines = profitLines(t, { technician: 30, bodyshop: 50 });
const sum = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;

check(`price before VAT AED 20,000 (got ${t.net})`, near(t.net, 20000));
check(`film 1 roll 1,429 · tint 120 · ceramic 130 (75 + 55) · consumables 125`, near(t.packageMaterials.film, 1429) && near(t.packageMaterials.tint, 120) && near(t.packageMaterials.ceramic, 130) && near(t.packageMaterials.consumables, 125), JSON.stringify(t.packageMaterials));
check(`labour at cost 80 h × AED 50 = 4,000`, near(t.installerHours, 80) && near(t.bodyshopLabourCost, 4000), `${t.installerHours} h · ${t.bodyshopLabourCost}`);
check(`recovery 2 × 250 = 500`, near(t.recoveryCost, 500));
check(`commission 5,000`, near(t.commission, 5000));
check(`bank fee (payment link 1.75% of 21,000 + AED 1) = 368.50`, near(t.bankCharge, 368.5), String(t.bankCharge));
check(`total cost 11,672.50`, near(t.totalCost, 11672.5), String(t.totalCost));
check(`PROFIT AED 8,327.50 (41.6%)`, near(t.profit, 8327.5) && (t.profit / t.net * 100).toFixed(1) === "41.6", `${t.profit} · ${(t.profit / t.net * 100).toFixed(1)}%`);
check(`the lines add up to the total cost (${sum})`, near(sum, t.totalCost), lines.map((l) => `${l.key} ${l.amount}`).join(", "));
check(`profit = price − total cost`, near(t.profit, t.net - t.totalCost));
check(`the package margin is not the whole price any more (${t.labourMargin})`, t.labourMargin < 20000 && near(t.labourMargin, 20000 - 4000 - 1804));
check(`the labour line reads "80 h × AED 50"`, /80 h × AED 50/.test(lines.find((l) => l.key === "labour").detail ?? ""));
check(`the materials line names film, tint, ceramic and consumables`, /PPF film 1 roll/.test(lines.find((l) => l.key === "materials").detail ?? "") && /tint/.test(lines.find((l) => l.key === "materials").detail ?? ""));

// Tint is window tint, never ceramic coating; a switched-off item ("Not needed") costs nothing.
const tintOnly = packageLineCost({ title: "Tint", itemLabels: ["OFJ ceramic heat rejection film – rear side windows & rear screen"], installerHours: 4 }, costing);
check(`"ceramic heat rejection film" is tint, not ceramic coating`, tintOnly.tint > 0 && tintOnly.ceramic === 0, JSON.stringify(tintOnly));
const off = quoteTotals([{ ...pkg, package_items: { ...pkg.package_items, items: pkg.package_items.items.map((i) => (/Interior ceramic/.test(i.label) ? { ...i, off: true } : i)) } }], q, { technicianCostRate: 30, packageCosting: costing });
check(`interior ceramic switched off: ceramic 75 instead of 130`, near(off.packageMaterials.ceramic, 75), String(off.packageMaterials.ceramic));
// Without the costing figures nothing changes for ordinary quotations.
const plain = quoteTotals([line({ id: "l1", line_type: "labour", title: "Brake service", hours: 2, labour_rate: 350, hours_estimate: 2 })], { discount_percent: 0, vat_percent: 5 }, { technicianCostRate: 30 });
check(`an ordinary labour quotation: 2 h × 350 = 700, labour at cost 60, no materials`, near(plain.net, 700) && near(plain.labourCost, 60) && plain.packageMaterials.total === 0 && near(profitLines(plain, { technician: 30, bodyshop: 50 }).reduce((a, l) => a + l.amount, 0), plain.totalCost));

console.log(`\n${failed ? "FAILED" : "All passed"} (${failed} failed)`);
process.exit(failed ? 1 : 0);
