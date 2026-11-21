// The final tax invoice after an advance tax invoice (21 November 2026, J-01013): the pure rules.
//   node tests/unit/final-invoice.test.mjs
const mod = await import("file:///" + process.cwd().replaceAll("\\", "/") + "/src/lib/final-invoice-rules.ts");
const { finalBlock, finalRows, isAdvanceTaxInvoice, isAdvanceMoney, finalBalance, advanceSteps, cleanAdvanceDetails } = mod;

let n = 0;
const ok = (name, cond, extra) => { n++; if (!cond) { console.error(`FAIL ${name}`, extra ?? ""); process.exitCode = 1; } else console.log(`OK   ${name}`); };

const adv = { id: "a", number: "INV-00037", issued_at: "2026-11-16T09:27:26Z", taxable_aed: 7619.05, vat_aed: 380.95, total_aed: 8000 };
const b = finalBlock({ taxable: 9523.81, vat: 476.19, total: 10000 }, [adv]);
ok("J-01013: this invoice 1,904.76 + 95.24 = 2,000.00", b.thisInvoice.taxable === 1904.76 && b.thisInvoice.vat === 95.24 && b.thisInvoice.total === 2000, b.thisInvoice);
ok("VAT once: 380.95 + 95.24 = 476.19", Math.round((b.advance.vat + b.thisInvoice.vat) * 100) === 47619);
ok("no credit", b.credit === 0);
const rows = finalRows(b, 5);
ok("three rows in order", rows.map((r) => r.key).join(",") === "work,advance,this");
ok("advance row names INV-00037 and its day", /INV-00037 \(16 NOV 2026\)/.test(rows[1].label), rows[1].label);
ok("this invoice row has taxable and VAT", rows[2].split === "TAXABLE 1,904.76 + VAT 95.24");
ok("no block without an advance", finalBlock({ taxable: 1, vat: 0.05, total: 1.05 }, []) === null);

// Work added: 12,000 job.
const up = finalBlock({ taxable: 11428.57, vat: 571.43, total: 12000 }, [adv]);
ok("higher total: this invoice 4,000.00 with VAT 190.48", up.thisInvoice.total === 4000 && up.thisInvoice.vat === 190.48 && up.thisInvoice.taxable === 3809.52, up.thisInvoice);
// Work removed below the advance: 7,000 job.
const down = finalBlock({ taxable: 6666.67, vat: 333.33, total: 7000 }, [adv]);
ok("lower than the advance: this invoice 0.00, never negative", down.thisInvoice.total === 0 && down.thisInvoice.vat === 0);
ok("lower than the advance: credit 1,000.00 (VAT 47.62)", down.credit === 1000 && down.creditVat === 47.62, down);
ok("credit row shown", finalRows(down).some((r) => r.key === "credit"));
// Two advances.
const two = finalBlock({ taxable: 9523.81, vat: 476.19, total: 10000 }, [adv, { id: "b", number: "INV-00040", issued_at: "2026-11-18T08:00:00Z", taxable_aed: 952.38, vat_aed: 47.62, total_aed: 1000 }]);
ok("two advances add up", two.advance.total === 9000 && two.thisInvoice.total === 1000 && two.thisInvoice.vat === 47.62, two.thisInvoice);

ok("advance tax invoice recognised", isAdvanceTaxInvoice({ kind: "tax_invoice", deposit_for_quotation_id: "q" }) && !isAdvanceTaxInvoice({ kind: "tax_invoice", deposit_for_quotation_id: null }) && !isAdvanceTaxInvoice({ kind: "proforma", deposit_for_quotation_id: "q" }));
ok("the advance's own money is recognised", isAdvanceMoney({ deposit_invoice_number: "INV-00037" }, b) && !isAdvanceMoney({ deposit_invoice_number: null }, b));
ok("balance of this invoice", finalBalance(b, 0) === 2000 && finalBalance(b, 2000) === 0 && finalBalance(b, 500) === 1500);

const s1 = advanceSteps({ advancePaid: true, advanceInvoiced: true, jobDone: true, finalInvoice: false, balancePaid: true, gatedOut: false });
ok("J-01013 today: Final tax invoice is the current step, not ticked", s1.find((s) => s.key === "final_invoice").state === "current" && s1.find((s) => s.key === "balance").state === "later");
const s2 = advanceSteps({ advancePaid: true, advanceInvoiced: true, jobDone: true, finalInvoice: true, balancePaid: true, gatedOut: false });
ok("after the final invoice: gate-out current", s2.find((s) => s.key === "gate_out").state === "current" && s2.filter((s) => s.state === "done").length === 6);
ok("the false VAT remark is removed", cleanAdvanceDetails("VAT included in this amount") === null && cleanAdvanceDetails("Front brakes") === "Front brakes");

console.log(`${n} checks`);
