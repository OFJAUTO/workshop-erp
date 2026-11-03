// Section 3 of 2 November 2026: the payment hand-over (an advisor sends a payment he took to accounts) and the plate
// search of the Record payment window. Pure rules only.
//   node --import ./tests/unit/register.mjs tests/unit/payment-reports.test.mjs        (npm run test:unit)
const R = await import("../../src/lib/payment-report-rules.ts");
const P = await import("../../src/lib/plate-search.ts");
const { reportLine, firstName, reportLate, reportWorkingHours, reminderHoursOf, checkReportInput, reportStatusWords, reportClosedWords, reportMethodWords, DEFAULT_REPORT_REMINDER_HOURS } = R;
const { plateParts, vehicleOrFilter, cleanNeedle } = P;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// 3.3 THE line, in the owner's words.
const line = reportLine({ jobNumber: "J-00969", plate: "Dubai GG 13706", car: "Mercedes-Benz S 580", customer: "<CUSTOMER>", amount: 37930, method: "card", reporter: "Anas Khan" });
check("the owner's format: J · PLATE · CAR · customer · AED · method · from first name", line === "J-00969 · DUBAI GG 13706 · MERCEDES-BENZ S 580 · <CUSTOMER> · AED 37,930.00 · Card · from Anas", line);
check("a payment link and a transfer read in words", reportLine({ jobNumber: "J-1", plate: "X 1", car: "", customer: "C", amount: 5, method: "link", reporter: "Hamza" }).endsWith("AED 5.00 · Payment link · from Hamza") && reportLine({ jobNumber: "J-1", plate: "X 1", car: "", customer: "C", amount: 5, method: "transfer", reporter: "Hamza" }).includes("Bank transfer"));
check("an empty car is left out (no double dots)", !reportLine({ jobNumber: "J-1", plate: "X 1", car: "", customer: "C", amount: 5, method: "cash", reporter: "A" }).includes("·  ·"));
check("firstName: the first word, or 'an advisor'", firstName("Anas Khan") === "Anas" && firstName("  Mathew ") === "Mathew" && firstName(null) === "an advisor");
check("method words carry the auth code or the reference", reportMethodWords({ method: "card", authCode: "756117", reference: null }) === "Card · auth 756117" && reportMethodWords({ method: "transfer", authCode: null, reference: "TT-55" }) === "Bank transfer · ref TT-55" && reportMethodWords({ method: "cash", authCode: null, reference: null }) === "Cash");

// The advisor's form, checked the same way on the screen and the server.
const ok = checkReportInput({ amount: "7,930.00", method: "card", authCode: " 75 61 17 ", reference: "", note: "  paid by the driver " });
check("a card report with the auth code: amount read with its thousands, code tidied, note trimmed", "ok" in ok && ok.ok.amount === 7930 && ok.ok.authCode === "756117" && ok.ok.note === "paid by the driver" && ok.ok.reference === null, JSON.stringify(ok));
check("the auth code is optional for the advisor", "ok" in checkReportInput({ amount: 100, method: "link", authCode: "" }));
check("a wrong auth code is refused in words", "error" in checkReportInput({ amount: 100, method: "card", authCode: "12345" }) && /6 letters or digits/.test(checkReportInput({ amount: 100, method: "card", authCode: "12345" }).error));
check("an auth code on cash is refused (it is a reference)", "error" in checkReportInput({ amount: 100, method: "cash", authCode: "123456" }));
check("no amount, zero or a minus is refused", ["", "0", "-5", "abc"].every((a) => "error" in checkReportInput({ amount: a, method: "cash" })));
check("an unknown method is refused", "error" in checkReportInput({ amount: 10, method: "crypto" }));
check("a note above 500 characters is refused", "error" in checkReportInput({ amount: 10, method: "cash", note: "x".repeat(501) }));

// 3.4 The reminder after N WORKING hours (8:00-17:00, Monday to Saturday, a 13:00-14:00 break).
const wt = { openHour: 8, closeHour: 17, workingDays: ["mon", "tue", "wed", "thu", "fri", "sat"], breakStart: "13:00", breakEnd: "14:00", breaks: null };
// Monday 2 November 2026, 16:00 Dubai = 12:00 UTC.
const mon16 = "2026-11-02T12:00:00Z";
check("reported Mon 16:00, Mon 17:30: 1 working hour, not late", Math.abs(reportWorkingHours(mon16, "2026-11-02T13:30:00Z", wt) - 1) < 0.001 && !reportLate(mon16, "2026-11-02T13:30:00Z", wt, 4));
check("Tue 10:59: 3.98 h, still not late", !reportLate(mon16, "2026-11-03T06:59:00Z", wt, 4));
check("Tue 11:00: 4 working hours, late", reportLate(mon16, "2026-11-03T07:00:00Z", wt, 4));
// Saturday 7 Nov 16:00 → Monday 9 Nov: Sunday is closed, the break does not count.
check("Sat 16:00 → Mon 12:00: 1 + 4 = 5 h (Sunday closed)", Math.abs(reportWorkingHours("2026-11-07T12:00:00Z", "2026-11-09T08:00:00Z", wt) - 5) < 0.001);
check("Mon 12:00 → Mon 15:00 over the break: 2 h", Math.abs(reportWorkingHours("2026-11-02T08:00:00Z", "2026-11-02T11:00:00Z", wt) - 2) < 0.001);
check("the setting: 4 by default, 1 to 24, whole hours", reminderHoursOf({}) === DEFAULT_REPORT_REMINDER_HOURS && reminderHoursOf({ payment_report_reminder_hours: 6 }) === 6 && reminderHoursOf({ payment_report_reminder_hours: 0 }) === 4 && reminderHoursOf({ payment_report_reminder_hours: 99 }) === 4 && reminderHoursOf({ payment_report_reminder_hours: "2.4" }) === 2);

