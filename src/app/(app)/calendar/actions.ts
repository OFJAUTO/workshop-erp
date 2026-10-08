"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { APPOINTMENT_STATUSES, BOOKING_KINDS, COLLECT_METHODS, DURATIONS, isDateString } from "@/lib/calendar";
import { blankToNull, normalisePhone } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import type { RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { canEditAppointment } from "./form-data";

const schema = z
  .object({
    kind: z.enum(BOOKING_KINDS, { message: "Choose the type of booking." }),
    customer_mode: z.enum(["existing", "new"]),
    customer_id: z.string().trim(),
    new_name: z.string().trim(),
    new_phone: z.string().trim(),
    vehicle_id: z.string().trim(),
    vehicle_text: z.string().trim(),
    job_id: z.string().trim(),
    reason: z.string().trim(),
    collect_address: z.string().trim(),
    collect_method: z.string().trim(),
    date: z.string().trim(),
    time: z.string().trim().regex(/^\d{2}:\d{2}$/, "Choose the time."),
    duration_minutes: z.coerce.number(),
    advisor_id: z.string().trim(),
    notes: z.string().trim(),
    department: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (!isDateString(d.date)) ctx.addIssue({ code: "custom", message: "Choose the date.", path: ["date"] });
    if (d.kind === "customer_collects") {
      if (!d.job_id) ctx.addIssue({ code: "custom", message: "Choose the job card of the finished car.", path: ["job_id"] });
      return;
    }
    if (d.reason.length < 2) ctx.addIssue({ code: "custom", message: "Enter the reason for the visit.", path: ["reason"] });
    if (!["mechanical", "bodyshop", "both"].includes(d.department)) ctx.addIssue({ code: "custom", message: "Choose the department: Mechanical, Bodyshop or Both.", path: ["department"] });
    if (d.customer_mode === "existing" && !d.customer_id) ctx.addIssue({ code: "custom", message: "Choose the customer.", path: ["customer_id"] });
    if (d.customer_mode === "new" && d.new_name.length < 2) ctx.addIssue({ code: "custom", message: "Enter the new customer's name.", path: ["new_name"] });
    if (d.customer_mode === "new" && normalisePhone(d.new_phone).length < 7) ctx.addIssue({ code: "custom", message: "Enter the new customer's phone number.", path: ["new_phone"] });
    if (d.kind !== "customer_visit" && !d.vehicle_id && d.vehicle_text.length < 2) ctx.addIssue({ code: "custom", message: "Choose the car, or describe it.", path: ["vehicle_id"] });
    if (d.kind === "customer_visit" && !(DURATIONS as readonly number[]).includes(d.duration_minutes)) ctx.addIssue({ code: "custom", message: "Choose how long the visit takes.", path: ["duration_minutes"] });
    if (d.kind === "we_collect") {
      if (d.collect_address.length < 5) ctx.addIssue({ code: "custom", message: "Enter the collection address.", path: ["collect_address"] });
      if (!COLLECT_METHODS.some((m) => m.value === d.collect_method)) ctx.addIssue({ code: "custom", message: "Choose how the car is collected.", path: ["collect_method"] });
    }
  });

function parse(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return schema.safeParse({
    kind: get("kind"),
    customer_mode: get("customer_mode") || "existing",
    customer_id: get("customer_id"),
    new_name: get("new_name"),
    new_phone: get("new_phone"),
    vehicle_id: get("vehicle_id"),
    vehicle_text: get("vehicle_text"),
    job_id: get("job_id"),
    reason: get("reason"),
    collect_address: get("collect_address"),
    collect_method: get("collect_method"),
    date: get("date"),
    time: get("time"),
    duration_minutes: get("duration_minutes") || "30",
    advisor_id: get("advisor_id"),
    notes: get("notes"),
    department: get("department"),
  });
}

type Client = Awaited<ReturnType<typeof createClient>>;
type Parsed = z.infer<typeof schema>;

async function resolveCustomer(supabase: Client, d: Parsed): Promise<{ id: string } | { error: string }> {
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

/** Everything the row needs, from the parsed form. */
async function buildRow(supabase: Client, d: Parsed): Promise<Record<string, unknown> | { error: string }> {
  let customerId: string;
  let vehicleId: string | null = d.vehicle_id || null;
  let jobId: string | null = null;
  let reason = d.reason;

  if (d.kind === "customer_collects") {
    const { data: job } = await supabase.from("jobs").select("id, customer_id, vehicle_id, job_number, is_open").eq("id", d.job_id).maybeSingle();
    if (!job) return { error: "Job card not found." };
    customerId = job.customer_id;
    vehicleId = job.vehicle_id;
    jobId = job.id;
    reason = reason || `Collect finished car · ${job.job_number}`;
  } else {
    const customer = await resolveCustomer(supabase, d);
    if ("error" in customer) return customer;
    customerId = customer.id;
    if (vehicleId) {
      const { data: v } = await supabase.from("vehicles").select("id").eq("id", vehicleId).eq("customer_id", customerId).maybeSingle();
      if (!v) return { error: "That car does not belong to this customer." };
    }
  }

  if (d.advisor_id) {
    const { data: adv } = await supabase.from("staff").select("id").eq("id", d.advisor_id).eq("is_active", true).in("role_id", ["service_advisor", "owner"]).maybeSingle();
    if (!adv) return { error: "A booking can only be assigned to a service advisor or the owner." };
  }

  return {
    kind: d.kind,
    department: d.kind === "customer_collects" ? null : d.department,
    customer_id: customerId,
    vehicle_id: vehicleId,
    vehicle_text: vehicleId ? null : blankToNull(d.vehicle_text),
    job_id: jobId,
    reason,
    starts_at: new Date(`${d.date}T${d.time}:00+04:00`).toISOString(),
    duration_minutes: d.kind === "customer_visit" ? d.duration_minutes : 30,
    advisor_id: d.advisor_id || null,
    collect_address: d.kind === "we_collect" ? d.collect_address : null,
    collect_method: d.kind === "we_collect" ? d.collect_method : null,
    notes: blankToNull(d.notes),
  };
}

export async function createAppointment(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("bookAppointments");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const supabase = await createClient();
  const row = await buildRow(supabase, parsed.data);
  if ("error" in row) return { error: String(row.error), values };

  const { data: appt, error } = await supabase.from("appointments").insert(row).select("id").single();
  if (error || !appt) return { error: error?.message ?? "Could not book the appointment.", values };

  if (row.advisor_id && row.advisor_id !== staff.id) {
    await notifyStaff([String(row.advisor_id)], {
      type: "appointment_booked",
      title: `Booking made for you by ${staff.display_name}`,
      body: `${parsed.data.date} ${parsed.data.time} · ${String(row.reason)}`,
      href: `/calendar/${appt.id}`,
    });
  }
  revalidatePath("/calendar");
  redirect(`/calendar/${appt.id}`);
}

/** Loads the booking and checks the person may change it. */
async function loadEditable(supabase: Client, staff: { id: string; role_id: RoleId }, id: string) {
  const { data } = await supabase.from("appointments").select("id, advisor_id, created_by, status, kind").eq("id", id).maybeSingle();
  if (!data) return { error: "Booking not found." };
  if (!canEditAppointment(staff, data)) return { error: "Only the person this booking belongs to, or the owner, can change it." };
  return { appt: data };
}

export async function updateAppointment(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("bookAppointments");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const supabase = await createClient();
  const guard = await loadEditable(supabase, staff as { id: string; role_id: RoleId }, id);
  if ("error" in guard) return { error: guard.error ?? "Not allowed.", values };
  const row = await buildRow(supabase, parsed.data);
  if ("error" in row) return { error: String(row.error), values };

  const { error } = await supabase.from("appointments").update(row).eq("id", id);
  if (error) return { error: error.message, values };
  revalidatePath("/calendar");
  revalidatePath(`/calendar/${id}`);
  redirect(`/calendar/${id}?message=${encodeURIComponent("Booking updated.")}`);
}

/** Booked, done, no-show or cancelled (with a reason). "Arrived" is set by gate-in. */
export async function setAppointmentStatus(id: string, formData: FormData) {
  const staff = await requirePermission("bookAppointments");
  const status = String(formData.get("status") ?? "");
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(status) || status === "arrived") return;
  const supabase = await createClient();
  const guard = await loadEditable(supabase, staff as { id: string; role_id: RoleId }, id);
  if ("error" in guard) redirect(`/calendar/${id}?error=${encodeURIComponent(guard.error ?? "Not allowed.")}`);
  const reason = blankToNull(formData.get("cancel_reason"));
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
  const guard = await loadEditable(supabase, staff as { id: string; role_id: RoleId }, id);
  if ("error" in guard) redirect(`/calendar/${id}?error=${encodeURIComponent(guard.error ?? "Not allowed.")}`);
  await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString(), reminder_sent_by: staff.id }).eq("id", id);
  revalidatePath("/calendar");
  revalidatePath(`/calendar/${id}`);
}
