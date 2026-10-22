"use server";

import { redirect } from "next/navigation";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

/**
 * A part's expected date changed from the arrivals board: the new date and a short reason are written on the job,
 * "All parts here by" follows, the car's promised date moves later when the part lands after it, and the advisor hears.
 */
export async function changeExpectedDate(partId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const back = "/parts/arrivals";
  const date = String(formData.get("date") ?? "");
  const reason = blankToNull(formData.get("reason"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(`${back}?error=${encodeURIComponent("Pick the new date.")}`);
  if (!reason) redirect(`${back}?error=${encodeURIComponent("Say why it moved (one tap is enough).")}`);
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, expected_date, quantity, confirmed_quantity, received_qty").eq("id", partId).eq("is_active", true).maybeSingle();
  if (!p) redirect(`${back}?error=${encodeURIComponent("Part not found.")}`);
  await admin.from("part_items").update({ expected_date: date, updated_by: staff.id }).eq("id", partId);
  // "All parts here by" follows the latest open part.
  const { data: open } = await admin.from("part_items").select("expected_date, quantity, confirmed_quantity, received_qty").eq("job_id", p.job_id).eq("is_active", true).not("expected_date", "is", null);
  const latest = (open ?? []).filter((x) => Number(x.received_qty) < Number(x.confirmed_quantity ?? x.quantity)).map((x) => String(x.expected_date)).sort().at(-1) ?? date;
  const { data: job } = await admin.from("jobs").select("id, job_number, promised_at, gated_in_by, plan_parts_ready_date, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").eq("id", p.job_id).maybeSingle();
  if (job) {
    const patch: Record<string, unknown> = { plan_parts_ready_date: latest };
    const promisedMoved = !!job.promised_at && String(job.promised_at).slice(0, 10) < latest;
    if (promisedMoved) patch.promised_at = latest;
    await admin.from("jobs").update(patch).eq("id", job.id);
    await admin.from("job_events").insert({ job_id: job.id, event_type: "parts_plan", note: `${p.description}: expected date moved ${p.expected_date ?? "unset"} → ${date} (${reason})${promisedMoved ? `; promised date moved to ${latest}` : ""}`, created_by: staff.id });
    const ids = await advisorsInCharge(job.id);
    const plate = job.vehicle ? formatPlate(job.vehicle as unknown as Parameters<typeof formatPlate>[0]) : job.job_number;
    await notifyStaff(ids, { type: "parts_priced", title: `Part delayed on ${plate}: now expected ${date}`, body: `${p.description}: ${reason}.${promisedMoved ? ` The promised date moved to ${latest}.` : ""}`, jobId: job.id, href: `/jobs/${job.id}` });
  }
  revalidatePath("/parts/arrivals");
  revalidatePath(`/parts/${p.job_id}`);
  redirect(`${back}?message=${encodeURIComponent(`Expected ${date} saved${job && job.promised_at && String(job.promised_at).slice(0, 10) < latest ? "; the promised date moved and the advisor is told" : "; the advisor is told"}.`)}`);
}
