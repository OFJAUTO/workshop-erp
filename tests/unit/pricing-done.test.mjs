// Section 10 of 2 November 2026 (built 3 November): "Pricing done – send to advisor". One bar with "3 of 4 priced",
// the unpriced lines listed instead of sending, ONE notification to the advisor, and the car or estimate off the parts
// desk's to-do list once sent.
//   node --import ./tests/unit/register.mjs tests/unit/pricing-done.test.mjs        (npm run test:unit)
const P = await import("../../src/lib/pricing-done.ts");
const { pricingProgress, openLinesWords, pricingDoneTitle, pricingDoneBody, pricingSent, holdPerPartNotices, awaitingSend, jobPricingTodo, estimateLineMoment, estimateDeskTodo, PLANNING_STATUSES } = P;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const line = (key, state, missing = []) => ({ key, name: key, state, missing });
const p = pricingProgress([line("engine oil", "priced"), line("oil filter", "priced"), line("drain plug", "priced"), line("plug washer", "not_finished", ["no part number"]), line("old one", "removed")]);
check("3 of 4 priced (a removed line counts for nothing)", p.words === "3 of 4 priced" && p.total === 4 && p.done === 3 && p.open === 1, JSON.stringify(p));
check("the open line is listed with what it misses", p.openLines.length === 1 && p.openLines[0].key === "plug washer" && p.openLines[0].missing[0] === "no part number");
check("1 part not priced yet", openLinesWords(p) === "1 part not priced yet" && openLinesWords({ open: 3 }) === "3 parts not priced yet");
const na = pricingProgress([line("a", "priced"), line("b", "not_available"), line("c", "waiting_approval")]);
check("not available counts as done; waiting for the owner stays open", na.done === 2 && na.open === 1 && na.words === "2 of 3 priced" && na.detail === "1 not available · 1 waiting for owner approval");
check("nothing yet", pricingProgress([]).words === "No parts yet");
check("REVIEW: the line count includes removed lines (a pricing with only removed lines can still be sent)", pricingProgress([line("a", "removed")]).count === 1 && pricingProgress([line("a", "removed")]).total === 0);

check("ONE title: All parts priced on E-00058", pricingDoneTitle("E-00058", { open: 0, done: 4, total: 4 }, false) === "All parts priced on E-00058");
check("REVIEW: titles when every part went, when none could be had, and when it went by itself", pricingDoneTitle("J-1", { open: 0, done: 0, total: 0 }, false) === "No parts left on J-1" && pricingDoneTitle("J-1", { open: 0, done: 1, total: 1, priced: 0 }, false) === "Parts not available on J-1" && pricingDoneTitle("J-1", { open: 0, done: 2, total: 2 }, false, true) === "Parts changes on J-1");
check("REVIEW: the released notice says why it came by itself", /did not press Pricing done/.test(pricingDoneBody({ by: "the parts desk", p: { done: 1, total: 1, openLines: [], notAvailable: 1 }, changes: ["REAR DISCS: not available"], auto: true })));
check("sent with open lines: Parts priced on J-00970: 3 of 4", pricingDoneTitle("J-00970", { open: 1, done: 3, total: 4 }, false) === "Parts priced on J-00970: 3 of 4");
check("sent again after Edit: Prices updated on J-00970", pricingDoneTitle("J-00970", { open: 0, done: 4, total: 4 }, true) === "Prices updated on J-00970");
const body = pricingDoneBody({ by: "Peter", p: { done: 4, total: 4, openLines: [], notAvailable: 0 }, changes: ["ENGINE OIL: Advisor asked 1, Parts changed to 8 L"], estimate: true });
check("the body folds the changes in and says the next step", /4 of 4 parts priced by Peter\./.test(body) && /Changes: ENGINE OIL: Advisor asked 1, Parts changed to 8 L\./.test(body) && /check the estimate and send it/.test(body), body);
const body2 = pricingDoneBody({ by: "Peter", p: { done: 3, total: 4, openLines: [line("plug washer", "not_finished")], notAvailable: 1 }, sentQuotes: ["Q-00012"] });
check("the open lines are named, and a quotation already sent is pointed out", /Not priced yet: PLUG WASHER\./.test(body2) && /\(1 not available\)/.test(body2) && /Q-00012 was already sent/.test(body2), body2);
const body3 = pricingDoneBody({ by: "Peter", p: { done: 4, total: 4, openLines: [], notAvailable: 0 }, revised: "Q-00012 version 2" });
check("a revised version made by the changes is named", /Q-00012 version 2 is ready with the new prices/.test(body3));

