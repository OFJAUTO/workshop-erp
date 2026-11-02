// Section 2 of 2 November 2026: placeholder costs (Q-00039's grill moulding at AED 1.00 from "OFJ Additional"), the LPO
// gate, From our stock, and line numbers never as part numbers.
//   node --import ./tests/unit/register.mjs tests/unit/part-costs.test.mjs        (npm run test:unit)
const R = await import("../../src/lib/parts-rows.ts");
const C = await import("../../src/lib/part-cost-check.ts");
const Q = await import("../../src/lib/quotes.ts");
const { isPlaceholderSupplier, realPartNumber, cleanPartNumber, partNumberProblem, rowMissing, rowState, sameCost, NO_PART_NUMBER } = R;
const { partCostCheck, costNeedsAnswer, boughtSimilar, discountTwiceNote, markupTooHigh, markupTooHighWords, lpoLineProblem, lpoProblemAdvice, costLimitsOf, DEFAULT_COST_LIMITS, belowShareWords, settledCostProblem, isSettledStatus } = C;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// 2.3 / 2.4: stand-in suppliers.
check("OFJ Additional is not a supplier (any case)", isPlaceholderSupplier("OFJ Additional") && isPlaceholderSupplier("Ofj Additional") && isPlaceholderSupplier("  ofj additional "));
check("OFJ alone, OFJ stock, TBC, ? and one or two letters are not suppliers", isPlaceholderSupplier("OFJ") && isPlaceholderSupplier("OFJ stock") && isPlaceholderSupplier("TBC") && isPlaceholderSupplier("?") && isPlaceholderSupplier("G") && isPlaceholderSupplier("HH"));
check("Our stock is real (from our shelf), and real suppliers are suppliers", !isPlaceholderSupplier("Our stock") && !isPlaceholderSupplier("Our Stock") && !isPlaceholderSupplier("ABU DHABI MOTORS L.L.C") && !isPlaceholderSupplier("AL RAS") && !isPlaceholderSupplier("GARGASH ENTERPRISES L.L.C"));
check("an empty supplier is missing, not a stand-in", !isPlaceholderSupplier("") && !isPlaceholderSupplier(null));

// 2.5: line numbers and OFJ are never part numbers.
check("realPartNumber hides line numbers, OFJ stand-ins and NO NUMBER", realPartNumber("12") === null && realPartNumber(" 105 ") === null && realPartNumber("OFJ") === null && realPartNumber("ofj1") === null && realPartNumber("OFJ-2") === null && realPartNumber("NO NUMBER") === null);
check("a real number stays as typed", realPartNumber("A 167 330 68 00") === "A 167 330 68 00" && realPartNumber("10152") === "10152" && realPartNumber("B07119963308") === "B07119963308");
check("cleanPartNumber: what a stored line number or OFJ meant is NO NUMBER", cleanPartNumber("12") === NO_PART_NUMBER && cleanPartNumber("OFJ1") === NO_PART_NUMBER && cleanPartNumber("no number") === NO_PART_NUMBER && cleanPartNumber("") === null && cleanPartNumber(" B07119963308 ") === "B07119963308");
check("a typed line number is refused with words", /looks like a line number/.test(partNumberProblem("12") ?? "") && /tap None/.test(partNumberProblem("12") ?? ""));
check("a typed OFJ is refused with words", /is not a part number/.test(partNumberProblem("OFJ") ?? "") && /is not a part number/.test(partNumberProblem("OFJ1") ?? ""));
check("a real number or None is never refused", partNumberProblem("A1673306800") === null && partNumberProblem("NO NUMBER") === null && partNumberProblem("") === null);

