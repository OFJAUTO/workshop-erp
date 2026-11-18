// THE cheque-pending words and the tax-invoice deadline (18 November 2026, Section 1, J-00493).
//   node --import ./tests/unit/register.mjs tests/unit/tax-invoice-due.test.mjs        (npm run test:unit)
const { taxDueOf, completedAtOf, earlyTaxStateOf, chequeTaxWhenOf, TAX_DUE_DAYS } = await import("../../src/lib/tax-invoice-due-rules.ts");
const { balanceWordsOf, stillDueOf, balanceBlockWords, waitingWordOf } = await import("../../src/lib/still-due.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// The J-00493 case: AED 12,600.00, a cheque of 12,600.00 waiting.
const cov = balanceWordsOf(stillDueOf({ total: 12600, paid: 0, balance: 12600, pending: 12600 }));
check("covered: amber COVERED BY CHEQUE – WAITING TO CLEAR, never red", cov.kind === "covered" && cov.tone === "amber" && cov.headline === "COVERED BY CHEQUE – WAITING TO CLEAR" && cov.after === "Balance once cleared: AED 0.00");
const part = balanceWordsOf(stillDueOf({ total: 25725, paid: 0, balance: 25725, pending: 13125 }));
check("part: both lines", part.kind === "part_pending" && part.pendingLine === "Cheque pending AED 13,125.00" && part.dueLine === "Balance due AED 12,600.00");
const due = balanceWordsOf(stillDueOf({ total: 945, paid: 0, balance: 945, pending: 0 }));
check("nothing paid in any form: red BALANCE DUE", due.kind === "due" && due.tone === "red" && due.headline === "BALANCE DUE AED 945.00");
check("paid: green Paid in full", balanceWordsOf(stillDueOf({ total: 945, paid: 945, balance: 0, pending: 0 })).headline === "Paid in full");
check("a transfer waits to CONFIRM", balanceWordsOf(stillDueOf({ total: 100, paid: 0, balance: 100, pending: 100 }), waitingWordOf(["transfer"])).headline === "COVERED BY TRANSFER – WAITING TO CONFIRM");
check("gate words: covered", /^Covered by cheque – waiting to clear \(AED 12,600\.00 on PRO-00009\)/.test(balanceBlockWords({ balance: 12600, invoiceNumber: "PRO-00009", pending: 12600 })));
check("gate words: nothing pending stays Balance due", balanceBlockWords({ balance: 50, invoiceNumber: null, pending: 0 }) === "Balance due AED 50.00.");

// The deadline: 14 days from completion, warned from day 10.
const t = taxDueOf("2026-11-06T08:33:56Z", "2026-11-18");
check(`due ${TAX_DUE_DAYS} days after completion (J-00493: 6 Nov → 20 Nov)`, t.dueDay === "2026-11-20" && t.words === "TAX INVOICE DUE BY 20 NOV 2026" && t.daysSince === 12 && t.warn && !t.late, JSON.stringify(t));
check("day 9 is not warned yet", !taxDueOf("2026-11-09T08:00:00Z", "2026-11-18").warn);
check("past the day: OVERDUE", taxDueOf("2026-10-31T06:31:43Z", "2026-11-18").late && /OVERDUE SINCE 14 NOV 2026/.test(taxDueOf("2026-10-31T06:31:43Z", "2026-11-18").words));
check("completion = the earliest stamp", completedAtOf([null, "2026-11-09T06:00:00Z", "2026-11-06T08:33:56Z"]) === "2026-11-06T08:33:56Z");
check("issue now: paid / covered / due", earlyTaxStateOf({ balance: 0, pending: 0 }) === "paid" && earlyTaxStateOf({ balance: 100, pending: 100 }) === "covered" && earlyTaxStateOf({ balance: 100, pending: 50 }) === "due");
check("the setting defaults to when the cheque clears", chequeTaxWhenOf(undefined) === "cleared" && chequeTaxWhenOf("received") === "received" && chequeTaxWhenOf("rubbish") === "cleared");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
