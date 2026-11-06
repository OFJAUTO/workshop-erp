// Section 11 of 2 November 2026 (built 3 November): Zoho Books on MANUAL. The pure rules: the mode (a missing setting is
// manual), the posting order across the whole list, the preview (held for undo, being sent, capped, the groups and
// their totals), the results words, the rate-limit stop, the reminder's once-a-working-day rule and its words, and the
// reconciliation's "this day still waits for Sync to Zoho".
//   node --import ./tests/unit/register.mjs tests/unit/zoho-sync-rules.test.mjs        (npm run test:unit)
const R = await import("../../src/lib/zoho-sync-rules.ts");
const { syncModeOf, kindWord, kindCount, itemsWord, sortForPosting, buildPreview, confirmLabel, tallyItems, runWords, mergeItems, isRateLimitError, reminderDue, reminderWords, dubaiClock, dayWaitsForSync, manualCronWords, resultWords, POSTING_ORDER, PREVIEW_GROUPS, RUN_CAP_TEST_ROWS, KIND_WORDS, ZOHO_KINDS } = R;
const { rowEffect, effectOfRow, doneOutcome, sendsOnPress, stuckWords, retryRefusal, reconDue, reconDaysDue, reconRunWords, RATE_LIMIT_WORDS, ACCOUNTS_WAIT_WORDS, SENDS_ON_PRESS_FILTER, RECON_DAYS_PER_RUN } = R;
const { reasonHref, waitingTurnWords } = R;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// 11.1 / 11.5: the mode. Nothing ever posts by itself unless the owner chose "automatic".
check("a missing setting is manual", syncModeOf(undefined) === "manual" && syncModeOf(null) === "manual" && syncModeOf("") === "manual");
check("only the exact word 'automatic' is automatic", syncModeOf("automatic") === "automatic" && syncModeOf("Automatic") === "manual" && syncModeOf(true) === "manual" && syncModeOf("manual") === "manual");

// Words.
check("every kind has its words, and every kind has a posting rank", ZOHO_KINDS.length === 14 && ZOHO_KINDS.every((k) => KIND_WORDS[k] && typeof POSTING_ORDER[k] === "number"));
check("kind words read as the sync page always did", kindWord("invoice") === "Tax invoice" && kindWord("billpayment") === "Supplier payment" && kindWord("nonsense") === "Document");
check("counts in a sentence: one and many", kindCount("invoice", 1) === "1 tax invoice" && kindCount("invoice", 5) === "5 tax invoices" && kindCount("settlement", 2) === "2 card settlements");
check("items: 1 item / 12 items", itemsWord(1) === "1 item" && itemsWord(12) === "12 items" && itemsWord(0) === "0 items");
check("every kind sits in exactly one preview group", ZOHO_KINDS.every((k) => PREVIEW_GROUPS.filter((g) => g.kinds.includes(k)).length === 1));

// The posting order covers the WHOLE list (the cron's batches only sorted 25 at a time): parents before children.
const t0 = "2026-11-03T05:00:00.000Z";
const at = (min) => new Date(Date.parse(t0) + min * 60000).toISOString();
const sorted = sortForPosting([
  { id: "p1", kind: "payment", enqueued_at: at(1) },
  { id: "bp", kind: "billpayment", enqueued_at: at(0) },
  { id: "i2", kind: "invoice", enqueued_at: at(5) },
  { id: "c1", kind: "contact", enqueued_at: at(9) },
  { id: "i1", kind: "invoice", enqueued_at: at(2) },
  { id: "b1", kind: "bill", enqueued_at: at(8) },
  { id: "d1", kind: "deposit", enqueued_at: at(7) },
]);
check("customers first, deposits before invoices, invoices before payments, the bill before its payment; oldest first inside a kind", sorted.map((r) => r.id).join(",") === "c1,d1,i1,i2,p1,b1,bp", sorted.map((r) => r.id).join(","));

