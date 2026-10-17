"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { closeJob } from "@/lib/close-job";
import { activeDeliveryTrip, tripCar } from "@/lib/delivery";
import { blankToNull } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/gate-out`);
  revalidatePath("/recovery");
  revalidatePath("/dashboard");
}

/** "Send to driver" pressed: the WhatsApp opens in the browser; here the send is written down. */
export async function markDriverSent(jobId: string) {
  const staff = await requirePermission("gateOut");
  const trip = await activeDeliveryTrip(jobId);
  if (!trip) return { error: "No delivery trip on this job." };
  const admin = createAdminClient();
  if (!trip.sent_at) {
    await admin.from("recovery_trips").update({ sent_at: new Date().toISOString(), updated_by: staff.id }).eq("id", trip.id);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "delivery", note: `Delivery details sent to the driver (${trip.driver_name ?? "driver"}) by ${staff.display_name}`, created_by: staff.id });
  }
  refresh(jobId);
  return { ok: true };
}

/** "Car loaded: send 'on its way'": marks On the way with the time; the browser then opens WhatsApp to the customer. */
export async function carLoaded(jobId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("gateOut");
  const trip = await activeDeliveryTrip(jobId);
  if (!trip) return { error: "No delivery trip on this job." };
  if (trip.delivered_at) return { error: "Already delivered." };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const message = String(formData.get("message") ?? "").trim();
  await admin.from("recovery_trips").update({ loaded_at: trip.loaded_at ?? now, updated_by: staff.id }).eq("id", trip.id);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  await admin.from("job_events").insert({ job_id: jobId, event_type: "delivery", note: `On the way, ${time}: "on its way" sent to the customer by ${staff.display_name}${message ? "" : " (no message text)"}`, created_by: staff.id });
  refresh(jobId);
  return { ok: true };
}

/** The advisor's backup once the driver cannot press his button: logged as marked by the advisor; the price comes later on the Recovery page. */
export async function advisorMarkDelivered(jobId: string, formData: FormData) {
  const staff = await requirePermission("gateOut");
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, is_open, job_number, gated_in_by").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || job.status !== "in_delivery") redirect(`/jobs/${jobId}/gate-out?error=${encodeURIComponent("This car is not out for delivery.")}`);
  void formData;
  const now = new Date().toISOString();
  const trip = await activeDeliveryTrip(jobId);
  if (trip && !trip.delivered_at) await admin.from("recovery_trips").update({ delivered_at: now, marked_by: staff.id, status: trip.price_aed ? "claimed" : trip.status, updated_by: staff.id }).eq("id", trip.id);
  await admin.from("gate_outs").update({ delivered_at: now, delivered_by: staff.id, handover_confirmed: true, updated_by: staff.id }).eq("job_id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "delivery", note: `Marked delivered by ${staff.display_name} (the driver's button was not used); the price follows on the Recovery page`, created_by: staff.id });
  await closeJob(jobId, staff.id, staff.display_name, "marked delivered by the advisor");
  if (trip) {
    const car = await tripCar(trip);
    await notifyStaff(car.advisorIds.filter((id) => id !== staff.id), { type: "delivery", title: `Delivered (marked by advisor) · ${job.job_number}`, body: "The job is closed. Add the driver's price on the Recovery page when it comes.", jobId, href: "/recovery" });
  }
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Marked delivered. The job is closed; the driver's price goes on the Recovery page.")}`);
}

/** A new pick-up trip from the Recovery page (our truck or a company brings a car in). */
export async function createPickupTrip(formData: FormData) {
  const staff = await requirePermission("gateOut");
  const { createTrip } = await import("@/lib/delivery");
  const { isMapLink } = await import("@/lib/recovery");
  const back = "/recovery";
  const driverName = blankToNull(formData.get("driver_name"));
  if (!driverName) redirect(`${back}?error=${encodeURIComponent("Pick or type the driver.")}`);
  const url = blankToNull(formData.get("location_url"));
  if (url && !isMapLink(url)) redirect(`${back}?error=${encodeURIComponent("That is not a map link. Paste the pin the customer sent (Google Maps).")}`);
  const admin = createAdminClient();
  let jobId: string | null = null;
  const jobNumber = blankToNull(formData.get("job_number"));
  if (jobNumber) {
    const { data: j } = await admin.from("jobs").select("id").ilike("job_number", jobNumber).maybeSingle();
    jobId = j?.id ?? null;
    if (!jobId) redirect(`${back}?error=${encodeURIComponent(`No job ${jobNumber} found. Leave the box empty for a pick-up before gate-in.`)}`);
  }
  const trip = await createTrip({
    jobId, kind: "pickup",
    company: blankToNull(formData.get("company")),
    driverId: blankToNull(formData.get("driver_id")),
    driverName, driverPhone: blankToNull(formData.get("driver_phone")), truckPlate: blankToNull(formData.get("truck_plate")),
    locationUrl: url, locationDetails: blankToNull(formData.get("location_details")),
    date: blankToNull(formData.get("date")), slot: blankToNull(formData.get("slot")), by: staff.id,
  });
  if (!trip) redirect(`${back}?error=${encodeURIComponent("The trip could not be saved.")}`);
  revalidatePath("/recovery");
  redirect(`${back}?message=${encodeURIComponent("Pick-up trip saved. Send the link to the driver from its row.")}&sent=${trip.id}`);
}

