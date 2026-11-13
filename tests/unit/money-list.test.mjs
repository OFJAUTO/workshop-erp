// Section 4 of 2 November 2026 (built 3 November): Invoices and payments shows every job with money paid or owed. The
// pure rules: the chips' filters, the tiles made from the rows (each one the sum of the list behind it), the collected
// rule (cheques on the day they clear), the dashboard's groups, the advance chip and the one "Paid so far · Balance" line.
//   node --import ./tests/unit/register.mjs tests/unit/money-list.test.mjs        (npm run test:unit)
const L = await import("../../src/lib/money-list.ts");
const S = await import("../../src/lib/money-steps.ts");
const { MONEY_FILTERS, inFilter, moneyTilesOf, countsAsCollected, collectedAt, awaitingGroupOf, rowMatches, paidSoFarParts, chipCountOf, recentlyPaid, creditTakenOff, RECENT_PAID_DAYS, RECENT_PAID_HINT } = L;
const { moneyState, advanceWords } = S;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const NOW = Date.parse("2026-11-03T10:00:00+04:00");
const doc = (number, kind, extra = {}) => ({ id: number, number, kind, issued_at: "2026-11-02T08:00:00Z", sent_at: null, converted_to: null, token: null, total_aed: 0, ...extra });
/** A row as the server builds it: the state from moneyState, the rest given. */
function row(over) {
  const r = { kind: "job", key: over.key, href: "", jobId: over.key, jobNumber: over.key, jobStatus: "in_work", isOpen: true, plate: "Dubai S 30303", car: "", customer: "C", customerId: "c", pictureUrl: null, proforma: null, taxInvoice: null, docNumber: null, total: null, paid: 0, balance: null, pendingCheque: 0, credited: 0, recentPaidOnly: false, advance: 0, paidToday: 0, paidTodayCount: 0, taxToday: [], issuedAt: "", lastAt: "", paidAt: null, reportedBy: null, ageDays: 0, what: null, ...over };
  const live = r.taxInvoice ?? r.proforma;
  r.state = over.state ?? moneyState({ jobStatus: r.jobStatus, isOpen: r.isOpen, gatedOutAt: null, proforma: r.proforma, taxInvoice: r.taxInvoice, total: live ? r.total ?? 0 : 0, paid: live ? r.paid : 0, balance: live ? r.balance ?? 0 : 0, chequePending: r.pendingCheque, needsInvoice: !live && r.total !== null, now: NOW, advance: live ? null : { paid: r.paid, left: r.balance } });
  return r;
}

// The owner's day: AED 30,000 on J-00969 in work (an advance before the proforma) and AED 8,000 from a second customer.
const j969 = row({ key: "J-00969", total: 67930, paid: 30000, balance: 37930, advance: 30000, paidToday: 30000, paidTodayCount: 1 });
const credit = row({ kind: "credit", key: "credit:b", total: null, paid: 8000, balance: null, paidToday: 8000, paidTodayCount: 1, state: { current: "payment", done: [], chip: { text: "Credit", tone: "amber" }, action: "none", actionLabel: "", waitingHours: null, live: null } });
const advance2 = row({ key: "J-2", total: 12600, paid: 8000, balance: 4600, advance: 8000, paidToday: 8000, paidTodayCount: 1 });
const sentPart = row({ key: "J-3", jobStatus: "ready", proforma: doc("PRO-1", "proforma", { sent_at: "2026-11-02T09:00:00Z", total_aed: 3150 }), total: 3150, paid: 1600, balance: 1550, pendingCheque: 500, paidToday: 1600, paidTodayCount: 2 });
const taxUnpaid = row({ key: "J-4", jobStatus: "pending_payment", taxInvoice: doc("INV-1", "tax_invoice", { total_aed: 2205 }), total: 2205, paid: 0, balance: 2205, taxToday: ["INV-1"] });
const leftOwing = row({ key: "J-5", isOpen: false, jobStatus: "closed", taxInvoice: doc("INV-0", "tax_invoice", { total_aed: 3150, sent_at: "2026-11-01T09:00:00Z" }), total: 3150, paid: 1000, balance: 2150 });
const paidOpen = row({ key: "J-6", jobStatus: "ready", taxInvoice: doc("INV-2", "tax_invoice", { total_aed: 500 }), total: 500, paid: 500, balance: 0, paidToday: 500, paidTodayCount: 1, taxToday: ["INV-2"] });
const inWorkNothing = row({ key: "J-7", total: 4000, paid: 0, balance: 4000 });
const charge = row({ kind: "charge", key: "charge:e", total: 630, paid: 0, balance: 630, docNumber: "PRO-9", state: { current: "payment", done: [], chip: { text: "Pending charge", tone: "amber" }, action: "none", actionLabel: "", waitingHours: null, live: null } });
const noTotal = row({ key: "J-8", total: null, paid: 0, balance: null, jobStatus: "ready" });
const rows = [j969, credit, advance2, sentPart, taxUnpaid, leftOwing, paidOpen, inWorkNothing, charge, noTotal];
const keysOf = (k) => rows.filter((r) => inFilter(k, r)).map((r) => r.key).sort().join(",");

