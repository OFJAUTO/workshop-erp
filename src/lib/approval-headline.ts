import "server-only";
import { createAdminClient } from "./supabase/admin";
import { headlineFrom } from "./approval-headline-rules";

/**
 * THE approval headline of a car (13 November 2026, Section 1, J-01002). A car the customer first declined in full and
 * later approved (the owner reopened it) must never keep "Declined, car going out". When the customer approved only some
 * items it reads "APPROVED IN PART: n OF m ITEMS".
 */
/** True when the customer approved a quotation after declining everything (the decline no longer stands). */
export async function approvedAfterDecline(jobId: string, declinedOutAt: string | null): Promise<boolean> {
  if (!declinedOutAt) return false;
  const { data } = await createAdminClient().from("quotations").select("id").eq("job_id", jobId).in("status", ["approved", "urgent_requested"]).gt("responded_at", declinedOutAt).limit(1);
  return (data ?? []).length > 0;
}

/** The headline of a job: the decline (if it still stands) or the part approval. */
export async function approvalHeadline(jobId: string, declinedOutAt: string | null): Promise<{ kind: "declined" | "part" | null; words: string | null }> {
  const admin = createAdminClient();
  const [after, { data: qs }] = await Promise.all([approvedAfterDecline(jobId, declinedOutAt), admin.from("quotations").select("id").eq("job_id", jobId).eq("kind", "quotation").in("status", ["approved", "urgent_requested"]).eq("is_active", true)]);
  const ids = ((qs ?? []) as { id: string }[]).map((q) => q.id);
  let approved = 0;
  let total = 0;
  if (ids.length) {
    const { data: lines } = await admin.from("quotation_lines").select("customer_approved, line_type, visible_to_customer, left_off").in("quotation_id", ids).eq("is_active", true);
    for (const l of (lines ?? []) as { customer_approved: boolean | null; line_type: string; visible_to_customer: boolean | null; left_off: boolean | null }[]) {
      if (l.line_type === "fee" || l.visible_to_customer === false || l.left_off) continue;
      total++;
      if (l.customer_approved !== false) approved++;
    }
  }
  return headlineFrom({ declinedOutAt, approvedAfterDecline: after, approved, total });
}
