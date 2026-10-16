import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { loadInvoice } from "@/lib/invoice-data";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** A staff copy of an invoice, proforma or credit note: owner, accounts and advisors. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await staffPdfAccess("document");
  if ("refused" in access) return access.refused;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found.", { status: 404 });
  const bundle = await loadInvoice(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  const pdf = await renderInvoicePdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${bundle.invoice.kind === "proforma" ? "Proforma" : bundle.invoice.kind === "credit_note" ? "Credit note" : "Invoice"} ${bundle.invoice.number}.pdf`);
}
