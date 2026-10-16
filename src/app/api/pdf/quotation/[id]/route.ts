import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { renderQuotePdf } from "@/lib/pdf/quote-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { loadQuotation } from "@/lib/quote-data";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** A staff preview of the quotation or estimate PDF, before or after sending: the owner, advisors, workshop managers and accounts. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await staffPdfAccess("document");
  if ("refused" in access) return access.refused;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found.", { status: 404 });
  const bundle = await loadQuotation(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  const q = bundle.quotation;
  const pdf = await renderQuotePdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${q.kind === "estimate" ? "Estimate" : "Quotation"} ${q.number} v${q.version}.pdf`);
}
