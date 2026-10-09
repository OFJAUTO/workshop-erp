import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { renderQuotePdf } from "@/lib/pdf/quote-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { loadQuotation } from "@/lib/quote-data";
import type { RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** A staff preview of the quotation PDF, before or after sending: the owner, or the job's advisor. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  const bundle = await loadQuotation(id);
  if (!bundle) return new NextResponse("Not found.", { status: 404 });
  const q = bundle.quotation;
  const role = staff.role_id as RoleId;
  let allowed = role === "owner";
  if (!allowed && role === "service_advisor") {
    allowed = q.created_by === staff.id || bundle.job?.gated_in_by === staff.id;
    if (!allowed && q.job_id) {
      const { data } = await createAdminClient().from("approval_requests").select("id").eq("job_id", q.job_id).eq("sent_by", staff.id).limit(1);
      allowed = (data ?? []).length > 0;
    }
  }
  if (!allowed) return new NextResponse("Not allowed.", { status: 403 });
  const pdf = await renderQuotePdf(bundle, await getSettings());
  return pdfResponse(pdf, `OFJ ${q.kind === "estimate" ? "Estimate" : "Quotation"} ${q.number} v${q.version}.pdf`);
}
