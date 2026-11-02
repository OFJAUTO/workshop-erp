// Section 1 of 2 November 2026: ONE selling-price rule, and nothing below cost unless the owner approved that line.
//   node --import ./tests/unit/register.mjs tests/unit/below-cost.test.mjs        (npm run test:unit)
const Q = await import("../../src/lib/quotes.ts");
const { lineTotal, linePrice, lineUnitPrice, markupBoth, markupFromSell, belowCostOf, belowCostChange, belowCostWords, costOfLine, markupForAddedPart, markupPickWords, cheapCostWarning, sidelessName, sendBlockers, floorProblem, revisionRowRed, revisionRowWarning, headerDiscountShares, belowCostAll, belowCostChangesIn, priceSideKeys, partLineChanges, needsPackageCosting } = Q;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const base = { id: "l1", quotation_id: "q1", position: 1, title: "FRONT LH LIGHT", details: null, group_label: null, source_type: "manual", source_key: null, quantity: 1, unit_cost: null, markup_percent: null, markup_mode: "percent", markup_aed: null, unit_price: null, hours: null, labour_rate: null, discount_percent: 0, discount_reason: null, line_total: 0, part_item_id: "p1", package_id: null, service_id: null, price_per: null, visible_to_customer: true, urgency: null, advisor_added: false, customer_approved: null, is_active: true, part_type: null, brand: null, option_group: null, chosen: true, fee_kind: null, recovery_trips: null, recovery_provider: null, dangerous: false, parent_line_id: null, recovery_provider_kind: null, markup_confirmed: false };
const part = (o) => ({ ...base, line_type: "part", ...o });

// 1.1 THE price rule (costPlusMarkup behind linePrice / lineTotal / lineUnitPrice / markupBoth): the cost goes UP by the markup.
const lh = part({ unit_cost: 12228.3, markup_percent: 80 });
check("percent: 12,228.30 + 80% = 22,010.94 (the normal route on Q-00039)", lineTotal(lh) === 22010.94, String(lineTotal(lh)));
check("the unit price and both markup forms agree", lineUnitPrice(lh) === 22010.94 && markupBoth(lh).sell === 22010.94 && markupBoth(lh).aed === 9782.64 && markupBoth(lh).percent === 80);
const grill = part({ unit_cost: 1, markup_mode: "aed", markup_aed: 870 });
check("AED: cost 1 + AED 870 = 871.00", lineTotal(grill) === 871);
const rh = part({ unit_cost: 5502.73, markup_percent: 55 });
check("a markup is never subtracted: 5,502.73 + 55% = 8,529.23 (never 2,476.23)", lineTotal(rh) === 8529.23, String(lineTotal(rh)));
const { netOf } = await import("../../src/lib/parts-rows.ts");
check("AED 5,502.73 is the COST: list 12,228.30 less the supplier's 55% (netOf, the Parts table), not a selling price", netOf("12228.30", "55") === "5502.73", netOf("12228.30", "55"));
const typed = markupFromSell(part({ unit_cost: 1000 }), 900);
check("a typed selling price below cost gives a NEGATIVE markup, never a discount", typed.markup_percent === -10);
const back = part({ unit_cost: 1000, ...typed });
check("markupFromSell round-trips through linePrice", linePrice(back) === 900);
// The early charge pushed into a quotation (charges.ts): an Other line with a cost sells at cost + markup, so the charge
// goes in as the markup that lands exactly on it - before, the empty markup sold it at its cost.
const charge = (cost, sell) => ({ ...base, line_type: "other", part_item_id: null, title: "FUEL", unit_cost: cost, unit_price: sell, markup_mode: "percent", ...markupFromSell({ unit_cost: cost, markup_percent: null, markup_mode: "percent" }, sell) });
check("a charge of 630 on a cost of 600 sells at 630 (not 600)", lineTotal(charge(600, 630)) === 630 && lineTotal({ ...charge(600, 630), markup_percent: null }) === 600);
check("a charge of 200 on a cost of 170 lands on 200.00 to the fils", lineTotal(charge(170, 200)) === 200);
check("a charge below its cost is a line below cost", !!belowCostOf(charge(100, 80)));

