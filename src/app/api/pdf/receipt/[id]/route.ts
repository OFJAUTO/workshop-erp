import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { PAYMENT_SELECT, loadInvoice, toPayment } from "@/lib/invoice-data";
import { renderReceiptPdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The receipt for one payment: owner, accounts and advisors. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select(PAYMENT_SELECT).eq("id", id).maybeSingle();
  if (!raw) return new NextResponse("Not found.", { status: 404 });
  const payment = toPayment(raw as Record<string, unknown>);
  // The customer opens a receipt from the invoice page with the invoice's own link token; staff with a login.
  const t = request.nextUrl.searchParams.get("t");
  let allowed = false;
  if (t && payment.invoice_id) {
    const { data: inv } = await admin.from("invoices").select("token, converted_from").eq("id", payment.invoice_id).maybeSingle();
    const { data: from } = inv?.converted_from ? await admin.from("invoices").select("token").eq("id", inv.converted_from).maybeSingle() : { data: null };
    allowed = !!inv && (inv.token === t || from?.token === t);
  }
  if (!allowed) {
    const staff = await getCurrentStaff();
    if (!staff) return new NextResponse("Please sign in.", { status: 401 });
    if (!can(staff.role_id as RoleId, "viewInvoices")) return new NextResponse("Not allowed.", { status: 403 });
  }
  const [invoice, { data: customer }, { data: job }, { data: by }] = await Promise.all([
    payment.invoice_id ? loadInvoice(payment.invoice_id) : Promise.resolve(null),
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", payment.customer_id).maybeSingle(),
    payment.job_id ? admin.from("jobs").select("job_number").eq("id", payment.job_id).maybeSingle() : Promise.resolve({ data: null }),
    payment.received_by ? admin.from("staff").select("display_name").eq("id", payment.received_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pdf = await renderReceiptPdf(payment, invoice, (customer as { full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null) ?? null, (job as { job_number: string } | null) ?? null, await getSettings(), (by as { display_name: string } | null)?.display_name ?? null);
  return pdfResponse(pdf, `OFJ Receipt ${payment.number}.pdf`);
}
