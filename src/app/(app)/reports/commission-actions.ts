"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** The owner's one tap: this quotation's commission has been paid out. Logged on the job; never shown to a customer. */
export async function markCommissionPaid(quotationId: string, formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) redirect("/dashboard");
  const month = String(formData.get("month") ?? "").slice(0, 7);
  const back = `/reports/monthly${month ? `?month=${encodeURIComponent(month)}` : ""}`;
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, number, job_id, commission_to, commission_aed, commission_paid_at").eq("id", quotationId).maybeSingle();
  if (!q) redirect(back);
  if (q.commission_paid_at) redirect(`${back}${month ? "&" : "?"}message=${encodeURIComponent("Already marked paid.")}#commissions`);
  await admin.from("quotations").update({ commission_paid_at: new Date().toISOString(), commission_paid_by: staff.id }).eq("id", quotationId);
  if (q.job_id) await admin.from("job_events").insert({ job_id: q.job_id, event_type: "commission_paid", note: `Commission AED ${Number(q.commission_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 })} to ${q.commission_to ?? "?"} marked paid by ${staff.display_name} (${q.number})`, created_by: staff.id });
  revalidatePath("/reports/monthly");
  if (q.job_id) revalidatePath(`/jobs/${q.job_id}`);
  redirect(`${back}${month ? "&" : "?"}message=${encodeURIComponent("Marked paid.")}#commissions`);
}
