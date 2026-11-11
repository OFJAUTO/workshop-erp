"use server";

import { getCurrentStaff } from "@/lib/auth";
import { loadInspection } from "@/lib/inspection-data";
import { newToken } from "@/lib/media";
import { quoteToken } from "@/lib/quote-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * VIEW AS CUSTOMER (10 November 2026, Section 10): the customer address of a document that was not sent yet. The link
 * is only made (as the send would make it), never sent: the preview says "Preview – not sent yet".
 */
export async function customerPreviewHref(kind: "report" | "quote", id: string): Promise<{ href?: string; error?: string }> {
  const staff = await getCurrentStaff();
  if (!staff) return { error: "Please sign in again." };
  const admin = createAdminClient();
  if (kind === "report") {
    const bundle = await loadInspection(id);
    if (!bundle || bundle.inspection.status !== "approved") return { error: "The customer sees the report once the workshop manager has approved it." };
    const { data: existing } = await admin.from("report_links").select("token").eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.token) return { href: `/report/${existing.token}` };
    const { data: created, error } = await admin.from("report_links").insert({ job_id: id, inspection_id: bundle.inspection.id, token: newToken(), created_by: staff.id, updated_by: staff.id }).select("token").single();
    if (error || !created) return { error: "Couldn't open the preview – try again." };
    return { href: `/report/${created.token}` };
  }
  const { data: q } = await admin.from("quotations").select("id, token").eq("id", id).maybeSingle();
  if (!q) return { error: "Not found." };
  if (q.token) return { href: `/quote/${q.token}` };
  const token = quoteToken();
  const { error } = await admin.from("quotations").update({ token, updated_by: staff.id }).eq("id", id).is("token", null);
  if (error) return { error: "Couldn't open the preview – try again." };
  const { data: again } = await admin.from("quotations").select("token").eq("id", id).maybeSingle();
  return again?.token ? { href: `/quote/${again.token}` } : { error: "Couldn't open the preview – try again." };
}