// 4.1 every job with money appears, with the right figures, in the right lists.
check("Part paid includes the advances (no proforma yet) as well as part-paid documents and a car that left owing", keysOf("part") === ["J-00969", "J-2", "J-3", "J-5"].sort().join(","), keysOf("part"));
check("Awaiting payment = every balance due on approved work, whatever the step (credit never)", keysOf("awaiting") === ["J-00969", "J-2", "J-3", "J-4", "J-5", "J-7", "charge:e"].sort().join(","), keysOf("awaiting"));
check("Collected today = every row with money in today (job, credit, a paid invoice)", keysOf("today") === ["J-00969", "credit:b", "J-2", "J-3", "J-6"].sort().join(","), keysOf("today"));
check("Advance, no proforma yet = jobs with money before a document", keysOf("advance") === ["J-00969", "J-2"].sort().join(","), keysOf("advance"));
check("Customer credit = the credit rows only", keysOf("credit") === "credit:b");
check("Paid = a total, nothing left, money in", keysOf("paid") === "J-6", keysOf("paid"));
check("Tax invoices today = the rows with a tax invoice issued today", keysOf("tax_today") === ["J-4", "J-6"].sort().join(","), keysOf("tax_today"));
check("Released = a job that left", keysOf("released") === "J-5", keysOf("released"));
check("a car that left owing says so (amber), not a green 'Released'", leftOwing.state.chip.text === "Left owing · AED 2,150 due" && leftOwing.state.chip.tone === "amber", leftOwing.state.chip.text);
check("a car that left paid in full stays 'Released' (green)", row({ key: "J-12", isOpen: false, jobStatus: "closed", taxInvoice: doc("INV-3", "tax_invoice", { total_aed: 100 }), total: 100, paid: 100, balance: 0 }).state.chip.text === "Released");
check("Proformas / Tax invoices follow the documents", keysOf("proforma") === "J-3" && keysOf("tax") === ["J-4", "J-5", "J-6"].sort().join(","));
check("All = every row", rows.every((r) => inFilter("", r)));
check("fourteen chips (3 November: Auth code missing; 13 November: Proformas waiting for payment), All first", MONEY_FILTERS.length === 14 && MONEY_FILTERS.some((f) => f.key === "proforma_waiting") && MONEY_FILTERS.some((f) => f.key === "auth_missing") && MONEY_FILTERS[0].key === "" && MONEY_FILTERS.some((f) => f.key === "today") && MONEY_FILTERS.some((f) => f.key === "tax_today"));

// 4.2 every tile equals the sum of the list behind it; the counts match.
const t = moneyTilesOf(rows);
const sum = (k, f) => Math.round(rows.filter((r) => inFilter(k, r)).reduce((a, r) => a + f(r), 0) * 100) / 100;
check("Awaiting tile = sum of the awaiting list's balances, count = its rows", t.awaitingAed === sum("awaiting", (r) => r.balance ?? 0) && t.awaitingCount === rows.filter((r) => inFilter("awaiting", r)).length, `${t.awaitingAed} / ${t.awaitingCount}`);
check("the owner's figures: Awaiting holds J-00969's AED 37,930 (it was AED 0 · 0 cars)", t.awaitingAed === 37930 + 4600 + 1550 + 2205 + 2150 + 4000 + 630);
check("Awaiting splits into due now (sent, left, pending charge) and work in progress", t.dueNowAed === 1550 + 2205 + 2150 + 630 && t.wipAed === Math.round((t.awaitingAed - t.dueNowAed) * 100) / 100, `${t.dueNowAed} / ${t.wipAed}`);
check("Collected today tile = sum of the today list (AED 30,000 + 8,000 + 8,000 + 1,600 + 500)", t.todayAed === sum("today", (r) => r.paidToday) && t.todayAed === 48100, String(t.todayAed));
check("Collected today counts: rows and payments", t.todayCount === 5 && t.todayPayments === 6);
check("Part paid tile figures = its list", t.partCount === 4 && t.partAed === sum("part", (r) => r.balance ?? 0));
check("Tax invoices today = the invoices on its list", t.taxTodayCount === 2);
check("the Awaiting tile knows how much of it is pending charges (the dashboard's one line)", t.awaitingChargeCount === 1 && t.awaitingChargeAed === 630);
// Review of 3 November: one car with two tax invoices today - the chip counts invoices like the tile; every other chip counts rows.
const twoTax = row({ key: "J-13", jobStatus: "pending_payment", taxInvoice: doc("INV-5", "tax_invoice", { total_aed: 105 }), total: 105, paid: 0, balance: 105, taxToday: ["INV-5", "INV-6"] });
check("the Tax invoices today chip counts the invoices (2 on one car), the tile the same", chipCountOf("tax_today", [twoTax, taxUnpaid]) === 3 && moneyTilesOf([twoTax, taxUnpaid]).taxTodayCount === 3 && chipCountOf("awaiting", [twoTax, taxUnpaid]) === 2);
check("no rows, no money", JSON.stringify(moneyTilesOf([])) === JSON.stringify({ awaitingCount: 0, awaitingAed: 0, awaitingChargeCount: 0, awaitingChargeAed: 0, dueNowAed: 0, wipAed: 0, partCount: 0, partAed: 0, todayCount: 0, todayAed: 0, todayPayments: 0, taxTodayCount: 0 }));