/** The owner or accounts answer a claimed price: Approved, Queried (with a note to whoever runs the trips), or Paid. */
export async function decideTrip(tripId: string, formData: FormData) {
  const staff = await requirePermission("approveRelease"); // the owner and accounts
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const { data: trip } = await admin.from("recovery_trips").select("id, job_id, status, price_aed, driver_name, company").eq("id", tripId).maybeSingle();
  if (!trip) redirect(`/recovery?error=${encodeURIComponent("Trip not found.")}`);
  const next = decision === "approve" ? "approved" : decision === "query" ? "queried" : decision === "paid" ? "paid" : null;
  if (!next) redirect(`/recovery?error=${encodeURIComponent("Choose Approve, Query or Paid.")}`);
  if (next === "queried" && !note) redirect(`/recovery?error=${encodeURIComponent("Write the query note.")}`);
  await admin.from("recovery_trips").update({ status: next, decided_by: staff.id, decided_at: new Date().toISOString(), query_note: next === "queried" ? note : null, updated_by: staff.id }).eq("id", tripId);
  if (trip.job_id) await admin.from("job_events").insert({ job_id: trip.job_id, event_type: "delivery", note: `Recovery price AED ${Number(trip.price_aed ?? 0).toLocaleString("en-GB")} ${next === "queried" ? `queried by ${staff.display_name}: ${note}` : `${next} by ${staff.display_name}`}`, created_by: staff.id });
  revalidatePath("/recovery");
  redirect(`/recovery?message=${encodeURIComponent(next === "queried" ? "Queried; the note is on the trip." : next === "paid" ? "Marked paid." : "Approved.")}`);
}

/** Accounts type a price on a trip that has none (the advisor marked it delivered). */
export async function setTripPrice(tripId: string, formData: FormData) {
  const staff = await requirePermission("approveRelease");
  const price = Number(String(formData.get("price") ?? "").replace(",", "."));
  if (!(price > 0)) redirect(`/recovery?error=${encodeURIComponent("Enter the price in AED.")}`);
  const admin = createAdminClient();
  await admin.from("recovery_trips").update({ price_aed: Math.round(price * 100) / 100, price_at: new Date().toISOString(), status: "claimed", updated_by: staff.id }).eq("id", tripId);
  revalidatePath("/recovery");
  redirect(`/recovery?message=${encodeURIComponent("Price saved as claimed.")}`);
}

/** Settings > Recovery drivers: add or change one (the regular driver is prefilled at gate-out). */
export async function saveRecoveryDriver(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  const admin = createAdminClient();
  const id = blankToNull(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) redirect(`/settings?error=${encodeURIComponent("Enter the driver's name.")}#drivers`);
  const row = {
    name,
    phone: blankToNull(formData.get("phone")),
    truck_plate: blankToNull(formData.get("truck_plate")),
    company: blankToNull(formData.get("company")),
    is_default: formData.get("is_default") === "on",
    updated_by: staff.id,
  };
  if (row.is_default) await admin.from("recovery_drivers").update({ is_default: false, updated_by: staff.id }).eq("is_default", true);
  if (id) await admin.from("recovery_drivers").update(row).eq("id", id);
  else await admin.from("recovery_drivers").insert({ ...row, created_by: staff.id });
  revalidatePath("/settings");
  redirect(`/settings?message=${encodeURIComponent("Driver saved.")}#drivers`);
}

/** A driver no longer used is set aside (never deleted). */
export async function removeRecoveryDriver(id: string) {
  const staff = await requirePermission("manageSettings");
  await createAdminClient().from("recovery_drivers").update({ is_active: false, updated_by: staff.id }).eq("id", id);
  revalidatePath("/settings");
  redirect(`/settings?message=${encodeURIComponent("Driver removed from the list.")}#drivers`);
}
