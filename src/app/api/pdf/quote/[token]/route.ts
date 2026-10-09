import { NextResponse, type NextRequest } from "next/server";
import { renderQuotePdf } from "@/lib/pdf/quote-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { loadQuotation } from "@/lib/quote-data";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The customer's quotation or estimate as a PDF, from the same link token as the page. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const admin = createAdminClient();
  const { data: row } = await admin.from("quotations").select("id, status").eq("token", token).maybeSingle();
  if (!row || ["superseded", "cancelled", "pending_owner"].includes(row.status)) return new NextResponse("This link is not valid. Please ask the workshop for a new one.", { status: 404 });
  const bundle = await loadQuotation(row.id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  const pdf = await renderQuotePdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${bundle.quotation.kind === "estimate" ? "Estimate" : "Quotation"} ${bundle.quotation.number}.pdf`);
}
