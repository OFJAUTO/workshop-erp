// Paid means paid (10 November 2026, Section 1): THE still-due figure in src/lib/still-due.ts.
//   node --import ./tests/unit/register.mjs tests/unit/still-due.test.mjs        (npm run test:unit)
const { stillDueOf, mayOfferPayment, stillDueWords, readyTemplateFor, READY_PAID_TEMPLATE, READY_WAITING_TEMPLATE } = await import("../../src/lib/still-due.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const tpl = "Dear [name],\n\nThe proforma and the amount due are here:\n[link]\n\nOFJ Automotive";

const paid = stillDueOf({ total: 2325.75, paid: 2325.75, balance: 0, pending: 0 });
check("fully paid: state paid, nothing due, no payment offered", paid.state === "paid" && paid.due === 0 && !mayOfferPayment(paid));
check("fully paid: the paid message, no payment wording", readyTemplateFor(tpl, paid) === READY_PAID_TEMPLATE && /fully paid, thank you/.test(READY_PAID_TEMPLATE) && !/pay now|amount due/i.test(READY_PAID_TEMPLATE));

const cheque = stillDueOf({ total: 2325.75, paid: 0, balance: 2325.75, pendingCheque: 2325.75 });
check("cheque covering the whole balance: waiting to clear, nothing asked", cheque.state === "waiting_clear" && cheque.due === 0 && !mayOfferPayment(cheque));
check("waiting to clear: its own message", readyTemplateFor(tpl, cheque) === READY_WAITING_TEMPLATE && stillDueWords(cheque) === "Payment received – waiting to clear");

const part = stillDueOf({ total: 19999, paid: 6599, balance: 13400, pending: 0 });
check("part paid: only the remaining figure", part.state === "part" && part.due === 13400 && mayOfferPayment(part));
check("part paid: the message names the balance after the link", /Balance due: AED 13,400\.00/.test(readyTemplateFor(tpl, part)) && readyTemplateFor(tpl, part).indexOf("[link]") < readyTemplateFor(tpl, part).indexOf("Balance due"));

const partCheque = stillDueOf({ total: 1000, paid: 0, balance: 1000, pending: 400 });
check("a cheque for part of it: the rest only", partCheque.state === "part" && partCheque.due === 600, JSON.stringify(partCheque));

const none = stillDueOf({ total: 500, paid: 0, balance: 500, pending: 0 });
check("nothing received: the full amount due, the owner's template unchanged", none.state === "due" && none.due === 500 && readyTemplateFor(tpl, none) === tpl);
check("no total yet: none", stillDueOf({ total: null, paid: 0, balance: null }).state === "none" && stillDueOf(null).state === "none");
check("a fils of rounding counts as paid", stillDueOf({ total: 100, paid: 99.996, balance: 0.004 }).state === "paid");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
