// Section 12 of 2 November 2026 (built 3 November): Parts accounts (part lines, LPOs, payments to suppliers, returns,
// problems, totals, filters) and the suppliers search. Pure rules only, no database.
//   node --import ./tests/unit/register.mjs tests/unit/parts-accounts.test.mjs        (npm run test:unit)
const R = await import("../../src/lib/parts-accounts-rules.ts");
const S = await import("../../src/lib/supplier-rules.ts");
const I = await import("../../src/lib/supplier-invoice-rows.ts");
const { partLines, lpoRows, returnRows, partsProblems, supplierBalances, partsAccountsTotals, filterLines, filterLpos, filterProblems, filterReturns, filterBalances, qtyWithUnit, dubaiDay, daysSince, searchHit, salesByPart, partEnding, creditNoteOf, expectedCredit, asPaTab, commonFilter, returnStateOf, isBoughtLine, isChargedLine, PA_QUICK } = R;
const { supplierNeedsTrn, supplierSearchHit, digitsOf, asSupplierFilter, nationalNumber } = S;
const { groupInvoices, unpaidBySupplier, unpaidShares, invoiceFilterOf, invoiceFilterParams } = I;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const NOW = Date.parse("2026-11-03T08:00:00Z");
const part = (id, o = {}) => ({ id, jobId: "j1", description: `part ${id}`, partNumber: "A1673306800", quantity: 1, confirmedQuantity: null, unit: null, supplier: "SPARE HUB", costAed: 100, finalCostAed: null, availability: "to_order", orderStatus: "to_order", poId: null, expectedDate: null, receivedQty: 0, issueStatus: "none", issueConfirmedAt: null, returnStatus: "none", returnedQty: 0, disposition: null, dispositionAt: null, dispositionNote: null, creditNotePath: null, notNeededAt: null, exchangeStatus: "none", exchangeReason: null, replacedPartId: null, replacementPartId: null, pricedAt: "2026-10-20T08:00:00Z", createdAt: "2026-10-20T07:00:00Z", goodwillCostAed: null, zohoVendorcreditId: null, isActive: true, removedAt: null, refusedAt: null, refusedReason: null, ...o });
const po = (id, o = {}) => ({ id, number: `LPO-${id}`, kind: "supplier", orderType: null, jobId: "j1", supplierId: "s1", supplierName: "SPARE HUB", status: "ordered", total: 100, approvedBy: "Mathew", approvedAt: "2026-10-21T08:00:00Z", orderedAt: "2026-10-21T09:00:00Z", receivedAt: null, createdAt: "2026-10-21T07:00:00Z", invoiceStatus: "none", invoiceNumber: null, invoiceDate: null, invoiceAmount: null, checkedAt: null, zohoBillId: null, paidAt: null, paidBy: null, paidMethod: null, paidReference: null, ...o });
const job = (id, o = {}) => ({ id, jobNumber: `J-${id}`, status: "in_work", isOpen: true, workDoneAt: null, plate: "DUBAI GG 13706", car: "MERCEDES-BENZ S 580", vin: "WDD2220001", taxInvoices: [], proformas: [], ...o });
const sale = (partId, kind, amount, o = {}) => ({ partId, kind, docId: `d-${partId}-${kind}`, number: kind === "tax_invoice" ? "INV-00003" : kind === "proforma" ? "PRO-00009" : "Q-00002", jobId: "j1", amount, cost: null, quantity: 1, at: "2026-10-31T10:00:00Z", notCharged: null, ...o });
const sup = (id, name, o = {}) => ({ id, name, trn: "100200300400500", vatRegistered: true, paymentTerms: null, isActive: true, ...o });
const base = (o = {}) => ({ today: "2026-11-03", now: NOW, parts: [], pos: [], lines: [], jobs: [job("j1")], sales: [], suppliers: [sup("s1", "SPARE HUB")], invoices: [], invoicePartNames: new Map(), zoho: new Map(), placeholders: [], limits: { invoiceRedDays: 7, creditWaitDays: 14, vatPercent: 5 }, ...o });

/* ---------- small helpers ---------- */
check("qtyWithUnit: pieces show the number alone", qtyWithUnit(2, null) === "2" && qtyWithUnit(1, "pc") === "1" && qtyWithUnit(3, "each") === "3");
check("qtyWithUnit: sets and other units", qtyWithUnit(1, "set") === "1 set" && qtyWithUnit(2, "set") === "2 sets" && qtyWithUnit(4.5, "L") === "4.5 L");
check("dubaiDay: a day stays, a moment moves 4 hours", dubaiDay("2026-11-03") === "2026-11-03" && dubaiDay("2026-11-02T21:00:00Z") === "2026-11-03" && dubaiDay(null) === null);
check("daysSince counts whole days", daysSince("2026-10-27T08:00:00Z", NOW) === 7 && daysSince(null, NOW) === null);
check("search: letters, and without spaces for plates and numbers", searchHit("J-00969 DUBAI GG 13706", "gg13706") && searchHit("A 167 330 68 00", "A1673306800") && !searchHit("BMW", "audi") && searchHit("anything", ""));
check("asPaTab falls back to Parts lines", asPaTab("problems") === "problems" && asPaTab("x") === "lines" && asPaTab(undefined) === "lines");
check("commonFilter keeps only search, supplier and dates", JSON.stringify(commonFilter({ q: "a", supplier: "s", from: "f", to: "t", status: "x", quick: "y" })) === JSON.stringify({ q: "a", supplier: "s", from: "f", to: "t" }));

