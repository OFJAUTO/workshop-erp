// Apply supplier advances without a new payment, and the invoice date check (11 November 2026, Section 3, Mathew).
//   node --import ./tests/unit/register.mjs tests/unit/supplier-advances.test.mjs        (npm run test:unit)
const { suggestAdvanceUses, advanceLeftAfter, checkAdvanceUses, likelyInvoiceOf, advanceLeftWords, invoiceDateWarning } = await import("../../src/lib/supplier-payment-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// The real case: GARGASH advances SPAY-00014 12,840 / SPAY-00011 2,705 / SPAY-00010 3,575; invoice 10670029 on LPO-00037-2 owes 12,269.06.
const advances = [
  { paymentId: "p14", number: "SPAY-00014", left: 12840 },
  { paymentId: "p11", number: "SPAY-00011", left: 2705 },
  { paymentId: "p10", number: "SPAY-00010", left: 3575 },
];
const inv = [{ poId: "lpo37-2", due: 12269.06, date: "2026-11-01" }];
const uses = suggestAdvanceUses([advances[0]], inv);
check("SPAY-00014 suggested in full on the invoice due (12,269.06)", uses.length === 1 && uses[0].amount === 12269.06, JSON.stringify(uses));
const left = advanceLeftAfter([advances[0]], uses).get("p14");
check("leaves AED 570.94 on the advance", left === 570.94, String(left));
check("the words", advanceLeftWords(left) === "Left on this advance: AED 570.94");
check("no new payment needed: the uses pass the check", checkAdvanceUses(uses, advances, inv) === null);

// One advance split across several invoices; several advances on one invoice.
const two = [{ poId: "a", due: 2000, date: "2026-10-01" }, { poId: "b", due: 1000, date: "2026-10-05" }];
const split = suggestAdvanceUses([{ paymentId: "x", number: "SPAY-1", left: 2500 }], two);
check("one advance split over two invoices (2,000 + 500)", split.length === 2 && split.find((u) => u.poId === "a")?.amount === 2000 && split.find((u) => u.poId === "b")?.amount === 500, JSON.stringify(split));
const many = suggestAdvanceUses([{ paymentId: "x", number: "SPAY-1", left: 600 }, { paymentId: "y", number: "SPAY-2", left: 600 }], [{ poId: "a", due: 1000 }]);
check("two advances on one invoice (600 + 400)", many.length === 2 && many[0].amount === 600 && many[1].amount === 400, JSON.stringify(many));
check("more than an advance holds is refused", /More than SPAY-1 holds/.test(checkAdvanceUses([{ paymentId: "x", poId: "a", amount: 700 }], [{ paymentId: "x", number: "SPAY-1", left: 600 }], [{ poId: "a", due: 1000 }]) ?? ""));
check("more than the invoice owes is refused", /more than it still owes/.test(checkAdvanceUses([{ paymentId: "x", poId: "a", amount: 900 }], [{ paymentId: "x", number: "SPAY-1", left: 2000 }], [{ poId: "a", due: 800 }]) ?? ""));
check("with a new payment on the same invoice the total is checked", /more than it still owes/.test(checkAdvanceUses([{ paymentId: "x", poId: "a", amount: 500 }], [{ paymentId: "x", number: "SPAY-1", left: 2000 }], [{ poId: "a", due: 800 }], [{ poId: "a", amount: 400 }]) ?? ""));

// The likely invoice: same LPO first, else the closest amount.
check("likely invoice: the same LPO", likelyInvoiceOf({ paymentId: "x", number: "S", left: 100, poIds: ["lpo9"] }, [{ poId: "lpo1", due: 100 }, { poId: "lpo9", due: 5000 }]) === "lpo9");
check("likely invoice: the closest amount", likelyInvoiceOf({ paymentId: "x", number: "S", left: 2705, poIds: [] }, [{ poId: "a", due: 1000 }, { poId: "b", due: 2700 }, { poId: "c", due: 9000 }]) === "b");

// The date check: LPO-00044-1 and LPO-00043-1 were saved with 2026-05-11 (11 May) for 5 November.
const w = invoiceDateWarning("2026-05-11", "2026-11-04", "2026-11-11");
check("2026-05-11 on an LPO of 4 Nov is flagged with the swap", !!w && /days before the LPO/.test(w) && /Did you mean 5 Nov 2026/.test(w), w ?? "");
check("a future date is flagged", /in the future/.test(invoiceDateWarning("2026-12-01", "2026-11-04", "2026-11-11") ?? ""));
check("a normal date passes", invoiceDateWarning("2026-11-06", "2026-11-04", "2026-11-11") === null);
check("a date a little before the LPO passes (quotation invoices)", invoiceDateWarning("2026-10-20", "2026-11-04", "2026-11-11") === null);

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
