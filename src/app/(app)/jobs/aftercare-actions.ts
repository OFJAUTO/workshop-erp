"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { verifyPin } from "@/lib/pin";
import { createAdminClient } from "@/lib/supabase/admin";

const BODYSHOP_DEPTS = ["bodyshop", "paint", "ppf_tint", "detailing"];

/** The PPF team leader signs the 10-day check off with his own PIN; the findings and note are kept. */
export async function signOffAftercare(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const back = `/jobs/${jobId}`;
  const allowed = !staff.viewingAs && (staff.role_id === "owner" || ((staff.role_id === "workshop_manager" || staff.role_id === "team_leader") && BODYSHOP_DEPTS.includes(staff.department_id ?? "")));
  if (!allowed) redirect(`${back}?error=${encodeURIComponent("Only the owner, the bodyshop manager or a team leader signs the check off.")}`);
  const admin = createAdminClient();
  const { data: row } = await admin.from("aftercare_checks").select("id, done_at").eq("job_id", jobId).eq("is_active", true).maybeSingle();
  if (!row) redirect(`${back}?error=${encodeURIComponent("No after-care check on this job.")}`);
  if (row!.done_at) redirect(`${back}?message=${encodeURIComponent("The check is already signed off.")}`);
  if (staff.role_id !== "owner") {
    const { data: priv } = await admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle();
    if (!verifyPin(String(formData.get("pin") ?? "").trim(), priv?.pin_hash)) redirect(`${back}?error=${encodeURIComponent("That is not your PIN. Try again.")}`);
  }
  const findings = formData.getAll("point").map(String);
  const note = blankToNull(formData.get("note"));
  await admin.from("aftercare_checks").update({ done_at: new Date().toISOString(), done_by: staff.id, findings: { checked: findings }, notes: note, updated_by: staff.id }).eq("id", row!.id);
  const { data: job } = await admin.from("jobs").select("job_number, gated_in_by").eq("id", jobId).maybeSingle();
  await admin.from("job_events").insert({ job_id: jobId, event_type: "aftercare_done", note: `10-day after-care check signed off by ${staff.display_name}${note ? `: ${note}` : ""}`, created_by: staff.id });
  if (job?.gated_in_by) await notifyStaff([job.gated_in_by], { type: "aftercare_due", title: `10-day check done · ${job.job_number}`, body: `${staff.display_name} signed it off${note ? `: ${note}` : "."}`, jobId, href: back });
  revalidatePath(back);
  revalidatePath("/warranties");
  redirect(`${back}?message=${encodeURIComponent("After-care check signed off. The customer's OFJ warranty is now active.")}`);
}
