"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyManagers, notifyStaff } from "@/lib/notifications";
import { ROAD_TEST_ITEMS, roadTestProblems, type RoadTestItems } from "@/lib/road-test";
import { createAdminClient } from "@/lib/supabase/admin";

/** Saves the road test as done (every check marked, remarks where needed) or as not possible with a reason. */
export async function saveRoadTest(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("roadTest");
  const values = formValues(formData);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, department, is_open, assigned_to").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const { data: before } = await admin.from("road_tests").select("decision, status").eq("job_id", jobId).maybeSingle();
  const notPossible = String(formData.get("outcome") ?? "") === "not_possible";
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { job_id: jobId, inspector_id: staff.id, updated_by: staff.id, created_by: staff.id, started_at: now, done_at: now };
  if (notPossible) {
    const reason = blankToNull(formData.get("not_possible_reason"));
    if (!reason || reason.length < 3) return { error: "Say why the road test is not possible.", values };
    row.status = "not_possible";
    row.not_possible_reason = reason;
    row.items = {};
  } else {
    const items: RoadTestItems = {};
    for (const it of ROAD_TEST_ITEMS) {
      const status = String(formData.get(`status__${it.key}`) ?? "");
      items[it.key] = { status: status === "good" || status === "average" || status === "bad" ? status : null, remarks: blankToNull(formData.get(`remarks__${it.key}`)) };
    }
    const problems = roadTestProblems(items);
    if (problems.length) return { error: problems.map((p) => p.label).join(" · "), values };
    row.status = "done";
    row.items = items;
    row.not_possible_reason = null;
  }
  const { error } = await admin.from("road_tests").upsert(row, { onConflict: "job_id" });
  if (error) return { error: error.message, values };
  // A road test the manager asked for held the inspection: tell the technician it is open now.
  if (before?.decision === "needed" && before.status === "not_started" && job.assigned_to) {
    await notifyStaff([job.assigned_to], { type: "inspection_open", title: `Inspection open · ${job.job_number}`, body: notPossible ? `Road test not possible: ${row.not_possible_reason}. Start the inspection.` : `Road test done by ${staff.display_name}. Start the inspection.`, jobId, href: `/my-jobs/${jobId}` });
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "road_test", note: notPossible ? `Road test not possible (${staff.display_name}): ${row.not_possible_reason}` : `Road test done by ${staff.display_name}`, created_by: staff.id });
  await notifyManagers(job.department ?? null, { type: "road_test_done", title: `Road test ${notPossible ? "not possible" : "done"} · ${job.job_number}`, body: notPossible ? String(row.not_possible_reason) : `By ${staff.display_name}.`, jobId, href: `/jobs/${jobId}/inspection` });
  revalidatePath("/road-tests");
  revalidatePath(`/road-tests/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/inspection`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/my-jobs");
  revalidatePath("/dashboard");
  redirect(`/road-tests?message=${encodeURIComponent(`${job.job_number}: road test ${notPossible ? "marked not possible" : "saved"}.`)}`);
}
