import { NextResponse, type NextRequest } from "next/server";
import { loadPurchaseOrder } from "@/lib/parts-data";
import { renderPoPdf } from "@/lib/pdf/invoice-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The supplier copy of an LPO from its link token: what the supplier opens from the message. Approved orders only. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const { data: row } = await createAdminClient().from("purchase_orders").select("id, status").eq("verify_token", token).eq("is_active", true).maybeSingle();
  if (!row || row.status === "pending_approval") return new NextResponse("This link is not valid.", { status: 404 });
  const bundle = await loadPurchaseOrder(row.id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  return pdfResponse(await renderPoPdf(bundle, await getSettings()), `OFJ ${bundle.po.number}.pdf`);
}
