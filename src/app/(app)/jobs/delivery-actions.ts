"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { closeJob } from "@/lib/close-job";
import { activeDeliveryTrip, tripCar, recalcTripKm } from "@/lib/delivery";
import { blankToNull } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { reopenZoho, tryEnqueueZoho } from "@/lib/zoho-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_RECOVERY_RATES, priceHistoryOf, type RateKind } from "@/lib/recovery";

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
  redirect(`${back}?message=${encodeURIComponent(`${kind === "pickup" ? "Pick-up" : "Delivery"} saved ✓ — send it to ${driverName ?? "the driver"} now (the buttons are on its row below).`)}&sent=${trip.id}`);
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

/**
 * "Change price" on a claimed or queried trip (owner and accounts): the new price with a short reason. The driver's
 * own figure stays (original_price_aed, crossed out on the page) and every change is written in price_history; the
 * trip keeps its status so it is then approved at the new price. A paid month is locked except for the owner.
 */
export async function changeTripPrice(tripId: string, formData: FormData) {
  const staff = await requirePermission("approveRelease");
  const price = Number(String(formData.get("price") ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  const reason = String(formData.get("reason") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const back = (q: string) => `/recovery?${q}#trip-${tripId}`;
  if (!(price > 0)) redirect(back(`error=${encodeURIComponent("Enter the new price in AED.")}`));
  if (reason.length < 3) redirect(back(`error=${encodeURIComponent("Write a short reason for the change.")}`));
  const admin = createAdminClient();
  const { data: trip } = await admin.from("recovery_trips").select("id, job_id, status, price_aed, original_price_aed, price_history, paid_month, kind, location_details, delivered_at, created_at").eq("id", tripId).maybeSingle();
  if (!trip) redirect(`/recovery?error=${encodeURIComponent("Trip not found.")}`);
  if (!["claimed", "queried"].includes(String(trip.status))) redirect(back(`error=${encodeURIComponent("Only a claimed or queried trip can have its price changed.")}`));
  if (trip.paid_month && staff.role_id !== "owner") redirect(back(`error=${encodeURIComponent(`That month (${trip.paid_month}) is already paid and locked. Only the owner can change it.`)}`));
  const from = Number(trip.price_aed);
  const to = Math.round(price * 100) / 100;
  if (Number.isFinite(from) && Math.abs(from - to) < 0.005) redirect(back(`error=${encodeURIComponent("That is the price already on the trip.")}`));
  const history = [...priceHistoryOf(trip.price_history), { from: Number.isFinite(from) ? from : 0, to, reason, by: staff.id, by_name: staff.display_name, at: new Date().toISOString() }];
  await admin.from("recovery_trips").update({ price_aed: to, original_price_aed: trip.original_price_aed ?? (Number.isFinite(from) ? from : null), price_history: history, updated_by: staff.id }).eq("id", tripId);
  if (trip.job_id) await admin.from("job_events").insert({ job_id: trip.job_id, event_type: "delivery", note: `Recovery price changed from AED ${from.toLocaleString("en-GB")} to AED ${to.toLocaleString("en-GB")} by ${staff.display_name}: ${reason}`, created_by: staff.id });
  revalidatePath("/recovery");
  redirect(back(`message=${encodeURIComponent(`Price changed to AED ${to.toLocaleString("en-GB")}. Tell the driver with the prepared WhatsApp under the trip, then Approve.`)}&changed=${tripId}`));
}

/** Settings > Recovery rates (owner): the minimum per trip and AED per km for each kind of truck, and the flag percent. */
export async function saveRecoveryRates(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  const num = (k: string, fallback: number) => { const n = Number(String(formData.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 && String(formData.get(k) ?? "").trim() !== "" ? Math.round(n * 100) / 100 : fallback; };
  const value = Object.fromEntries((Object.keys(DEFAULT_RECOVERY_RATES) as RateKind[]).map((k) => [k, { min: num(`${k}_min`, DEFAULT_RECOVERY_RATES[k].min), per_km: num(`${k}_per_km`, DEFAULT_RECOVERY_RATES[k].per_km) }]));
  const percent = num("flag_percent", 25);
  const admin = createAdminClient();
  await admin.from("settings").upsert({ key: "recovery_rates", label: "Recovery normal rates (minimum per trip and AED per km)", value, updated_by: staff.id }, { onConflict: "key" });
  await admin.from("settings").upsert({ key: "recovery_flag_percent", label: "Recovery: flag a trip this many % above the expected price", value: percent, updated_by: staff.id }, { onConflict: "key" });
  revalidatePath("/settings");
  revalidatePath("/recovery");
  redirect(`/settings?message=${encodeURIComponent("Recovery rates saved.")}#recovery-rates`);
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
  // A month can be paid AGAIN when late trips arrive: the payout row carries the WHOLE month (summed), and the
  // already-synced Zoho expense reopens so the difference fails in plain words instead of the second batch
  // silently never reaching the books.
  const { data: existing } = await admin.from("recovery_payouts").select("id, total_aed, trip_count").eq("who", who).eq("month", month).maybeSingle();
  const sumTotal = Math.round((total + Number(existing?.total_aed ?? 0)) * 100) / 100;
  const sumCount = unpaid.length + (Number(existing?.trip_count) || 0);
  const { data: payout, error: payoutError } = await admin.from("recovery_payouts").upsert({ who, month, total_aed: sumTotal, trip_count: sumCount, paid_at: now, paid_by: staff.id, created_by: staff.id, updated_by: staff.id }, { onConflict: "who,month" }).select("id").single();
  if (payoutError || !payout) redirect(`/recovery?month=${month}&error=${encodeURIComponent(`The trips are marked paid but the payout record did not save (${payoutError?.message ?? "unknown"}). Tell the owner before paying anyone.`)}`);
  if (existing) await reopenZoho("recovery", String(payout.id));
  else await tryEnqueueZoho("recovery", String(payout.id), null, staff.id);
  revalidatePath("/recovery");
  redirect(`/recovery?month=${month}&message=${encodeURIComponent(`${who}: ${month} marked paid (AED ${total.toLocaleString("en-GB")}). The month is locked.`)}`);
}

/** Section 7: "Send to driver" on a recovery-page row (pick-ups and jobless trips included). */
export async function markTripSentById(tripId: string) {
  const staff = await requirePermission("gateOut");
  const admin = createAdminClient();
  const { data: t } = await admin.from("recovery_trips").select("id, sent_at").eq("id", tripId).maybeSingle();
  if (!t) return;
  if (!t.sent_at) await admin.from("recovery_trips").update({ sent_at: new Date().toISOString(), updated_by: staff.id }).eq("id", tripId);
  revalidatePath("/recovery");
}

/** 30 October 2026: the office marks a trip's step for the driver (Car loaded / Delivered to OFJ), with the photo if there is one. */
export async function officeTripStepAction(tripId: string, step: "loaded" | "delivered", photoPath: string | null): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("gateOut");
  if (staff.viewingAs) return { error: "View only." };
  const { officeTripStep } = await import("@/lib/delivery");
  const r = await officeTripStep(tripId, step === "loaded" ? "loaded" : "delivered", photoPath, staff);
  revalidatePath("/recovery");
  return "error" in r ? { error: r.error } : { ok: true };
}
