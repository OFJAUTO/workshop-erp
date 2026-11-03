// Section 5 of 2 November 2026 (built 3 November): the auth code is optional, made-up codes are flagged, and the bank's
// settlement report fills a missing code in. The pure rules only: THE made-up rule, the box's words, the money list's
// chip, the payment hand-over's matching, and the bank-report matching (suggested / settled).
//   node --import ./tests/unit/register.mjs tests/unit/auth-code.test.mjs        (npm run test:unit)
const A = await import("../../src/lib/auth-code.ts");
const S = await import("../../src/lib/settlement-report.ts");
const L = await import("../../src/lib/money-list.ts");
const R = await import("../../src/lib/payment-report-rules.ts");
const M = await import("../../src/lib/money-steps.ts");
const { isFakeAuthCode, realAuthCode, authCodeMissing, authCodeProblem, authCodeNote, authCodeRefusal, authConfirmWords, authMissingWhy, authMissingFilter, FAKE_AUTH_CODES, AUTH_OPTIONAL_HINT, AUTH_MISSING_WORDS } = A;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

/* 5.2 THE made-up rule. */
check("the owner's examples are made up: 111111, 000000, 123456, all the same digit", ["111111", "000000", "123456", "999999", "555555"].every(isFakeAuthCode));
check("straight runs up and down, the same letter six times and a few patterns are made up", ["012345", "234567", "456789", "654321", "987654", "543210", "AAAAAA", "121212", "123123", "ABCDEF", "QWERTY"].every(isFakeAuthCode));
check("real codes from the bank are not (the live codes of 24 Oct - 2 Nov)", ["756117", "004977", "HKTGJK", "873553", "B0A60C", "041975", "219769"].every((c) => !isFakeAuthCode(c)));
check("typed in small letters or with spaces it is read the same way", isFakeAuthCode(" 11 11 11 ") && isFakeAuthCode("aaaaaa") && realAuthCode("ab12cd") === "AB12CD" && realAuthCode(" 75 61 17 ") === "756117");
check("empty or the wrong length is never 'made up' (it is missing or a problem)", !isFakeAuthCode("") && !isFakeAuthCode("11111") && !isFakeAuthCode(null));
check("realAuthCode: null for empty, short, long or made up; the code otherwise", realAuthCode("") === null && realAuthCode("12345") === null && realAuthCode("1234567") === null && realAuthCode("111111") === null && realAuthCode(null) === null && realAuthCode("219769") === "219769");
check("the made-up list is one fixed list (the database filter names every code in it)", FAKE_AUTH_CODES.length > 40 && FAKE_AUTH_CODES.every((c) => /^[A-Z0-9]{6}$/.test(c)) && FAKE_AUTH_CODES.every((c) => authMissingFilter().includes(c)) && authMissingFilter().startsWith("auth_code.is.null,"));
check("authCodeMissing: card or link with no code or a made-up one", authCodeMissing({ method: "link", auth_code: "111111" }) && authCodeMissing({ method: "card", auth_code: null }) && authCodeMissing({ method: "card" }) && !authCodeMissing({ method: "card", auth_code: "756117" }));
check("cash, cheque and transfer never miss an auth code", ["cash", "cheque", "transfer"].every((m) => !authCodeMissing({ method: m, auth_code: null })));
check("the flag's words and why", AUTH_MISSING_WORDS === "Auth code missing" && authMissingWhy("111111") === "111111 is not a real code" && authMissingWhy(null) === "No auth code was typed");

