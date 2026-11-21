import { getCurrentStaff } from "@/lib/auth";
import { loadVouchers } from "@/lib/journal-vouchers";
import { jvPaidByLabel, jvTypeLabel } from "@/lib/jv-rules";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** The Journal Vouchers as a real Excel file (21 November 2026, Section 2): owner and accounts only. */
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts"].includes(staff.role_id)) return Response.json({ error: "Not allowed." }, { status: 403 });
  const vs = await loadVouchers();
  const rows = vs.map((v) => ({
    number: v.number,
    status: v.status === "void" ? "Void" : v.status === "unpaid" ? "Pay later" : "Paid",
    paidOn: v.paidOn ?? "",
    type: jvTypeLabel(v.type),
    description: v.description ?? "",
    jobs: v.jobs.join(", "),
    provider: v.provider ?? "",
    trn: v.providerTrn ?? "",
    invoice: v.providerInvoice ?? "",
    invoiceDate: v.providerInvoiceDate ?? "",
    amount: v.amount,
    vat: v.vat,
    total: Math.round((v.amount + v.vat) * 100) / 100,
    paidBy: v.status === "unpaid" ? "Not paid yet" : jvPaidByLabel(v.paidBy) + (v.staffName ? ` (${v.staffName})` : ""),
    reference: v.reference ?? "",
    receipt: v.noReceipt ? "No receipt" : v.proofPath ? "Proof attached" : "",
    by: v.by ?? "",
  }));
  const live = rows.filter((r) => r.status !== "Void");
  const buf = await buildXlsx([
    {
      name: "Journal vouchers",
      columns: [
        { header: "JV number", key: "number", width: 11 },
        { header: "Status", key: "status", width: 10 },
        { header: "Paid on", key: "paidOn", width: 11 },
        { header: "Type", key: "type", width: 16 },
        { header: "Description", key: "description", width: 40 },
        { header: "Job", key: "jobs", width: 12 },
        { header: "Provider", key: "provider", width: 30 },
        { header: "Provider TRN", key: "trn", width: 17 },
        { header: "Invoice number", key: "invoice", width: 16 },
        { header: "Invoice date", key: "invoiceDate", width: 12 },
        { header: "Amount before VAT (AED)", key: "amount", width: 14, numFmt: "#,##0.00" },
        { header: "VAT (AED)", key: "vat", width: 10, numFmt: "#,##0.00" },
        { header: "Total (AED)", key: "total", width: 12, numFmt: "#,##0.00" },
        { header: "Who paid", key: "paidBy", width: 22 },
        { header: "Reference", key: "reference", width: 16 },
        { header: "Receipt", key: "receipt", width: 14 },
        { header: "Recorded by", key: "by", width: 16 },
      ],
      rows,
      totals: { number: "Total (not void)", amount: live.reduce((a, r) => a + r.amount, 0), vat: live.reduce((a, r) => a + r.vat, 0), total: live.reduce((a, r) => a + r.total, 0) },
    },
  ]);
  return xlsxResponse(buf, `OFJ Journal vouchers ${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}.xlsx`);
}