// 1.2 Nothing below cost.
check("a part at a positive markup is never below cost", belowCostOf(lh) === null && belowCostOf(rh) === null);
const neg = part({ unit_cost: 1000, markup_percent: -10, title: "BRAKE DISC" });
const b = belowCostOf(neg);
check("a negative markup is below cost: sell 900, cost 1,000, 100 under", !!b && b.sell === 900 && b.cost === 1000 && b.short === 100 && !b.approved);
check("the words say sell and cost, labelled", belowCostWords("BRAKE DISC", b) === "BRAKE DISC would sell at AED 900.00, below its cost of AED 1,000.00 (AED 100.00 under)");
check("an owner's line discount can put a part below cost", !!belowCostOf(part({ unit_cost: 1000, markup_percent: 20, discount_percent: 25 })));
check("hidden, complimentary, left-off and unchosen lines are never judged", !belowCostOf({ ...neg, visible_to_customer: false }) && !belowCostOf({ ...neg, price_display: "complimentary" }) && !belowCostOf({ ...neg, left_off: true }) && !belowCostOf({ ...neg, option_group: "g", chosen: false }));
check("a part still without its price is not judged", belowCostOf(part({ unit_cost: null, markup_percent: -50 })) === null);
const svc = { ...base, line_type: "package", part_item_id: null, title: "NIGHT SKY PAINTING", unit_cost: 1500, unit_price: 1200 };
check("a service with our cost 1,500 sold at 1,200 is below cost", belowCostOf(svc)?.short === 300);
check("a service with no price yet is not judged (enter the price catches it)", belowCostOf({ ...svc, unit_price: null }) === null && belowCostOf({ ...svc, unit_price: 0 }) === null);
const rec = { ...base, line_type: "recovery", part_item_id: null, title: "RECOVERY, NORMAL, TWO WAYS", unit_cost: 170, unit_price: 150, quantity: 2 };
check("recovery charged 150 a trip against 170 costs is below cost (2 trips: 300 vs 340)", belowCostOf(rec)?.sell === 300 && belowCostOf(rec)?.cost === 340);
check("recovery paid by us (hidden) is never judged", belowCostOf({ ...rec, visible_to_customer: false, unit_price: 0 }) === null);
check("labour is never judged (its floor is the standard rate)", belowCostOf({ ...base, line_type: "labour", hours: 1, labour_rate: 1, unit_cost: 999 }) === null);
// A package against its computed cost.
const costing = { rolls: 2, filmRollPriceGloss: 3000, filmRollPriceMatte: 3500, tintPerCar: 400, tintFactor: 1, ceramicExteriorPerCar: 200, ceramicInteriorPerCar: 100, consumablesPerCar: 100, packageHours: 20, tintExtraHours: 3, ratePerHour: 50 };
const pkg = { ...base, line_type: "package", part_item_id: null, title: "OFJ FULL PROTECTION", package_key: "ofj_full", package_items: { items: [{ label: "PPF full body" }] }, unit_price: 5000, installer_hours: null };
const pkgCost = costOfLine(pkg, { packageCosting: costing });
check("a package's cost is its computed cost (film 2 x 3,000 + consumables 100 + 20 h x 50 = 7,100)", pkgCost === 7100, String(pkgCost));
check("a package priced 5,000 against 7,100 is below cost", belowCostOf(pkg, { packageCosting: costing })?.short === 2100);
check("without the costing figures a package is not judged", belowCostOf(pkg) === null);
check("a package at 20,000 is fine", belowCostOf({ ...pkg, unit_price: 20000 }, { packageCosting: costing }) === null);

// The owner's approval covers the figures he saw only.
const ok = { ...neg, below_cost_at: "2026-11-02T10:00:00Z", below_cost_reason: "Goodwill for a regular", below_cost_sell_aed: 900, below_cost_cost_aed: 1000, below_cost_by_name: "Omar" };
check("approved: the same figures are covered, with who and why", belowCostOf(ok)?.approved === true && belowCostOf(ok)?.reason === "Goodwill for a regular" && belowCostOf(ok)?.byName === "Omar");
check("a lower price later is not covered", belowCostOf({ ...ok, markup_percent: -20 })?.approved === false);
check("a higher cost later is not covered", belowCostOf({ ...ok, unit_cost: 1100 })?.approved === false);
check("a higher price (still below cost) stays covered", belowCostOf({ ...ok, markup_percent: -5 })?.approved === true);

