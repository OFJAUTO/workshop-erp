"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

/** "Send on WhatsApp" for the warranty card: the send is written down (who and when). */
export async function markWarrantyCardSent(jobId: string): Promise<{ ok?: boolean; error?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !(staff.role_id === "owner" || staff.role_id === "service_advisor")) return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin.from("jobs").update({ warranty_card_sent_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "warranty_card_sent", note: `Warranty card sent on WhatsApp by ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** The owner activates the warranty by hand, with a note (the 10-day check could not happen, or happened elsewhere). */
export async function activateWarrantyByHand(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const back = `/jobs/${jobId}`;
  if (staff.role_id !== "owner" || staff.viewingAs) redirect(`${back}?error=${encodeURIComponent("Only the owner activates a warranty by hand.")}`);
  const note = blankToNull(formData.get("note"));
  if (!note) redirect(`${back}?error=${encodeURIComponent("Write a short note: why it is activated without the 10-day check.")}#warranty-card`);
  const admin = createAdminClient();
  const { data: row } = await admin.from("aftercare_checks").select("id, done_at, activated_at").eq("job_id", jobId).eq("is_active", true).maybeSingle();
  if (!row) redirect(`${back}?error=${encodeURIComponent("This job has no 10-day check: its warranty is already active from the handover.")}`);
  if (row!.done_at || row!.activated_at) redirect(`${back}?message=${encodeURIComponent("The warranty is already active.")}`);
  await admin.from("aftercare_checks").update({ activated_at: new Date().toISOString(), activated_by: staff.id, activation_note: note, updated_by: staff.id }).eq("id", row!.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "warranty_activated", note: `Warranty activated by hand by ${staff.display_name}: ${note}`, created_by: staff.id });
  revalidatePath(back);
  revalidatePath("/warranties");
  redirect(`${back}?message=${encodeURIComponent("Warranty activated. The customer's warranty page now says Active.")}#warranty-card`);
}
