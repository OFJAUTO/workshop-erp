"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isBodyshopStaff } from "@/lib/bodyshop-findings";
import { randomUUID } from "node:crypto";
import { cleanPanelMarks, damageWords, marksWords, panelLabel, severityLabel } from "@/lib/car-outline";
import { fillTemplate } from "@/lib/calendar";
import { seesCustomers } from "@/lib/customer-data";
import { DEFAULT_DAMAGE_FOUND, cleanDamageAfter, itemLine } from "@/lib/damage";
import { damageAfterReady } from "@/lib/damage-data";
import { SAVE_FAILED } from "@/lib/app-errors";
import { greetingNameOf } from "@/lib/messages";
import { notifyJobAdvisors } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
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

/**
 * Damage found AFTER check-in (section 4.6, 30 October 2026): anyone working on the car records the panel, what is
 * there and its photos; it is kept apart from the check-in damage ("Found after check-in · <date>"), the advisor in
 * charge is told, and the advisor sends the customer a WhatsApp update with the job card link. Never deleted.
 */
export async function addDamageAfter(jobId: string, json: string): Promise<{ error?: string; id?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Not allowed." };
  if (!(await damageAfterReady())) return { error: "This needs a database update first (tell the owner)." };
  let input: { panel?: string; damage?: string[]; severity?: string | null; note?: string | null };
  try { input = JSON.parse(json); } catch { return { error: "Bad marking." }; }
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("job_number, gated_out_at, is_open, vehicle:vehicles(kind, plate_number, plate_code, has_plate, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Job not found." };
  if (job.gated_out_at) return { error: "The car has left: nothing more can be added." };
  const [entry] = cleanDamageAfter([{ id: randomUUID(), panel: input.panel, damage: input.damage, severity: input.severity, note: input.note, at: new Date().toISOString(), by: staff.id, by_name: staff.display_name }]);
  if (!entry) return { error: "Pick a panel on the car first." };
  if (!entry.damage.length && !entry.note) return { error: "Tap what is there (a scratch, a dent…) or write a note." };
  const { data: gi } = await admin.from("gate_ins").select("id, damage_after").eq("job_id", jobId).maybeSingle();
  if (!gi) return { error: "Gate-in not found." };
  const list = [...cleanDamageAfter((gi as { damage_after?: unknown }).damage_after), entry];
  const { error } = await admin.from("gate_ins").update({ damage_after: list, updated_by: staff.id }).eq("id", gi.id);
  if (error) return { error: SAVE_FAILED };
  const line = itemLine({ label: panelLabel(entry.panel), words: damageWords(entry.damage), severity: severityLabel(entry.severity), note: entry.note });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "damage_found_after", note: `Damage found after check-in by ${staff.display_name}: ${line}`, created_by: staff.id });
  const plate = formatPlate(job.vehicle as unknown as Parameters<typeof formatPlate>[0]);
  await notifyJobAdvisors(jobId, { type: "damage_found_after", title: `Damage found after check-in: ${plate}`, body: `${line} · tell the customer`, href: `/jobs/${jobId}#damage` }, { except: staff.id });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/gate-in`);
  return { id: entry.id };
}

/** The WhatsApp update for one found-after entry: the customer roles only (the message carries the customer's name). */
export async function damageFoundMessage(jobId: string, entryId: string): Promise<{ error?: string; message?: string; phone?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || !seesCustomers(staff.role_id)) return { error: "Only the advisors, accounts and the owner message the customer." };
  const admin = createAdminClient();
  const [{ data: gi }, { data: job }, { data: approval }, settings] = await Promise.all([
    admin.from("gate_ins").select("damage_after").eq("job_id", jobId).maybeSingle(),
    admin.from("jobs").select("customer:customers(full_name, company_name, phone), vehicle:vehicles(kind, plate_number, plate_code, has_plate, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
    admin.from("approval_requests").select("token").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    getSettings(),
  ]);
  const entry = cleanDamageAfter((gi as { damage_after?: unknown } | null)?.damage_after).find((e) => e.id === entryId);
  if (!entry || !job) return { error: "Not found." };
  if (!approval?.token) return { error: "This car has no job card link yet: send the job card first." };
  type V = { make: { name: string } | null; model: { name: string } | null } & Parameters<typeof formatPlate>[0];
  const v = job.vehicle as unknown as V;
  const c = job.customer as unknown as { full_name: string | null; company_name: string | null; phone: string | null } | null;
  const link = await shortFor(`${PRODUCTION_SITE_URL}/approve/${approval.token}`);
  const template = String(settings.whatsapp_damage_found_template || DEFAULT_DAMAGE_FOUND);
  const message = fillTemplate(template, {
    name: greetingNameOf(c) || "Customer",
    "make model": [v?.make?.name, v?.model?.name].filter(Boolean).join(" ") || "car",
    plate: formatPlate(v),
    damage: itemLine({ label: panelLabel(entry.panel), words: damageWords(entry.damage), severity: severityLabel(entry.severity), note: entry.note }),
    link,
  });
  return { message, phone: String(c?.phone ?? "").replace(/[^\d]/g, "") };
}

/** Stamps an entry as told to the customer (WhatsApp opened or the message copied). */
export async function markDamageAfterSent(jobId: string, entryId: string): Promise<{ error?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !seesCustomers(staff.role_id)) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: gi } = await admin.from("gate_ins").select("id, damage_after").eq("job_id", jobId).maybeSingle();
  if (!gi) return { error: "Not found." };
  const list = cleanDamageAfter((gi as { damage_after?: unknown }).damage_after).map((e) => (e.id === entryId && !e.sent_at ? { ...e, sent_at: new Date().toISOString() } : e));
  const { error } = await admin.from("gate_ins").update({ damage_after: list, updated_by: staff.id }).eq("id", gi.id);
  if (error) return { error: SAVE_FAILED };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "damage_found_after_sent", note: `Customer told about damage found after check-in by ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
  return {};
}
