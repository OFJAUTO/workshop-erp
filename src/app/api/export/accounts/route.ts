import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { INVOICE_SELECT, METHOD_LABELS, PAYMENT_SELECT, toInvoice, toPayment } from "@/lib/invoice-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";
import { feeOf } from "@/lib/card-settlement-rules";

export const dynamic = "force-dynamic";

const day = (iso: string | null | undefined) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00Z") : null);

/** Invoices and payments as a real Excel file for the accountants, until the Zoho link is built. ?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "exportAccounts")) return new NextResponse("Not allowed.", { status: 403 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const admin = createAdminClient();
  let iq = admin.from("invoices").select(INVOICE_SELECT + ", job:jobs!invoices_job_id_fkey(job_number), customer:customers(full_name, company_name, trn)").eq("is_active", true).order("issued_at");
  let pq = admin.from("payments").select(PAYMENT_SELECT + ", job:jobs(job_number), invoice:invoices(number), customer:customers(full_name, company_name)").eq("is_active", true).order("received_at");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    iq = iq.gte("issued_at", `${from}T00:00:00+04:00`);
    pq = pq.gte("received_at", `${from}T00:00:00+04:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    iq = iq.lte("issued_at", `${to}T23:59:59+04:00`);
    pq = pq.lte("received_at", `${to}T23:59:59+04:00`);
  }
  const [{ data: invoices }, { data: payments }] = await Promise.all([iq, pq]);
  const invNumber = new Map<string, string>();
  for (const r of (invoices ?? []) as unknown as Record<string, unknown>[]) {
    const inv = toInvoice(r);
    invNumber.set(inv.id, inv.number);
  }
  const money = "#,##0.00";
  const invoiceRows = ((invoices ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const inv = toInvoice(r);
    const job = r.job as { job_number: string } | null;
    const c = r.customer as { full_name: string; company_name: string | null; trn: string | null } | null;
    return { number: inv.number, kind: inv.kind, date: day(inv.issued_at), status: inv.status, job: job?.job_number ?? "", customer: c?.company_name ?? c?.full_name ?? "", trn: c?.trn ?? "", gross: inv.subtotal_aed, discount: inv.discount_aed, taxable: inv.taxable_aed, vat: inv.vat_aed, total: inv.total_aed, creditOf: inv.credit_of ? (invNumber.get(inv.credit_of) ?? inv.credit_of) : "" };
  });
  const paymentRows = ((payments ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const p = toPayment(r);
    const job = r.job as { job_number: string } | null;
    const inv = r.invoice as { number: string } | null;
    const c = r.customer as { full_name: string; company_name: string | null } | null;
    return { number: p.number, date: day(p.received_at), method: METHOD_LABELS[p.method], amount: p.amount_aed, charge: feeOf(p).fee, chargeKind: feeOf(p).fee > 0 ? (feeOf(p).actual ? "actual" : "estimate") : "", invoice: inv?.number ?? "", job: job?.job_number ?? "", customer: c?.company_name ?? c?.full_name ?? "", reference: p.reference ?? "", chequeNo: p.cheque_number ?? "", chequeBank: p.cheque_bank ?? "", chequeDate: day(p.cheque_date), chequeStatus: p.cheque_status ?? "", status: p.status, deposit: p.is_deposit ? "yes" : "" };
  });
  const buffer = await buildXlsx([
    {
      name: "Invoices",
      columns: [
        { header: "Number", key: "number", width: 12 }, { header: "Kind", key: "kind", width: 12 }, { header: "Date", key: "date", width: 12 },
        { header: "Status", key: "status", width: 10 }, { header: "Job card", key: "job", width: 10 }, { header: "Customer", key: "customer", width: 26 },
        { header: "Customer TRN", key: "trn", width: 16 }, { header: "Gross", key: "gross", width: 12, numFmt: money }, { header: "Discount", key: "discount", width: 12, numFmt: money },
        { header: "Taxable", key: "taxable", width: 12, numFmt: money }, { header: "VAT", key: "vat", width: 12, numFmt: money }, { header: "Total", key: "total", width: 13, numFmt: money },
        { header: "Credit of", key: "creditOf", width: 12 },
      ],
      rows: invoiceRows,
      totals: { customer: "TOTAL", gross: invoiceRows.reduce((a, r) => a + r.gross, 0), discount: invoiceRows.reduce((a, r) => a + r.discount, 0), taxable: invoiceRows.reduce((a, r) => a + r.taxable, 0), vat: invoiceRows.reduce((a, r) => a + r.vat, 0), total: invoiceRows.reduce((a, r) => a + r.total, 0) },
    },
    {
      name: "Payments",
      columns: [
        { header: "Receipt", key: "number", width: 12 }, { header: "Date", key: "date", width: 12 }, { header: "Method", key: "method", width: 12 },
        { header: "Amount", key: "amount", width: 12, numFmt: money }, { header: "Bank charge", key: "charge", width: 12, numFmt: money }, { header: "Charge is", key: "chargeKind", width: 10 },
        { header: "Invoice", key: "invoice", width: 12 }, { header: "Job card", key: "job", width: 10 }, { header: "Customer", key: "customer", width: 26 },
        { header: "Reference", key: "reference", width: 14 }, { header: "Cheque no.", key: "chequeNo", width: 12 }, { header: "Cheque bank", key: "chequeBank", width: 14 },
        { header: "Cheque date", key: "chequeDate", width: 12 }, { header: "Cheque status", key: "chequeStatus", width: 12 }, { header: "Status", key: "status", width: 12 },
        { header: "Deposit", key: "deposit", width: 9 },
      ],
      rows: paymentRows,
      totals: { customer: "TOTAL", amount: paymentRows.reduce((a, r) => a + r.amount, 0), charge: paymentRows.reduce((a, r) => a + r.charge, 0) },
    },
  ]);
  return xlsxResponse(buffer, `OFJ accounts ${from || "all"} to ${to || "today"}.xlsx`);
}
