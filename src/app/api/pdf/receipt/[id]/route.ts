import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { PAYMENT_SELECT, loadInvoice, toPayment } from "@/lib/invoice-data";
import { renderReceiptPdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { depositState } from "@/lib/deposits";
import { round2 } from "@/lib/money";

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
  // A deposit receipt reaches the customer with the quotation's own link token.
  const qt = request.nextUrl.searchParams.get("q");
  if (!allowed && qt && payment.job_id) {
    const { data: qq } = await admin.from("quotations").select("id").eq("job_id", payment.job_id).eq("token", qt).maybeSingle();
    allowed = !!qq;
  }
  if (!allowed) {
    const access = await staffPdfAccess("document");
    if ("refused" in access) return access.refused;
  }
  const [invoice, { data: customer }, { data: job }, { data: by }] = await Promise.all([
    payment.invoice_id ? loadInvoice(payment.invoice_id) : Promise.resolve(null),
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", payment.customer_id).maybeSingle(),
    payment.job_id ? admin.from("jobs").select("job_number").eq("id", payment.job_id).maybeSingle() : Promise.resolve({ data: null }),
    payment.received_by ? admin.from("staff").select("display_name").eq("id", payment.received_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // A deposit: the quotation it was asked for on and what remains of it after every deposit so far.
  let deposit: { quotationNumber: string | null; quotationTotal: number; received: number; balance: number } | null = null;
  if (payment.job_id && (payment.is_deposit || !payment.invoice_id)) {
    const st = await depositState(payment.job_id);
    deposit = { quotationNumber: st.quotationNumbers.join(", ") || null, quotationTotal: st.quotationTotal, received: st.received, balance: round2(Math.max(0, st.quotationTotal - st.received)) };
  }
  const pdf = await renderReceiptPdf(payment, invoice, (customer as { full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null) ?? null, (job as { job_number: string } | null) ?? null, await getSettings(), (by as { display_name: string } | null)?.display_name ?? null, deposit);
  return pdfResponse(pdf, `OFJ Receipt ${payment.number}.pdf`);
}
