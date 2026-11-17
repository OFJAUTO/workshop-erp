// Journal vouchers (17 November 2026, Section 6): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/jv-rules.test.mjs        (npm run test:unit)
const { JV_TYPES, checkJvPay, checkPayLater, correctionWords, jvTotal, jvTypeOfKind, toReimburse } = await import("../../src/lib/jv-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const today = "2026-11-17";

check("the owner's default accounts", JV_TYPES.find((t) => t.key === "fuel").account === "Automobile Expense" && JV_TYPES.find((t) => t.key === "recovery").account === "Recovery and transport" && JV_TYPES.find((t) => t.key === "other").account === "Other Expenses" && JV_TYPES.find((t) => t.key === "delivery").account === "Postage");
check("a charge's kind is its voucher type", jvTypeOfKind("fuel") === "fuel" && jvTypeOfKind("delivery") === "delivery" && jvTypeOfKind("weird") === "other");
check("who paid is never pre-selected (must be chosen)", /Choose who paid/.test(checkJvPay({ paidBy: null, staffId: null, paidOn: today, today }) ?? ""));
check("a staff member's own money needs the staff member", /Pick the staff member/.test(checkJvPay({ paidBy: "staff", staffId: null, paidOn: today, today }) ?? ""));
check("no future payment date", /future/.test(checkJvPay({ paidBy: "cash", staffId: null, paidOn: "2026-11-18", today }) ?? ""));
check("company card, today: fine", checkJvPay({ paidBy: "card", staffId: null, paidOn: today, today }) === null);
check("pay later needs the provider, its invoice number and date", /provider/.test(checkPayLater({ provider: "", invoiceNumber: "1", invoiceDate: today, today, count: 1 }) ?? "") && /invoice number/.test(checkPayLater({ provider: "A", invoiceNumber: " ", invoiceDate: today, today, count: 1 }) ?? "") && checkPayLater({ provider: "A", invoiceNumber: "9", invoiceDate: today, today, count: 2 }) === null);
check("a corrected amount is said, the same amount is not", correctionWords(400, 380) === "Cost corrected from the receipt: 400.00 → 380.00" && correctionWords(400, 400) === null);
check("a voucher's total with VAT", jvTotal([{ amount: 90, vat: 5 }, { amount: 50, vat: 2.5 }]) === 147.5);
const owed = toReimburse([
  { staffId: "a", staffName: "Peter", amount: 90, vat: 5, status: "paid", reimbursedAt: null, paidBy: "staff" },
  { staffId: "a", staffName: "Peter", amount: 10, vat: 0, status: "paid", reimbursedAt: "2026-11-17", paidBy: "staff" },
  { staffId: "b", staffName: "Anas", amount: 20, vat: 1, status: "void", reimbursedAt: null, paidBy: "staff" },
  { staffId: "c", staffName: "Mathew", amount: 30, vat: 0, status: "paid", reimbursedAt: null, paidBy: "cash" },
]);
check("To reimburse: only paid, not yet reimbursed, paid by the staff member", owed.length === 1 && owed[0].staffName === "Peter" && owed[0].total === 95 && owed[0].count === 1, JSON.stringify(owed));

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