/* 5.1 The box: optional, the hint, only a wrong length refused. */
check("the hint is the owner's words", AUTH_OPTIONAL_HINT === "Optional – helps match the bank report");
check("an empty box is no problem any more (optional)", authCodeProblem("card", "") === null && authCodeProblem("link", "") === null);
check("a made-up code is no problem (it saves as missing)", authCodeProblem("link", "111111") === null);
check("five characters are refused in words, with 'leave it empty'", /6 letters or digits/.test(authCodeProblem("card", "21976") ?? "") && /Leave it empty/.test(authCodeProblem("card", "21976") ?? ""));
check("the amber note for a made-up code (none for a real code or an empty box)", /111111 is not a real code: the payment is saved as "Auth code missing"/.test(authCodeNote("link", "111111") ?? "") && authCodeNote("link", "756117") === null && authCodeNote("link", "") === null && authCodeNote("cash", "111111") === null);
check("the 'Add auth code' box refuses a made-up code in the server's own words (never 'saved as missing')", authCodeRefusal("link", "111111") === "111111 is not a real code: type the code from the payment confirmation." && authCodeRefusal("card", "123456") === "123456 is not a real code: type the code from the card slip." && authCodeRefusal("link", "756117") === null && authCodeRefusal("cash", "111111") === null && !/saved as/.test(authCodeRefusal("link", "000000") ?? "saved as"));
check("the confirm words: 'auth 756117', or 'auth code missing (flagged)' for none or made up; nothing for cash", authConfirmWords("card", "756117") === "auth 756117" && authConfirmWords("link", "") === "auth code missing (flagged)" && authConfirmWords("link", "111111") === "auth code missing (flagged)" && authConfirmWords("cash", "") === null);
check("the full-payment question says the code is missing", /auth code missing – flagged until it is added/.test(M.confirmFullText({ amount: 100, method: "link", reference: null, authMissing: true, invoiceNumber: "PRO-1", isProforma: true, nextTaxNumber: "INV-1" })) && !/missing/.test(M.confirmFullText({ amount: 100, method: "link", reference: "auth 756117", invoiceNumber: "PRO-1", isProforma: true, nextTaxNumber: "INV-1" })));

/* The advisor's hand-over form and the receipt that answers it: a made-up code counts as no code. */
const made = R.checkReportInput({ amount: 100, method: "link", authCode: "111111" });
check("the advisor's made-up code is accepted but stored as no code (never fills accounts' box)", "ok" in made && made.ok.authCode === null, JSON.stringify(made));
check("the advisor's real code is kept", (() => { const r = R.checkReportInput({ amount: 100, method: "card", authCode: "b0a60c" }); return "ok" in r && r.ok.authCode === "B0A60C"; })());
check("a wrong length is still refused for the advisor", "error" in R.checkReportInput({ amount: 100, method: "card", authCode: "12345" }));
const rep = (id, authCode) => ({ id, amount: 30000, status: "waiting", authCode, reference: null, reportedAt: "2026-11-02T05:00:00Z" });
check("a receipt with a made-up code answers a report with a real code (the made-up one says nothing)", R.pickReportForReceipt([rep("a", "B0A60C")], { amount: 30000, authCode: "111111" }) === "a");
check("a report with a made-up code is answered by a receipt with the real code", R.pickReportForReceipt([rep("a", "000000")], { amount: 30000, authCode: "B0A60C" }) === "a");
check("two real codes that differ still never close each other", R.pickReportForReceipt([rep("a", "B0A60C")], { amount: 30000, authCode: "756117" }) === null);

/* 5.2 The Invoices and payments chip. */
const row = (over) => ({ kind: "job", key: "J", jobId: "J", total: 100, paid: 0, balance: 100, advance: 0, paidToday: 0, paidTodayCount: 0, taxToday: [], proforma: null, taxInvoice: null, reportedBy: null, isOpen: true, state: { current: "payment" }, authMissing: [], ...over });
const flagged = row({ key: "J-00969", authMissing: [{ id: "p", number: "RCT-00040", method: "link", amount: 30000, receivedAt: "2026-11-02T05:41:21Z", code: "111111" }] });
check("the chip 'Auth code missing' is on the list", L.MONEY_FILTERS.some((f) => f.key === "auth_missing" && f.label === "Auth code missing"));
check("a row with a flagged payment is in it, a row without is not (and a row built without the field neither)", L.inFilter("auth_missing", flagged) && !L.inFilter("auth_missing", row({})) && !L.inFilter("auth_missing", { ...row({}), authMissing: undefined }));
check("the chip counts its rows, like every other chip but 'Tax invoices today'", L.chipCountOf("auth_missing", [flagged, row({ key: "x" }), { ...flagged, key: "y" }]) === 2);

