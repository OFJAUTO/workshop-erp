"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isBodyshopStaff } from "@/lib/bodyshop-findings";
import { cleanPanelMarks, marksWords } from "@/lib/car-outline";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

/** The damage marked on the car outline at gate-in (gate_ins.damage_panels): the gate-in people, advisors and the owner. */
export async function saveGateInDamage(jobId: string, json: string): Promise<{ error?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !can(staff.role_id as RoleId, "editGateIn")) return { error: "Not allowed." };
  let marks;
  try { marks = cleanPanelMarks(JSON.parse(json)); } catch { return { error: "Bad marking." }; }
  const admin = createAdminClient();
  const { data: gi } = await admin.from("gate_ins").select("id, damage_panels").eq("job_id", jobId).maybeSingle();
  if (!gi) return { error: "Gate-in not found." };
  const { data: job } = await admin.from("jobs").select("gated_out_at").eq("id", jobId).maybeSingle();
  if (job?.gated_out_at) return { error: "The car has left: the gate-in can no longer be changed." };
  const { error } = await admin.from("gate_ins").update({ damage_panels: marks, updated_by: staff.id }).eq("id", gi.id);
  if (error) return { error: error.message };
  revalidatePath(`/jobs/${jobId}/gate-in`);
  return {};
}

/** The bodyshop pre-work check before PPF (jobs.prework_panels): bodyshop staff and the owner. */
export async function savePreworkCheck(jobId: string, json: string): Promise<{ error?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !isBodyshopStaff(staff)) return { error: "Only bodyshop staff or the owner mark the pre-work check." };
  let marks;
  try { marks = cleanPanelMarks(JSON.parse(json)); } catch { return { error: "Bad marking." }; }
  const { error } = await createAdminClient().from("jobs").update({ prework_panels: marks, updated_by: staff.id }).eq("id", jobId);
  if (error) return { error: error.message };
  revalidatePath(`/bodyshop/${jobId}`);
  return {};
}

/** "Pre-work check done": stamped with who and when, written in the job history with what was found. */
export async function markPreworkChecked(jobId: string): Promise<void> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !isBodyshopStaff(staff)) return;
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("prework_panels").eq("id", jobId).maybeSingle();
  const words = marksWords(cleanPanelMarks(job?.prework_panels));
  await admin.from("jobs").update({ prework_checked_at: new Date().toISOString(), prework_checked_by: staff.id, updated_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "prework_checked", note: `Pre-work check done by ${staff.display_name}: ${words || "no damage found"}`, created_by: staff.id });
  revalidatePath(`/bodyshop/${jobId}`);
}