/* ---------- the part ladder ---------- */
const stepOf = (p, extra = {}) => partLines(base({ parts: [p], ...extra }))[0];
check("no cost yet: Waiting for the price", stepOf(part("a", { costAed: null, orderStatus: "none" })).step === "to_price");
check("priced, not approved: Priced", stepOf(part("a", { orderStatus: "none" })).step === "priced");
check("approved, no LPO: To order", stepOf(part("a")).step === "to_order");
check("on a waiting LPO: On LPO, waiting approval", stepOf(part("a", { poId: "m1" }), { pos: [po("m1", { kind: "main", status: "pending_approval", orderedAt: null, approvedAt: null })] }).step === "lpo_waiting");
check("LPO approved, not ordered: Approved, not ordered", stepOf(part("a", { poId: "p1" }), { pos: [po("p1", { status: "approved", orderedAt: null })] }).step === "approved");
check("ordered", stepOf(part("a", { poId: "p1", orderStatus: "ordered" }), { pos: [po("p1")] }).step === "ordered");
const late = stepOf(part("a", { poId: "p1", orderStatus: "ordered", expectedDate: "2026-11-01" }), { pos: [po("p1")] });
check(`ordered and past the expected day: late, the date in plain words ("${late.stateWords}")`, late.late && late.stateWords === "Ordered, expected 1 Nov 2026");
check("partly received", stepOf(part("a", { quantity: 2, poId: "p1", orderStatus: "partly_received", receivedQty: 1 }), { pos: [po("p1", { status: "partly_received" })] }).step === "partly_received");
check("received", stepOf(part("a", { poId: "p1", orderStatus: "received", receivedQty: 1 }), { pos: [po("p1", { status: "received" })] }).step === "received");
check("from the shelf (in stock, received): Received", stepOf(part("a", { availability: "in_stock", orderStatus: "none", receivedQty: 1, supplier: "Our stock" })).step === "received");
check("handed to the technician: With the technician", stepOf(part("a", { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed" })).step === "with_tech");
check("with the technician and the work finished: Fitted", stepOf(part("a", { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed" }), { jobs: [job("j1", { workDoneAt: "2026-11-01T10:00:00Z" })] }).step === "fitted");
check("with the technician and the car at QC: Fitted", stepOf(part("a", { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed" }), { jobs: [job("j1", { status: "pending_qc" })] }).step === "fitted");
check("on the proforma", stepOf(part("a", { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed" }), { sales: [sale("a", "proforma", 150)] }).step === "on_proforma");
const inv = stepOf(part("a", { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed" }), { sales: [sale("a", "tax_invoice", 150), sale("a", "quotation", 160)], jobs: [job("j1", { workDoneAt: "2026-11-01T10:00:00Z" })] });
check("on an issued tax invoice: Invoiced, selling from the tax invoice", inv.step === "invoiced" && inv.selling === 150 && inv.sellingFrom === "tax_invoice" && inv.stateWords === "Invoiced INV-00003");
check("four dots: ordered, received, fitted, invoiced", inv.dots.ordered && inv.dots.received && inv.dots.fitted && inv.dots.invoiced);
check("margin = selling − cost, % of selling", inv.margin === 50 && inv.marginPct === 33.3);
// Review fix (3 Nov): each dot is its own fact. An early tax invoice while the part is still with the supplier.
const early = stepOf(part("a", { poId: "p1", orderStatus: "ordered", expectedDate: "2026-11-01" }), { pos: [po("p1")], sales: [sale("a", "tax_invoice", 150)] });
check(`invoiced but not received: Received and Fitted grey, Invoiced on ("${early.stateWords}")`, early.step === "invoiced" && early.dots.ordered && !early.dots.received && !early.dots.fitted && early.dots.invoiced && /not received yet/.test(early.stateWords));
check("invoiced but not received and past its day: still Late from the supplier", early.late && filterLines([early], { quick: "late" }, []).length === 1);
const proNotHere = stepOf(part("a", { orderStatus: "to_order" }), { sales: [sale("a", "proforma", 150)] });
check(`on a proforma, not even ordered: no dot lit, and it says so ("${proNotHere.stateWords}")`, proNotHere.step === "on_proforma" && !proNotHere.dots.ordered && !proNotHere.dots.received && !proNotHere.dots.invoiced && /not ordered yet/.test(proNotHere.stateWords));
const withTechOnly = stepOf(part("a", { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed" }), { sales: [sale("a", "tax_invoice", 150)] });
check("with the technician, the work not finished: Fitted stays grey even on the invoice", withTechOnly.dots.received && !withTechOnly.dots.fitted && withTechOnly.dots.invoiced);
const partly = stepOf(part("a", { quantity: 2, poId: "p1", orderStatus: "partly_received", receivedQty: 1, expectedDate: "2026-11-01" }), { pos: [po("p1", { status: "partly_received" })] });
check("partly received: Received grey, late while the rest is due", !partly.dots.received && partly.dots.ordered && partly.late);
// A free comeback: the invoice line keeps its value, the warranty credit takes the bill to 0.
const comeback = stepOf(part("a", { orderStatus: "received", receivedQty: 1 }), { sales: [sale("a", "tax_invoice", 0, { notCharged: "warranty" })] });
check(`a free comeback's part sells for nothing and says why ("${comeback.notCharged}")`, comeback.selling === 0 && comeback.margin === -100 && /free comeback/.test(comeback.notCharged ?? ""));
// A part on a main LPO still waiting for approval (one LPO for every supplier, named "2 suppliers").
const mainSups = [sup("s1", "SPARE HUB"), sup("s3", "AL TAYER MOTORS")];
const onMain = partLines(base({ parts: [part("a", { poId: "m1", supplier: "AL TAYER MOTORS" })], pos: [po("m1", { kind: "main", status: "pending_approval", supplierId: null, supplierName: "2 suppliers" })], suppliers: mainSups }))[0];
check(`a part on a waiting main LPO reads its own supplier ("${onMain.supplier}")`, onMain.supplier === "AL TAYER MOTORS" && onMain.supplierId === "s3");
check("and the supplier filter keeps it", filterLines([onMain], { supplier: "s3" }, mainSups).length === 1 && filterLines([onMain], { supplier: "s1" }, mainSups).length === 0);
const fin = stepOf(part("a", { quantity: 2, costAed: 250, finalCostAed: 260, poId: "p1", orderStatus: "received", receivedQty: 2 }), { pos: [po("p1", { status: "received" })] });
check("cost = the supplier invoice price × quantity", fin.cost === 520 && fin.unitCost === 260 && fin.costFrom === "Final cost");
check("selling from the approved quotation before any invoice", stepOf(part("a"), { sales: [sale("a", "quotation", 871)] }).selling === 871);
const hidden = stepOf(part("a"), { sales: [sale("a", "quotation", 0, { notCharged: "hidden" })] });
check("a hidden quotation line sells for nothing and says why", hidden.selling === 0 && /hidden line/.test(hidden.notCharged ?? ""));
check("the request's unit shows with the quantity", stepOf(part("a", { unit: "set" })).qtyWords === "1 set");

/* ---------- endings ---------- */
check("returned to the supplier: ending, cost 0", (() => { const r = stepOf(part("a", { disposition: "returned", dispositionAt: "2026-10-25T08:00:00Z", receivedQty: 1, orderStatus: "received", finalCostAed: 0 })); return r.ending === "returned" && r.cost === 0; })());
check("moved to stock / scrap / goodwill", partEnding(part("a", { disposition: "stock" })) === "stock" && partEnding(part("a", { disposition: "scrap" })) === "scrap" && partEnding(part("a", { disposition: "fit_approved" })) === "goodwill");
check("goodwill costs what the owner approved", stepOf(part("a", { disposition: "fit_approved", goodwillCostAed: 90 })).cost === 90);
check("refused on the LPO and removed are endings", partEnding(part("a", { refusedAt: "x" })) === "refused" && partEnding(part("a", { removedAt: "x" })) === "removed");
check("not needed / back with Parts / being exchanged", partEnding(part("a", { notNeededAt: "x" })) === "not_needed" && partEnding(part("a", { returnStatus: "returned" })) === "back" && partEnding(part("a", { exchangeStatus: "needed" })) === "exchange");

/* ---------- a replaced part: the invoice keeps the ORIGINAL id; the sale belongs to the replacement, once ---------- */
const orig = part("o", { refusedAt: "2026-10-22T08:00:00Z", replacementPartId: "r", isActive: false });
const repl = part("r", { replacedPartId: "o", orderStatus: "received", receivedQty: 1, issueStatus: "confirmed", costAed: 120 });
const sb = salesByPart([orig, repl], [sale("o", "tax_invoice", 200)]);
check("the tax invoice line of the original counts for the replacement", sb.get("r")?.tax?.amount === 200 && !sb.get("o"));
const backOnly = salesByPart([{ ...orig, replacementPartId: null, exchangeStatus: "done", refusedAt: null }, repl], [sale("o", "tax_invoice", 200)]);
check("a replacement that only points back (replaced_part_id) still takes the sale", backOnly.get("r")?.tax?.amount === 200 && !backOnly.get("o"));
check("the exchanged original never reads as bought but never charged", !partsProblems(base({ parts: [{ ...orig, replacementPartId: null, exchangeStatus: "done", refusedAt: null, isActive: true }, repl], jobs: [job("j1", { isOpen: false, status: "closed", taxInvoices: ["INV-00003"] })], sales: [sale("o", "tax_invoice", 200)] })).some((p) => p.rule === "not_charged"));
const rl = partLines(base({ parts: [orig, repl], sales: [sale("o", "tax_invoice", 200)] }));
check("the replacement reads Invoiced, the original Refused on the LPO", rl.find((x) => x.partId === "r").step === "invoiced" && rl.find((x) => x.partId === "o").ending === "refused");

// Review fix (3 Nov): an original marked not needed BEFORE ordering, replaced from another supplier. The approved
// quotation line still points at the original, which the loader reads only to follow it (linkParts, never listed).
const nnOrig = part("nn0", { notNeededAt: "2026-10-25T08:00:00Z", orderStatus: "none", replacementPartId: "nn1" });
const nnRepl = part("nn1", { replacedPartId: "nn0", poId: "p1", orderStatus: "ordered" });
const nnBase = base({ parts: [nnRepl], linkParts: [nnOrig], pos: [po("p1")], sales: [sale("nn0", "quotation", 450)] });
const nnLine = partLines(nnBase);
check("the replacement carries the original's approved quotation line", nnLine.length === 1 && nnLine[0].partId === "nn1" && nnLine[0].selling === 450 && nnLine[0].sellingFrom === "quotation");
check("so it is never Bought, not on the quotation", !partsProblems(nnBase).some((p) => p.rule === "not_on_quote"));
check("the never-bought original is not in Returns and credits", returnRows(nnBase).length === 0 && returnRows(base({ parts: [nnOrig, nnRepl], pos: [po("p1")] })).every((r) => r.partId !== "nn0"));

/* ---------- LPO ladder ---------- */
const lpoOf = (p, extra = {}) => lpoRows(base({ pos: [p], ...extra }))[0];
check("waiting for approval", lpoOf(po("x", { status: "pending_approval" })).step === "waiting_approval");
check("approved, not ordered", lpoOf(po("x", { status: "approved", orderedAt: null })).step === "approved");
check("ordered / partly received", lpoOf(po("x")).step === "ordered" && lpoOf(po("x", { status: "partly_received" })).step === "partly_received");
const noInv = lpoOf(po("x", { status: "received", receivedAt: "2026-10-25T08:00:00Z", invoiceStatus: "to_follow" }));
check("received without the invoice: Received, invoice missing · 9 days", noInv.step === "received" && noInv.invoiceMissing && noInv.invoiceMissingDays === 9);
check("supplier invoiced, then paid", lpoOf(po("x", { status: "received", invoiceStatus: "received" })).step === "invoiced" && lpoOf(po("x", { status: "received", invoiceStatus: "received", paidAt: "2026-11-02T08:00:00Z" })).step === "paid");
check("cancelled aside", lpoOf(po("x", { status: "cancelled" })).step === "cancelled");
check("an approved main LPO is hidden (its supplier LPOs carry it)", lpoRows(base({ pos: [po("m", { kind: "main", status: "approved" })] })).length === 0 && lpoRows(base({ pos: [po("m", { kind: "main", status: "pending_approval" })] })).length === 1);
check("VAT 5% on a VAT-registered supplier, none when not registered", lpoOf(po("x", { total: 1000 })).vat === 50 && lpoOf(po("x", { total: 1000 }), { suppliers: [sup("s1", "SPARE HUB", { vatRegistered: false })] }).vat === 0);
check("approved by and when kept", lpoOf(po("x")).approvedBy === "Mathew");
const lpos = lpoRows(base({ pos: [po("a1", { status: "approved", orderedAt: null }), po("o1"), po("r1", { status: "received", invoiceStatus: "to_follow", receivedAt: "2026-11-01T08:00:00Z" }), po("i1", { status: "received", invoiceStatus: "received" })] }));
check("quick: Approved but not ordered", filterLpos(lpos, { quick: "approved_not_ordered" }, []).map((r) => r.id).join() === "a1");
check("quick: Ordered but not received", filterLpos(lpos, { quick: "ordered_not_received" }, []).map((r) => r.id).join() === "o1");
check("quick: Received, invoice missing", filterLpos(lpos, { quick: "received_no_invoice" }, []).map((r) => r.id).join() === "r1");
check("quick: Invoiced, not paid", filterLpos(lpos, { quick: "unpaid" }, []).map((r) => r.id).join() === "i1");
check("the LPO's supplier invoice match comes from the Supplier invoices rows", (() => {
  const invs = groupInvoices([{ id: "i1", number: "LPO-i1", job_id: "j1", supplier_id: "s1", supplier_name: "SPARE HUB", status: "received", total_cost_aed: 100, supplier_invoice_status: "received", supplier_invoice_number: "INV-77", supplier_invoice_date: "2026-11-01", supplier_invoice_amount: 100, supplier_invoice_at: "2026-11-01T08:00:00Z", received_at: "2026-11-01T08:00:00Z", checked_at: null, zoho_bill_id: null, paid_at: null }], [{ po_id: "i1", description: "X", quantity: 1, received_qty: 1, unit_cost: 100, invoice_unit_cost: null, invoice_check: null }], [], [{ id: "s1", name: "SPARE HUB", trn: "100200300400500", vat_registered: true }]);
  const r = lpoRows(base({ pos: [po("i1", { status: "received", invoiceStatus: "received" })], invoices: invs }))[0];
  return r.invoice?.number === "INV-77" && r.invoice.match[0] === "matches";
})());

/* ---------- payments to suppliers (the unpaid figure is THE one of the Supplier invoices tab) ---------- */
const siPo = (id, sid, name, number, amount, o = {}) => ({ id, number: `LPO-${id}`, job_id: "j1", supplier_id: sid, supplier_name: name, status: "received", total_cost_aed: amount, supplier_invoice_status: "received", supplier_invoice_number: number, supplier_invoice_date: "2026-10-20", supplier_invoice_amount: amount, supplier_invoice_at: "2026-10-20T08:00:00Z", received_at: "2026-10-20T08:00:00Z", checked_at: "x", zoho_bill_id: null, paid_at: null, ...o });
const invRows = groupInvoices([
  siPo("p1", "s1", "SPARE HUB", "INV-1", 1000),
  siPo("p2", "s1", "SPARE HUB", "INV-2", 400, { paid_at: "2026-11-01T08:00:00Z", paid_method: "transfer", paid_reference: "FT123", supplier_invoice_date: "2026-10-28" }),
  siPo("p3", "s2", "SPARE HUB", "INV-9", 200),
  siPo("p4", "s1", "SPARE HUB", null, 300, { supplier_invoice_status: "to_follow", supplier_invoice_amount: null }),
], [], [], [{ id: "s1", name: "SPARE HUB", trn: "100200300400500", vat_registered: true }, { id: "s2", name: "SPARE HUB", trn: null, vat_registered: true }]);
const unpaid = unpaidBySupplier(invRows);
check("unpaid per supplier is keyed by the supplier's id (two suppliers of one name never merge)", unpaid.length === 2 && unpaid[0].supplierId === "s1" && unpaid[0].total === 1050 && unpaid[1].supplierId === "s2");
check("the oldest unpaid invoice date is kept", unpaid[0].oldest === "2026-10-20");
check("the paid invoice carries when, how and the reference", invRows.find((r) => r.number === "INV-2")?.paidMethod === "transfer" && invRows.find((r) => r.number === "INV-2")?.paidReference === "FT123");
const bal = supplierBalances(invRows, [sup("s1", "SPARE HUB"), sup("s2", "SPARE HUB", { trn: null })]);
const b1 = bal.find((b) => b.supplierId === "s1");
check("balance: invoiced, paid, unpaid (with VAT)", b1.invoiced === 1470 && b1.paid === 420 && b1.unpaid === 1050 && b1.unpaidCount === 1);
check("balance: the invoice to follow apart", b1.toFollow === 315 && b1.toFollowCount === 1);
check("balance: VAT registered without TRN is flagged", bal.find((b) => b.supplierId === "s2").needsTrn === true && !b1.needsTrn);
check("payments quick filters", filterBalances(bal, "unpaid").length === 2 && filterBalances(bal, "paid").length === 0 && filterBalances(bal, "to_follow").length === 1);
check("Our stock is never a supplier we pay", supplierBalances(groupInvoices([siPo("q1", null, "Our stock", "X-1", 50)], [], [], []), []).length === 0);
// Review fix (3 Nov): one invoice split over two LPOs (two cars), paid LPO by LPO.
const split = groupInvoices([siPo("x1", "s1", "SPARE HUB", "INV-4512", 500, { paid_at: "2026-11-02T08:00:00Z" }), siPo("x2", "s1", "SPARE HUB", "INV-4512", 300)], [], [], [{ id: "s1", name: "SPARE HUB", trn: "100200300400500", vat_registered: true }]);
const sp1 = split[0];
check(`a split invoice paid on one LPO: partly paid, AED 525 paid and 315 to pay (${sp1.paidAmount} / ${sp1.unpaidAmount})`, split.length === 1 && !sp1.paid && sp1.partlyPaid && sp1.paidAmount === 525 && sp1.unpaidAmount === 315 && sp1.total === 840);
check("unpaid per supplier counts only what is still to pay", unpaidBySupplier(split)[0]?.total === 315 && unpaidBySupplier(split)[0]?.count === 1);
check("the LPO still to pay is the one the Pay link opens (never the paid one)", unpaidShares(sp1).map((x) => x.poId).join() === "x2");
const spBal = supplierBalances(split, [sup("s1", "SPARE HUB")])[0];
check(`the supplier balance: paid 525, unpaid 315 (${spBal.paid} / ${spBal.unpaid})`, spBal.paid === 525 && spBal.unpaid === 315 && spBal.invoiced === 840);
check("partsAccountsTotals owes the same 315", partsAccountsTotals([], split, []).owed === 315);
const both = groupInvoices([siPo("y1", "s1", "SPARE HUB", "INV-5", 500, { paid_at: "x" }), siPo("y2", "s1", "SPARE HUB", "INV-5", 300, { paid_at: "y" })], [], [], [{ id: "s1", name: "SPARE HUB", trn: "100200300400500", vat_registered: true }])[0];
check("both LPOs paid: paid in full, nothing to pay, no Pay link", both.paid && !both.partlyPaid && both.unpaidAmount === 0 && both.paidAmount === both.total && unpaidShares(both).length === 0);

/* ---------- returns and credits ---------- */
const ret = part("rt", { quantity: 2, costAed: 260, finalCostAed: 0, poId: "p1", orderStatus: "received", receivedQty: 2, returnedQty: 2, disposition: "returned", dispositionAt: "2026-10-15T08:00:00Z" });
check("the credit expected: qty × the cost (a zeroed final cost falls back to the priced cost)", expectedCredit(ret) === 520);
check("the credit with the supplier invoice price when it stood", expectedCredit(part("x", { quantity: 1, costAed: 250, finalCostAed: 260, receivedQty: 1 })) === 260);
const rr = returnRows(base({ parts: [ret, part("cn", { disposition: "returned", dispositionAt: "2026-11-02T08:00:00Z", creditNotePath: "credit-notes/cn/x.pdf", receivedQty: 1 }), part("tr", { returnStatus: "to_return", receivedQty: 1, orderStatus: "received" }), part("nn", { notNeededAt: "2026-11-01T08:00:00Z", orderStatus: "received", receivedQty: 1 })], pos: [po("p1", { status: "received" })] }));
const byKey = (k) => rr.find((x) => x.partId === k);
check("returned, no credit note: waiting, red after 14 days, with VAT", byKey("rt").state === "waiting_credit" && byKey("rt").overdue && byKey("rt").creditWithVat === 546 && byKey("rt").waitingDays === 19);
check("the credit note scan on file: Credit note on file", byKey("cn").state === "credit_on_file" && creditNoteOf(part("z", { creditNotePath: "a" })).onFile);
check("section 7's structured credit note counts too (one function to extend)", creditNoteOf(part("z", { creditNumber: "CN-55" })).onFile && creditNoteOf(part("z", { creditNumber: "CN-55" })).number === "CN-55");
check("scanned back to go to the supplier: To go back", byKey("tr").state === "to_return");
// Review fix (3 Nov): the number typed on Returns and leftovers is the credit note (stored as the return's note).
const typedCn = part("tc", { disposition: "returned", dispositionAt: "2026-10-15T08:00:00Z", dispositionNote: "CN-4512", receivedQty: 1, orderStatus: "received" });
check("a typed credit note number with no scan: Credit note on file", creditNoteOf(typedCn).onFile && creditNoteOf(typedCn).number === "CN-4512" && creditNoteOf(typedCn).typed && returnStateOf(typedCn, null) === "credit_on_file");
const tcRow = returnRows(base({ parts: [typedCn] }))[0];
check("its card shows the credit note, never the same number again as a note, and no problem", tcRow.state === "credit_on_file" && tcRow.creditNote.number === "CN-4512" && tcRow.note === null && !partsProblems(base({ parts: [typedCn] })).some((p) => p.rule === "credit_missing"));
check("section 7's structured number wins over the typed one", creditNoteOf({ ...typedCn, creditNumber: "CN-99" }).number === "CN-99" && !creditNoteOf({ ...typedCn, creditNumber: "CN-99" }).typed);
check("a note on a part kept in stock is not a credit note", !creditNoteOf(part("st", { disposition: "stock", dispositionNote: "shelf B" })).onFile);
// Not needed on a main LPO still waiting for approval: never bought, no credit due, not listed.
const nnMain = part("nm", { notNeededAt: "2026-11-01T08:00:00Z", orderStatus: "to_order", poId: "m1" });
check("not needed on a waiting main LPO: never bought, not in Returns and credits", returnStateOf(nnMain, po("m1", { kind: "main", status: "pending_approval" })) === null && returnRows(base({ parts: [nnMain], pos: [po("m1", { kind: "main", status: "pending_approval" })] })).length === 0);
check("not needed after it was ordered: still to decide (a credit may be due)", returnStateOf(part("no", { notNeededAt: "x", orderStatus: "ordered", poId: "p1" }), po("p1")) === "no_ending");
check("not needed with no ending: No ending decided yet", byKey("nn").state === "no_ending");
check("waiting for a credit note first", rr[0].partId === "rt");
check("returns filter by state", filterReturns(rr, { quick: "credit_on_file" }, []).length === 1 && filterReturns(rr, { status: "waiting_credit" }, []).length === 1);
check("credits due land on the supplier's balance", supplierBalances(invRows, [sup("s1", "SPARE HUB")], rr).find((b) => b.supplierId === "s1").creditsDue === 546);

/* ---------- PROBLEMS: one rule each, a positive and a negative case ---------- */
const probs = (o) => partsProblems(base(o));
const rules = (o) => probs(o).map((p) => p.rule);
const here = (id, o = {}) => part(id, { orderStatus: "received", receivedQty: 1, issueStatus: "confirmed", issueConfirmedAt: "2026-10-28T08:00:00Z", ...o });
// 1. Bought, never charged.
const invoicedJob = job("j1", { status: "closed", isOpen: false, taxInvoices: ["INV-00003"] });
check("1+: a fitted part not on the issued tax invoice is red", (() => { const p = probs({ parts: [here("a")], jobs: [invoicedJob], sales: [sale("a", "quotation", 300)] }).find((x) => x.rule === "not_charged"); return p?.severity === "red" && /not on the tax invoice/.test(p.detail) && p.amount === 100; })());
check("1+: on a gone car with no invoice at all: red", rules({ parts: [here("a")], jobs: [job("j1", { isOpen: false, status: "closed" })] }).includes("not_charged"));
check("1−: on the tax invoice: no problem", !rules({ parts: [here("a")], jobs: [invoicedJob], sales: [sale("a", "tax_invoice", 300)] }).includes("not_charged"));
check("1−: goodwill approved by the owner is not a problem", !rules({ parts: [here("a", { disposition: "fit_approved" })], jobs: [invoicedJob] }).includes("not_charged"));
check("1−: a job still in work is not judged yet", !rules({ parts: [here("a")], sales: [sale("a", "quotation", 300)] }).includes("not_charged"));
check("1−: a car released on credit with its proforma unpaid: charged (the customer owes it), no problem", !rules({ parts: [here("a")], jobs: [job("j1", { isOpen: false, status: "closed", proformas: ["PRO-00009"] })], sales: [sale("a", "proforma", 300), sale("a", "quotation", 300)] }).includes("not_charged"));
check("1−: a free comeback part (on the tax invoice at AED 0) is not never charged", !rules({ parts: [here("a")], jobs: [invoicedJob], sales: [sale("a", "tax_invoice", 0, { notCharged: "warranty" })] }).includes("not_charged"));
check("1: a complimentary line is amber (cost on us)", probs({ parts: [here("a")], jobs: [invoicedJob], sales: [sale("a", "quotation", 0, { notCharged: "complimentary" })] }).find((x) => x.rule === "not_charged")?.severity === "amber");
// 2. Bought, not on the quotation (open job).
check("2+: ordered with no approved quotation line: amber", probs({ parts: [part("a", { poId: "p1", orderStatus: "ordered" })], pos: [po("p1")] }).find((x) => x.rule === "not_on_quote")?.severity === "amber");
check("2+: left off the quotation", /left off/.test(probs({ parts: [part("a", { poId: "p1", orderStatus: "ordered" })], pos: [po("p1")], sales: [sale("a", "quotation", 0, { notCharged: "left_off" })] }).find((x) => x.rule === "not_on_quote")?.detail ?? ""));
check("2−: on the approved quotation", !rules({ parts: [part("a", { poId: "p1", orderStatus: "ordered" })], pos: [po("p1")], sales: [sale("a", "quotation", 150)] }).includes("not_on_quote"));
check("2−: only priced (not bought) is not a problem", !rules({ parts: [part("a", { orderStatus: "none" })] }).includes("not_on_quote"));
// 3. Received without a supplier invoice.
const r3 = (days) => probs({ pos: [po("p1", { status: "received", invoiceStatus: "to_follow", receivedAt: new Date(NOW - days * 86400000).toISOString() })] }).find((x) => x.rule === "no_supplier_invoice");
check("3+: amber, red after the red days", r3(2)?.severity === "amber" && r3(8)?.severity === "red" && /8 days ago/.test(r3(8).detail));
check("3−: invoice entered, or Our stock", !rules({ pos: [po("p1", { status: "received", invoiceStatus: "received" })] }).includes("no_supplier_invoice") && !rules({ pos: [po("p1", { status: "received", invoiceStatus: "to_follow", supplierName: "Our stock" })] }).includes("no_supplier_invoice"));
// 4. Price different from the LPO.
const line = (o) => ({ id: "l1", poId: "p1", partItemId: "a", description: "front rh wishbone link", partNumber: null, quantity: 2, unitCost: 250, receivedQty: 2, expectedDate: null, invoiceUnitCost: 260, invoiceCheck: "accepted", ...o });
const p4 = (o) => probs({ pos: [po("p1", { status: "received" })], lines: [line(o)] }).find((x) => x.rule === "price_differs");
check("4+: accepted change is amber with the words and the profit", p4({})?.severity === "amber" && /Approved 250\.00 · invoiced 260\.00 \(\+10\.00 each, \+20\.00 total\)/.test(p4({}).detail) && /−AED 20\.00/.test(p4({}).detail));
check("4+: waiting for the owner's OK / queried with the supplier are red", p4({ invoiceCheck: "mismatch" })?.severity === "red" && /owner's OK/.test(p4({ invoiceCheck: "mismatch" }).detail) && p4({ invoiceCheck: "disputed" })?.severity === "red");
check("4−: the same price", !p4({ invoiceUnitCost: 250, invoiceCheck: "match" }));
// 5. Placeholder costs: open jobs from Prices to fix, gone cars from the settled-cost rule.
const ph = probs({ parts: [part("m", { costAed: 1, poId: "p1", orderStatus: "ordered", supplier: "OFJ Additional" })], pos: [po("p1", { total: 1 })], sales: [sale("m", "quotation", 871)], placeholders: [{ partId: "m", jobId: "j1", why: "AED 1.00 is not a real price", settled: true }] }).find((x) => x.rule === "placeholder_cost");
check("5+: J-00969's moulding (AED 1.00 on an ordered LPO) from Prices to fix", ph?.severity === "red" && /AED 1\.00 is not a real price/.test(ph.detail) && /sold AED 871\.00/.test(ph.detail));
const flush = probs({ parts: [here("f", { costAed: 1, supplier: "OFJ Additional", availability: "in_stock", orderStatus: "none" })], jobs: [job("j1", { isOpen: false, status: "closed", taxInvoices: ["INV-00002"] })], sales: [sale("f", "tax_invoice", 150)] }).find((x) => x.rule === "placeholder_cost");
check("5+: J-00609's engine flush (AED 1.00, in stock, car gone, on INV-00002) from the settled-cost rule", flush?.severity === "red" && /AED 1\.00 is not a real price/.test(flush.detail));
check("5−: a real cost on a gone car", !rules({ parts: [here("f", { costAed: 80 })], jobs: [job("j1", { isOpen: false, status: "closed", taxInvoices: ["INV-1"] })], sales: [sale("f", "tax_invoice", 150)] }).includes("placeholder_cost"));
check("5−: a returned part (cost zeroed) is not a placeholder", !rules({ parts: [here("f", { disposition: "returned", finalCostAed: 0 })], jobs: [job("j1", { isOpen: false, status: "closed" })] }).includes("placeholder_cost"));
// 6. A cost changed after invoicing (INV-00003: 2 × 260 = 520 against 500 counted).
const st = probs({ parts: [here("w", { quantity: 2, costAed: 250, finalCostAed: 260 })], jobs: [invoicedJob], sales: [sale("w", "tax_invoice", 700, { cost: 500, quantity: 2 })] }).find((x) => x.rule === "stale_invoice_cost");
check("6+: INV-00003 counts 500.00, the supplier invoice makes it 520.00: profit overstated by AED 20.00", st?.severity === "red" && /counts the cost as AED 500\.00/.test(st.detail) && /makes it AED 520\.00/.test(st.detail) && /overstated by AED 20\.00/.test(st.detail) && st.amount === 20);
check("6−: the invoice counts the real cost", !rules({ parts: [here("w", { quantity: 2, costAed: 250, finalCostAed: 260 })], jobs: [invoicedJob], sales: [sale("w", "tax_invoice", 700, { cost: 520, quantity: 2 })] }).includes("stale_invoice_cost"));
check("6: a replacement's cost is followed from the original's invoice line", rules({ parts: [orig, { ...repl, finalCostAed: 140 }], jobs: [invoicedJob], sales: [sale("o", "tax_invoice", 200, { cost: 120 })] }).includes("stale_invoice_cost"));
// 7. Possible duplicate / queried invoices.
const dupRows = groupInvoices([siPo("d1", "s1", "SPARE HUB", "INV-10", 520), siPo("d2", "s1", "SPARE HUB", "INV-11", 520)], [], [], [{ id: "s1", name: "SPARE HUB", trn: "100200300400500", vat_registered: true }]);
check("7+: the same supplier, date and amount under another number is red", probs({ invoices: dupRows }).some((x) => x.rule === "duplicate_invoice" && x.severity === "red"));
check("7+: a query still open is amber", probs({ invoices: groupInvoices([siPo("q1", "s1", "SPARE HUB", "INV-12", 90, { query: "qty is 1" })], [], [], []) }).some((x) => x.rule === "duplicate_invoice" && x.severity === "amber" && /qty is 1/.test(x.detail)));
check("7−: a normal invoice", !rules({ invoices: groupInvoices([siPo("n1", "s1", "SPARE HUB", "INV-13", 90)], [], [], []) }).includes("duplicate_invoice"));
// 8. Credit note missing.
check("8+: returned, no credit note: red after 14 days", probs({ parts: [ret], pos: [po("p1", { status: "received" })] }).find((x) => x.rule === "credit_missing")?.severity === "red");
check("8−: the credit note on file", !rules({ parts: [{ ...ret, creditNotePath: "x" }], pos: [po("p1", { status: "received" })] }).includes("credit_missing"));
// 9. Supplier without TRN with invoices.
check("9+: VAT registered, no TRN, with an invoice", rules({ invoices: groupInvoices([siPo("t1", "s2", "NO TRN LLC", "INV-5", 90)], [], [], [{ id: "s2", name: "NO TRN LLC", trn: null, vat_registered: true }]) }).includes("supplier_no_trn"));
check("9−: not VAT registered", !rules({ invoices: groupInvoices([siPo("t1", "s2", "NO VAT", "INV-5", 90)], [], [], [{ id: "s2", name: "NO VAT", trn: null, vat_registered: false }]) }).includes("supplier_no_trn"));
// Order and filters.
const mixed = probs({ parts: [part("a", { poId: "p1", orderStatus: "ordered" })], pos: [po("p1"), po("p2", { status: "received", invoiceStatus: "to_follow", receivedAt: new Date(NOW - 9 * 86400000).toISOString() })] });
check("red first", mixed[0].severity === "red" && mixed.at(-1).severity === "amber");
check("problems filter by rule and by colour", filterProblems(mixed, { quick: "not_on_quote" }, []).length === 1 && filterProblems(mixed, { status: "red" }, []).every((p) => p.severity === "red"));

/* ---------- filters and totals ---------- */
const many = partLines(base({ parts: [here("a", { supplier: "SPARE HUB" }), part("b", { supplier: "AL TAYER MOTORS", jobId: "j2" })], jobs: [job("j1"), job("j2", { plate: "DUBAI X 2", jobNumber: "J-00042" })], suppliers: [sup("s1", "SPARE HUB"), sup("s3", "AL TAYER MOTORS")], sales: [sale("a", "tax_invoice", 150)] }));
check("filter by supplier id (matched by the supplier's name on a part with no LPO)", filterLines(many, { supplier: "s3" }, [sup("s1", "SPARE HUB"), sup("s3", "AL TAYER MOTORS")]).map((r) => r.partId).join() === "b");
check("filter by plate without spaces and by job number", filterLines(many, { q: "dubaix2" }, []).map((r) => r.partId).join() === "b" && filterLines(many, { q: "J-00042" }, []).length === 1);
check("filter by date (ordered else priced, a Dubai day)", filterLines(many, { from: "2026-10-21", to: "2026-10-21" }, []).length === 0 && filterLines(many, { from: "2026-10-20", to: "2026-10-20" }, []).length === 2);
check("lines quick: Bought, not invoiced / Invoiced", filterLines(many, { quick: "invoiced" }, []).map((r) => r.partId).join() === "a" && filterLines(many, { quick: "not_invoiced" }, []).length === 0);
const t = partsAccountsTotals(many, invRows, mixed);
check("totals: parts bought, charged on tax invoices, margin and %", t.bought === 100 && t.charged === 150 && t.margin === 50 && t.marginPct === 33.3);
// Review fix (3 Nov): every box opens the list its figure is made of.
const tileMix = partLines(base({ parts: [here("a"), here("b", { costAed: 40 }), part("c", { disposition: "returned", dispositionAt: "x", receivedQty: 1, orderStatus: "received" })], sales: [sale("a", "tax_invoice", 150)] }));
const tm = partsAccountsTotals(tileMix, [], []);
const boughtList = filterLines(tileMix, { quick: "bought" }, []);
check(`the Parts bought box opens exactly its lines (${tm.boughtCount} = ${boughtList.length}, AED ${tm.bought})`, PA_QUICK.lines[0].key === "bought" && tm.boughtCount === boughtList.length && tm.bought === Math.round(boughtList.reduce((a, l) => a + l.cost, 0) * 100) / 100 && tm.boughtCount === 2);
check("the Charged box opens exactly its lines", tm.chargedCount === filterLines(tileMix, { quick: "invoiced" }, []).length && tileMix.filter(isChargedLine).length === tm.chargedCount && tileMix.filter(isBoughtLine).length === tm.boughtCount);
// 5 November 2026 (Mathew): VAT only from a supplier registered WITH a TRN - INV-9's supplier has none, so no VAT on it.
check("totals: owed to suppliers with VAT (none from the supplier with no TRN), invoices to follow apart", t.owed === 1250 && t.owedCount === 2 && t.toFollow === 315 && t.toFollowCount === 1, `owed ${t.owed}`);
check("totals: problems and red ones", t.problems === mixed.length && t.problemsRed === mixed.filter((p) => p.severity === "red").length);

/* ---------- the suppliers list ---------- */
check("needs a TRN: VAT registered without 15 digits", supplierNeedsTrn({ name: "A", trn: null, vat_registered: true }) && supplierNeedsTrn({ name: "A", trn: "1234", vat_registered: null }));
check("needs no TRN: has 15 digits, not VAT registered, or Our stock", !supplierNeedsTrn({ name: "A", trn: "100200300400500", vat_registered: true }) && !supplierNeedsTrn({ name: "A", trn: null, vat_registered: false }) && !supplierNeedsTrn({ name: "Our Stock", trn: null, vat_registered: true }));
const s = { name: "Gargash Enterprises L.L.C", trn: "100236472100003", phone: "+971 52 956 2232", email: "parts@gargash.example", contact_name: "Rahul", notes: "Mercedes genuine", address: "Deira", payment_terms: "30 days" };
check("search by name, any case", supplierSearchHit(s, "gargash") && supplierSearchHit(s, "GARGASH ENT"));
check("search by phone digits however typed", supplierSearchHit(s, "052 956 2232") && supplierSearchHit(s, "0529562232") && supplierSearchHit(s, "9562232"));
check("search by TRN digits", supplierSearchHit(s, "100236472100003") && supplierSearchHit(s, "2361 0000") === false && supplierSearchHit(s, "47210"));
// Review fix (3 Nov): landlines in either format.
check("the national number of a phone", nationalNumber("+971 4 555 1212") === "45551212" && nationalNumber("04 555 1212") === "45551212" && nationalNumber("00971 4 555 1212") === "45551212" && nationalNumber("+971 52 956 2232") === "529562232" && nationalNumber("052 956 2232") === "529562232");
check("a landline stored +971 4 is found by 04 …, and the other way round", supplierSearchHit({ name: "A", phone: "+971 4 555 1212" }, "04 555 1212") && supplierSearchHit({ name: "A", phone: "04 555 1212" }, "+971 4 555 1212") && supplierSearchHit({ name: "A", phone: "+971 4 555 1212" }, "045551212") && supplierSearchHit({ name: "A", phone: "+971 4 555 1212" }, "555 1212"));
check("a different landline is not found", !supplierSearchHit({ name: "A", phone: "+971 4 555 1212" }, "04 555 9999"));
check("search by contact person, email and notes", supplierSearchHit(s, "rahul") && supplierSearchHit(s, "parts@") && supplierSearchHit(s, "genuine"));
check("no hit on something else; empty search shows all", !supplierSearchHit(s, "toyota") && supplierSearchHit(s, "") && !supplierSearchHit({ name: "X" }, "1234"));
check("digitsOf and the quick filter names", digitsOf("+971 (4) 123-45") === "971412345" && asSupplierFilter("unpaid") === "unpaid" && asSupplierFilter("no_trn") === "no_trn" && asSupplierFilter("x") === null);

/* ---------- the Supplier invoices filters travel whole (screen = export) ---------- */
const fp = invoiceFilterParams({ supplier: "s1", unpaid: "1", problems: "", q: " 4512 ", job: "j9", open: "x" });
check(`the export carries Unpaid, the search and the car (${JSON.stringify(fp)})`, JSON.stringify(fp) === JSON.stringify([["supplier", "s1"], ["unpaid", "1"], ["q", "4512"], ["job", "j9"]]));
const back = invoiceFilterOf((k) => new URLSearchParams(fp).get(k));
check("and reads back as the same filter", back.unpaid === true && back.problems === false && back.supplier === "s1" && back.q === "4512" && back.job === "j9");

/* ---------- integration with section 7 (endings) and section 9 (units), 3 November 2026 ---------- */
// Section 9's ONE unit rule: litres, sets and pieces by its cleanUnit; an unknown word shows the number alone.
check("units through section 9: 8 L, 6.5 L, litres, a kit is a set, pieces and unknown words show the number", qtyWithUnit(8, "l") === "8 L" && qtyWithUnit(6.5, "L") === "6.5 L" && qtyWithUnit(2, "litres") === "2 L" && qtyWithUnit(1, "kit") === "1 set" && qtyWithUnit(3, "pc") === "3" && qtyWithUnit(3, "boxes") === "3");
check("a part line in litres reads 8 L", partLines(base({ parts: [part("oil", { quantity: 8, unit: "l", costAed: 30 })] }))[0].qtyWords === "8 L");
// Section 7 writes every ending with removed_at set and the part inactive: never plain "Removed".
const ended = (id, o = {}) => part(id, { isActive: false, removedAt: "2026-10-20T08:00:00Z", notNeededAt: "2026-10-20T08:00:00Z", dispositionAt: "2026-10-20T08:00:00Z", finalCostAed: 0, costAed: 300, poId: "p7", ...o });
const p7 = po("p7", { status: "received" });
const cx = ended("cx", { disposition: "cancelled", orderStatus: "none" });
const cxLine = partLines(base({ parts: [cx], pos: [p7] }))[0];
check("cancelled with the supplier: its own ending, cost off the job, never bought", partEnding(cx) === "cancelled" && cxLine.ending === "cancelled" && cxLine.cost === 0 && cxLine.costFrom === "Cancelled: nothing to pay" && !isBoughtLine(cxLine) && cxLine.stateWords === "Cancelled with the supplier");
check("before section 7's migration (disposition empty, disposition_at set) it still reads cancelled", partEnding(ended("cx0", { disposition: null, orderStatus: "none", returnStatus: "none" })) === "cancelled");
check("cancelled, LPO not paid: nothing to credit, not in Returns and credits", returnStateOf(cx, p7) === null && returnRows(base({ parts: [cx], pos: [p7] })).length === 0);
const p7paid = po("p7", { status: "received", paidAt: "2026-10-18T08:00:00Z" });
const cxPaid = returnRows(base({ parts: [cx], pos: [p7paid], lines: [{ id: "l7", poId: "p7", partItemId: "cx", description: "x", partNumber: null, quantity: 2, unitCost: 150, receivedQty: 0, expectedDate: null, invoiceUnitCost: null, invoiceCheck: null }] }))[0];
check(`cancelled after the LPO was paid: a credit is due, counting what was ordered (${cxPaid?.state} ${cxPaid?.credit})`, cxPaid?.state === "credit_due" && cxPaid.credit === 300 && !cxPaid.overdue);
const cxProb = partsProblems(base({ parts: [cx], pos: [p7paid] })).find((x) => x.rule === "credit_missing");
check("and an amber Problems line asks for that credit", cxProb?.severity === "amber" && /after LPO-p7 was paid/.test(cxProb.detail));
check("cancelled after a later payment: nothing due", returnStateOf(cx, po("p7", { paidAt: "2026-10-25T08:00:00Z" })) === null);
const rp = ended("rp", { disposition: "return_pending", orderStatus: "received", receivedQty: 1, returnedQty: 1, returnStatus: "to_return" });
const rpLine = { id: "l8", poId: "p7", partItemId: "rp", description: "x", partNumber: null, quantity: 1, unitCost: 300, receivedQty: 1, expectedDate: null, invoiceUnitCost: 280, invoiceCheck: "accepted" };
const rpRow = returnRows(base({ parts: [rp], pos: [p7], lines: [rpLine] }))[0];
check(`return to supplier, credit note awaited: waiting for the credit note (${rpRow?.state})`, partEnding(rp) === "return_pending" && rpRow?.state === "waiting_credit" && rpRow.overdue && rpRow.waitingDays === 14);
check(`its credit is section 7's returnCreditOf: the supplier invoice price on its LPO line (${rpRow?.credit})`, rpRow?.credit === 280 && expectedCredit(rp, rpLine) === 280 && expectedCredit(rp, { ...rpLine, invoiceUnitCost: null }) === 300);
check("it is a credit, not a cost: not in Parts bought, cost 0", (() => { const l = partLines(base({ parts: [rp], pos: [p7] }))[0]; return l.cost === 0 && !isBoughtLine(l) && l.costFrom === "Returned: credit due"; })());
check("before the migration a return pending (to_return + disposition_at) reads the same, never To go back", returnStateOf(ended("rp0", { disposition: null, orderStatus: "received", receivedQty: 1, returnStatus: "to_return" }), p7) === "waiting_credit");
check("the red Problems line for it", partsProblems(base({ parts: [rp], pos: [p7], lines: [rpLine] })).some((x) => x.rule === "credit_missing" && x.severity === "red"));
const rd = ended("rd", { disposition: "returned", orderStatus: "received", receivedQty: 1, returnedQty: 1, returnStatus: "returned", creditNumber: "CN-700", creditAmount: 250, creditDate: "2026-10-22" });
const rdRow = returnRows(base({ parts: [rd], pos: [p7], lines: [{ ...rpLine, partItemId: "rd" }] }))[0];
check(`returned with section 7's credit note: on file, credited at its typed amount (${rdRow?.credit})`, rdRow?.state === "credit_on_file" && rdRow.credit === 250 && rdRow.creditNote.number === "CN-700");
const ks = ended("ks", { disposition: "stock", orderStatus: "received", receivedQty: 1 });
check("kept in stock: its ending, cost off the job, not in Returns and credits", partEnding(ks) === "stock" && partLines(base({ parts: [ks], pos: [p7] }))[0].cost === 0 && returnStateOf(ks, p7) === null);
const stale = partsProblems(base({ parts: [cx], pos: [p7], sales: [sale("cx", "tax_invoice", 500, { cost: 300 })], jobs: [job("j1", { taxInvoices: ["INV-00003"] })] })).find((x) => x.rule === "stale_invoice_cost");
check("ended after its tax invoice: the invoice still counts the cost, a red line until corrected", stale?.severity === "red" && /cancelled with the supplier after it/.test(stale.detail) && stale.amount === -300);
check("a plain removed part (never ordered) is still Removed", partEnding(part("rm", { removedAt: "x" })) === "removed");

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
