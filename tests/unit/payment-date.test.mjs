// THE payment date (17 November 2026, Section 3): the role limits, closed months, the typed day and the month flag.
//   node --import ./tests/unit/register.mjs tests/unit/payment-date.test.mjs        (npm run test:unit)
const { checkPaymentDate, parseTypedDay, showDay, stampOfDay, monthMismatchWords, inClosedMonth, earliestDay, addDays } = await import("../../src/lib/payment-date-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const today = "2026-11-17";

check("typed day/month/year is read day first", parseTypedDay("16/11/2026") === "2026-11-16" && parseTypedDay("1-2-26") === "2026-02-01" && parseTypedDay("2026-11-16") === "2026-11-16");
check("an impossible day is not a day", parseTypedDay("31/02/2026") === null && parseTypedDay("16/13/2026") === null && parseTypedDay("yesterday") === null);
check("the box shows a picked day as day/month/year", showDay("2026-11-05") === "05/11/2026");
check("the future is refused", !checkPaymentDate({ day: "2026-11-18", today, role: "accounts" }).ok);
check("today is fine for everyone", checkPaymentDate({ day: today, today, role: "advisor" }).ok);
check("an advisor: up to 3 days back", checkPaymentDate({ day: "2026-11-14", today, role: "advisor" }).ok && !checkPaymentDate({ day: "2026-11-13", today, role: "advisor" }).ok && earliestDay("advisor", today) === "2026-11-14");
check("accounts: any day of an open month", checkPaymentDate({ day: "2026-09-02", today, role: "accounts" }).ok && earliestDay("accounts", today) === null);
const closed = checkPaymentDate({ day: "2026-10-31", today, role: "accounts", closedThrough: "2026-10" });
check("accounts: a closed month needs the owner, in plain words", !closed.ok && closed.needsOwner === true && /October 2026 is closed/.test(closed.error));
check("the owner may date it in a closed month", checkPaymentDate({ day: "2026-10-31", today, role: "owner", closedThrough: "2026-10" }).ok);
check("a month after the closed one is open", !inClosedMonth("2026-11-01", "2026-10") && inClosedMonth("2026-09-30", "2026-10") && !inClosedMonth("2026-01-01", ""));
check("the stamp: now for today, noon Dubai for an earlier day", stampOfDay(today, today, "2026-11-17T06:00:00.000Z") === "2026-11-17T06:00:00.000Z" && stampOfDay("2026-11-14", today, "x") === "2026-11-14T12:00:00+04:00");
check("same month as the tax invoice: no flag", monthMismatchWords({ number: "RCT-1", day: "2026-11-02" }, { number: "INV-1", day: "2026-11-30" }) === null);
check("another month than its tax invoice: flagged, the invoice date kept", /RCT-1 is dated 30 Oct 2026 \(October 2026\) but its tax invoice INV-1 is dated 2 Nov 2026 \(November 2026\)/.test(monthMismatchWords({ number: "RCT-1", day: "2026-10-30" }, { number: "INV-1", day: "2026-11-02" }) ?? ""));
check("days move across a month end", addDays("2026-11-01", -1) === "2026-10-31");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