// The preview.
const NOW = Date.parse("2026-11-03T06:00:00.000Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const row = (id, kind, amount, extra = {}) => ({ id, kind, record_id: `r-${id}`, enqueued_at: ago(60), last_error: null, claimed_at: null, name: `${kind} ${id}`, amount, ...extra });
const pending = [
  row("inv1", "invoice", 1050),
  row("inv2", "invoice", 2205.5),
  row("pay1", "payment", 1000),
  row("dep1", "deposit", 500),
  row("payNew", "payment", 300, { enqueued_at: ago(3) }), // inside the 10-minute undo window
  row("bill1", "bill", 840),
  row("bp1", "billpayment", 840, { last_error: "Waiting for the bill of LPO-00012 to reach Zoho first." }),
  row("st1", "settlement", 9815.2),
  row("com1", "commission", 250),
  row("rec1", "recovery", 400),
  row("cust1", "contact", null),
  row("busy1", "invoice", 99, { claimed_at: ago(2) }), // another run is sending it now
  row("stale1", "invoice", 10, { claimed_at: ago(30) }), // a dead run's claim: free again
];
const p = buildPreview(pending, { undoMinutes: 10, now: NOW });
const g = (k) => p.groups.find((x) => x.key === k);
check("the run sends every free row except the held one and the one being sent", p.ids.length === 11 && !p.ids.includes("payNew") && !p.ids.includes("busy1") && p.ids.includes("stale1"), p.ids.join(","));
check("the run's ids are in posting order (the customer record first)", p.ids[0] === "cust1" && p.ids.indexOf("dep1") < p.ids.indexOf("inv1") && p.ids.indexOf("inv1") < p.ids.indexOf("pay1") && p.ids.indexOf("bill1") < p.ids.indexOf("bp1"), p.ids.join(","));
check("tax invoices: 3, with their total", g("invoices")?.count === 3 && g("invoices")?.total === 3265.5, JSON.stringify(g("invoices")));
check("payments and deposits counted together (the held one not in it)", g("payments")?.count === 2 && g("payments")?.total === 1500, JSON.stringify(g("payments")));
check("supplier bills, supplier payments, card settlements, expenses each their own line", g("bills")?.total === 840 && g("billpayments")?.total === 840 && g("settlements")?.total === 9815.2 && g("expenses")?.count === 2 && g("expenses")?.total === 650);
check("records are counted, never totalled", g("records")?.count === 1 && g("records")?.total === 0 && g("records")?.countOnly === true);
check("money in = payments and deposits; money out = supplier payments and expenses", p.moneyIn === 1500 && p.moneyOut === 1490, `${p.moneyIn} / ${p.moneyOut}`);
check("the held payment is named with when it can go", p.held.count === 1 && /1 payment recorded in the last 10 minutes/.test(p.held.words ?? "") && p.held.nextAt === new Date(Date.parse(ago(3)) + 10 * 60000).toISOString(), JSON.stringify(p.held));
check("one row being sent by another run is counted apart", p.beingSent === 1);
check("a row tried before keeps its reason in the preview", p.rows.find((r) => r.id === "bp1")?.reason?.startsWith("Waiting for the bill"));
check("groups come in the owner's order (invoices first, records last)", p.groups[0].key === "invoices" && p.groups[p.groups.length - 1].key === "records");
check("about N Zoho calls (rough, for OFJ TEST's daily allowance)", p.calls > 11 && p.calls < 11 * 8, String(p.calls));
check("an empty queue previews nothing", buildPreview([], { now: NOW }).ids.length === 0 && buildPreview([], { now: NOW }).groups.length === 0);
const many = Array.from({ length: RUN_CAP_TEST_ROWS + 30 }, (_, i) => row(`x${i}`, "invoice", 1));
const capped = buildPreview(many, { now: NOW, cap: RUN_CAP_TEST_ROWS });
check("OFJ TEST: one press sends at most the cap, the rest is named for later", capped.ids.length === RUN_CAP_TEST_ROWS && capped.later === 30);
check("the REAL book has no cap", buildPreview(many, { now: NOW, cap: null }).later === 0);
check("the confirm button names the action and the book", confirmLabel(12, "OFJ TEST") === "Yes, sync and record 12 items to OFJ TEST" && confirmLabel(1, "OFJ TEST") === "Yes, sync and record 1 item to OFJ TEST");

// Results.
const items = [
  { id: "a", kind: "invoice", record_id: "x", outcome: "posted", words: null, at: t0 },
  { id: "b", kind: "payment", record_id: "y", outcome: "failed", words: "Mapping missing: Cash", at: t0 },
  { id: "c", kind: "bill", record_id: "z", outcome: "waiting", words: "Waits for the invoice", at: t0 },
];
check("the tally counts posted, removed, skipped, failed and waiting", JSON.stringify(tallyItems(items)) === JSON.stringify({ posted: 1, removed: 0, skipped: 0, failed: 1, waiting: 1 }));
check("the results line leaves out a zero part", runWords({ posted: 12, failed: 1, waiting: 2 }) === "12 posted · 1 failed · 2 still waiting" && runWords({ posted: 3, failed: 0, waiting: 0 }) === "3 posted" && runWords({ posted: 0, failed: 0, waiting: 0 }) === "Nothing sent");
check("a removal and a closed row are never counted as posted", runWords({ posted: 2, removed: 1, skipped: 1, failed: 0, waiting: 0 }) === "2 posted · 1 removed from Zoho · 1 closed, nothing sent" && runWords({ posted: 0, removed: 0, skipped: 2, failed: 0, waiting: 0 }) === "2 closed, nothing sent");
check("a handler's answer: posted, removed (reversed) or skipped", doneOutcome({ zoho: { total: 1 } }) === "posted" && doneOutcome({ reversed: "removed from Zoho" }) === "removed" && doneOutcome({ skipped: "Voided in the ERP before it was posted. Nothing went to Zoho." }) === "skipped" && doneOutcome(null) === "posted");
check("a removed receipt reads as a removal, not as a payment", resultWords("payment", { receipt: "RCT-00040", reversed: "removed from Zoho", reason: "wrong amount" }) === "Removed from Zoho: RCT-00040 (wrong amount).", resultWords("payment", { receipt: "RCT-00040", reversed: "removed from Zoho", reason: "wrong amount" }));
check("a removed supplier payment never reads \"Paid in Zoho · the bill shows AED 0.00 due\"", resultWords("billpayment", { lpo: "LPO-00012-1", reversed: "removed from Zoho" }) === "Removed from Zoho: the supplier payment of LPO-00012-1 (taken back in the ERP)." && /^Already removed in Zoho/.test(resultWords("billpayment", { lpo: "LPO-1", reversed: "already removed in Zoho" }) ?? ""));
const merged = mergeItems(items, [{ id: "b", kind: "payment", record_id: "y", outcome: "posted", words: "Payment in Zoho: AED 1,000.00", at: t0 }]);
check("a Retry replaces the row's outcome in the list (the name kept)", merged.length === 3 && merged.find((i) => i.id === "b").outcome === "posted" && tallyItems(merged).failed === 0);
check("Zoho's call allowance used up is a stop, not a failure", isRateLimitError("Zoho said: You have exceeded the maximum call rate limit of 1000") && isRateLimitError("Zoho said: HTTP 429") && !isRateLimitError("Zoho said: Invoice number already exists"));
check("a test stand-in's posted row reads as such", resultWords("invoice", { e2e: true, e2e_stub: "post" }) === "Posted (test server: no Zoho call)");
check("posted figures keep their words (the sync page's resultWords moved here)", /^In Zoho: AED 1,050.00 · VAT AED 50.00/.test(resultWords("invoice", { zoho: { total: 1050, vat: 50, balance: 0 } }) ?? ""));

// 11.4: the reminder, once a working day from opening time.
const dubai = (date, hh, mm = 0) => Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+04:00`);
const base = { mode: "manual", openHour: 8, closeHour: 17, workingDays: ["mon", "tue", "wed", "thu", "fri", "sat"], toldToday: false, waiting: 12, blocked: null };
check("Tuesday 08:05: due", reminderDue({ ...base, nowMs: dubai("2026-11-03", 8, 5) }).due === true);
check("Tuesday 07:30 (before opening): not yet", reminderDue({ ...base, nowMs: dubai("2026-11-03", 7, 30) }).reason === "Before opening time.");
check("Tuesday 17:10 (after closing): not today", reminderDue({ ...base, nowMs: dubai("2026-11-03", 17, 10) }).reason === "After closing time.");
check("Sunday (not a working day): never", reminderDue({ ...base, nowMs: dubai("2026-11-08", 9) }).reason === "Not a working day.");
check("already told today: never twice", reminderDue({ ...base, toldToday: true, nowMs: dubai("2026-11-03", 9) }).reason === "Already told today.");
check("nothing waiting: no bell", reminderDue({ ...base, waiting: 0, nowMs: dubai("2026-11-03", 9) }).due === false);
check("automatic mode: no bell", reminderDue({ ...base, mode: "automatic", nowMs: dubai("2026-11-03", 9) }).due === false);
check("the sync cannot run (posting stopped): no bell", reminderDue({ ...base, blocked: "Posting to the REAL book is stopped", nowMs: dubai("2026-11-03", 9) }).due === false);
check("Dubai clock: 23:30 UTC on Monday is Tuesday 03:30 in Dubai", (() => { const c = dubaiClock(Date.parse("2026-11-02T23:30:00Z")); return c.date === "2026-11-03" && c.hour === 3 && c.dayId === "tue"; })());
const words = reminderWords({ total: 12, byKind: { payment: 4, invoice: 5, bill: 2, settlement: 1 }, red: 1 });
check("the bell's title is the owner's words", words.title === "12 items waiting to sync to Zoho", words.title);
check("the body lists the kinds in posting order, then the red rows, then what to do", words.body === "5 tax invoices · 4 payments · 2 supplier bills · 1 card settlement. 1 red row needs a look. Open Zoho Books and press Sync to Zoho: check the preview, then Yes.", words.body);
check("one item: singular", reminderWords({ total: 1, byKind: { invoice: 1 }, red: 0 }).title === "1 item waiting to sync to Zoho");
check("the cron's line on manual", manualCronWords({ total: 12, red: 1 }) === "Manual: 12 items waiting for Sync to Zoho · 1 red" && manualCronWords({ total: 0, red: 0 }) === "Manual: nothing waiting");

// The reconciliation on manual: a day is compared only once nothing from before its end waits unsent.
check("yesterday ends after the oldest unsent row: it waits for Sync to Zoho", dayWaitsForSync("2026-11-02", "2026-11-02T10:00:00+04:00") === true);
check("a day that ended before the oldest unsent row is compared", dayWaitsForSync("2026-11-01", "2026-11-02T10:00:00+04:00") === false);
check("nothing unsent: every day is compared", dayWaitsForSync("2026-11-02", null) === false);
check("the boundary: a row queued right at midnight belongs to the next day", dayWaitsForSync("2026-11-02", "2026-11-03T00:00:00+04:00") === false);

/* ---------------- Review of 3 November 2026 ---------------- */

// 1. What a row does: only a FIRST post is new money in the preview.
check("effect: a document not in Zoho yet is a first post", rowEffect({ inZoho: false }).effect === "new");
check("effect: a receipt voided before the press: nothing goes", rowEffect({ inZoho: false, gone: true, removable: true }).effect === "nothing");
check("effect: a receipt voided after it reached Zoho: taken back out", rowEffect({ inZoho: true, gone: true, removable: true }).effect === "removal");
check("effect: a late proof on a posted voucher: already in Zoho", rowEffect({ inZoho: true }).effect === "again");
check("effect: an invoice cancelled after it reached Zoho: no money, red by hand", rowEffect({ inZoho: true, gone: true }).effect === "again" && /by hand/.test(rowEffect({ inZoho: true, gone: true }).words ?? ""));
check("effect: a deposit document or a main LPO never goes", rowEffect({ inZoho: false, notForZoho: "a deposit document" }).effect === "nothing");
check("effect: the outbox row's own Zoho id means already in Zoho", effectOfRow({ zoho_id: "123" }) === "again" && effectOfRow({ effect: "removal", zoho_id: "123" }) === "removal" && effectOfRow({}) === "new");
const eff = [
  row("pNew", "payment", 1000),
  row("pVoidBefore", "payment", 2000, { effect: "nothing", effect_words: "Voided or cancelled before it was sent: nothing goes to Zoho." }),
  row("pVoidAfter", "payment", 5000, { effect: "removal", zoho_id: "z1" }),
  row("dAllocated", "deposit", 30000, { zoho_id: "z2" }),
  row("bpReversed", "billpayment", 840, { effect: "removal", zoho_id: "z3" }),
  row("comProof", "commission", 250, { effect: "again", zoho_id: "z4" }),
  row("billScan", "bill", 840, { zoho_id: "z5" }),
];
const pe = buildPreview(eff, { undoMinutes: 10, now: NOW });
const ge = (k) => pe.groups.find((x) => x.key === k);
check("preview: a voided receipt is not in Payments, nor in Money in", ge("payments")?.count === 1 && ge("payments")?.total === 1000 && pe.moneyIn === 1000, JSON.stringify(ge("payments")) + ` in ${pe.moneyIn}`);
check("preview: a reversed supplier payment is not Money out; a re-run commission and bill add nothing", !ge("billpayments") && !ge("expenses") && !ge("bills") && pe.moneyOut === 0, JSON.stringify(pe.groups));
check("preview: the removals are their own line, with their total", pe.removals.count === 2 && pe.removals.total === 5840 && pe.removals.rows.map((r) => r.id).sort().join(",") === "bpReversed,pVoidAfter");
check("preview: already in Zoho (allocation, late proof, late scan) is its own line", pe.again.count === 3 && pe.again.rows.map((r) => r.id).sort().join(",") === "billScan,comProof,dAllocated");
check("preview: nothing goes (voided before the press) is its own line, with its words", pe.nothing.count === 1 && pe.nothing.rows[0].id === "pVoidBefore" && /nothing goes/.test(pe.nothing.rows[0].words ?? ""));
check("preview: every row is still in the run (the rows close or are taken back), each with its effect", pe.ids.length === 7 && pe.rows.find((r) => r.id === "pVoidAfter")?.effect === "removal" && pe.rows.find((r) => r.id === "pNew")?.effect === "new");

// 2. What a press can move: the reminder, the menu number and Waiting on you count only that.
check("a row nobody tried yet: a press sends it", sendsOnPress(null) && sendsOnPress(""));
check("a row waiting only on Zoho's own allowance or chart of accounts: a press sends it", sendsOnPress(RATE_LIMIT_WORDS) && sendsOnPress(`${ACCOUNTS_WAIT_WORDS}: timeout`));
check("a row waiting for its red bill or a cheque: a press cannot move it", !sendsOnPress("Waiting for the bill of LPO-00012 to reach Zoho first.") && !sendsOnPress("Waiting for the cheque to clear."));
check("the database filter names the same three cases", /last_error\.is\.null/.test(SENDS_ON_PRESS_FILTER) && /call\*allowance/.test(SENDS_ON_PRESS_FILTER) && /chart\*of\*accounts/.test(SENDS_ON_PRESS_FILTER));
const stuck1 = stuckWords([{ kind: "billpayment", reason: "Waiting for the bill of LPO-00012 to reach Zoho first." }]);
check("one stuck row in one sentence, with what it waits for", stuck1 === "1 supplier payment waits for something Sync to Zoho cannot do (Waiting for the bill of LPO-00012 to reach Zoho first): fix that first (often a red row on the Zoho Books page), then it goes with the next sync.", stuck1);
check("no stuck rows: no sentence", stuckWords([]) === null);
check("only rows waiting for something else: no bell (a press cannot clear them)", reminderDue({ ...base, waiting: 0, nowMs: dubai("2026-11-03", 9) }).due === false);
const ws = reminderWords({ total: 2, byKind: { invoice: 2 }, red: 1, stuckWords: stuck1 });
check("the bell's title counts only what a press sends; the stuck row is a sentence in the body", ws.title === "2 items waiting to sync to Zoho" && ws.body.includes("1 supplier payment waits for something Sync to Zoho cannot do"), ws.body);
check("the cron's line names the stuck rows apart", manualCronWords({ total: 0, red: 1, stuck: 1 }) === "Manual: nothing waiting · 1 waiting on something else · 1 red");

// 3. Retry is refused where it could post twice.
check("Retry refuses an opening-balances row", /corrected by hand in Zoho/.test(retryRefusal({ hand_only: true }) ?? ""));
check("Retry refuses a row done by hand that turned red again (it could post a second document)", /done by hand in Zoho before/.test(retryRefusal({ manual: true, name: "Mathew" }) ?? ""));
check("Retry may run on an ordinary red row", retryRefusal(null) === null && retryRefusal({ e2e_stub: "fail" }) === null);

// 4. The reconciliation walks back: a day held back for Sync to Zoho is compared once its documents went.
check("reconDue (moved here, unchanged): not before 00:30, then a missing row is due", reconDue(null, "2026-11-02", dubai("2026-11-03", 0, 10), false) === false && reconDue(null, "2026-11-02", dubai("2026-11-03", 0, 40), false) === true);
// Saturday 31 Oct had documents after the morning press; Sunday 1 Nov is a day off; Monday 2 Nov 09:00 the press.
const satUnsent = "2026-10-31T15:00:00+04:00";
check("Sunday: Saturday waits for Sync to Zoho (nothing compared)", reconDaysDue({ nowMs: dubai("2026-11-01", 10), rows: { "2026-10-30": { status: "green", checked_at: "2026-10-31T01:00:00Z" } }, firstUnsent: satUnsent, drainSaturated: false, lookback: 2 }).length === 0);
check("Monday before the press: Saturday and Sunday both still wait", reconDaysDue({ nowMs: dubai("2026-11-02", 8), rows: { "2026-10-30": { status: "green", checked_at: "2026-10-31T01:00:00Z" } }, firstUnsent: satUnsent, drainSaturated: false, lookback: 3 }).length === 0);
const afterPress = reconDaysDue({ nowMs: dubai("2026-11-02", 9, 5), rows: { "2026-10-30": { status: "green", checked_at: "2026-10-31T01:00:00Z" } }, firstUnsent: null, drainSaturated: false, lookback: 3 });
check("Monday after the press: Saturday is compared too, though it is no longer yesterday", afterPress.join(",") === "2026-10-31,2026-11-01", afterPress.join(","));
const tuesday = reconDaysDue({ nowMs: dubai("2026-11-03", 9), rows: { "2026-11-01": { status: "green", checked_at: "2026-11-02T05:05:00Z" } }, firstUnsent: null, drainSaturated: false, lookback: 4 });
check("Tuesday: a missed Saturday is still caught up (the walk looks back, not only at yesterday)", tuesday.includes("2026-10-31") && tuesday.includes("2026-11-02") && !tuesday.includes("2026-11-01"), tuesday.join(","));
check("a row written before its day ended is compared again; a finished one is not", reconDaysDue({ nowMs: dubai("2026-11-03", 9), rows: { "2026-11-01": { status: "green", checked_at: "2026-11-01T08:00:00Z" }, "2026-11-02": { status: "green", checked_at: "2026-11-02T21:00:00Z" } }, firstUnsent: null, drainSaturated: false, lookback: 2 }).join(",") === "2026-11-01");
check("a day still waiting stops the walk (every later day waits too)", reconDaysDue({ nowMs: dubai("2026-11-03", 9), rows: {}, firstUnsent: "2026-11-01T12:00:00+04:00", drainSaturated: false, lookback: 4 }).join(",") === "2026-10-30,2026-10-31");
check("a few days per run at most (Zoho's daily allowance)", reconDaysDue({ nowMs: dubai("2026-11-03", 9), rows: {}, firstUnsent: null, drainSaturated: false, lookback: 10 }).length === RECON_DAYS_PER_RUN);
check("a busy queue on automatic: nothing compared", reconDaysDue({ nowMs: dubai("2026-11-03", 9), rows: {}, firstUnsent: null, drainSaturated: true }).length === 0);
check("yesterday keeps its hourly re-check while red", reconDaysDue({ nowMs: dubai("2026-11-03", 9), rows: { "2026-11-02": { status: "red", checked_at: new Date(dubai("2026-11-03", 7)).toISOString() } }, firstUnsent: null, drainSaturated: false, lookback: 1 }).join(",") === "2026-11-02");
check("the words after a sync name each day compared", reconRunWords([{ day: "2026-10-31", status: "green" }, { day: "2026-11-01", status: "red" }]) === "Compared with Zoho: 2026-10-31 identical ✓ · 2026-11-01 a difference – see Reconciliation." && reconRunWords([]) === null);

// Fix 3 (4 November 2026): the fix link follows the reason AND the document, and a free waiting row says why.
check("a tax-period refusal on a bill links straight to its LPO", reasonHref("Zoho said: You can specify Tax Treatment only for transactions within tax period.", { kind: "billpayment", recordId: "abc" })?.href === "/parts/orders/abc");
check("the same reason without a document keeps no link", reasonHref("You can specify Tax Treatment only for transactions within tax period.") === null);
check("a TRN refusal still goes to the suppliers page", reasonHref("E2e Golden Zone needs its 15-digit TRN", { kind: "bill", recordId: "x" })?.href === "/parts/suppliers?filter=no_trn");
check("a free waiting row says its turn (manual and automatic)", /Sync to Zoho/.test(waitingTurnWords("manual")) && /five-minute run/.test(waitingTurnWords("automatic")));

// THE true check of a posted document (6 November 2026, LPO-00045-1).
{
  const { figuresDiffWords, postedDiffers, RECHECK_KINDS } = R;
  check("figures equal to the fils = no words", figuresDiffWords({ net: 962.86, vat: 48.14, total: 1011 }, { net: 962.86, vat: 48.14, total: 1011.0 }) === null);
  const w = figuresDiffWords({ net: 962.85, vat: 48.14, total: 1010.99 }, { net: 962.86, vat: 48.14, total: 1011 });
  check(`the owner's words "1,010.99 vs 1,011.00 (−0.01)" (${w})`, w === "1,010.99 vs 1,011.00 (−0.01)");
  check("the VAT named when only the VAT differs", figuresDiffWords({ net: 100, vat: 5.01, total: 105 }, { net: 100, vat: 5, total: 105 }) === "VAT 5.01 vs 5.00 (+0.01)");
  check("floating sums never fake a difference (0.1 + 0.2)", figuresDiffWords({ total: 0.1 + 0.2 }, { total: 0.3 }) === null);
  const stored = { zoho: { net: 962.85, vat: 48.14, total: 1010.99, balance: 1010.99 }, erp: { net: 962.85, charges: 0 } };
  check("a bill posted before the rule looks fine on its stored figures…", postedDiffers("bill", stored) === null);
  check("…and differs against the ERP's figures today", postedDiffers("bill", stored, { net: 962.86, vat: 48.14, total: 1011 }) === "Zoho differs: 1,010.99 vs 1,011.00 (−0.01)");
  check("its green words no longer claim a match", !/matches the ERP/.test(resultWords("bill", stored, { net: 962.86, vat: 48.14, total: 1011 }) ?? "") && /matches the ERP to the fils/.test(resultWords("bill", stored) ?? ""));
  check("an invoice whose VAT differs is named", postedDiffers("invoice", { zoho: { total: 105, vat: 5.01, balance: 0 }, erp: { total: 105, vat: 5 } }) === "Zoho differs: VAT 5.01 vs 5.00 (+0.01)");
  check("a VAT rounding in the bill's adjustment shows in the words", /VAT rounding AED 0.01 as the bill's adjustment/.test(resultWords("bill", { zoho: { net: 100, vat: 5, total: 105.01, balance: 105.01 }, erp: { net: 100, vat: 5.01, total: 105.01 }, vat_adjustment: 0.01 }) ?? ""));
  check("a done-by-hand row is never red", postedDiffers("bill", { manual: true, zoho: { total: 1 }, erp: { total: 2 } }) === null);
  check("bills and invoices can be checked again", RECHECK_KINDS.includes("bill") && RECHECK_KINDS.includes("invoice") && !RECHECK_KINDS.includes("payment"));
}

// Audit H3: a settlement transfer counts on its own date, whatever day Zoho's filter listed it under.
{
  const { rowsOnDay, shiftDay } = R;
  check("the day before and after (across a month end)", shiftDay("2026-11-01", -1) === "2026-10-31" && shiftDay("2026-11-30", 1) === "2026-12-01");
  const rows = [{ date: "2026-11-03", reference_number: "STL-00006" }, { date: "2026-11-02", reference_number: "STL-00005" }, { date: "2026-11-03T00:00:00+0400" }];
  check("STL-00006 listed under 2 Nov still counts on 3 Nov", rowsOnDay(rows, "2026-11-03").length === 2 && rowsOnDay(rows, "2026-11-02").length === 1);
}

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
