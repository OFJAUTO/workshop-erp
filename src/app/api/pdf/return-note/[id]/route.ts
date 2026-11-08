import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { loadPurchaseReturns } from "@/lib/purchase-returns";
import { renderReturnNotePdf } from "@/lib/pdf/return-note-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The return note for the supplier (8 November 2026): Parts, the owner, accounts. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await staffPdfAccess("lpo");
  if ("refused" in access) return access.refused;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found.", { status: 404 });
  const [r] = await loadPurchaseReturns({ ids: [id] });
  if (!r) return new NextResponse("Not found.", { status: 404 });
  return pdfResponse(await renderReturnNotePdf(r, await getSettings()), `OFJ ${r.number}.pdf`);
}