// THE row state.
const row = (o) => ({ part_number: "A1", part_type: "genuine", brand: "", list_price: "", discount: "", cost_aed: "100", supplier: "AL TAYER MOTORS LLC", availability: "in_stock", days: "", qty: "1", ...o });
check("a normal row is priced", rowState(row({})) === "priced");
const ofj = rowMissing(row({ supplier: "OFJ Additional", cost_aed: "1" }));
check("OFJ Additional: not finished, 'Not a supplier'", ofj.some((m) => m.field === "supplier" && m.short === "Not a supplier") && rowState(row({ supplier: "OFJ Additional" })) === "not_finished");
check("Our stock with no stock item: 'Pick the stock item'", rowMissing(row({ supplier: "Our stock", stock_item: "" })).some((m) => m.field === "stock_item"));
check("Our stock with its stock item is priced", rowState(row({ supplier: "Our stock", stock_item: "11111111-1111-4111-8111-111111111111" })) === "priced");
check("a part approved before the rule (stock item not judged) stays priced", rowState(row({ supplier: "Our stock" })) === "priced");
const asked = row({ cost_aed: "2.24", cost_ask: "AED 2.24 – is this the real price?", cost_ask_for: "2.24", cost_ask_kind: "ask_cheap", cost_ask_hold: "1" });
check("a cost question that holds: 'Real price?', not finished", rowMissing(asked).some((m) => m.field === "cost_check" && m.short === "Real price?") && rowState(asked) === "not_finished");
check("before the database change the question is a warning only (the row stays priced)", rowState({ ...asked, cost_ask_hold: "" }) === "priced");
check("a question about another cost does not hold the row", rowState({ ...asked, cost_aed: "2.50" }) === "priced");
check("sameCost reads text and numbers to the fils", sameCost("2.24", 2.24) && sameCost("1,00", "1") && !sameCost("", 0) && !sameCost("2.24", "2.25"));

// 2.1: THE cost check.
const L = DEFAULT_COST_LIMITS;
check("the limits: ask under AED 5, flag under 50%, similar within 20%, warn over 500%", L.askBelow === 5 && L.farBelowPercent === 50 && L.similarPercent === 20 && L.markupWarnPercent === 500);
check("Settings override the limits; a missing row keeps the default", costLimitsOf({ part_cost_ask_below_aed: 3, part_markup_warn_percent: "400" }).askBelow === 3 && costLimitsOf({ part_markup_warn_percent: "400" }).markupWarnPercent === 400 && costLimitsOf({}).farBelowPercent === 50);
const none = { bought: [], twins: [] };
const v1 = partCostCheck({ cost: 1 }, none);
check("AED 1.00 never bought before: asked", v1?.kind === "ask_cheap" && v1.words === "AED 1.00 – is this the real price?");
check("a genuine plug washer at AED 2.24 is asked once...", partCostCheck({ cost: 2.24 }, none)?.kind === "ask_cheap");
check("...and not asked when the same part number was bought at a similar price (2.30, within 20%)", partCostCheck({ cost: 2.24 }, { bought: [{ cost: 2.3, where: "LPO-00041-1", on: "2026-10-12" }], twins: [] }) === null);
check("boughtSimilar finds the similar purchase", boughtSimilar(2.24, { bought: [{ cost: 9, where: "x", on: null }, { cost: 2.1, where: "LPO-1", on: null }], twins: [] })?.where === "LPO-1");
check("the answer for this very cost ends the question; another cost asks again", partCostCheck({ cost: 2.24, confirmedCost: 2.24 }, none) === null && partCostCheck({ cost: 2.5, confirmedCost: 2.24 }, none)?.kind === "ask_cheap");
const far = partCostCheck({ cost: 1 }, { bought: [{ cost: 871, where: "LPO-00041-1", on: "2026-10-12" }], twins: [] });
check("far under the last price paid for the same number: red, with where and when", far?.kind === "far_below" && /Last bought at AED 871\.00 \(LPO-00041-1, 12 Oct\)/.test(far.words) && /AED 1\.00 is less than half/.test(far.words), far?.words);
check("a real price above the limit is not asked", partCostCheck({ cost: 49 }, none) === null && partCostCheck({ cost: 5 }, none) === null);
const twin = partCostCheck({ cost: 300 }, { bought: [], twins: [{ label: "FRONT RH HEAD LIGHT", cost: 12228.3 }] });
check("far under the same part on the other side of the car: red", twin?.kind === "far_below" && /FRONT RH HEAD LIGHT/.test(twin.words) && /real price\?$/.test(twin.words), twin?.words);
check("a part from a stock item whose cost came from deliveries is never asked", partCostCheck({ cost: 1, fromStock: true }, none) === null);
check("a typed stock cost (not from deliveries) is asked like any typed cost", partCostCheck({ cost: 3, fromStock: false }, none)?.kind === "ask_cheap");
check("costNeedsAnswer: open until answered for this cost", costNeedsAnswer(v1, null, 1) && !costNeedsAnswer(v1, 1, 1) && costNeedsAnswer(v1, 1, 2) && !costNeedsAnswer(null, null, 1));

