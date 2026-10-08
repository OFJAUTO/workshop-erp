"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { APPOINTMENT_STATUSES, DURATIONS, isDateString } from "@/lib/calendar";
import { blankToNull, normalisePhone } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    customer_mode: z.enum(["existing", "new"]),
    customer_id: z.string().trim(),
    new_name: z.string().trim(),
    new_phone: z.string().trim(),
    vehicle_id: z.string().trim(),
    vehicle_text: z.string().trim(),
    reason: z.string().trim().min(2, "Enter the reason for the visit."),
    date: z.string().trim(),
    time: z.string().trim().regex(/^\d{2}:\d{2}$/, "Choose the time."),
    duration_minutes: z.coerce.number().refine((n) => (DURATIONS as readonly number[]).includes(n), "Choose the duration."),
    advisor_id: z.string().trim(),
    notes: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (!isDateString(d.date)) ctx.addIssue({ code: "custom", message: "Choose the date.", path: ["date"] });
    if (d.customer_mode === "existing" && !d.customer_id) ctx.addIssue({ code: "custom", message: "Choose the customer.", path: ["customer_id"] });
    if (d.customer_mode === "new" && d.new_name.length < 2) ctx.addIssue({ code: "custom", message: "Enter the new customer's name.", path: ["new_name"] });
    if (d.customer_mode === "new" && normalisePhone(d.new_phone).length < 7) ctx.addIssue({ code: "custom", message: "Enter the new customer's phone number.", path: ["new_phone"] });
    if (!d.vehicle_id && d.vehicle_text.length < 2) ctx.addIssue({ code: "custom", message: "Choose the car, or describe it.", path: ["vehicle_id"] });
  });

function parse(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return schema.safeParse({
    customer_mode: get("customer_mode") || "existing",
    customer_id: get("customer_id"),
    new_name: get("new_name"),
    new_phone: get("new_phone"),
    vehicle_id: get("vehicle_id"),
    vehicle_text: get("vehicle_text"),
    reason: get("reason"),
    date: get("date"),
    time: get("time"),
    duration_minutes: get("duration_minutes") || "60",
    advisor_id: get("advisor_id"),
    notes: get("notes"),
  });
}

async function resolveCustomer(supabase: Awaited<ReturnType<typeof createClient>>, d: z.infer<typeof schema>): Promise<{ id: string } | { error: string }> {
  if (d.customer_mode === "existing") {
    const { data } = await supabase.from("customers").select("id").eq("id", d.customer_id).eq("is_active", true).maybeSingle();
    return data ? { id: data.id } : { error: "Customer not found." };
  }
  const phone = normalisePhone(d.new_phone);
  const { data: existing } = await supabase.from("customers").select("id, full_name").eq("phone", phone).eq("is_active", true).maybeSingle();
  if (existing) return { id: existing.id }; // Same phone: it is the same customer.
  const { data, error } = await supabase.from("customers").insert({ customer_type: "individual", full_name: d.new_name, phone }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not add the customer." };
  return { id: data.id };
}

function startsAtOf(date: string, time: string) {
  return new Date(`${date}T${time}:00+04:00`).toISOString();
}

export async function createAppointment(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("bookAppointments");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;
  const supabase = await createClient();

  const customer = await resolveCustomer(supabase, d);
  if ("error" in customer) return { error: customer.error, values };
  if (d.vehicle_id) {
    const { data: v } = await supabase.from("vehicles").select("id").eq("id", d.vehicle_id).eq("customer_id", customer.id).maybeSingle();
    if (!v) return { error: "That car does not belong to this customer.", values };
  }

  const { data: appt, error } = await supabase
    .from("appointments")
    .insert({
      customer_id: customer.id,
      vehicle_id: d.vehicle_id || null,
      vehicle_text: d.vehicle_id ? null : d.vehicle_text,
      reason: d.reason,
      starts_at: startsAtOf(d.date, d.time),
      duration_minutes: d.duration_minutes,
      advisor_id: d.advisor_id || null,
      notes: blankToNull(d.notes),
    })
    .select("id")
    .single();
  if (error || !appt) return { error: error?.message ?? "Could not book the appointment.", values };

  if (d.advisor_id && d.advisor_id !== staff.id) {
    await notifyStaff([d.advisor_id], {
      type: "appointment_booked",
      title: `Appointment booked for you by ${staff.display_name}`,
      body: `${d.date} ${d.time} · ${d.reason}`,
      href: `/calendar/${appt.id}`,
    });
  }
  revalidatePath("/calendar");
  redirect(`/calendar/${appt.id}`);
}

export async function updateAppointment(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("bookAppointments");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;
  const supabase = await createClient();

  const customer = await resolveCustomer(supabase, d);
  if ("error" in customer) return { error: customer.error, values };

  const { error } = await supabase
    .from("appointments")
    .update({
      customer_id: customer.id,
      vehicle_id: d.vehicle_id || null,
      vehicle_text: d.vehicle_id ? null : d.vehicle_text,
      reason: d.reason,
      starts_at: startsAtOf(d.date, d.time),
      duration_minutes: d.duration_minutes,
      advisor_id: d.advisor_id || null,
      notes: blankToNull(d.notes),
    })
    .eq("id", id);
  if (error) return { error: error.message, values };
  revalidatePath("/calendar");
  revalidatePath(`/calendar/${id}`);
  redirect(`/calendar/${id}?message=${encodeURIComponent("Appointment updated.")}`);
}

/** Booked, no-show or cancelled (with a reason). "Arrived" is set by gate-in. */
export async function setAppointmentStatus(id: string, formData: FormData) {
  await requirePermission("bookAppointments");
  const status = String(formData.get("status") ?? "");
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(status) || status === "arrived") return;
  const reason = blankToNull(formData.get("cancel_reason"));
  const supabase = await createClient();
  await supabase
    .from("appointments")
    .update({ status, cancel_reason: status === "cancelled" ? reason : null })
    .eq("id", id);
  revalidatePath("/calendar");
  revalidatePath(`/calendar/${id}`);
}

export async function markReminderSent(id: string) {
  const staff = await requirePermission("bookAppointments");
  const supabase = await createClient();
  await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString(), reminder_sent_by: staff.id }).eq("id", id);
  revalidatePath("/calendar");
  revalidatePath(`/calendar/${id}`);
}
