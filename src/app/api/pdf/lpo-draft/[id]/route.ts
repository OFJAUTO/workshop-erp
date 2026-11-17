import { NextResponse, type NextRequest } from "next/server";
import { staffPdfAccess } from "@/lib/pdf/access";
import { draftSupplierRow } from "@/lib/lpo-share";
import { loadPurchaseOrder } from "@/lib/parts-data";
import { renderPoPdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The DRAFT of an LPO for one supplier (17 November 2026, Section 5): BEFORE approval only, for checking prices and
 * availability - the draft mark across every page and in the header. Staff only (the parts desk shares the file
 * itself; there is no public draft address). After approval it is refused: the clean LPO is shared instead.
 *   /api/pdf/lpo-draft/<LPO id>?supplier=<supplier name>   (a main LPO holds several suppliers)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await staffPdfAccess("lpo");
  if ("refused" in access) return access.refused;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found.", { status: 404 });
  const bundle = await loadPurchaseOrder(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  if (bundle.po.status !== "pending_approval") return new NextResponse("This LPO is approved: share the LPO itself, not a draft.", { status: 409 });
  const supplierName = (request.nextUrl.searchParams.get("supplier") ?? "").trim() || bundle.po.supplier_name;
  const supplier = await draftSupplierRow(supplierName);
  const pdf = await renderPoPdf(bundle, await getSettings(), { draft: true, supplierName, supplier });
  return pdfResponse(pdf, `OFJ DRAFT ${bundle.po.number} ${supplierName}.pdf`);
}