// Gargash (Q-00039): the standard discount taken off a figure that was already net.
const twice = discountTwiceNote({ list: 12228.3, discount: 55 }, [{ label: "FRONT LH HEAD LIGHT", net: 12228.3 }]);
check("a list price equal to a net already seen, with the supplier's discount: one light line", !!twice && /Supplier discount 55% applied/.test(twice) && /already the net price of FRONT LH HEAD LIGHT/.test(twice) && /Is AED 12,228\.30 the LIST price\?/.test(twice), twice ?? "");
check("no discount, or another figure: no note", discountTwiceNote({ list: 12228.3, discount: 0 }, [{ label: "x", net: 12228.3 }]) === null && discountTwiceNote({ list: 9000, discount: 55 }, [{ label: "x", net: 12228.3 }]) === null);

// Markup over 500%.
const grill = { unit_cost: 1, markup_percent: null, markup_mode: "aed", markup_aed: 870 };
check("cost 1.00 + AED 870 = 87,000%: warned", markupTooHigh(grill) === 87000);
check("the words name the markup, the cost and the supplier", markupTooHighWords(87000, 1, "OFJ Additional") === "Markup 87,000% – is the cost real? (cost AED 1.00, OFJ Additional)");
check("engine oil at 400% and a normal 30% are not warned; 600% is", markupTooHigh({ unit_cost: 25, markup_percent: 400 }) === null && markupTooHigh({ unit_cost: 100, markup_percent: 30 }) === null && markupTooHigh({ unit_cost: 100, markup_percent: 600 }) === 600);
check("a line with no cost is never warned", markupTooHigh({ unit_cost: null, markup_percent: 900 }) === null && markupTooHigh({ unit_cost: 0, markup_percent: 900 }) === null);

// 2.2: the LPO gate.
const ok = { ask: null, hold: true, confirmed: false };
const part = (o) => ({ description: "Front lh grill surround moulding", cost_aed: 300, supplier: "AL TAYER MOTORS LLC", availability: "to_order", ...o });
check("a real part may go on an LPO", lpoLineProblem(part({}), ok) === null);
check("no price, no supplier: refused with the part's name", /^FRONT LH GRILL SURROUND MOULDING: no price yet$/.test(lpoLineProblem(part({ cost_aed: null }), ok)?.words ?? "") && /no supplier yet/.test(lpoLineProblem(part({ supplier: "" }), ok)?.words ?? ""));
check("OFJ Additional is refused", /"OFJ Additional" is not a supplier/.test(lpoLineProblem(part({ supplier: "OFJ Additional", cost_aed: 1 }), ok)?.words ?? ""));
check("from our stock is never on an LPO", /from our stock – it is never on an LPO/.test(lpoLineProblem(part({ supplier: "Our stock" }), ok)?.words ?? "") && /never on an LPO/.test(lpoLineProblem(part({ availability: "in_stock" }), ok)?.words ?? ""));
check("AED 1.00 is refused until confirmed (works before the database change)", /AED 1\.00 is not a real price/.test(lpoLineProblem(part({ cost_aed: 1 }), ok)?.words ?? "") && lpoLineProblem(part({ cost_aed: 1 }), { ask: null, hold: true, confirmed: true }) === null);
check("an unanswered cost question holds the line; a warning only does not", /is this the real price/.test(lpoLineProblem(part({ cost_aed: 2.24 }), { ask: { kind: "ask_cheap", words: "AED 2.24 – is this the real price?" }, hold: true, confirmed: false })?.words ?? "") && lpoLineProblem(part({ cost_aed: 2.24 }), { ask: { kind: "ask_cheap", words: "x" }, hold: false, confirmed: false }) === null);

