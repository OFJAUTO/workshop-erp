// Receiving never blocks the mechanic (15 November 2026): THE reference rules.
//   node --import ./tests/unit/register.mjs tests/unit/receipt-refs.test.mjs        (npm run test:unit)
const { DEFAULT_REF_TYPES, refTypesOf, refsOfRow, countingNumber, refColumns, refNumberProblem, paperworkDue, pendingTag, looksLikeOtherRef, paperworkBlock, refKeyOf, refCounts } = await import("../../src/lib/receipt-refs.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const types = refTypesOf(null);
check("defaults: invoice and pre-payment count, WIP does not", refCounts(types, "invoice") && refCounts(types, "prepay") && !refCounts(types, "wip"));
check("defaults: three types", types.length === 3 && DEFAULT_REF_TYPES.length === 3);
const custom = refTypesOf([{ key: "wip", counts: true }, { key: "delivery_note", label: "Delivery note number", counts: false }, { key: "invoice", label: "Hacked" }]);
check("a stored setting changes 'counts' but never a built-in name", refCounts(custom, "wip") && custom.find((t) => t.key === "invoice").label === "Invoice number");
check("an added type is kept", custom.some((t) => t.key === "delivery_note" && t.label === "Delivery note number" && !t.counts));
check("built-in types can never be removed", refTypesOf([]).length === 3);
check("a new type's key from its words", refKeyOf("Delivery note number") === "delivery_note_number");

check("an older receipt's invoice number is its one reference", JSON.stringify(refsOfRow({ invoice_number: "INV-1", refs: [] })) === JSON.stringify([{ type: "invoice", number: "INV-1" }]));
check("no number, no refs: paperwork pending", refsOfRow({ invoice_number: null, refs: [] }).length === 0);
const wipOnly = [{ type: "wip", number: "W-77" }];
check("a WIP number does not count as the invoice", countingNumber(wipOnly, types) === null);
check("a pre-payment number counts", countingNumber([{ type: "wip", number: "W-77" }, { type: "prepay", number: "PP26POR24179" }], types) === "PP26POR24179");
const cols = refColumns([{ type: "prepay", number: "PP1" }, { type: "wip", number: "W-77" }, { type: "invoice", number: "INV-9" }, { type: "dn", number: "DN-1" }]);
check("the three columns", cols.invoice === "INV-9" && cols.prepay === "PP1" && cols.wip === "W-77" && cols.other.length === 1);

check("a WIP number with digits is fine", refNumberProblem("W-77", "WIP number") === null);
check("letters only refused", /does not look like a wip number/.test(refNumberProblem("ABC", "WIP number") ?? ""));
check("empty refused", /Type the wip number/.test(refNumberProblem("  ", "WIP number") ?? ""));

check("normal supplier: due the same day", paperworkDue("2026-11-15", false, 5) === "2026-11-15");
check("invoice-later supplier: its own days (at most 5)", paperworkDue("2026-11-15", true, 3) === "2026-11-18" && paperworkDue("2026-11-15", true, 9) === "2026-11-20");
check("tag: due today", pendingTag({ refs: [], due: "2026-11-15", today: "2026-11-15" }) === "ARRIVED - PAPERWORK DUE TODAY");
check("tag: WIP recorded, invoice due by", pendingTag({ refs: wipOnly, due: "2026-11-18", today: "2026-11-15" }) === "INVOICE DUE BY 18 NOV 2026");
check("tag: overdue", /OVERDUE/.test(pendingTag({ refs: [], due: "2026-11-15", today: "2026-11-16" })));

check("live check: PP26POR24179 looks like a pre-payment number", looksLikeOtherRef("PP26POR24179") === "prepay");
check("live check: WIP-1234 and W/556 look like WIP", looksLikeOtherRef("WIP-1234") === "wip" && looksLikeOtherRef("W/556") === "wip");
check("live check: normal invoice numbers are not flagged", ["1260925555", "S0856", "CSB08415/26", "41153545", "3978"].every((n) => looksLikeOtherRef(n) === null));

const pend = [{ poNumber: "LPO-1", refs: [], pending: true }];
check("a delivery with no reference blocks closing and paying", /LPO-1 has a delivery recorded as "Arrived - paperwork pending"/.test(paperworkBlock(pend) ?? ""));
check("a delivery with a WIP number does not block (it has a reference)", paperworkBlock([{ poNumber: "LPO-1", refs: wipOnly, pending: true }]) === null);
check("an older receipt (before 15 Nov, not marked pending) never blocks", paperworkBlock([{ poNumber: "LPO-1", refs: [], pending: false }]) === null);

console.log(failed ? `${failed} failed` : "All receipt-refs checks passed");
process.exit(failed ? 1 : 0);
