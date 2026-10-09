import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { INVOICE_SELECT, METHOD_LABELS, PAYMENT_SELECT, toInvoice, toPayment } from "@/lib/invoice-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cells: unknown[]) => cells.map(cell).join(",");

/** Invoices and payments as a spreadsheet file (CSV, opens in Excel) for the accountants, until the Zoho link is built. ?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "exportAccounts")) return new NextResponse("Not allowed.", { status: 403 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const admin = createAdminClient();
  let iq = admin.from("invoices").select(INVOICE_SELECT + ", job:jobs(job_number), customer:customers(full_name, company_name, trn)").eq("is_active", true).order("issued_at");
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
  const lines: string[] = [];
  lines.push("INVOICES");
  lines.push(row(["Number", "Kind", "Date", "Status", "Job card", "Customer", "Customer TRN", "Gross", "Discount", "Taxable", "VAT", "Total", "Credit of"]));
  const invNumber = new Map<string, string>();
  for (const r of (invoices ?? []) as unknown as Record<string, unknown>[]) {
    const inv = toInvoice(r);
    invNumber.set(inv.id, inv.number);
  }
  for (const r of (invoices ?? []) as unknown as Record<string, unknown>[]) {
    const inv = toInvoice(r);
    const job = r.job as { job_number: string } | null;
    const c = r.customer as { full_name: string; company_name: string | null; trn: string | null } | null;
    lines.push(row([inv.number, inv.kind, inv.issued_at.slice(0, 10), inv.status, job?.job_number ?? "", c?.company_name ?? c?.full_name ?? "", c?.trn ?? "", inv.subtotal_aed.toFixed(2), inv.discount_aed.toFixed(2), inv.taxable_aed.toFixed(2), inv.vat_aed.toFixed(2), inv.total_aed.toFixed(2), inv.credit_of ? (invNumber.get(inv.credit_of) ?? inv.credit_of) : ""]));
  }
  lines.push("");
  lines.push("PAYMENTS");
  lines.push(row(["Receipt", "Date", "Method", "Amount", "Bank charge", "Invoice", "Job card", "Customer", "Reference", "Cheque no.", "Cheque bank", "Cheque date", "Cheque status", "Status", "Deposit"]));
  for (const r of (payments ?? []) as unknown as Record<string, unknown>[]) {
    const p = toPayment(r);
    const job = r.job as { job_number: string } | null;
    const inv = r.invoice as { number: string } | null;
    const c = r.customer as { full_name: string; company_name: string | null } | null;
    lines.push(row([p.number, p.received_at.slice(0, 10), METHOD_LABELS[p.method], p.amount_aed.toFixed(2), p.bank_charge_aed.toFixed(2), inv?.number ?? "", job?.job_number ?? "", c?.company_name ?? c?.full_name ?? "", p.reference ?? "", p.cheque_number ?? "", p.cheque_bank ?? "", p.cheque_date ?? "", p.cheque_status ?? "", p.status, p.is_deposit ? "yes" : ""]));
  }
  const name = `OFJ accounts ${from || "all"} to ${to || "today"}.csv`;
  return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
