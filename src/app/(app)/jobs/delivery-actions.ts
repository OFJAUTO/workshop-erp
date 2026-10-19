"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { closeJob } from "@/lib/close-job";
import { activeDeliveryTrip, tripCar, recalcTripKm } from "@/lib/delivery";
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

/**
 * A new pick-up or delivery from the Recovery page. Our truck: the saved driver fills in by himself and is
 * never shown. External recovery: the truck type (Flatbed or Closed box) and the company, saved with its
 * mobile for next time. Both get the same one-button link.
 */
export async function createPickupTrip(formData: FormData) {
  const staff = await requirePermission("gateOut");
  const { createTrip, loadDrivers } = await import("@/lib/delivery");
  const { isMapLink } = await import("@/lib/recovery");
  const back = "/recovery";
  const side = String(formData.get("side") ?? "ours");
  const kind = String(formData.get("kind") ?? "pickup") === "delivery" ? "delivery" : "pickup";
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
  let company: string | null = null;
  let recoveryKind: string | null = null;
  let driverId: string | null = null;
  let driverName: string | null = null;
  let driverPhone: string | null = null;
  let truckPlate: string | null = null;
  if (side === "external") {
    recoveryKind = ["flatbed", "closed_box"].includes(String(formData.get("truck_type"))) ? String(formData.get("truck_type")) : null;
    if (!recoveryKind) redirect(`${back}?error=${encodeURIComponent("Pick the truck type: Flatbed or Closed box.")}`);
    const choice = String(formData.get("company_choice") ?? "");
    if (choice && choice !== "__new__") {
      const { data: c } = await admin.from("recovery_companies").select("id, name, phone").eq("id", choice).maybeSingle();
      if (!c) redirect(`${back}?error=${encodeURIComponent("Pick the company again.")}`);
      company = c.name;
      driverPhone = c.phone;
    } else {
      const name = blankToNull(formData.get("company_name"));
      if (!name) redirect(`${back}?error=${encodeURIComponent("Type the company's name.")}`);
      const phone = blankToNull(formData.get("company_phone"));
      const { data: existing } = await admin.from("recovery_companies").select("id, phone").ilike("name", name).maybeSingle();
      if (existing) await admin.from("recovery_companies").update({ phone: phone ?? existing.phone, is_active: true, updated_by: staff.id }).eq("id", existing.id);
      else await admin.from("recovery_companies").insert({ name, phone, created_by: staff.id, updated_by: staff.id });
      company = name;
      driverPhone = phone;
    }
    driverName = company;
  } else {
    // Our truck: the saved driver only, pre-selected; his details never show on the form.
    const drivers = (await loadDrivers()).filter((d) => !d.company);
    const d = drivers.find((x) => x.is_default) ?? drivers[0];
    if (!d) redirect(`${back}?error=${encodeURIComponent("No saved driver yet. The owner adds one under Settings > Recovery drivers.")}`);
    driverId = d.id;
    driverName = d.name;
    driverPhone = d.phone;
    truckPlate = d.truck_plate;
  }
  const trip = await createTrip({
    jobId, kind, company, driverId, driverName, driverPhone, truckPlate,
    locationUrl: url, locationDetails: blankToNull(formData.get("location_details")),
    date: blankToNull(formData.get("date")), slot: blankToNull(formData.get("slot")), by: staff.id,
  });
  if (!trip) redirect(`${back}?error=${encodeURIComponent("The trip could not be saved.")}`);
  if (recoveryKind) await admin.from("recovery_trips").update({ recovery_kind: recoveryKind, updated_by: staff.id }).eq("id", trip.id);
  revalidatePath("/recovery");
  redirect(`${back}?message=${encodeURIComponent(`${kind === "pickup" ? "Pick-up" : "Delivery"} saved. Send the link from its row.`)}&sent=${trip.id}`);
}