// Fixes of 3 November 2026 (review of section 2).
check("LPO problems say what fixes them: an open question Parts can answer is 'confirm'", lpoLineProblem(part({ cost_aed: 2.24 }), { ask: { kind: "ask_cheap", words: "AED 2.24 – is this the real price?" }, hold: true, confirmed: false })?.fix === "confirm" && lpoLineProblem(part({ cost_aed: 1 }), ok)?.fix === "confirm");
check("...a wrong supplier or no price is 'price', a shelf part 'stock'; AED 1.00 before the database change is 'price'", lpoLineProblem(part({ supplier: "OFJ Additional" }), ok)?.fix === "price" && lpoLineProblem(part({ cost_aed: null }), ok)?.fix === "price" && lpoLineProblem(part({ supplier: "Our stock" }), ok)?.fix === "stock" && lpoLineProblem(part({ cost_aed: 1 }), { ask: null, hold: false, confirmed: false })?.fix === "price");
const adviceConfirm = lpoProblemAdvice([{ words: "x", fix: "confirm" }], false);
const adviceApprove = lpoProblemAdvice([{ words: "x", fix: "confirm" }], true);
check("a question Parts can answer never sends them to Remove: not needed (raising and approving)", /Yes, real price/.test(adviceConfirm) && !/Remove: not needed/.test(adviceConfirm) && /Yes, real price/.test(adviceApprove) && !/Parts replace/.test(adviceApprove), `${adviceConfirm} | ${adviceApprove}`);
check("...a wrong price or supplier still does", /Remove: not needed, then Replace/.test(lpoProblemAdvice([{ words: "x", fix: "price" }], false)) && /Parts replace it with the real price/.test(lpoProblemAdvice([{ words: "x", fix: "price" }], true)));
check("the share words follow the setting: 'less than half' at 50%, 'under 70% of it' at 70%", belowShareWords(50) === "less than half" && belowShareWords(70) === "under 70% of it");
const L70 = { ...DEFAULT_COST_LIMITS, farBelowPercent: 70 };
const twin70 = partCostCheck({ cost: 60 }, { bought: [], twins: [{ label: "REAR LH DOOR on this job", cost: 100 }] }, L70);
check("at 70%, AED 60 against the other side at AED 100 is flagged (it was silently passed)", twin70?.kind === "far_below" && /40% under REAR LH DOOR on this job/.test(twin70.words), twin70?.words);
check("...and at the default 50% it is not", partCostCheck({ cost: 60 }, { bought: [], twins: [{ label: "x", cost: 100 }] }) === null);
const last70 = partCostCheck({ cost: 60 }, { bought: [{ cost: 100, where: "LPO-1", on: null }], twins: [] }, L70);
check("the last-price words follow the setting ('under 70% of it', never 'less than half')", /AED 60\.00 is under 70% of it/.test(last70?.words ?? "") && !/less than half/.test(last70?.words ?? ""), last70?.words);
check("settled statuses: ordered, partly received, received (to order is not)", isSettledStatus("ordered") && isSettledStatus("partly_received") && isSettledStatus("received") && !isSettledStatus("to_order") && !isSettledStatus("none") && !isSettledStatus(null));
check("an ordered part: AED 1.00 from OFJ Additional is not real", settledCostProblem({ cost_aed: 1, final_cost_aed: null, supplier: "OFJ Additional" }) === "AED 1.00 is not a real price");
check("...a stand-in supplier at a real cost with no invoice price is named", settledCostProblem({ cost_aed: 450, final_cost_aed: null, supplier: "OFJ Additional" }) === '"OFJ Additional" is not a supplier');
check("...a supplier invoice or stock price (final cost) clears it, even with the stand-in name left", settledCostProblem({ cost_aed: 1, final_cost_aed: 450, supplier: "OFJ Additional" }) === null && settledCostProblem({ cost_aed: 300, final_cost_aed: null, supplier: "AL TAYER MOTORS LLC" }) === null);
check("an ordered row is past pricing: a stand-in supplier or an open question never makes it unfinished", rowState(row({ supplier: "OFJ Additional", cost_aed: "1", settled: "1", cost_ask: "AED 1.00 – is this the real price?", cost_ask_for: "1", cost_ask_hold: "1" })) === "priced");