// A change is refused only when it makes things worse.
check("adding a line below cost is a change below cost", !!belowCostChange(null, neg));
check("a line put below cost by Parts can still change its urgency", belowCostChange(neg, { ...neg, urgency: "urgent" }) === null);
check("raising the price (still below) is allowed", belowCostChange(neg, { ...neg, markup_percent: -5 }) === null);
check("lowering it further is not", !!belowCostChange(neg, { ...neg, markup_percent: -20 }));
check("going from fine to below cost is not", !!belowCostChange(part({ unit_cost: 1000, markup_percent: 10 }), neg));
check("an approved change is no change below cost", belowCostChange(null, ok) === null);

// The floor (minimum markup) leaves below-cost lines to the below-cost rule; "Before sending" stops them unless approved.
check("the minimum-markup floor leaves a below-cost line to its own rule", floorProblem(neg, 5) === null);
const blocks = sendBlockers({ kind: "quotation", status: "draft" }, [neg], [{ id: "p1", cost_aed: 1000, confirm_status: "confirmed" }], { minMarkup: 5 });
check("Before sending: an unapproved line below cost blocks, in words", blocks.some((x) => /below its cost of AED 1,000\.00/.test(x.label)), blocks.map((x) => x.label).join(" | "));
check("Before sending: the owner's approval lets it go", !sendBlockers({ kind: "quotation", status: "draft" }, [ok], [{ id: "p1", cost_aed: 1000, confirm_status: "confirmed" }], { minMarkup: 5 }).some((x) => /below its cost/.test(x.label)));
check("Before sending: a package below its computed cost blocks", sendBlockers({ kind: "quotation", status: "draft" }, [pkg], [], { minMarkup: 5, packageCosting: costing }).some((x) => /below its cost/.test(x.label)));

// A part added after approval or by a revision takes the quotation's own markup, never silently the minimum.
check("the left/right words come off a name, front and rear stay", sidelessName("FRONT LH LIGHT") === "front light" && sidelessName("Front RH light") === "front light" && sidelessName("REAR LEFT DOOR SEAL") === "rear door seal", [sidelessName("FRONT LH LIGHT"), sidelessName("REAR LEFT DOOR SEAL")].join(" | "));
check("a FRONT part and a REAR part are never twins (review: false 'check the price')", sidelessName("FRONT BRAKE DISCS") !== sidelessName("REAR BRAKE DISCS") && sidelessName("FL SHOCK") === sidelessName("FR SHOCK") && sidelessName("FL SHOCK") !== sidelessName("RL SHOCK"));
check("a rear part is never compared with the front one's cost", cheapCostWarning(350, []) === null && markupForAddedPart([{ title: "FRONT BRAKE PADS", unit_cost: 800, markup_percent: 60, markup_mode: "percent" }], { title: "REAR BRAKE PADS", cost: 350 }, 5).source !== "twin");
const others = [{ title: "Front LH light", partNumber: "A2239067006", unit_cost: 12228.3, markup_mode: "percent", markup_percent: 80, markup_aed: null }, { title: "FRONT LH GRILL SURROUND MOULDING", partNumber: "12", unit_cost: 1, markup_mode: "aed", markup_percent: 5, markup_aed: 870 }];
const pick = markupForAddedPart(others, { title: "FRONT RH HEAD LIGHT", partNumber: "A2239067006", cost: 5502.73 }, 5);
check("the RH head light takes the LH light's 80% (same part number)", pick.source === "twin" && pick.markup_percent === 80 && pick.from === "Front LH light");
check("the words say where the markup came from", markupPickWords(pick) === "80% (same as Front LH light)");
const byName = markupForAddedPart([{ title: "FRONT LEFT DOOR SEAL", unit_cost: 200, markup_percent: 35, markup_mode: "percent" }], { title: "FRONT RIGHT DOOR SEAL", cost: 210 }, 5);
check("a twin by name on the other side", byName.source === "twin" && byName.markup_percent === 35);
const most = markupForAddedPart([{ title: "OIL FILTER", unit_cost: 50, markup_percent: 30 }, { title: "AIR FILTER", unit_cost: 80, markup_percent: 30 }, { title: "WIPER", unit_cost: 40, markup_percent: 50 }], { title: "CABIN FILTER", cost: 60 }, 5);
check("no twin: the markup used most on the quotation (30%)", most.source === "quotation" && most.markup_percent === 30 && markupPickWords(most) === "30% (most used on this quotation)");
check("nothing to learn from: the minimum", markupForAddedPart([], { title: "X", cost: 10 }, 5).source === "minimum");
check("never below the minimum", markupForAddedPart([{ title: "LIGHT", unit_cost: 10, markup_percent: 2 }], { title: "LIGHT", cost: 10 }, 5).markup_percent === 5);
const aedTwin = markupForAddedPart([{ title: "BUMPER", partNumber: "B1234", unit_cost: 1000, markup_mode: "aed", markup_aed: 10, markup_percent: 5 }], { title: "BUMPER", partNumber: "B1234", cost: 1000 }, 5);
check("an AED twin below the minimum is lifted to the minimum in AED (50.00 on 1,000)", aedTwin.markup_mode === "aed" && aedTwin.markup_aed === 50);

