// The supplier's invoice number at receiving (13 November 2026): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/receipt-rules.test.mjs        (npm run test:unit)
const { reminderDue, dueTag, laterDays, receiptNumberProblem, sameNumber, receivedCountWords, mayReplaceFile, addDays } = await import("../../src/lib/receipt-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const base = { received_at: "2026-11-13T06:00:00Z", invoice_due_date: "2026-11-18", invoice_number: null, invoice_later: true, reminded_day3_at: null, reminded_day5_at: null, last_reminded_on: null, is_active: true };

check("no reminder on days 0 to 2", ["2026-11-13", "2026-11-14", "2026-11-15"].every((d) => reminderDue(base, d) === null));
check("day 3", reminderDue(base, "2026-11-16") === "day3");
check("day 4 after the day-3 bell: nothing", reminderDue({ ...base, reminded_day3_at: "x", last_reminded_on: "2026-11-16" }, "2026-11-17") === null);
check("day 5 (the due day)", reminderDue({ ...base, reminded_day3_at: "x", last_reminded_on: "2026-11-16" }, "2026-11-18") === "day5");
check("overdue from day 6, every day", reminderDue({ ...base, reminded_day3_at: "x", reminded_day5_at: "x", last_reminded_on: "2026-11-18" }, "2026-11-19") === "overdue" && reminderDue({ ...base, reminded_day3_at: "x", reminded_day5_at: "x", last_reminded_on: "2026-11-19" }, "2026-11-20") === "overdue");
check("never twice on one day", reminderDue({ ...base, reminded_day3_at: "x", reminded_day5_at: "x", last_reminded_on: "2026-11-20" }, "2026-11-20") === null);
check("the number typed stops the reminders", reminderDue({ ...base, invoice_number: "INV-77" }, "2026-11-25") === null);
check("a 2-day supplier: overdue after day 2, day 3 bell still comes", reminderDue({ ...base, invoice_due_date: "2026-11-15" }, "2026-11-16") === "day3" && reminderDue({ ...base, invoice_due_date: "2026-11-15", reminded_day3_at: "x", last_reminded_on: "2026-11-16" }, "2026-11-17") === "overdue");
check("the tag", dueTag("2026-11-18") === "INVOICE DUE BY 18 NOV 2026");
check("never more than 5 days, never less than 1", laterDays(9) === 5 && laterDays(0) === 5 && laterDays(2) === 2 && laterDays(-3) === 1);
check("the number is compulsory and must look real", !!receiptNumberProblem("") && !!receiptNumberProblem("abc") && !!receiptNumberProblem("1111") && receiptNumberProblem("INV-2026-0451") === null);
check("numbers compare as people type them", sameNumber("INV-123", "inv 123") && !sameNumber("INV-123", "INV-124"));
check("2 of 5 received", receivedCountWords([{ quantity: 1, received_qty: 1 }, { quantity: 2, received_qty: 2 }, { quantity: 1, received_qty: 0 }, { quantity: 1, received_qty: 0 }, { quantity: 3, received_qty: 1 }]) === "2 of 5 received");
check("files: accounts and the owner always; the parts desk only its paper until accounts checked", mayReplaceFile("accounts", "invoice", true) && mayReplaceFile("owner", "paper", true) && mayReplaceFile("parts", "paper", false) && !mayReplaceFile("parts", "paper", true) && !mayReplaceFile("parts", "invoice", false));
check("days add up", addDays("2026-11-13", 5) === "2026-11-18");

process.exit(failed ? 1 : 0);
