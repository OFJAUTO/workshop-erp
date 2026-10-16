import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { loadPurchaseOrder } from "@/lib/parts-data";
import { renderPoPdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The LPO PDF for the supplier: Parts, the owner, accounts and advisors. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await staffPdfAccess("lpo");
  if ("refused" in access) return access.refused;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found.", { status: 404 });
  const bundle = await loadPurchaseOrder(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  if (bundle.po.status === "pending_approval") return new NextResponse("This LPO is not approved yet. It cannot be sent before approval.", { status: 423 });
  const pdf = await renderPoPdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${bundle.po.number}.pdf`);
}
