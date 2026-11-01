// The Supplier invoices tab's rows (1 November 2026): one row per invoice over its LPOs, status, match, duplicates.
//   node --import ./tests/unit/register.mjs tests/unit/supplier-invoice-rows.test.mjs        (npm run test:unit)
const { groupInvoices, filterInvoices, unpaidBySupplier, invoiceNoticeTitle, invWords } = await import("../../src/lib/supplier-invoice-rows.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const po = (id, job, number, amount, extra = {}) => ({ id, number: `LPO-${id}`, job_id: job, supplier_id: "s1", supplier_name: "SPARE HUB", status: "received", total_cost_aed: amount, supplier_invoice_status: "received", supplier_invoice_number: number, supplier_invoice_date: "2026-11-01", supplier_invoice_amount: amount, supplier_invoice_at: "2026-11-01T08:00:00Z", received_at: "2026-11-01T08:00:00Z", checked_at: null, zoho_bill_id: null, paid_at: null, ...extra });
const pos = [
  po("a", "j1", "INV-4512", 520),
  po("b", "j2", "inv 4512", 400),
  po("c", "j1", null, 150, { supplier_invoice_status: "to_follow", supplier_invoice_amount: null }),
  po("d", "j1", "INV-9999", 520),
  po("e", "j3", "INV-77", 100, { checked_at: "x", zoho_bill_id: "z", paid_at: "p" }),
];
const lines = [
  { po_id: "a", description: "WISHBONE LINK", quantity: 2, received_qty: 2, unit_cost: 260, invoice_unit_cost: null, invoice_check: null },
  { po_id: "b", description: "STABILISER LINK", quantity: 2, received_qty: 2, unit_cost: 200, invoice_unit_cost: 210, invoice_check: "mismatch" },
  { po_id: "c", description: "CABIN FILTER", quantity: 1, received_qty: 1, unit_cost: 150, invoice_unit_cost: null, invoice_check: null },
  { po_id: "d", description: "BRAKE HOSE", quantity: 2, received_qty: 1, unit_cost: 260, invoice_unit_cost: null, invoice_check: null },
  { po_id: "e", description: "BOLT", quantity: 1, received_qty: 1, unit_cost: 100, invoice_unit_cost: null, invoice_check: null },
];
const jobs = [{ id: "j1", job_number: "J-1", plate: "DUBAI W 1", car: "RAM" }, { id: "j2", job_number: "J-2", plate: "DUBAI X 2", car: "BMW" }, { id: "j3", job_number: "J-3", plate: "", car: "" }];
const rows = groupInvoices(pos, lines, jobs, [{ id: "s1", name: "SPARE HUB", trn: "100200300400500", vat_registered: true }]);
const inv = rows.find((r) => r.number === "INV-4512");
check("one invoice typed on two LPOs (any spelling of the number) is one row", rows.filter((r) => r.shares.some((s) => s.poId === "a" || s.poId === "b")).length === 1 && inv?.shares.length === 2);
check("before VAT 920, VAT 46, total 966", inv?.beforeVat === 920 && inv?.vat === 46 && inv?.total === 966);
check("a price changed on one of its lines", inv?.match.includes("price_changed"));
check("status New until accounts check it", inv?.status === "new");
check("the to-follow LPO waits for its invoice", rows.find((r) => r.shares[0].poId === "c")?.status === "waiting");
const d = rows.find((r) => r.number === "INV-9999");
check(`same supplier, date and a share's amount under another number: possible duplicate (${d?.duplicateOf})`, /INV-4512/.test(d?.duplicateOf ?? ""));
check("a short delivery is Quantity different", d?.match.includes("quantity_different"));
check("checked, billed and paid: Paid to supplier", rows.find((r) => r.number === "INV-77")?.status === "paid");
check("the search finds a part name", filterInvoices(rows, { q: "stabiliser" }, new Map(lines.map((l) => [l.po_id, [l.description]]))).some((r) => r.number === "INV-4512"));
check("the search finds the number without its dash", filterInvoices(rows, { q: "4512" }).length === 1);
check("unpaid filter leaves the paid one out", !filterInvoices(rows, { unpaid: true }).some((r) => r.number === "INV-77"));
check("unpaid per supplier", unpaidBySupplier(rows)[0]?.supplier === "SPARE HUB");
check("the notice title", invoiceNoticeTitle("Spare Hub", "4512", 1040) === "Supplier invoice · SPARE HUB · INV 4512 · AED 1,040.00 + VAT");
check("INV never twice", invWords("INV-4512") === "INV-4512" && invWords("4512") === "INV 4512");
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
