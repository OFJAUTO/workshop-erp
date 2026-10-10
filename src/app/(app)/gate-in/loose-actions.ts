"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull, normalisePhone } from "@/lib/format";
import { formValues, type FormState } from "@/lib/form-state";
import { ensureLooseMake, itemSummary } from "@/lib/loose-items";
import { GATE_IN_BUCKET } from "@/lib/media";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { ensureQrLink } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ItemInput = { item_type: string; description: string | null; quantity: number; notes: string | null; photo: File | null };

/**
 * Gate-in of loose items (no car): the customer, one line per item, what the customer wants, and
 * what we saw at the counter. The job opens straight at Quote: there is no inspection report and no
 * wash on this path.
 */
export async function createLooseGateIn(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateIn");
  const values = formValues(formData);
  const get = (k: string) => String(formData.get(k) ?? "").trim();

  // Items
  const items: ItemInput[] = [];
  for (let i = 0; i < 20; i++) {
    if (!formData.has(`item_type_${i}`) && !formData.has(`item_type_other_${i}`)) continue;
    const own = get(`item_type_other_${i}`);
    const type = (own || get(`item_type_${i}`)).replace(/\s+/g, " ").trim();
    const description = blankToNull(get(`item_description_${i}`));
    if (!type && !description) continue;
    if (!type) return { error: `Item ${i + 1}: choose what it is, or type it.`, values };
    const qty = Math.max(1, Math.round(Number(get(`item_quantity_${i}`)) || 1));
    const photo = formData.get(`item_photo_${i}`);
    items.push({ item_type: type.charAt(0).toUpperCase() + type.slice(1), description, quantity: qty, notes: blankToNull(get(`item_notes_${i}`)), photo: photo instanceof File && photo.size > 0 ? photo : null });
  }
  if (items.length === 0) return { error: "Add at least one item.", values };
  for (const it of items) {
    if (it.photo && !["image/jpeg", "image/png", "image/webp"].includes(it.photo.type)) return { error: "Item photos must be JPG, PNG or WebP.", values };
    if (it.photo && it.photo.size > 15 * 1024 * 1024) return { error: "An item photo must be under 15 MB.", values };
  }
  const requests = get("requests").split(/\r?\n/).map((r) => r.trim()).filter(Boolean).slice(0, 50);
  if (requests.length === 0) return { error: "Write what the customer wants, one line per request.", values };
  const department = get("department") === "bodyshop" ? "bodyshop" : "mechanical";
  const priority = ["high", "normal", "low"].includes(get("priority")) ? get("priority") : "normal";

  const supabase = await createClient();
  const admin = createAdminClient();

  // Customer: an existing one, or a new one from the name and phone.
  let customerId = get("customer_id");
  if (customerId) {
    const { data: c } = await supabase.from("customers").select("id").eq("id", customerId).maybeSingle();
    if (!c) return { error: "Customer not found. Search again.", values };
  } else {
    const name = get("new_name");
    const phone = get("new_phone");
    if (name.length < 2) return { error: "Enter the customer's name.", values };
    if (phone.length < 7) return { error: "Enter the customer's phone number.", values };
    const { data: created, error } = await supabase.from("customers").insert({ customer_type: "individual", full_name: name, phone: normalisePhone(phone) }).select("id").single();
    if (error || !created) return { error: error?.message ?? "Could not save the customer.", values };
    customerId = created.id;
  }

  // The "car": a vehicle row of kind loose, so quotations, invoices, QC and the rest keep working.
  const summary = itemSummary(items);
  const makeId = await ensureLooseMake();
  const { data: vehicle, error: vError } = await admin.from("vehicles").insert({ customer_id: customerId, kind: "loose", has_plate: false, plate_country: "UAE", make_id: makeId, variant: summary, created_by: staff.id, updated_by: staff.id }).select("id").single();
  if (vError || !vehicle) return { error: vError?.message ?? "Could not open the record.", values };

  const now = new Date().toISOString();
  const broughtBy = blankToNull(get("brought_by"));
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({ vehicle_id: vehicle.id, customer_id: customerId, priority, department, gated_in_by: staff.id, job_kind: "loose", status: "pending_quote", stage: "quote", first_approval_at: now, stage_entered_at: now, brought_by: broughtBy, assessment_note: blankToNull(get("assessment_note")), created_by: staff.id, updated_by: staff.id })
    .select("id, job_number")
    .single();
  if (jobError || !job) return { error: jobError?.message ?? "Could not open the job card.", values };

  // Items, each with its own QR tag.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const { data: row } = await admin.from("job_items").insert({ job_id: job.id, position: i + 1, item_type: it.item_type, description: it.description, quantity: it.quantity, notes: it.notes, created_by: staff.id, updated_by: staff.id }).select("id").single();
    if (!row) continue;
    const code = await ensureQrLink("item", { jobId: job.id, vehicleId: vehicle.id, refId: row.id }, staff.id);
    await admin.from("job_items").update({ qr_code: code }).eq("id", row.id);
    if (it.photo) {
      const path = `${job.id}/items/${row.id}-${Date.now()}.jpg`;
      const { error: upError } = await admin.storage.from(GATE_IN_BUCKET).upload(path, it.photo, { contentType: it.photo.type, upsert: false });
      if (!upError) await admin.from("gate_in_media").insert({ job_id: job.id, kind: "item_photo", item_id: row.id, storage_path: path, uploaded_by: staff.id, created_by: staff.id, updated_by: staff.id });
    }
  }
  await admin.from("job_requests").insert(requests.map((text, i) => ({ job_id: job.id, position: i + 1, text })));
  await admin.from("job_events").insert({ job_id: job.id, event_type: "gate_in", to_status: "pending_quote", to_stage: "quote", to_staff: staff.id, note: `Loose items gated in on ${job.job_number}: ${summary}${broughtBy ? `, brought by ${broughtBy}` : ""}. No inspection or wash on this path.`, created_by: staff.id });

  const n = { type: "loose_gated_in", title: `Loose items · ${job.job_number}`, body: `${summary}. Quote needed: ${requests[0]}${requests.length > 1 ? ` (+${requests.length - 1})` : ""}.`, jobId: job.id, href: `/jobs/${job.id}` };
  if (staff.role_id === "service_advisor") await notifyStaff([staff.id], n);
  else await notifyRoles(["service_advisor"], n);

  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  redirect(`/jobs/${job.id}?message=${encodeURIComponent(`${job.job_number} opened for ${summary}. Print the tags and stick one on each item.`)}`);
}
