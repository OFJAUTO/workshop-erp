// Money from the estimate (4 November 2026): the pure rules.
//   node tests/unit/estimate-money.test.mjs
import { strict as assert } from "node:assert";

const mod = await import("file:///" + process.cwd().replaceAll("\\", "/") + "/src/lib/estimate-money-rules.ts");
const { cleanBillTo, billToProblem, billToWords, billToFromCustomer, partialOf, advanceSplit, advanceWordsOf, estimateBadge, paidOfWords, emFilterOf, validUntilFrom } = mod;

let n = 0;
const ok = (name, cond) => { n++; if (!cond) { console.error(`FAIL ${name}`); process.exitCode = 1; } else console.log(`OK   ${name}`); };

// Bill-to: trimmed, TRN digits only, null when empty.
ok("empty bill-to is null", cleanBillTo({ company: "  ", trn: "" }) === null);
const bt = cleanBillTo({ company: " LARS Trading LLC ", trn: "100-200-300-400-500", attention: "Lars", po_number: "PO-7781", address: "JLT, Dubai" });
ok("bill-to trimmed and TRN digits only", bt.company === "LARS Trading LLC" && bt.trn === "100200300400500");
ok("a 15-digit TRN passes", billToProblem(bt) === null);
ok("a short TRN is refused in words", /15 digits/.test(billToProblem(cleanBillTo({ trn: "1234" })) ?? ""));
ok("no TRN is fine (not VAT-registered)", billToProblem(cleanBillTo({ company: "X" })) === null);
const words = billToWords(bt);
ok("bill-to words in order", words[0] === "LARS Trading LLC" && words[1] === "Attn: Lars" && words[3] === "TRN 100200300400500" && words[4] === "Your PO/ref: PO-7781");
const pre = billToFromCustomer({ customer_type: "company", company_name: "LARS", full_name: "Lars P", trn: "100200300400500", area: "JLT" });
ok("company customers prefill name, TRN and area", pre.company === "LARS" && pre.trn === "100200300400500" && pre.address === "JLT");

// Partial amounts.
ok("50% of 2,420 is 1,210", partialOf("percent", 50, 2420).amount === 1210);
ok("AED partial stays as typed", partialOf("aed", 1000, 2420).amount === 1000);
ok("above the total is refused", /More than the estimate/.test(partialOf("aed", 3000, 2420).error ?? ""));
ok("over 100% is refused", /at most 100/.test(partialOf("percent", 120, 2420).error ?? ""));
ok("zero is refused", !!partialOf("aed", 0, 2420).error);

// VAT taken OUT of the advance, landing exactly.
const s = advanceSplit(1210, 5);
ok("advance split lands exactly", s.total === 1210 && s.taxable === 1152.38 && s.vat === 57.62 && Math.round((s.taxable + s.vat) * 100) / 100 === 1210);
ok("advance words name the estimate", advanceWordsOf("E-00061") === "ADVANCE PAYMENT AGAINST ESTIMATE E-00061");

// Badges.
const base = { total: 2420, paid: 0, pendingCheque: 0, proformaOpen: false, proformaComplete: false, fullyInvoiced: false, advanceInvoiced: 0 };
ok("nothing out = no badge", estimateBadge(base).key === null && paidOfWords(base) === null);
ok("proforma out unpaid", estimateBadge({ ...base, proformaOpen: true }).key === "proforma_unpaid");
ok("part paid", estimateBadge({ ...base, paid: 1210 }).key === "part_paid" && /1,210\.00 of/.test(estimateBadge({ ...base, paid: 1210 }).words));
ok("prepaid at the full total", estimateBadge({ ...base, paid: 2420 }).key === "prepaid");
ok("paid words carry the pending cheque", /cheque AED 500\.00 clearing/.test(paidOfWords({ ...base, paid: 100, pendingCheque: 500 }) ?? ""));
ok("the filter follows the badge", emFilterOf({ ...base, paid: 2420 }, "prepaid") && !emFilterOf({ ...base, paid: 2420 }, "part_paid"));

// Valid until: Dubai day + days.
ok("valid-until is a day string", /^\d{4}-\d{2}-\d{2}$/.test(validUntilFrom(Date.UTC(2026, 10, 4, 12), 7)));

console.log(`\n${n} checks, ${process.exitCode ? "with failures" : "all passed"}`);
