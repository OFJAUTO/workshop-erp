import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { loadPurchaseOrder } from "@/lib/parts-data";
import { renderPoPdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The purchase order PDF for the supplier: Parts, the owner, accounts and advisors. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (!can(staff.role_id as RoleId, "viewPurchaseOrders")) return new NextResponse("Not allowed.", { status: 403 });
  const bundle = await loadPurchaseOrder(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  if (bundle.po.status === "pending_approval") return new NextResponse("This purchase order is not approved yet. It cannot be sent before approval.", { status: 423 });
  const pdf = await renderPoPdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${bundle.po.number}.pdf`);
}