// The owner's revision box: a cost far under the same part is red.
check("Q-00039: 5,502.73 against the LH light's 12,228.30 is 55% under", cheapCostWarning(5502.73, [{ label: "FRONT LH LIGHT on this job", cost: 12228.3 }]) === "cost AED 5,502.73 is 55% under FRONT LH LIGHT on this job (AED 12,228.30)");
check("half or more is not flagged", cheapCostWarning(7000, [{ label: "X", cost: 12228.3 }]) === null);
check("no references, nothing flagged", cheapCostWarning(5, []) === null);
const row = { partId: "p", kind: "added", title: "FRONT RH HEAD LIGHT", supplier: "Gargash", list: 12228.3, discount: 55, cost: 5502.73, oldCost: null, qty: 1, sell: 9904.91, markupWords: "80%", below: null, cheap: "cost AED 5,502.73 is 55% under FRONT LH LIGHT on this job (AED 12,228.30)" };
check("a cheap cost makes the row red, with what to do", revisionRowRed(row) && /check the Parts price before allowing/.test(revisionRowWarning(row)));
check("a plain row is not red", !revisionRowRed({ ...row, cheap: null }) && revisionRowWarning({ ...row, cheap: null }) === null);

// Review of 2 November 2026: the fallback markup for an added part learns only from real percentage markups.
const q39 = [{ title: "Front LH light", partNumber: "A2239067006", unit_cost: 12228.3, markup_mode: "percent", markup_percent: 80, markup_aed: null }, { title: "FRONT LH GRILL SURROUND MOULDING", partNumber: "12", unit_cost: 1, markup_mode: "aed", markup_percent: 5, markup_aed: 870 }];
const noTwin = markupForAddedPart(q39, { title: "ENGINE MOUNT", partNumber: "X9", cost: 500 }, 5);
check("Q-00039 lines + a part with no twin: 80% (never the placeholder's 87,000%)", noTwin.source === "quotation" && noTwin.markup_percent === 80 && lineTotal(part({ unit_cost: 500, markup_percent: noTwin.markup_percent })) === 900, JSON.stringify(noTwin));
check("only a placeholder-cost AED line to learn from: the minimum", markupForAddedPart([q39[1]], { title: "ENGINE MOUNT", cost: 500 }, 5).source === "minimum");
const tie = markupForAddedPart([{ title: "OIL FILTER", unit_cost: 50, markup_percent: 30 }, { title: "WIPER", unit_cost: 40, markup_percent: 80 }], { title: "CABIN FILTER", cost: 60 }, 5);
check("a tie goes to the LOWER markup (30% before 80%)", tie.markup_percent === 30, JSON.stringify(tie));
check("a placeholder cost is never a twin either", markupForAddedPart([{ title: "FRONT LH MOULDING", unit_cost: 1, markup_mode: "aed", markup_aed: 870, markup_percent: 5 }], { title: "FRONT RH MOULDING", cost: 500 }, 5).source === "minimum");