/* 5.3 The bank report: suggested and settled. */
const line = (over = {}) => ({ index: 1, date: "2026-11-02", terminal: null, card: null, type: "SALES", kind: "sale", acqRef: null, authCode: "4X7Q21", amount: 30000, msf: 525, txn: 1, vat: 26.3, net: 29447.7, desp: "M/D/C/CN", method: "link", methodBy: "description", adds: true, ...over });
const pay = (over = {}) => ({ id: "p40", number: "RCT-00040", method: "link", amount: 30000, receivedDay: "2026-11-02", authCode: null, codeMissing: true, settledIn: null, ...over });
{
  const [m] = S.matchLines([line()], [pay()]);
  check("a real report code no payment carries + ONE missing-code payment of the same amount, method and day = suggested", m.status === "suggested" && m.paymentId === "p40" && m.fillCode === "4X7Q21" && m.daysApart === 0, JSON.stringify(m));
  check("the suggestion's words", m.why === "Suggested match: RCT-00040 · AED 30,000.00 · payment link · the same day · its auth code is missing", m.why);
}
{
  const [m] = S.matchLines([line({ date: "2026-11-05" })], [pay()]);
  check("three days apart is still suggested ('3 days apart')", m.status === "suggested" && /3 days apart/.test(m.why), m.why);
  const [far] = S.matchLines([line({ date: "2026-11-06" })], [pay()]);
  check("four days apart is not suggested (picked by hand)", far.status === "unmatched" && far.candidates.includes("p40"), JSON.stringify(far));
  const [amt] = S.matchLines([line({ amount: 29999.99 })], [pay()]);
  check("a fils different is not suggested", amt.status === "unmatched");
  const [meth] = S.matchLines([line({ method: "card" })], [pay()]);
  check("another method is not suggested", meth.status !== "suggested");
  const [unknown] = S.matchLines([line({ method: null, methodBy: null })], [pay()]);
  check("the line's method unknown: suggested, and the words say so", unknown.status === "suggested" && /method is not on the report line/.test(unknown.why), unknown.why);
  const [real] = S.matchLines([line()], [pay({ codeMissing: false, authCode: "756117" })]);
  check("a payment with a real (different) code is never suggested", real.status === "unmatched");
  const [noCode] = S.matchLines([line({ authCode: null })], [pay()]);
  check("a report line with no code fills nothing (picked by hand)", noCode.status === "unmatched" && noCode.candidates.includes("p40"));
  const [fakeLine] = S.matchLines([line({ authCode: "000000" })], [pay()]);
  check("a bank line whose code looks made up fills nothing (picked by hand)", fakeLine.status === "unmatched");
}
{
  const two = S.matchLines([line()], [pay(), pay({ id: "p41", number: "RCT-00041", receivedDay: "2026-11-01" })]);
  check("two missing-code payments that fit: unmatched, both first to pick, and the words say so", two[0].status === "unmatched" && two[0].candidates[0] === "p40" && two[0].candidates.includes("p41") && /2 payments without an auth code could be this one/.test(two[0].why), JSON.stringify(two[0]));
}
{
  const [s] = S.matchLines([line({ authCode: "B0A60C" })], [pay({ codeMissing: false, authCode: "B0A60C", settledIn: "STL-00005" })]);
  check("the same code on a payment settled by hand = 'settled' (handled, never settled twice)", s.status === "settled" && s.paymentId === "p40" && /Already settled in STL-00005 ✓/.test(s.why), JSON.stringify(s));
  const [sug] = S.matchLines([line()], [pay({ settledIn: "STL-00004" })]);
  check("a settled payment with its code missing is still suggested (the code is saved; the line then reads settled)", sug.status === "suggested" && /settled in STL-00004/.test(sug.why), sug.why);
  const [near] = S.matchLines([line({ authCode: "ZZ9ZZ9" })], [pay({ codeMissing: false, authCode: "756117", settledIn: "STL-00001" })]);
  check("a settled payment with a real code is never offered to pick by hand", !near.candidates.includes("p40"));
  // Review, 3 November 2026: two missing-code payments fit, one settled by hand - the settled one is offered too (the
  // screen picks it as "already settled"), and the words name it, so the open payment is not settled by mistake.
  const [both] = S.matchLines([line()], [pay({ settledIn: "STL-00004" }), pay({ id: "p50", number: "RCT-00050", receivedDay: "2026-11-03" })]);
  check("a settled payment that fits is offered first and named 'already settled in STL-00004'", both.status === "unmatched" && both.candidates[0] === "p40" && both.candidates.includes("p50") && /RCT-00040 \(already settled in STL-00004\), RCT-00050\): pick the right one/.test(both.why), JSON.stringify(both));
}
{
  // Review, 3 November 2026: ONE TO ONE. One missing-code payment that fits two lines (their codes on no payment) is
  // suggested for neither - the first line in the file never wins a coin toss and puts another payment's code on it.
  const two = S.matchLines([line(), line({ index: 2, authCode: "QQ1234" })], [pay()]);
  check("one payment fitting two lines: neither line is suggested, both offer it first, the words name the other line", two.every((x) => x.status === "unmatched" && x.candidates[0] === "p40") && /RCT-00040 has its auth code missing and fits this line and line 2 alike/.test(two[0].why) && /and line 1 alike/.test(two[1].why), JSON.stringify(two));
  const order = S.matchLines([line({ index: 2, authCode: "QQ1234" }), line()], [pay()]);
  check("the line order never decides it (the same answer the other way round)", order.every((x) => x.status === "unmatched"), JSON.stringify(order.map((x) => x.status)));
  const mixed = S.matchLines([line(), line({ index: 2, authCode: "QQ1234", amount: 750, net: 735 })], [pay(), pay({ id: "p41", number: "RCT-00041", amount: 750 })]);
  check("two lines, two payments, each fitting only its own: both suggested, each to its own", mixed[0].status === "suggested" && mixed[0].paymentId === "p40" && mixed[1].status === "suggested" && mixed[1].paymentId === "p41", JSON.stringify(mixed.map((x) => [x.status, x.paymentId])));
  const carriedElse = S.matchLines([line(), line({ index: 2, authCode: "QQ1234" })], [pay(), pay({ id: "p9", number: "RCT-00009", codeMissing: false, authCode: "QQ1234", receivedDay: "2026-10-01" })]);
  check("a line whose code IS on a payment never competes for the missing-code one (the other line keeps its suggestion)", carriedElse[0].status === "suggested" && carriedElse[0].paymentId === "p40" && carriedElse[1].status === "unmatched", JSON.stringify(carriedElse.map((x) => [x.status, x.paymentId])));
  const exactFirst = S.matchLines([line({ authCode: "756117" })], [pay({ id: "a", number: "RCT-00036", codeMissing: false, authCode: "756117" }), pay()]);
  check("an exact match always wins over a suggestion", exactFirst[0].status === "matched" && exactFirst[0].paymentId === "a");
}
/* Dates the report reader reads (review, 3 November 2026: an impossible date crashed the review). */
check("the bank's day-first dates", S.reportDate("24/10/2026") === "2026-10-24" && S.reportDate("24-10-26") === "2026-10-24" && S.reportDate("2026-10-24") === "2026-10-24" && S.reportDate("24 OCT 2026") === "2026-10-24" && S.reportDate("05/10/2026") === "2026-10-05");
check("a spreadsheet's US order is read when the month cannot be one ('10/24/26' = 24 Oct)", S.reportDate("10/24/26") === "2026-10-24" && S.reportDate("10/24/26 13:45") === "2026-10-24");
check("a date that is not on the calendar is no date (never '2026-24-10')", S.reportDate("2026-24-10") === null && S.reportDate("32/01/2026") === null && S.reportDate("31/02/2026") === null && S.reportDate("13/13/2026") === null && S.reportDate("00/10/2026") === null);
check("the Excel read options turn date cells into ISO days (one rule for the server and the reader's test)", S.REPORT_XLSX_READ.cellDates === true && S.REPORT_XLSX_READ.dateNF === "yyyy-mm-dd" && S.REPORT_SHEET_ROWS.dateNF === "yyyy-mm-dd" && S.REPORT_SHEET_ROWS.raw === false);

check("suggestionStands is the ONE rule the server re-checks", S.suggestionStands(line(), pay()) && !S.suggestionStands(line({ authCode: "111111" }), pay()) && !S.suggestionStands(line(), pay({ codeMissing: false })) && !S.suggestionStands(line({ kind: "refund" }), pay()) && !S.suggestionStands(line({ date: null }), pay()));

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
