// Removing an ordered part (3 November 2026, section 7, J-00969): which endings fit a part, how an ending is stored
// before and after the migration, what the LPO becomes, and the words on screen.
//   node --import ./tests/unit/register.mjs tests/unit/part-endings.test.mjs        (npm run test:unit)
const E = await import("../../src/lib/part-endings.ts");
const S = await import("../../src/lib/part-state.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const opt = (c, key) => c.options.find((o) => o.key === key);

// J-00969's grill: ordered on LPO-00037-1, nothing delivered, Peter asked to fit it as goodwill (never approved).
const grill = { is_active: true, order_status: "ordered", quantity: 1, confirmed_quantity: 1, received_qty: 0, issue_status: "none", availability: "to_order", supplier: "OFJ Additional", disposition: "fit_pending", disposition_at: "2026-11-02T08:47:16Z", return_status: "returned", exchange_status: "none" };
const g = E.endingsFor(grill);
check("J-00969 grill: no refusal (a goodwill request is not an ending)", g.refusal === null, g.refusal ?? "");
check("J-00969 grill: Cancelled with the supplier is offered and suggested", opt(g, "cancelled").allowed && g.suggested === "cancelled");
check("J-00969 grill: Return is greyed - nothing delivered", !opt(g, "return").allowed && /Not delivered yet/.test(opt(g, "return").why ?? ""));
check("J-00969 grill: Keep in stock is greyed - nothing delivered", !opt(g, "stock").allowed && /Not delivered yet/.test(opt(g, "stock").why ?? ""));
check("the server says the same (Return refused in words)", /nothing to return/.test(E.endingRefusal(grill, "return") ?? "") && E.endingRefusal(grill, "cancelled") === null);
check("an unknown choice is refused in words", /Choose an ending/.test(E.endingRefusal(grill, "throw_away") ?? ""));

// Delivered parts.
const here = { is_active: true, order_status: "received", quantity: 2, received_qty: 2, issue_status: "none", availability: "to_order", supplier: "Gargash", disposition: null, disposition_at: null, return_status: "none" };
const h = E.endingsFor(here);
check("delivered: Return and Keep in stock offered, Return suggested", opt(h, "return").allowed && opt(h, "stock").allowed && h.suggested === "return");
check("delivered: Cancelled greyed with the reason", !opt(h, "cancelled").allowed && /Already delivered \(2 here\)/.test(opt(h, "cancelled").why ?? ""));
check("delivered in full: no 'partly' note", h.partly === null);
const partly = { ...here, order_status: "partly_received", quantity: 3, received_qty: 1 };
const pt = E.endingsFor(partly);
check("partly delivered: Return offered, the rest is cancelled in words", opt(pt, "return").allowed && /Only 1 of 3 arrived: the other 2 are cancelled/.test(pt.partly ?? ""), pt.partly ?? "");

// From our own shelf.
const shelf = { is_active: true, order_status: "received", quantity: 1, received_qty: 1, availability: "in_stock", supplier: "Our stock", stock_item_id: "s1", disposition: null, disposition_at: null, return_status: "none" };
const sh = E.endingsFor(shelf);
check("from our shelf: only Keep in stock (back on the shelf)", !opt(sh, "return").allowed && !opt(sh, "cancelled").allowed && opt(sh, "stock").allowed && /Back onto our shelf/.test(opt(sh, "stock").help));
const shelfNotTaken = { ...shelf, order_status: "to_order", received_qty: 0 };
check("our stock not taken yet: Cancelled (it comes off the list)", E.endingsFor(shelfNotTaken).suggested === "cancelled" && /Not taken from the shelf yet/.test(opt(E.endingsFor(shelfNotTaken), "cancelled").help));
const toOrder = { ...grill, order_status: "to_order", disposition: null, disposition_at: null, return_status: "none" };
check("approved, not ordered yet: Cancelled says it comes off the order list", /Not ordered yet/.test(opt(E.endingsFor(toOrder), "cancelled").help));

// Refusals: whole dialog.
check("with the technician: bring it back first", /With the technician/.test(E.endingsFor({ ...here, issue_status: "confirmed" }).refusal ?? ""));
check("being exchanged (wrong or faulty): its own ending", /being exchanged/.test(E.endingsFor({ ...here, exchange_status: "needed" }).refusal ?? ""));
check("already removed", /Already removed/.test(E.endingsFor({ ...here, is_active: false }).refusal ?? ""));
check("already scrapped / fitted as goodwill", /scrapped/.test(E.endingsFor({ ...here, disposition: "scrap" }).refusal ?? "") && /goodwill/.test(E.endingsFor({ ...here, disposition: "fit_approved" }).refusal ?? ""));
check("already ended: says which ending", E.endingsFor({ ...here, disposition: "stock", disposition_at: "x" }).refusal === "Already done: Kept in stock.");

// Storage before and after the migration.
check("a choice becomes its state (a return with its credit note in hand is complete)", E.stateOfChoice("cancelled", false) === "cancelled" && E.stateOfChoice("return", false) === "return_pending" && E.stateOfChoice("return", true) === "returned" && E.stateOfChoice("stock", false) === "stock");
check("before the migration: cancelled and return pending are stored as NULL", E.storedDisposition("cancelled", false) === null && E.storedDisposition("return_pending", false) === null && E.storedDisposition("returned", false) === "returned" && E.storedDisposition("stock", false) === "stock");
check("after the migration: stored by name", E.storedDisposition("cancelled", true) === "cancelled" && E.storedDisposition("return_pending", true) === "return_pending");
check("read back before the migration: NULL + disposition_at = cancelled", E.endingOf({ disposition: null, disposition_at: "2026-11-03T09:00:00Z", return_status: "none" }) === "cancelled");
check("read back before the migration: NULL + disposition_at + to_return = return pending", E.endingOf({ disposition: null, disposition_at: "2026-11-03T09:00:00Z", return_status: "to_return" }) === "return_pending");
check("read back after the migration", E.endingOf({ disposition: "cancelled" }) === "cancelled" && E.endingOf({ disposition: "return_pending" }) === "return_pending");
check("no ending: nothing decided, a goodwill request, scrap", E.endingOf({ disposition: null, disposition_at: null }) === null && E.endingOf({ disposition: "fit_pending", disposition_at: "x" }) === null && E.endingOf({ disposition: "scrap", disposition_at: "x" }) === null);
check("an ended part's cost never counts on the job", !E.partCostCounts({ disposition: "cancelled" }) && E.partCostCounts({ disposition: null }));

// The words.
check("the row's label: Removed – <ending> by <name>", E.endingWords("cancelled", "Omar") === "Removed – Cancelled with the supplier by Omar" && E.endingWords("return_pending", "Peter") === "Removed – Return to supplier – credit note awaited by Peter" && E.endingWords("stock", "Peter") === "Removed – Kept in stock by Peter");
check("the LPO line's label", E.LINE_ENDING_LABEL.cancelled === "Cancelled – not delivered" && E.LINE_ENDING_LABEL.return_pending === "Returned – credit note awaited");
const msg = E.supplierMessage("cancelled", { lpo: "LPO-00037-1", vin: "WDD1234567", lines: [{ name: "Front lh grill surround moulding", partNumber: null, qty: 1 }] });
check("the cancellation for the supplier", msg === "LPO-00037-1 · OFJ Automotive\nVIN: WDD1234567\n\nPlease cancel:\n• FRONT LH GRILL SURROUND MOULDING × 1", JSON.stringify(msg));
const ret = E.supplierMessage("return_pending", { lpo: "LPO-00040-2", vin: null, lines: [{ name: "Brake pads", partNumber: "A0004209100", qty: 2 }] });
check("the return for the supplier asks for the credit note", ret === "LPO-00040-2 · OFJ Automotive\n\nWe are returning:\n• A0004209100 · BRAKE PADS × 2\n\nPlease send the credit note.", JSON.stringify(ret));

// The LPO after a line ended.
const a1 = E.poAfterEnding({ status: "ordered", chargesAed: 0 }, []);
check("LPO-00037-1 (its only line cancelled): total 0, cancelled", a1.total === 0 && a1.status === "cancelled" && a1.cancel && !a1.releaseCharges);
const a2 = E.poAfterEnding({ status: "ordered", chargesAed: 0 }, [{ quantity: 1, received_qty: 0, unit_cost: 12228.3 }]);
check("one of two lines cancelled: the total is the other line", a2.total === 12228.3 && a2.status === "ordered" && !a2.cancel);
const a3 = E.poAfterEnding({ status: "partly_received", chargesAed: 25 }, [{ quantity: 1, received_qty: 1, unit_cost: 100 }]);
check("the only line still waiting was cancelled: every remaining line is in = received (charges counted)", a3.status === "received" && a3.total === 125);
const a4 = E.poAfterEnding({ status: "ordered", chargesAed: 7500 }, []);
check("ordered, no line left but a courier charge: kept, said in words", !a4.cancel && a4.total === 7500 && /charges \(AED 7500.00\) stay/.test(a4.chargeNote ?? ""));
const a5 = E.poAfterEnding({ status: "approved", chargesAed: 40 }, []);
check("never ordered, no line left: cancelled and its charges leave with it", a5.cancel && a5.releaseCharges && a5.total === 0);
const a6 = E.poAfterEnding({ status: "ordered", chargesAed: 0 }, [{ quantity: 2, received_qty: 1, unit_cost: 50 }]);
check("part of a line in: partly received", a6.status === "partly_received" && a6.total === 100);

// Review fixes (3 November 2026).
// A part replaced by another supplier's part is not "being exchanged": it takes the endings (never "Moved to stock").
const replaced = { ...toOrder, replacement_part_id: "r1", not_needed_at: "2026-11-01T08:00:00Z" };
check("replaced by another supplier: not being exchanged", !E.isExchanging(replaced) && E.isExchanging({ ...here, exchange_status: "ordered" }));
check("replaced by another supplier, nothing delivered: Cancelled with the supplier, Keep in stock greyed", E.endingsFor(replaced).refusal === null && E.endingsFor(replaced).suggested === "cancelled" && !opt(E.endingsFor(replaced), "stock").allowed);
// Partly delivered: the rest is cancelled with the supplier - and the supplier is told, whatever the ending.
check("not delivered on the line", E.notDeliveredQty(3, 1) === 2 && E.notDeliveredQty(1, 1) === 0 && E.notDeliveredQty(2, 2.004) === 0);
const partRet = E.supplierMessage("return_pending", { lpo: "LPO-00050-1", vin: null, lines: [{ name: "Oil filter", partNumber: null, qty: 1 }], notDelivered: [{ name: "Oil filter", partNumber: null, qty: 2 }] });
check("partly delivered, returned: returning 1 AND cancel the other 2", partRet === "LPO-00050-1 · OFJ Automotive\n\nWe are returning:\n• OIL FILTER × 1\n\nPlease send the credit note.\n\nPlease cancel (not delivered):\n• OIL FILTER × 2", JSON.stringify(partRet));
const partStock = E.supplierMessage("stock", { lpo: "LPO-00050-1", vin: "VIN1", lines: [], notDelivered: [{ name: "Oil filter", partNumber: "OF-1", qty: 2 }] });
check("partly delivered, kept in stock: only the cancellation of the rest", partStock === "LPO-00050-1 · OFJ Automotive\nVIN: VIN1\n\nPlease cancel (not delivered):\n• OF-1 · OIL FILTER × 2", JSON.stringify(partStock));
// What a return is credited at: what the supplier billed, never the job's cost the ending set to 0.
check("credit: the typed credit note amount wins", E.returnCreditOf({ qty: 2, creditNoteAmount: 501, invoiceUnit: 260, lineUnit: 250, finalCost: 0, cost: 1 }).amount === 501 && E.returnCreditOf({ qty: 2, creditNoteAmount: 501 }).source === "credit_note");
check("credit: the supplier's invoice price (260, not the LPO's 250)", E.returnCreditOf({ qty: 1, invoiceUnit: 260, lineUnit: 250, finalCost: 0, cost: 250 }).amount === 260);
check("credit: the LPO price when no invoice yet (a cost corrected later is on the line, not the first AED 1.00)", E.returnCreditOf({ qty: 1, invoiceUnit: null, lineUnit: 250, finalCost: 0, cost: 1 }).amount === 250);
check("credit: the part's own cost only without a line (final 0 = not a figure)", E.returnCreditOf({ qty: 2, finalCost: 0, cost: 40 }).amount === 80 && E.returnCreditOf({ qty: 2, finalCost: 0, cost: 40 }).source === "cost");
// An ordered LPO left with only a courier charge says how to close it.
check("charges left alone on an ordered LPO: the words name Waived – remove", /Waived – remove/.test(E.poAfterEnding({ status: "ordered", chargesAed: 50 }, []).chargeNote ?? ""));

// The tracking list.
const now = Date.parse("2026-11-10T08:00:00Z");
check("days waiting for the credit note", E.daysWaiting("2026-11-03T07:00:00Z", now) === 7 && E.daysWaiting(null, now) === 0 && E.daysWaiting("2026-11-11T00:00:00Z", now) === 0);

// The one state per part (part-state.ts) reads the endings.
check("part state: cancelled", S.partState({ disposition: null, disposition_at: "x", return_status: "none", order_status: "none" }).label === "Cancelled with the supplier");
check("part state: return pending (amber)", S.partState({ disposition: "return_pending", order_status: "received" }).tone === "amber");
check("an ended part has a home and is never waited for", !S.hasNoHome({ disposition: null, disposition_at: "x", not_needed_at: "y" }) && !S.stillToReceive({ disposition: null, disposition_at: "x", order_status: "ordered" }));
check("a part not needed with no ending still has no home (the list asks)", S.hasNoHome({ not_needed_at: "y", disposition: null, disposition_at: null }));

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