// The collected rule (B): received day for money, clearing day for cheques.
const from = "2026-11-02T20:00:00.000Z"; // Dubai midnight, 3 November
const p = (o) => ({ status: "recorded", is_active: true, method: "cash", cheque_status: null, received_at: "2026-11-03T05:00:00+00:00", cleared_at: null, ...o });
check("cash received today counts", countsAsCollected(p({}), from));
check("cash received yesterday does not", !countsAsCollected(p({ received_at: "2026-11-02T19:59:59+00:00" }), from));
check("a cheque received yesterday and cleared today counts today", countsAsCollected(p({ method: "cheque", cheque_status: "cleared", received_at: "2026-11-02T08:00:00+00:00", cleared_at: "2026-11-03T06:00:00+00:00" }), from));
check("a cheque received today and still pending does not count", !countsAsCollected(p({ method: "cheque", cheque_status: "pending" }), from));
check("a cheque received today that cleared yesterday? never (cleared after received): the clearing day decides", collectedAt(p({ method: "cheque", cheque_status: "cleared", cleared_at: "2026-11-03T07:00:00+00:00" })) === "2026-11-03T07:00:00+00:00");
check("a bounced cheque, a voided or an inactive payment never count", !countsAsCollected(p({ method: "cheque", cheque_status: "bounced" }), from) && !countsAsCollected(p({ status: "voided" }), from) && !countsAsCollected(p({ is_active: false }), from) && !countsAsCollected(p({ status: "pending_owner" }), from));
check("a cleared cheque with no clearing time falls back to its received time", collectedAt(p({ method: "cheque", cheque_status: "cleared", cleared_at: null })) === "2026-11-03T05:00:00+00:00");
check("the window's end is excluded; the time formats compare as instants (Z and +00:00)", !countsAsCollected(p({ received_at: "2026-11-03T20:00:00+00:00" }), from, "2026-11-03T20:00:00.000Z") && countsAsCollected(p({ received_at: "2026-11-02T20:00:00+00:00" }), from));

// The dashboard's groups and the advance chip.
check("groups: advance in work / nothing paid / to send / due now", awaitingGroupOf(j969) === "wip_advance" && awaitingGroupOf(inWorkNothing) === "wip_nothing" && awaitingGroupOf(sentPart) === "due_now" && awaitingGroupOf(taxUnpaid) === "due_now" && awaitingGroupOf(leftOwing) === "due_now" && awaitingGroupOf(charge) === "due_now");
const unsent = row({ key: "J-9", jobStatus: "ready", proforma: doc("PRO-2", "proforma", { total_aed: 900 }), total: 900, paid: 0, balance: 900 });
check("a proforma not sent yet, or a Ready car with no proforma: to send or prepare", awaitingGroupOf(unsent) === "to_send" && awaitingGroupOf(row({ key: "J-10", jobStatus: "ready", total: 500, paid: 0, balance: 500 })) === "to_send");
check("the advance chip: 'Advance AED 30,000 · AED 37,930 to pay' (amber, nothing to do while in work)", j969.state.chip.text === "Advance AED 30,000 · AED 37,930 to pay" && j969.state.chip.tone === "amber" && j969.state.action === "none", j969.state.chip.text);
check("at Ready the advance chip keeps 'Prepare the proforma' as the action", row({ key: "J-11", jobStatus: "ready", total: 1000, paid: 400, balance: 600 }).state.action === "prepare_proforma");
check("without an advance nothing changes (backwards compatible)", inWorkNothing.state.chip.text === "Work in progress" && moneyState({ jobStatus: "ready", isOpen: true, gatedOutAt: null, proforma: null, taxInvoice: null, total: 0, paid: 0, balance: 0, chequePending: 0, needsInvoice: true }).chip.text === "Proforma to prepare");
check("advance words: paid in full, and no total yet", advanceWords(500, 0) === "Advance AED 500 · paid in full" && advanceWords(500, null) === "Advance AED 500");