// Before sending: a stand-in supplier or an unanswered question never goes out.
const base = { id: "l1", quotation_id: "q1", position: 1, title: "FRONT LH GRILL SURROUND MOULDING", details: null, group_label: null, source_type: "manual", source_key: null, quantity: 1, unit_cost: 1, markup_percent: null, markup_mode: "aed", markup_aed: 870, unit_price: null, hours: null, labour_rate: null, discount_percent: 0, discount_reason: null, line_total: 871, part_item_id: "p1", package_id: null, service_id: null, price_per: null, visible_to_customer: true, urgency: null, advisor_added: false, customer_approved: null, is_active: true, part_type: "genuine", brand: null, option_group: null, chosen: true, fee_kind: null, recovery_trips: null, recovery_provider: null, dangerous: false, parent_line_id: null, recovery_provider_kind: null, markup_confirmed: false, line_type: "part" };
const p1 = { id: "p1", job_id: "j", part_request_id: null, part_number: "12", description: "FRONT LH GRILL SURROUND MOULDING", quantity: 1, diagram_path: null, supplier: "OFJ Additional", cost_aed: 1, availability: "to_order", delivery_date: null, priced_by: null, priced_at: null, confirm_status: "confirmed", confirmed_quantity: 1, confirmed_by: null, confirmed_at: null, reject_note: null, order_status: "none", added_by_role: "parts", is_active: true, created_at: "", part_type: "genuine", brand: null, option_group: null, question_text: null, question_at: null, question_by: null, answer_text: null, answered_at: null, answered_by: null };
const bl = Q.sendBlockers({ kind: "quotation", status: "draft" }, [base], [p1], { minMarkup: 5 });
check("Q-00039's line cannot be sent: OFJ Additional is not a supplier", bl.some((b) => /"OFJ Additional" is not a supplier – Parts to put the real supplier and price/.test(b.label)), bl.map((b) => b.label).join(" | "));
const bl2 = Q.sendBlockers({ kind: "quotation", status: "draft" }, [{ ...base, unit_cost: 2.24, markup_aed: 1 }], [{ ...p1, supplier: "ABU DHABI MOTORS L.L.C", cost_aed: 2.24 }], { minMarkup: 5, costAsks: { p1: "AED 2.24 – is this the real price?" } });
check("an unanswered cost question stops the send", bl2.some((b) => /AED 2\.24 – is this the real price\? – Parts to confirm the real price/.test(b.label)), bl2.map((b) => b.label).join(" | "));
const bl3 = Q.sendBlockers({ kind: "quotation", status: "draft" }, [{ ...base, unit_cost: 49, markup_mode: "percent", markup_percent: 30, markup_aed: null }], [{ ...p1, supplier: "Our stock", cost_aed: 49 }], { minMarkup: 5, costAsks: {} });
check("a real part goes (from our stock included)", !bl3.some((b) => /supplier|real price/.test(b.label)), bl3.map((b) => b.label).join(" | "));
const est = { ...base, part_item_id: null, supplier_text: "G", unit_cost: 5, markup_mode: "percent", markup_percent: 30, markup_aed: null, priced_at: "2026-11-01" };
const bl4 = Q.sendBlockers({ kind: "estimate", status: "draft" }, [est], [], { minMarkup: 5 });
check("an estimate part from supplier 'G' cannot be sent", bl4.some((b) => /"G" is not a supplier/.test(b.label)), bl4.map((b) => b.label).join(" | "));

// A part the customer already approved (to order, ordered, received) never stops a revision: nobody can change it there.
for (const status of ["to_order", "ordered", "received"]) {
  const blS = Q.sendBlockers({ kind: "quotation", status: "draft" }, [base], [{ ...p1, order_status: status }], { minMarkup: 5, costAsks: { p1: "AED 1.00 – is this the real price?" } });
  check(`a revision with Q-00039's moulding already ${status.replace("_", " ")} can be sent (no stand-in or cost blocker)`, !blS.some((b) => /is not a supplier|Parts to confirm the real price/.test(b.label)), blS.map((b) => b.label).join(" | "));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll part-cost checks passed");
process.exit(failed ? 1 : 0);
