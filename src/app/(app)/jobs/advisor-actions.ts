"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

const back = (jobId: string, msg: string, ok = true) => redirect(`/jobs/${jobId}?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);

/**
 * Section 4 (21 October): ONE advisor in charge per car. Advisors and the owner change it any time;
 * the change is logged and the car's notifications follow the new person from that moment.
 */
export async function setAdvisorInCharge(jobId: string, formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) back(jobId, "View only.", false);
  if (!["service_advisor", "owner"].includes(staff!.role_id)) back(jobId, "Advisors and the owner change the advisor in charge.", false);
  const to = String(formData.get("staff_id") ?? "");
  const admin = createAdminClient();
  const [{ data: job }, { data: target }] = await Promise.all([
    admin.from("jobs").select("id, job_number, advisor_id, gated_in_by, is_open").eq("id", jobId).maybeSingle(),
    admin.from("staff").select("id, display_name, role_id, is_active").eq("id", to).maybeSingle(),
  ]);
  if (!job) back(jobId, "Job not found.", false);
  if (!target || !target.is_active || !["service_advisor", "owner"].includes(target.role_id)) back(jobId, "Pick an advisor.", false);
  if (job!.advisor_id === target!.id) back(jobId, `${target!.display_name} is already in charge.`);
  const { data: old } = job!.advisor_id ? await admin.from("staff").select("display_name").eq("id", job!.advisor_id).maybeSingle() : { data: null };
  await admin.from("jobs").update({ advisor_id: target!.id, updated_by: staff!.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "advisor_change", note: `Advisor in charge: ${old?.display_name ?? "nobody"} → ${target!.display_name} (changed by ${staff!.display_name}). The car's notifications follow ${target!.display_name} from now.`, created_by: staff!.id });
  if (target!.id !== staff!.id) await notifyStaff([target!.id], { type: "advisor_change", title: `You are in charge of ${job!.job_number}`, body: `${staff!.display_name} put this car under your name. Its notifications come to you from now.`, jobId, href: `/jobs/${jobId}` });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  back(jobId, `Advisor in charge: ${target!.display_name}.`);
}

/** The optional Follow on someone else's car: updates on it reach you too, until you unfollow. */
export async function toggleFollow(jobId: string, formData: FormData) {
  void formData;
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) back(jobId, "View only.", false);
  if (!["service_advisor", "owner"].includes(staff!.role_id)) back(jobId, "Following is for advisors.", false);
  const admin = createAdminClient();
  const { data: cur } = await admin.from("job_followers").select("id, is_active").eq("job_id", jobId).eq("staff_id", staff!.id).maybeSingle();
  if (cur) {
    await admin.from("job_followers").update({ is_active: !cur.is_active, updated_by: staff!.id }).eq("id", cur.id);
    revalidatePath(`/jobs/${jobId}`);
    back(jobId, cur.is_active ? "Unfollowed: this car's updates stop coming to you." : "Following: this car's updates come to you too.");
  }
  await admin.from("job_followers").insert({ job_id: jobId, staff_id: staff!.id, created_by: staff!.id, updated_by: staff!.id });
  revalidatePath(`/jobs/${jobId}`);
  back(jobId, "Following: this car's updates come to you too.");
}