// The one line, and the search.
const line = paidSoFarParts({ total: 67930, paid: 30000, balance: 37930, pendingCheque: 500 });
check("Paid so far · Balance in the one wording", line.total === "Total AED 67,930.00" && line.paid === "Paid so far AED 30,000.00" && line.balance === "Balance AED 37,930.00" && line.balanceTone === "due" && line.cheque === "cheque AED 500.00 clearing");
check("Paid in full / No approved total yet", paidSoFarParts({ total: 500, paid: 500, balance: 0 }).balance === "Paid in full" && paidSoFarParts({ total: null, paid: 100, balance: null }).balance === "No approved total yet");
check("the search finds a plate written either way, a job and a document number", rowMatches(j969, "dubai s 30303") && rowMatches(j969, "s30303") && rowMatches(j969, "J-00969") && rowMatches(sentPart, "pro-1") && !rowMatches(j969, "zzz"));

// Review of 3 November: cars that left paid in full stay on the list without dates for RECENT_PAID_DAYS, counted in no tile.
check("recently paid: inside the window yes, outside no, nothing never", RECENT_PAID_DAYS === 30 && recentlyPaid("2026-10-10T10:00:00+04:00", NOW) && !recentlyPaid("2026-10-01T10:00:00+04:00", NOW) && !recentlyPaid(null, NOW));
check("the hint names the window and how to find older ones", RECENT_PAID_HINT.includes("last 30 days") && RECENT_PAID_HINT.includes("search or enter dates"));
const paidLeft = row({ key: "J-14", isOpen: false, jobStatus: "closed", recentPaidOnly: true, taxInvoice: doc("INV-7", "tax_invoice", { total_aed: 800 }), total: 800, paid: 800, balance: 0 });
check("a recently paid car that left: Paid, Tax invoices, Released; never Awaiting, Part paid or Today; no tile moves", inFilter("paid", paidLeft) && inFilter("tax", paidLeft) && inFilter("released", paidLeft) && !inFilter("awaiting", paidLeft) && !inFilter("part", paidLeft) && !inFilter("today", paidLeft) && JSON.stringify(moneyTilesOf([...rows, paidLeft])) === JSON.stringify(t));
// Review of 3 November: credit notes take off what is owed (less any refund paid out on them).
const cn = (o) => ({ kind: "credit_note", status: "issued", is_active: true, credit_of: "INV-X", total_aed: 1050, refund_amount_aed: null, refund_paid_at: null, ...o });
check("a credit note of AED 1,050 takes AED 1,050 off its invoice", creditTakenOff("INV-X", [cn({})]) === 1050);
check("two notes add up; another invoice's note, a cancelled or inactive one, or a proforma never count", creditTakenOff("INV-X", [cn({}), cn({ total_aed: "210.00" }), cn({ credit_of: "INV-Y" }), cn({ status: "cancelled" }), cn({ is_active: false }), cn({ kind: "proforma" })]) === 1260);
check("a note refunded to the customer in money no longer lowers the invoice (a part refund only partly)", creditTakenOff("INV-X", [cn({ refund_paid_at: "2026-11-03T08:00:00Z", refund_amount_aed: 1050 })]) === 0 && creditTakenOff("INV-X", [cn({ refund_paid_at: "2026-11-03T08:00:00Z", refund_amount_aed: 50 })]) === 1000 && creditTakenOff("INV-X", [cn({ refund_amount_aed: 1050 })]) === 1050);
const cl = paidSoFarParts({ total: 10500, paid: 9450, balance: 0, credited: 1050 });
check("the one line names the credit note: 'credit note AED 1,050.00 off' and Paid in full", cl.credit === "credit note AED 1,050.00 off" && cl.balance === "Paid in full" && paidSoFarParts({ total: 1, paid: 1, balance: 0 }).credit === null);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
