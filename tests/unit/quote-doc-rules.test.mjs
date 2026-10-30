// The quotation PDF rules of 30 October 2026 (night batch section 6): the free pick-up shown once (6.3), tint per window
// (6.4), any package item "Not needed" (6.5) and no package at AED 0 (6.6).
//   node --import ./tests/unit/register.mjs tests/unit/quote-doc-rules.test.mjs        (npm run test:unit)
const { tintItemLabel, emptyTintSpec } = await import("../../src/lib/tint.ts");
const { packageParts, packageDetailsText, packagesGivePickup, isPickupShownByPackage, toSnapshot } = await import("../../src/lib/packages.ts");
const { quoteTotals, sendBlockers } = await import("../../src/lib/quotes.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// 6.4 Tint per window.
const spec = emptyTintSpec();
spec.rows.rear_sides = { on: true, shade: 30, double: false };
spec.rows.rear_window = { on: true, shade: 30, double: false };
const item = "OFJ ceramic heat rejection film – side & rear windows";
check("only the rear chosen: the item names exactly that", tintItemLabel(item, spec) === "OFJ ceramic heat rejection film – rear side windows & rear screen · 30% darkness", tintItemLabel(item, spec));
spec.rows.front_sides = { on: true, shade: 50, double: false };
check("different shades are listed per window group", tintItemLabel(item, spec) === "OFJ ceramic heat rejection film – front side windows 50% darkness · rear side windows & rear screen 30% darkness", tintItemLabel(item, spec));
check("no tint chosen yet: the item keeps its name", tintItemLabel(item, emptyTintSpec()) === item);
check("a coating is not tint", tintItemLabel("Exterior ceramic coating", spec) === "Exterior ceramic coating");

// 6.5 Any package item can be switched off.
const snap = { key: "full", name: "OFJ Full Protection Package", time_in_workshop: "5 working days", pickup_dropoff: true, aftercare_check: true, items: [
  { label: "Full body paint protection film (PPF) – gloss, self healing", warranty: "10 years" },
  { label: "Exterior ceramic coating (paint and wheels)", warranty: "3 years" },
  { label: "Interior ceramic coating", warranty: "1 year", off: true },
] };
check("the \"Not needed\" mark survives the save (toSnapshot)", toSnapshot(snap).items[2].off === true && toSnapshot(snap).items[0].off === undefined);
check("an item marked Not needed leaves the customer's copy", !packageParts(snap).items.some((i) => /Interior/.test(i.label)) && !/Interior/.test(packageDetailsText(snap)));
const line = (o) => ({ id: o.id, quotation_id: "q", position: 1, is_active: true, title: "", details: null, line_type: "package", quantity: 1, hours: null, labour_rate: null, unit_price: null, unit_cost: null, markup_percent: null, discount_percent: 0, visible_to_customer: true, option_group: null, chosen: true, left_off: false, fee_kind: null, ...o });
const costing = { filmRollPriceGloss: 1429, filmRollPriceMatte: 1524, tintPerCar: 120, tintFactor: 1, tintExtraHours: 0, ceramicExteriorPerCar: 75, ceramicInteriorPerCar: 55, consumablesPerCar: 125, packageHours: 80, ratePerHour: 50, rolls: 1 };
const pkgLine = line({ id: "k", title: snap.name, package_key: "full", package_items: snap, unit_price: 20000 });
const q = { discount_percent: 0, vat_percent: 5 };
check("and leaves the costing: interior ceramic (AED 55) is not counted", quoteTotals([pkgLine], q, { packageCosting: costing }).packageMaterials.ceramic === 75);
check("the free pick-up badge can be switched off too", !packageParts({ ...snap, pickup_dropoff: false }).complimentary.some((c) => /pick-up/.test(c)));

// 6.3 The free pick-up shown once.
check("a package with the pick-up badge gives the pick-up", packagesGivePickup([snap]) && !packagesGivePickup([{ ...snap, pickup_dropoff: false }]));
check("its AED 0 recovery line is the one left off the customer's copy", isPickupShownByPackage({ line_type: "recovery", title: "Complimentary pick-up & drop-off" }, 0) && !isPickupShownByPackage({ line_type: "recovery", title: "Recovery" }, 250));

// 6.6 A package at AED 0 is never sent.
const blockers = sendBlockers({ ...q, kind: "quotation", status: "draft" }, [line({ id: "z", title: snap.name, package_key: "full", package_items: snap, unit_price: 0 })], [], { minMarkup: 0, openRequests: 0, workshopEstimate: null, confirmPercent: 100 });
check("a package at AED 0.00: \"set the package price first\"", blockers.some((b) => /set the package price first/.test(b.label)), blockers.map((b) => b.label).join(" | "));
check("priced: no such blocker", !sendBlockers({ ...q, kind: "quotation", status: "draft" }, [pkgLine], [], { minMarkup: 0, openRequests: 0, workshopEstimate: null, confirmPercent: 100 }).some((b) => /package price/.test(b.label)));
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
