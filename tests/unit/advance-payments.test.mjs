// THE PAYMENTS box of an estimate and of its job (16 November 2026, Section 2, the E-00082 case).
//   node --import ./tests/unit/register.mjs tests/unit/advance-payments.test.mjs        (npm run test:unit)
const { advanceBoxOf } = await import("../../src/lib/advance-payments-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const ask = { id: "p1", number: "PRO-00029", amount: 8000, at: "2026-11-15T08:00:00Z", complete: false };
const r = (n, amount, pending = false, at = "2026-11-16T08:00:00Z") => ({ id: n, number: n, amount, at, method: "Bank transfer", pending, invoiceNumber: null });

const none = advanceBoxOf({ total: 20000, asks: [], receipts: [] });
check("nothing asked: says so, nothing left of an advance", none.state === "nothing_asked" && none.advanceLeft === 0 && none.totalLeft === 20000);

const asked = advanceBoxOf({ total: 20000, asks: [ask], receipts: [] });
check("8,000 asked, nothing in: NOT RECEIVED YET", asked.state === "not_received" && asked.words === "NOT RECEIVED YET" && asked.advanceLeft === 8000 && asked.requested === 8000);

const part = advanceBoxOf({ total: 20000, asks: [ask], receipts: [r("RCT-1", 5000)] });
check("5,000 of 8,000: partial, 3,000 still to receive", part.state === "partial" && part.advanceLeft === 3000 && part.totalLeft === 15000, part.words);

const bank = advanceBoxOf({ total: 20000, asks: [ask], receipts: [r("RCT-2", 8000, true)] });
check("a transfer waiting for the bank is not counted yet", bank.state === "waiting_bank" && bank.received === 0 && bank.pending === 8000 && bank.advanceLeft === 8000);

const full = advanceBoxOf({ total: 20000, asks: [ask], receipts: [r("RCT-1", 5000), r("RCT-3", 3000)] });
check("5,000 + 3,000: advance received, 12,000 left on the bill", full.state === "received" && full.advanceLeft === 0 && full.totalLeft === 12000);

const over = advanceBoxOf({ total: 6000, asks: [{ ...ask, amount: 6000, complete: true }], receipts: [r("RCT-4", 6000), r("RCT-5", 500)] });
check("more than the whole bill: the extra is named", over.extra === 500 && over.totalLeft === 0, String(over.extra));

const noAsk = advanceBoxOf({ total: 20000, asks: [], receipts: [r("RCT-6", 1000)] });
check("money with no proforma (made by the payment): counted as received", noAsk.received === 1000 && noAsk.totalLeft === 19000);

const fils = advanceBoxOf({ total: 100.1, asks: [{ ...ask, amount: 33.37 }], receipts: [r("A", 11.12), r("B", 22.25)] });
check("to the fils", fils.advanceLeft === 0 && fils.totalLeft === 66.73 && fils.state === "received", JSON.stringify([fils.advanceLeft, fils.totalLeft]));

console.log(failed ? `\n${failed} FAILED` : "\nall pass");
process.exit(failed ? 1 : 0);