// The status words on the job card and in the window.
check("waiting: amber words name the advisor", reportStatusWords({ status: "waiting", reporter: "Anas K" }) === "Payment reported by Anas · waiting for accounts");
check("recorded: Recorded ✓ RCT-… by", reportStatusWords({ status: "recorded", reporter: "Anas", recordedBy: "Mathew J", paymentNumber: "RCT-00043" }) === "Recorded ✓ RCT-00043 by Mathew");
check("queried: the comment", reportStatusWords({ status: "queried", reporter: "Anas", queriedBy: "Mathew", queryNote: "Photo unclear" }) === "Query from Mathew: Photo unclear");
check("a waiting report can be recorded; others say why not", reportClosedWords({ status: "waiting" }) === null && reportClosedWords({ status: "recorded", paymentNumber: "RCT-00043" }) === "Already recorded as RCT-00043." && /Queried by Mathew/.test(reportClosedWords({ status: "queried", queriedBy: "Mathew", queryNote: "x" })));

// Review fixes (3 November 2026): one rule for the advisor's button, the slip kinds, and which report a receipt answers.
const { stillOwes, slipKind, pickReportForReceipt } = R;
check("stillOwes: a balance above zero, or nothing approved yet; never a paid car or no figures", stillOwes({ balance: 2000 }) && stillOwes({ balance: null }) && !stillOwes({ balance: 0 }) && !stillOwes({ balance: 0.004 }) && !stillOwes(null));
check("slipKind: a PDF by type or name, a video, else a photo", slipKind("application/pdf", "x") === "pdf" && slipKind(null, "job/a/slip.PDF") === "pdf" && slipKind("video/mp4", "a") === "video" && slipKind(null, "a.webm") === "video" && slipKind("image/jpeg", "a.jpg") === "image" && slipKind(null, null) === "image");
const rep = (id, o = {}) => ({ id, amount: 5000, status: "waiting", authCode: null, reference: null, reportedAt: "2026-11-02T08:00:00Z", ...o });
check("a receipt answers the report with the same amount (no codes on either side)", pickReportForReceipt([rep("a")], { amount: 5000 }) === "a");
check("a different amount answers nothing", pickReportForReceipt([rep("a")], { amount: 4999 }) === null);
check("two card payments of 5,000: auth B0A60C never closes the report with auth 4X7Q21 (real-looking codes: 111111 is made up since 3 Nov)", pickReportForReceipt([rep("a", { authCode: "4X7Q21" })], { amount: 5000, authCode: "B0A60C" }) === null);
check("the report whose auth code matches comes first, even when it is newer", pickReportForReceipt([rep("a"), rep("b", { authCode: "B0A60C", reportedAt: "2026-11-02T09:00:00Z" })], { amount: 5000, authCode: "b0a 60c" }) === "b");
check("references agree when one sits inside the other (FT2611-55 against 2611 55)", pickReportForReceipt([rep("a", { reference: "2611 55" })], { amount: 5000, reference: "FT2611-55" }) === "a" && pickReportForReceipt([rep("a", { reference: "TT-1234" })], { amount: 5000, reference: "TT-9876" }) === null);
check("a queried report is answered when the money arrives (waiting ones first)", pickReportForReceipt([rep("q", { status: "queried", reportedAt: "2026-11-02T07:00:00Z" })], { amount: 5000 }) === "q" && pickReportForReceipt([rep("q", { status: "queried", reportedAt: "2026-11-02T07:00:00Z" }), rep("w")], { amount: 5000 }) === "w");
check("recorded and withdrawn reports are never answered again", pickReportForReceipt([rep("r", { status: "recorded" }), rep("x", { status: "withdrawn" })], { amount: 5000 }) === null);

// 3.2 The plate search: the code and the number are kept apart in the database.
check("'GG 13706' → code GG, number 13706", JSON.stringify(plateParts("GG 13706")) === JSON.stringify({ code: "GG", number: "13706" }));
check("'gg13706' and 'Dubai GG 13706' and 'W-64762'", plateParts("gg13706")?.code === "GG" && plateParts("Dubai GG 13706")?.number === "13706" && plateParts("W-64762")?.code === "W" && plateParts("W 64762")?.number === "64762");
check("digits only → the number alone", JSON.stringify(plateParts("13706")) === JSON.stringify({ code: null, number: "13706" }));
check("a name is not a plate", plateParts("Ahmed") === null && plateParts("") === null);
const f = vehicleOrFilter("GG 13706");
check("the filter asks for the code with the number", f.includes("and(plate_code.ilike.GG,plate_number.ilike.%13706%)") && f.includes("vin.ilike.%GG13706%"), f);
check("a bare number searches the plate number", vehicleOrFilter("13706").includes("plate_number.ilike.%13706%"));
check("commas, brackets and wildcards never reach the filter", !/[(),*%]/.test(cleanNeedle("a,b(c)*%d")) && !vehicleOrFilter("x,y)").includes("x,y"));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
