import { NextResponse, type NextRequest } from "next/server";
import { loadInvoice } from "@/lib/invoice-data";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The customer's invoice as a PDF, from the same link token as the page. The status reflects this moment. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const { data: row } = await createAdminClient().from("invoices").select("id").eq("token", token).eq("is_active", true).maybeSingle();
  if (!row) return new NextResponse("This link is not valid. Please ask the workshop for a new one.", { status: 404 });
  const bundle = await loadInvoice(row.id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  const pdf = await renderInvoicePdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${bundle.invoice.kind === "proforma" ? "Proforma" : bundle.invoice.kind === "credit_note" ? "Credit note" : "Invoice"} ${bundle.invoice.number}.pdf`);
}
