import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { PAYMENT_SELECT, loadInvoice, toPayment } from "@/lib/invoice-data";
import { renderReceiptPdf, type ReceiptData, type ReceiptSummary } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { depositState } from "@/lib/deposits";
import { round2 } from "@/lib/money";
import { formatPlate } from "@/lib/types";
import { formatPhone } from "@/lib/messages";

export const dynamic = "force-dynamic";

type VehicleRow = Parameters<typeof formatPlate>[0] & { has_plate: boolean; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

/** The receipt for one payment: the 26 October layout. Owner, accounts and advisors; the customer with a link token. */
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
  const [invoice, { data: customer }, { data: job }, { data: payRows }] = await Promise.all([
    payment.invoice_id ? loadInvoice(payment.invoice_id) : Promise.resolve(null),
    admin.from("customers").select("full_name, company_name, phone, trn").eq("id", payment.customer_id).maybeSingle(),
    payment.job_id
      ? admin.from("jobs").select("job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", payment.job_id).maybeSingle()
      : Promise.resolve({ data: null }),
    payment.job_id ? admin.from("payments").select(PAYMENT_SELECT).eq("job_id", payment.job_id).eq("is_active", true) : Promise.resolve({ data: null }),
  ]);
  const v = ((job as { vehicle?: unknown } | null)?.vehicle as VehicleRow | null) ?? null;
  const vehicle = v
    ? { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ") || null, plate: v.has_plate === false ? "NO PLATE" : formatPlate(v), vin: v.vin ?? null }
    : null;

  // Paid to date on the job: every recorded payment, deposits included (a pending cheque counts, with its note).
  const recorded = ((payRows ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded");
  const paid = round2(recorded.reduce((a, p) => a + p.amount_aed, 0));
  const pendingCheque = recorded.some((p) => p.method === "cheque" && p.cheque_status === "pending");
  const summaryOf = (totalLabel: string, total: number): ReceiptSummary => ({
    totalLabel,
    total,
    paid,
    balance: round2(Math.max(0, total - paid)),
    paidInFull: total > 0 && total - paid <= 0.005 && !pendingCheque,
    pendingCheque,
  });

  let forLine: string;
  let docRef: ReceiptData["docRef"] = null;
  let summary: ReceiptSummary | null = null;
  if (invoice) {
    const kind = invoice.invoice.kind;
    forLine = `Payment against ${kind === "proforma" ? "proforma invoice" : kind === "credit_note" ? "credit note" : "invoice"} ${invoice.invoice.number}`;
    docRef = { label: kind === "proforma" ? "Proforma" : kind === "credit_note" ? "Credit note" : "Invoice", value: invoice.invoice.number };
    if (kind !== "credit_note") summary = summaryOf(kind === "proforma" ? "Proforma total" : "Invoice total", invoice.invoice.total_aed);
  } else {
    const st = payment.job_id ? await depositState(payment.job_id) : null;
    const qn = st?.quotationNumbers.join(", ") || null;
    forLine = `Advance payment (deposit)${qn ? ` against quotation ${qn}` : ""}`;
    if (qn) docRef = { label: "Quotation", value: qn };
    if (st && st.quotationTotal > 0) summary = summaryOf("Quotation total", st.quotationTotal);
  }

  const data: ReceiptData = {
    payment,
    customer: customer ? { ...(customer as NonNullable<ReceiptData["customer"]>), phone: customer.phone ? formatPhone(customer.phone) : null } : null,
    jobNumber: (job as { job_number: string } | null)?.job_number ?? null,
    vehicle,
    docRef,
    forLine,
    summary,
    invoiceToken: invoice?.invoice.token ?? null,
  };
  const pdf = await renderReceiptPdf(data, await getSettings());
  return pdfResponse(pdf, `OFJ Receipt ${payment.number}.pdf`);
}