/** The owner or accounts answer a claimed price: Approved, Queried (with a note to whoever runs the trips), or Paid. */
export async function decideTrip(tripId: string, formData: FormData) {
  const staff = await requirePermission("approveRelease"); // the owner and accounts
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const { data: trip } = await admin.from("recovery_trips").select("id, job_id, status, price_aed, driver_name, company").eq("id", tripId).maybeSingle();
  if (!trip) redirect(`/recovery?error=${encodeURIComponent("Trip not found.")}`);
  // Paid is never per trip any more: the month is marked paid in one go, per driver or company.
  const next = decision === "approve" ? "approved" : decision === "query" ? "queried" : null;
  if (!next) redirect(`/recovery?error=${encodeURIComponent("Choose Approve or Query. Paying happens by the month.")}`);
  const lockRow = await admin.from("recovery_trips").select("paid_month").eq("id", tripId).maybeSingle();
  if (lockRow.data?.paid_month && staff.role_id !== "owner") redirect(`/recovery?error=${encodeURIComponent(`That month (${lockRow.data.paid_month}) is already paid and locked. Only the owner can change it.`)}`);
  if (next === "queried" && !note) redirect(`/recovery?error=${encodeURIComponent("Write the query note.")}`);
  await admin.from("recovery_trips").update({ status: next, decided_by: staff.id, decided_at: new Date().toISOString(), query_note: next === "queried" ? note : null, updated_by: staff.id }).eq("id", tripId);
  if (trip.job_id) await admin.from("job_events").insert({ job_id: trip.job_id, event_type: "delivery", note: `Recovery price AED ${Number(trip.price_aed ?? 0).toLocaleString("en-GB")} ${next === "queried" ? `queried by ${staff.display_name}: ${note}` : `${next} by ${staff.display_name}`}`, created_by: staff.id });
  revalidatePath("/recovery");
  redirect(`/recovery?message=${encodeURIComponent(next === "queried" ? "Queried; the note is on the trip." : "Approved.")}`);
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

/** A trip with no road distance (no key, no pin): the kilometres typed by hand on the Recovery page. */
/** Owner or accounts: work the road distance out again (after the pin or the key was fixed). */
export async function recalcDistance(tripId: string) {
  const staff = await requirePermission("approveRelease");
  const r = await recalcTripKm(tripId, staff.id);
  revalidatePath("/recovery");
  redirect(r.km !== null ? `/recovery?message=${encodeURIComponent(`Distance found: ${r.km} km by road.`)}` : `/recovery?error=${encodeURIComponent(r.error ?? "Distance not found.")}`);
}

export async function setTripKm(tripId: string, formData: FormData) {
  const staff = await requirePermission("approveRelease");
  const km = Number(String(formData.get("km") ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(km) || km <= 0 || km > 2000) redirect(`/recovery?error=${encodeURIComponent("Enter the one-way kilometres.")}`);
  const admin = createAdminClient();
  await admin.from("recovery_trips").update({ road_km: Math.round(km * 10) / 10, km_source: "manual", updated_by: staff.id }).eq("id", tripId);
  revalidatePath("/recovery");
  redirect(`/recovery?message=${encodeURIComponent("Distance saved.")}`);
}

/**
 * "Mark <month> paid" for one driver or company: only when every one of their trips that month is approved;
 * the month then locks (changes need the owner). Written to recovery_payouts for the books.
 */
export async function markMonthPaid(formData: FormData) {
  const staff = await requirePermission("approveRelease");
  const who = String(formData.get("who") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!who || !/^\d{4}-\d{2}$/.test(month)) redirect(`/recovery?error=${encodeURIComponent("Pick the month and the driver.")}`);
  const admin = createAdminClient();
  const { TRIP_SELECT } = await import("@/lib/delivery");
  const { data: rows } = await admin.from("recovery_trips").select(TRIP_SELECT).eq("is_active", true).gte("created_at", `${month}-01`).order("created_at");
  const whoOf = (t: { company: string | null; driver_name: string | null }) => t.company ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck");
  const trips = ((rows ?? []) as { id: string; company: string | null; driver_name: string | null; status: string; price_aed: number | string | null; delivered_at: string | null; created_at: string; paid_month: string | null }[])
    .filter((t) => (t.delivered_at ?? t.created_at).startsWith(month) && whoOf(t) === who);
  if (!trips.length) redirect(`/recovery?error=${encodeURIComponent("No trips for that month.")}`);
  const open = trips.filter((t) => t.status !== "approved" && t.status !== "paid");
  if (open.length) redirect(`/recovery?month=${month}&error=${encodeURIComponent(`${open.length} trip${open.length === 1 ? " is" : "s are"} not approved yet.`)}`);
  const unpaid = trips.filter((t) => !t.paid_month);
  const total = unpaid.reduce((a, t) => a + (Number(t.price_aed) || 0), 0);
  if (!unpaid.length) redirect(`/recovery?month=${month}&message=${encodeURIComponent("Already marked paid.")}`);
  const now = new Date().toISOString();
  for (const t of unpaid) await admin.from("recovery_trips").update({ status: "paid", paid_month: month, updated_by: staff.id }).eq("id", t.id);
  await admin.from("recovery_payouts").upsert({ who, month, total_aed: Math.round(total * 100) / 100, trip_count: unpaid.length, paid_at: now, paid_by: staff.id, created_by: staff.id, updated_by: staff.id }, { onConflict: "who,month" });
  revalidatePath("/recovery");
  redirect(`/recovery?month=${month}&message=${encodeURIComponent(`${who}: ${month} marked paid (AED ${total.toLocaleString("en-GB")}). The month is locked.`)}`);
}
