import { NextResponse, type NextRequest } from "next/server";
import { pdfResponse } from "@/lib/pdf/response";
import { renderWarrantyPdf } from "@/lib/pdf/warranty-pdf";
import { getSettings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureWarrantyToken, warrantyCardOf } from "@/lib/warranty-data";

export const dynamic = "force-dynamic";

/** The warranty certificate, from the warranty card's own token (or the older handover token). Jobs with nothing under warranty have none. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return new NextResponse("This link is not valid.", { status: 404 });
  const settings = await getSettings();
  const admin = createAdminClient();
  const { data: byWarranty } = await admin.from("jobs").select("id").eq("warranty_token", token).maybeSingle();
  const { data: byHandover } = byWarranty ? { data: null } : await admin.from("jobs").select("id").eq("bodyshop_handover_token", token).maybeSingle();
  const jobId = (byWarranty?.id ?? byHandover?.id ?? null) as string | null;
  if (!jobId) return new NextResponse("This link is not valid.", { status: 404 });
  const card = await warrantyCardOf(jobId, settings);
  if (!card?.rows.length) return new NextResponse("Nothing on this job carries a product warranty.", { status: 404 });
  const wToken = card.token ?? (await ensureWarrantyToken(jobId));
  const pdf = await renderWarrantyPdf(card, `${PRODUCTION_SITE_URL}/warranty/${wToken}`, settings);
  return pdfResponse(pdf, `OFJ warranty ${card.certificateNo}.pdf`);
}
