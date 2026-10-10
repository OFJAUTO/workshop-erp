"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { serviceStickerDefaults, stickerSettings, type ServiceStickerData } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";

const STICKER_ROLES: RoleId[] = ["owner", "gate_in", "parts", "service_advisor"];

/** The service sticker's numbers, as corrected by the person printing it. Saved on the job and the car. */
export async function saveServiceSticker(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(STICKER_ROLES.includes(role) || can(role, "manageWork"))) redirect(`/jobs/${jobId}`);
  const admin = createAdminClient();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const [{ data: job }, { data: gateIn }] = await Promise.all([
    admin.from("jobs").select("id, vehicle_id, work_started_at, plan_released_at, gated_in_at, service_sticker").eq("id", jobId).maybeSingle(),
    admin.from("gate_ins").select("mileage, mileage_unit").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job) redirect("/jobs");
  const today = new Date().toISOString().slice(0, 10);
  const current = serviceStickerDefaults(ss, job!, gateIn, today);
  const date = (v: FormDataEntryValue | null, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : fallback);
  const num = (v: FormDataEntryValue | null, fallback: number | null) => { const n = Number(String(v ?? "").replace(/[^\d]/g, "")); return String(v ?? "").trim() === "" ? fallback : Number.isFinite(n) ? n : fallback; };
  const next: ServiceStickerData = {
    ...current,
    serviced_on: date(formData.get("serviced_on"), current.serviced_on),
    mileage: num(formData.get("mileage"), current.mileage),
    next_date: date(formData.get("next_date"), current.next_date),
    next_mileage: num(formData.get("next_mileage"), current.next_mileage),
  };
  await admin.from("jobs").update({ service_sticker: next, updated_by: staff.id }).eq("id", jobId);
  await admin.from("vehicles").update({ next_service_date: next.next_date, next_service_mileage: next.next_mileage, updated_by: staff.id }).eq("id", job!.vehicle_id);
  revalidatePath(`/jobs/${jobId}`);
  const print = formData.get("print") === "1";
  if (print) redirect(`/print/service-sticker/${jobId}?back=${encodeURIComponent(`/jobs/${jobId}`)}`);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Service sticker details saved.")}#service-sticker`);
}