// The header (package) discount: a package judged after its share of it (review: a 10% package discount under the limit).
const hdr = (o = {}) => ({ discount_percent: 0, vat_percent: 5, discount_kind: null, discount_value: null, discount_scope: "labour", ...o });
const pkg7 = { ...pkg, id: "pk", unit_price: 7000 };
const lab = { ...base, id: "lb", line_type: "labour", part_item_id: null, title: "FIT", hours: 10, labour_rate: 300 };
check("a package at 7,000 against 7,100 is below cost already", !!belowCostOf(pkg7, { packageCosting: costing }));
const pkg8 = { ...pkg, id: "pk", unit_price: 8000 };
check("a package at 8,000 against 7,100 is fine without a discount", belowCostAll([pkg8, lab], hdr(), { packageCosting: costing }).size === 0);
const shares = headerDiscountShares([pkg8, lab], hdr({ discount_kind: "percent", discount_value: 15 }));
check("a 15% discount is shared by price: 1,200 on the package, 450 on the labour", shares.get("pk") === 1200 && shares.get("lb") === 450, JSON.stringify([...shares]));
const after15 = belowCostAll([pkg8, lab], hdr({ discount_kind: "percent", discount_value: 15 }), { packageCosting: costing }).get("pk");
check("after a 15% discount the package sells at 6,800, below its 7,100", after15?.sell === 6800 && after15?.cost === 7100, JSON.stringify(after15));
const hits = belowCostChangesIn({ lines: [pkg8, lab], q: hdr() }, { lines: [pkg8, lab], q: hdr({ discount_kind: "percent", discount_value: 15 }) }, { packageCosting: costing });
check("THE change check: the discount is a change below cost (on the package line)", hits.length === 1 && hits[0].line.id === "pk");
check("Before sending: a package below cost after the discount blocks", sendBlockers({ kind: "quotation", status: "draft", ...hdr({ discount_kind: "percent", discount_value: 15 }) }, [pkg8, lab], [], { minMarkup: 5, packageCosting: costing }).some((x) => /below its cost of AED 7,100\.00/.test(x.label)));
const aedHdr = hdr({ discount_kind: "aed", discount_value: 1000 });
const shareA = headerDiscountShares([pkg8, lab], aedHdr).get("pk");
const shareB = headerDiscountShares([pkg8, { ...lab, hours: 1 }], aedHdr).get("pk");
check("an AED discount over fewer labour hours falls more on the package", shareB > shareA, `${shareA} -> ${shareB}`);
const stampedPkg = { ...pkg8, below_cost_at: "2026-11-02T10:00:00Z", below_cost_sell_aed: 6800, below_cost_cost_aed: 7100 };
check("the owner's stamp covers the after-discount figure he saw", belowCostAll([stampedPkg, lab], hdr({ discount_kind: "percent", discount_value: 15 }), { packageCosting: costing }).get("pk")?.approved === true && belowCostAll([stampedPkg, lab], hdr({ discount_kind: "percent", discount_value: 20 }), { packageCosting: costing }).get("pk")?.approved === false);

// A plain bodyshop service: its installer hours (and a plain PPF line's film) are its cost, like the internal box counts.
const ppfPlain = { ...base, id: "sv", line_type: "package", part_item_id: null, title: "PPF INTERIOR SCREENS", unit_price: 300, installer_hours: 8, package_key: null };
check("a bodyshop service with 8 installer hours costs 8 x 50 = 400 (+ its film share)", costOfLine(ppfPlain, { bodyshopRate: 50 }) === 400 && costOfLine(ppfPlain, { bodyshopRate: 50, packageCosting: costing }) > 400);
check("priced 300 against that it is below cost", !!belowCostOf(ppfPlain, { bodyshopRate: 50 }));
check("a plain PPF line needs the costing figures on the server", needsPackageCosting([{ ...ppfPlain, is_active: true }]) && !needsPackageCosting([{ ...svc, is_active: true }]));

// What can never be refused: a cost (and plain words). Price-side keys are judged.
check("a cost, installer hours, a title or a note are not price-side", priceSideKeys({ id: "x", unit_cost: 5, installer_hours: 2, title: "A", details: "B" }).length === 0);
check("a price, markup, discount, quantity or unhiding is price-side", priceSideKeys({ id: "x", unit_price: 5, markup_percent: 1, discount_percent: 2, quantity: 1, visible_to_customer: true }).length === 5);

// The new version follows the part (review: an approved quotation's old cost was copied into the revision).
const lineV1 = { unit_cost: 1000, quantity: 1, part_type: "oem", brand: "BOSCH", positions: ["Front left"] };
const partNow = { cost_aed: 5000, quantity: 1, confirmed_quantity: null, part_type: "genuine", brand: "bosch", positions: ["Front left"], is_active: true, confirm_status: "confirmed" };
const d = partLineChanges(lineV1, partNow);
check("a re-priced part: money changed, and the type change is named", d.money && !d.gone && d.words.length === 1 && d.words[0] === "type OEM → GENUINE", JSON.stringify(d));
check("an untouched part: nothing changed", (() => { const x = partLineChanges(lineV1, { ...partNow, cost_aed: 1000, part_type: "oem" }); return !x.money && !x.gone && !x.words.length; })());
check("a part taken off: gone", partLineChanges(lineV1, { ...partNow, is_active: false }).gone);

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
