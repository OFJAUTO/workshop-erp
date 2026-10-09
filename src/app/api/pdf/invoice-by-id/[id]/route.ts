import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { loadInvoice } from "@/lib/invoice-data";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** A staff copy of an invoice, proforma or credit note: owner, accounts and advisors. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (!can(staff.role_id as RoleId, "viewInvoices")) return new NextResponse("Not allowed.", { status: 403 });
  const bundle = await loadInvoice(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  const pdf = await renderInvoicePdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${bundle.invoice.kind === "proforma" ? "Proforma" : bundle.invoice.kind === "credit_note" ? "Credit note" : "Invoice"} ${bundle.invoice.number}.pdf`);
}
