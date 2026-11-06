"use server";

import { dbWords } from "@/lib/app-errors";
import { requireStaff } from "@/lib/auth";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

/**
 * ASK THE ADVISOR (6 November 2026, Peter): a question from the parts screens to the car's advisor, about the job or
 * one part line, answered on /ask/<id>; the answer rings the asker's bell. Kept in job_events (no new table):
 * the question is `advisor_question` (from_staff → to_staff), each answer `advisor_answer` with `from_stage = "q:<id>"`.
 * INTERNAL ONLY - never on a supplier copy or a customer page.
 */

export type AskAnswer = { ok?: boolean; error?: string; message?: string };

const MAX = 1000;

async function carWords(jobId: string) {
  const { data } = await createAdminClient()
    .from("jobs")
    .select("job_number, advisor_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return null;
  const v = data.vehicle as unknown as Parameters<typeof formatPlate>[0] | null;
  return { jobNumber: data.job_number as string, advisorId: (data.advisor_id as string | null) ?? null, plate: v ? formatPlate(v) : "" };
}

export async function askAdvisorAction(jobId: string, partId: string | null, text: string): Promise<AskAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to ask." };
  const question = String(text ?? "").trim();
  if (question.length < 3) return { error: "Type the question (a few words)." };
  if (question.length > MAX) return { error: `Keep it under ${MAX} characters.` };
  const car = await carWords(jobId);
  if (!car) return { error: "This job could not be found." };
  if (!car.advisorId) return { error: "This car has no advisor yet – ask the owner who takes it." };
  if (car.advisorId === staff.id) return { error: "You are this car's advisor." };
  const admin = createAdminClient();
  let partName: string | null = null;
  if (partId) {
    const { data: p } = await admin.from("part_items").select("description, job_id").eq("id", partId).maybeSingle();
    if (!p || p.job_id !== jobId) return { error: "That part is not on this car." };
    partName = String(p.description ?? "").trim() || null;
  }
  const note = partName ? `About ${partName}: ${question}` : question;
  const { data: row, error } = await admin
    .from("job_events")
    .insert({ job_id: jobId, event_type: "advisor_question", from_staff: staff.id, to_staff: car.advisorId, note, created_by: staff.id })
    .select("id")
    .single();
  if (error || !row) return { error: error ? dbWords(error, "parts/advisor-ask", { staffId: staff.id, jobId }) : "Couldn't send – try again." };
  await notifyStaff([car.advisorId], {
    type: "advisor_question",
    title: `${staff.display_name} asks about ${car.jobNumber}${car.plate ? ` · ${car.plate}` : ""}`,
    body: note.slice(0, 300),
    jobId,
    href: `/ask/${row.id}`,
  });
  const { data: who } = await admin.from("staff").select("display_name").eq("id", car.advisorId).maybeSingle();
  return { ok: true, message: `Sent to ${who?.display_name ?? "the advisor"} ✓ – the answer comes to your bell.` };
}

export async function answerAdvisorQuestionAction(questionId: number, text: string): Promise<AskAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to answer." };
  const answer = String(text ?? "").trim();
  if (answer.length < 1) return { error: "Type the answer." };
  if (answer.length > MAX) return { error: `Keep it under ${MAX} characters.` };
  const admin = createAdminClient();
  const { data: q } = await admin.from("job_events").select("id, job_id, from_staff, to_staff, note, event_type").eq("id", questionId).maybeSingle();
  if (!q || q.event_type !== "advisor_question") return { error: "This question could not be found." };
  if (staff.id !== q.to_staff && staff.role_id !== "owner") return { error: "Only the advisor asked (or the owner) can answer here." };
  const { error } = await admin
    .from("job_events")
    .insert({ job_id: q.job_id, event_type: "advisor_answer", from_staff: staff.id, to_staff: q.from_staff, from_stage: `q:${q.id}`, note: answer, created_by: staff.id });
  if (error) return { error: dbWords(error, "parts/advisor-answer", { staffId: staff.id, jobId: q.job_id }) };
  const car = await carWords(q.job_id);
  if (q.from_staff) {
    await notifyStaff([q.from_staff], {
      type: "advisor_answer",
      title: `${staff.display_name} answered · ${car?.jobNumber ?? ""}${car?.plate ? ` · ${car.plate}` : ""}`,
      body: answer.slice(0, 300),
      jobId: q.job_id,
      href: `/ask/${q.id}`,
    });
  }
  return { ok: true, message: "Answer sent ✓" };
}
