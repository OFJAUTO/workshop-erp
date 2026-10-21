import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { loadCommissions } from "@/lib/commissions";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** The month's commissions as .xlsx (accounts and the owner): one sheet, every bucket with its state. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !(staff.role_id === "owner" || staff.role_id === "accounts")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const month = request.nextUrl.searchParams.get("month") ?? new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const { pending, ready, waiting, paid } = await loadCommissions();
  const inMonth = (d: string | null) => !!d && d.startsWith(month);
  const rows = [
    ...pending.filter((r) => inMonth(r.setAt)).map((r) => ({ state: "Pending owner approval", ...r })),
    ...ready.filter((r) => inMonth(r.decidedAt ?? r.setAt)).map((r) => ({ state: "Ready to pay", ...r })),
    ...waiting.filter((r) => inMonth(r.decidedAt ?? r.setAt)).map((r) => ({ state: "Approved, waiting for the customer", ...r })),
    ...paid.filter((r) => inMonth(r.paidAt)).map((r) => ({ state: "Paid", ...r })),
  ].map((r) => ({
    state: r.state,
    recipient: r.recipient,
    phone: r.phone ?? "",
    job: r.jobNumber,
    plate: r.plate,
    car: r.carTitle,
    quotation: `${r.quotation} v${r.version}`,
    invoice: r.invoiceNumber ?? "",
    customer_paid: r.customerPaid ? "Yes" : "No",
    amount: r.amount,
    added_by: r.setByName ?? "",
    added_at: r.setAt ? new Date(r.setAt) : "",
    paid_at: r.paidAt ? new Date(r.paidAt) : "",
    paid_by: r.paidByName ?? "",
    method: r.paidMethod === "transfer" ? "Bank transfer" : (r.paidMethod ?? ""),
    voucher: r.voucherNumber ?? "",
    reference: r.reference ?? "",
    proof: r.status === "paid" ? (r.proofMissing ? "Missing" : "Uploaded") : "",
    note: r.paidNote ?? "",
  }));
  const buffer = await buildXlsx([
    {
      name: `Commissions ${month}`,
      columns: [
        { header: "State", key: "state", width: 26 },
        { header: "Recipient", key: "recipient", width: 18 },
        { header: "Mobile", key: "phone", width: 18 },
        { header: "Job", key: "job", width: 10 },
        { header: "Plate", key: "plate", width: 14 },
        { header: "Car", key: "car", width: 20 },
        { header: "Quotation", key: "quotation", width: 14 },
        { header: "Invoice", key: "invoice", width: 12 },
        { header: "Customer paid", key: "customer_paid", width: 12 },
        { header: "Amount AED", key: "amount", width: 12, numFmt: "#,##0.00" },
        { header: "Added by", key: "added_by", width: 14 },
        { header: "Added", key: "added_at", width: 16, numFmt: "dd mmm yyyy" },
        { header: "Paid", key: "paid_at", width: 16, numFmt: "dd mmm yyyy" },
        { header: "Paid by", key: "paid_by", width: 14 },
        { header: "Method", key: "method", width: 14 },
        { header: "Voucher no.", key: "voucher", width: 12 },
        { header: "Reference", key: "reference", width: 16 },
        { header: "Proof", key: "proof", width: 10 },
        { header: "Note", key: "note", width: 24 },
      ],
      rows,
    },
  ]);
  return xlsxResponse(buffer, `OFJ Commissions ${month}.xlsx`);
}