// The job's state and what is held back.
const job = (status, done, reopened) => ({ status, parts_pricing_done_at: done, parts_pricing_reopened_at: reopened });
check("sent = done and not reopened", pricingSent(job("pending_quote", "2026-11-03T08:00:00Z", null)) && !pricingSent(job("pending_quote", "2026-11-03T08:00:00Z", "2026-11-03T09:00:00Z")) && !pricingSent(job("pending_quote", null, null)));
check("per-part notices wait while a send is expected (not sent before approval, or Edit pressed)", holdPerPartNotices(job("pending_quote", null, null)) && holdPerPartNotices(job("in_work", "a", "b")) && !holdPerPartNotices(job("pending_quote", "a", null)));
check("REVIEW: a car past approval never sent and never reopened holds NOTHING (nothing would ask for the send)", ["in_work", "pending_qc", "ready"].every((s) => !holdPerPartNotices(job(s, null, null)) && !awaitingSend(job(s, null, null))));
check("REVIEW: past approval, once reopened (additional work, a new part) the notices wait and the car waits for its send", holdPerPartNotices(job("in_work", null, "2026-11-03T10:00:00Z")) && jobPricingTodo(job("in_work", null, "2026-11-03T10:00:00Z"), { openRequests: 0, unpricedParts: 0, pricedSinceSend: 1 }) === "to_send");
check("after the customer's approval (planning) nothing is held: there is no button there", PLANNING_STATUSES.every((s) => !holdPerPartNotices(job(s, null, null))));
check("to-do: to price while a request is open or a part unpriced", jobPricingTodo(job("pending_quote", null, null), { openRequests: 1, unpricedParts: 0, pricedSinceSend: 0 }) === "to_price" && jobPricingTodo(job("pending_quote", null, null), { openRequests: 0, unpricedParts: 2, pricedSinceSend: 0 }) === "to_price");
check("to-do: priced but not sent = to send", jobPricingTodo(job("pending_quote", null, null), { openRequests: 0, unpricedParts: 0, pricedSinceSend: 3 }) === "to_send");
check("to-do: once sent with nothing open it leaves", jobPricingTodo(job("pending_quote", "a", null), { openRequests: 0, unpricedParts: 0, pricedSinceSend: 3 }) === null);
check("REVIEW: sent with 'Send what you have', the lines left open stay the desk's (To price)", jobPricingTodo(job("pending_quote", "a", null), { openRequests: 2, unpricedParts: 1, pricedSinceSend: 3 }) === "to_price");
check("REVIEW: a change held with nothing newly priced (not available, removed) still asks for the send", jobPricingTodo(job("pending_quote", null, "2026-11-03T10:00:00Z"), { openRequests: 0, unpricedParts: 0, pricedSinceSend: 0 }) === "to_send" && jobPricingTodo(job("pending_quote", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z"), { openRequests: 0, unpricedParts: 0, pricedSinceSend: 0 }) === "to_send");
check("REVIEW: an open request on an approved car that was sent is To price again", jobPricingTodo(job("waiting_parts", "2026-11-03T09:00:00Z", null), { openRequests: 1, unpricedParts: 0, pricedSinceSend: 0 }) === "to_price");
check("to-do: in planning only open requests count", jobPricingTodo(job("approved", null, null), { openRequests: 0, unpricedParts: 0, pricedSinceSend: 2 }) === null && jobPricingTodo(job("approved", null, null), { openRequests: 1, unpricedParts: 0, pricedSinceSend: 0 }) === "to_price");

const { pricingTodoOf } = P;
const priced = (at) => ({ is_active: true, confirm_status: "confirmed", order_status: "none", cost_aed: 100, priced_at: at });
check("from rows: an open request or a cost with no finished row is to price", pricingTodoOf(job("pending_quote", null, null), [{ status: "open" }], []) === "to_price" && pricingTodoOf(job("pending_quote", null, null), [], [{ ...priced(null), cost_aed: 50 }]) === "to_price");
check("from rows: every part priced, never sent = to send; sent = off the list", pricingTodoOf(job("pending_quote", null, null), [{ status: "done" }], [priced("2026-11-03T08:00:00Z")]) === "to_send" && pricingTodoOf(job("pending_quote", "2026-11-03T09:00:00Z", null), [], [priced("2026-11-03T08:00:00Z")]) === null);
check("from rows: Edit after the send, a part priced again = to send", pricingTodoOf(job("pending_quote", "2026-11-03T09:00:00Z", "2026-11-03T09:30:00Z"), [], [priced("2026-11-03T09:40:00Z")]) === "to_send");
check("from rows: an ordered, removed or rejected part never counts", pricingTodoOf(job("pending_quote", null, null), [], [{ ...priced(null), order_status: "ordered", cost_aed: null }, { ...priced(null), removed_at: "x", cost_aed: null }, { ...priced(null), confirm_status: "rejected", cost_aed: null }]) === null);
check("from rows: a part left off an approved quotation never keeps an in-work car on the list", pricingTodoOf(job("in_work", null, null), [], [priced("2026-11-01T08:00:00Z")]) === null);

// Estimates.
const sent = "2026-11-02T06:50:00Z";
check("a line's moment is its latest desk event (an advisor's later quantity change is not one)", estimateLineMoment({ unit_cost: 165, price_requested_at: "2026-11-02T05:59:00Z", priced_at: "2026-11-02T06:44:00Z", price_checked_at: "2026-11-02T06:45:00Z", quantity_changed_at: "2026-11-02T07:45:00Z" }) === "2026-11-02T06:45:00Z");
const lines = [
  { unit_cost: 165, price_requested_at: "2026-11-02T05:59:00Z", priced_at: "2026-11-02T06:44:00Z" },
  { unit_cost: 53, price_requested_at: "2026-11-02T05:59:00Z", priced_at: "2026-11-02T06:45:00Z" },
  { unit_cost: null, price_requested_at: "2026-11-02T06:43:00Z" },
  { unit_cost: 80, price_requested_at: null, priced_at: "2026-11-02T05:51:00Z", priced_by_advisor: true, price_checked_at: null },
];
const before = estimateDeskTodo(lines, null, true);
check("before the send: 1 to price, 1 advisor price to check, 2 priced not sent", before.toPrice === 1 && before.toCheck === 1 && before.pricedNotSent === 2, JSON.stringify(before));
const after = estimateDeskTodo(lines, sent, true);
check("REVIEW: after a send with lines still open (Send what you have) those stay listed; the priced ones leave", after.toPrice === 1 && after.toCheck === 1 && after.pricedNotSent === 0, JSON.stringify(after));
const full = estimateDeskTodo(lines.slice(0, 2), sent, true);
check("after a full send: nothing (the estimate leaves the list)", full.toPrice === 0 && full.toCheck === 0 && full.pricedNotSent === 0, JSON.stringify(full));
const half = estimateDeskTodo([{ unit_cost: 165, price_requested_at: "2026-11-02T05:59:00Z", priced_at: null }], null, false);
check("REVIEW: a half-typed line (a cost, no finished row) is still to price, with or without the send stamp", half.toPrice === 1 && half.pricedNotSent === 0 && estimateDeskTodo([{ unit_cost: 165, price_requested_at: "2026-11-02T05:59:00Z", priced_at: null }], sent, true).toPrice === 1);
const checked = estimateDeskTodo([{ unit_cost: 80, price_requested_at: null, priced_at: "2026-11-02T05:51:00Z", priced_by_advisor: true, price_checked_at: "2026-11-02T07:20:00Z" }], sent, true);
check("an advisor's price checked after the send waits to be sent", checked.toCheck === 0 && checked.pricedNotSent === 1);
const again = estimateDeskTodo([...lines.slice(0, 2), { unit_cost: null, price_requested_at: "2026-11-02T07:10:00Z" }], sent, true);
check("a part sent to the desk after it puts the estimate back on the list", again.toPrice === 1 && again.pricedNotSent === 0);
const old = estimateDeskTodo(lines, null, false);
check("without a known send: priced lines never keep it listed, open ones do", old.toPrice === 1 && old.toCheck === 1 && old.pricedNotSent === 0);
check("a left-off line never counts", estimateDeskTodo([{ unit_cost: null, price_requested_at: "x", left_off: true }], null, true).toPrice === 0);

// Review of 3 November 2026: "Price is right ✓" on the advisor's own price (a cost and a supplier only) makes the line
// priced on the bar and in the advisor's notification, as on the desk's list and in his editor.
const R = await import("../../src/lib/parts-rows.ts");
const advisorRow = { part_number: "", part_type: "", brand: "", list_price: "", discount: "", cost_aed: "80", supplier: "Gargash", availability: "", days: "", qty: "1" };
check("an advisor's price waiting for the check is not finished", R.rowState({ ...advisorRow, advisor_price: "1" }) === "not_finished");
check("an advisor's price the desk checked is priced (no part number, type or availability asked of him)", R.rowState({ ...advisorRow, advisor_price: "checked" }) === "priced");
check("a checked advisor price still needs its cost and supplier", R.rowState({ ...advisorRow, cost_aed: "", advisor_price: "checked" }) === "not_finished" && R.rowState({ ...advisorRow, supplier: "", advisor_price: "checked" }) === "not_finished");
check("the desk's own price still needs the whole row", R.rowState(advisorRow) === "not_finished");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll pricing-done checks passed");
process.exit(failed ? 1 : 0);
