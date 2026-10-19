import "server-only";
import { randomBytes } from "node:crypto";
import { closeJob } from "./close-job";
import { driverMessage, parseCoords } from "./recovery";
import { expandMapLink, tripRoadKmDetail, workshopPin } from "./route-distance";
import { getSettings } from "./settings";
import { shortFor } from "./short-links";
import { PRODUCTION_SITE_URL } from "./site";
import { notifyRoles, notifyStaff } from "./notifications";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export const TRIP_SELECT = "id, job_id, kind, company, driver_id, driver_name, driver_phone, truck_plate, location_url, location_details, lat, lng, scheduled_date, scheduled_slot, token, sent_at, loaded_at, delivered_at, photo_path, price_aed, price_at, status, decided_by, decided_at, query_note, marked_by, reminded_at, is_active, created_at, created_by, road_km, km_source, km_error, recovery_kind, paid_month";

export type TripRow = {
  id: string; job_id: string | null; kind: "delivery" | "pickup"; company: string | null; driver_id: string | null;
  driver_name: string | null; driver_phone: string | null; truck_plate: string | null;
  location_url: string | null; location_details: string | null; lat: number | null; lng: number | null;
  scheduled_date: string | null; scheduled_slot: string | null; token: string | null;
  sent_at: string | null; loaded_at: string | null; delivered_at: string | null; photo_path: string | null;
  price_aed: number | null; price_at: string | null; status: "open" | "claimed" | "approved" | "queried" | "paid";
  decided_by: string | null; decided_at: string | null; query_note: string | null; marked_by: string | null;
  reminded_at: string | null; is_active: boolean; created_at: string; created_by: string | null;
  road_km: number | null; km_source: "route" | "manual" | null; km_error: string | null; recovery_kind: string | null; paid_month: string | null;
};

export type DriverRow = { id: string; name: string; phone: string | null; truck_plate: string | null; company: string | null; is_default: boolean };

export const newDriveToken = () => randomBytes(18).toString("base64url");

/** The saved drivers (Settings > Recovery drivers, plus the ones learned at gate-out). */
export async function loadDrivers(): Promise<DriverRow[]> {
  const { data } = await createAdminClient().from("recovery_drivers").select("id, name, phone, truck_plate, company, is_default").eq("is_active", true).order("is_default", { ascending: false }).order("name");
  return (data ?? []) as DriverRow[];
}

/** The customer's last delivery pin, prefilled for a returning customer (editable). */
export async function lastPinOf(customerId: string | null | undefined): Promise<{ url: string; details: string | null } | null> {
  if (!customerId) return null;
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("jobs").select("id").eq("customer_id", customerId);
  const ids = (jobs ?? []).map((j) => j.id);
  if (!ids.length) return null;
  const { data } = await admin.from("recovery_trips").select("location_url, location_details, created_at").in("job_id", ids).eq("kind", "delivery").not("location_url", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.location_url ? { url: data.location_url as string, details: (data.location_details as string | null) ?? null } : null;
}

/** A driver typed at gate-out joins the saved list (matched by phone, else by name within the company). */
export async function rememberDriver(d: { name: string; phone: string | null; truckPlate: string | null; company: string | null }, by: string | null): Promise<string | null> {
  const admin = createAdminClient();
  const name = d.name.trim().slice(0, 80);
  if (!name) return null;
  const { data: all } = await admin.from("recovery_drivers").select("id, name, phone, truck_plate").eq("is_active", true);
  const phone = (d.phone ?? "").replace(/[^\d+]/g, "");
  const found = (all ?? []).find((r) => (phone && (r.phone ?? "").replace(/[^\d+]/g, "") === phone) || r.name.toLowerCase() === name.toLowerCase());
  if (found) {
    if ((d.truckPlate && !found.truck_plate) || (d.phone && !found.phone)) await admin.from("recovery_drivers").update({ truck_plate: found.truck_plate ?? d.truckPlate, phone: found.phone ?? d.phone, updated_by: by }).eq("id", found.id);
    return found.id;
  }
  const { data: ins } = await admin.from("recovery_drivers").insert({ name, phone: d.phone, truck_plate: d.truckPlate, company: d.company, created_by: by, updated_by: by }).select("id").maybeSingle();
  return ins?.id ?? null;
}

/** The trip row at gate-out (delivery) or from the Recovery page (pickup), with the driver's one-button token. */
export async function createTrip(input: { jobId: string | null; kind: "delivery" | "pickup"; company: string | null; driverId: string | null; driverName: string | null; driverPhone: string | null; truckPlate: string | null; locationUrl: string | null; locationDetails: string | null; date: string | null; slot: string | null; by: string | null }): Promise<TripRow | null> {
  const admin = createAdminClient();
  // A long link carries its coordinates; a short one (maps.app.goo.gl) is expanded by its redirects.
  const coords = parseCoords(input.locationUrl) ?? (await expandMapLink(input.locationUrl));
  // One live delivery trip per job: an older open one is retired first.
  if (input.jobId && input.kind === "delivery") await admin.from("recovery_trips").update({ is_active: false, updated_by: input.by }).eq("job_id", input.jobId).eq("kind", "delivery").is("delivered_at", null).eq("is_active", true);
  const { data } = await admin.from("recovery_trips").insert({
    job_id: input.jobId, kind: input.kind, company: input.company, driver_id: input.driverId,
    driver_name: input.driverName, driver_phone: input.driverPhone, truck_plate: input.truckPlate,
    location_url: input.locationUrl, location_details: input.locationDetails, lat: coords?.lat ?? null, lng: coords?.lng ?? null,
    scheduled_date: input.date, scheduled_slot: input.slot, token: newDriveToken(), created_by: input.by, updated_by: input.by,
  }).select(TRIP_SELECT).maybeSingle();
  const trip = (data as TripRow | null) ?? null;
  // The real road distance (Google Routes), written on the trip; a failure stores WHY in km_error.
  if (trip && coords) {
    const settings = await getSettings();
    const r = await tripRoadKmDetail({ kind: trip.kind, lat: coords.lat, lng: coords.lng }, await workshopPin(settings));
    await admin.from("recovery_trips").update({ road_km: r.km, km_source: r.km !== null ? "route" : null, km_error: r.error, lat: coords.lat, lng: coords.lng, updated_by: input.by }).eq("id", trip.id);
    trip.road_km = r.km;
    trip.km_source = r.km !== null ? "route" : trip.km_source;
  } else if (trip && !coords) {
    await admin.from("recovery_trips").update({ km_error: input.locationUrl ? "The pin could not be read as coordinates" : "No pin was given", updated_by: input.by }).eq("id", trip.id);
  }
  return trip;
}

/** Works one trip's road distance out again (the Recalculate button, and the hourly catch-up). */
export async function recalcTripKm(tripId: string, by: string | null): Promise<{ km: number | null; error: string | null }> {
  const admin = createAdminClient();
  const { data } = await admin.from("recovery_trips").select(TRIP_SELECT).eq("id", tripId).maybeSingle();
  const trip = data as TripRow | null;
  if (!trip) return { km: null, error: "Trip not found." };
  let lat = trip.lat;
  let lng = trip.lng;
  if (lat === null || lng === null) {
    const coords = parseCoords(trip.location_url) ?? (await expandMapLink(trip.location_url));
    lat = coords?.lat ?? null;
    lng = coords?.lng ?? null;
  }
  const settings = await getSettings();
  const r = await tripRoadKmDetail({ kind: trip.kind, lat, lng }, await workshopPin(settings));
  await admin.from("recovery_trips").update({ road_km: r.km ?? trip.road_km, km_source: r.km !== null ? "route" : trip.km_source, km_error: r.error, lat, lng, updated_by: by }).eq("id", tripId);
  return r;
}

export async function tripByToken(token: string): Promise<TripRow | null> {
  if (!/^[\w-]{10,}$/.test(token)) return null;
  const { data } = await createAdminClient().from("recovery_trips").select(TRIP_SELECT).eq("token", token).eq("is_active", true).maybeSingle();
  return (data as TripRow | null) ?? null;
}

export async function activeDeliveryTrip(jobId: string): Promise<TripRow | null> {
  const { data } = await createAdminClient().from("recovery_trips").select(TRIP_SELECT).eq("job_id", jobId).eq("kind", "delivery").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as TripRow | null) ?? null;
}

/** The plate, car and customer behind a trip, for the driver's message and page. */
export async function tripCar(trip: TripRow): Promise<{ plate: string; car: string; customerName: string | null; customerPhone: string | null; jobNumber: string | null; advisorIds: string[] }> {
  const admin = createAdminClient();
  if (!trip.job_id) return { plate: "", car: "", customerName: null, customerPhone: null, jobNumber: null, advisorIds: [] };
  const { data: job } = await admin.from("jobs").select("job_number, gated_in_by, customer:customers(full_name, company_name, phone), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", trip.job_id).maybeSingle();
  const v = job?.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const c = job?.customer as unknown as { full_name: string; company_name: string | null; phone: string | null } | null;
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", trip.job_id);
  const advisorIds = Array.from(new Set([job?.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
  return {
    plate: v ? formatPlate(v) : job?.job_number ?? "",
    car: v ? [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ") : "",
    customerName: c?.company_name ?? c?.full_name ?? null,
    customerPhone: c?.phone ?? null,
    jobNumber: job?.job_number ?? null,
    advisorIds,
  };
}

/** The driver's WhatsApp text: the customer's pin and his one-button page as short links. */
export async function driverMessageFor(trip: TripRow): Promise<string> {
  const car = await tripCar(trip);
  const drive = await shortFor(`${PRODUCTION_SITE_URL}/drive/${trip.token}`, "drive");
  // The map pin stays a plain Google Maps link: the driver's app shows the map preview that way.
  return driverMessage({ plate: car.plate, car: car.car, kind: trip.kind, date: trip.scheduled_date, slot: trip.scheduled_slot, customerName: car.customerName, customerPhone: car.customerPhone, locationUrl: trip.location_url, locationDetails: trip.location_details }, { drive, map: trip.location_url });
}

/**
 * The driver pressed his one button: the photo and his price land on the trip, the trip is claimed, and a delivery
 * closes the job ("Delivered hh:mm"). The link is dead afterwards.
 */
export async function completeTripByDriver(token: string, input: { bytes: Buffer; contentType: string; price: number }): Promise<{ ok: true; kind: "delivery" | "pickup" } | { error: string }> {
  const admin = createAdminClient();
  const trip = await tripByToken(token);
  if (!trip) return { error: "This link is no longer valid." };
  if (trip.delivered_at) return { error: "Already done, thank you." };
  if (!(input.price > 0) || input.price > 100000) return { error: "Enter the price in AED." };
  if (!input.bytes.length || input.bytes.length > 25 * 1024 * 1024) return { error: "The photo did not come through. Try again." };
  const ext = input.contentType.includes("png") ? "png" : input.contentType.includes("webp") ? "webp" : "jpg";
  const path = `recovery/${trip.id}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage.from("job-files").upload(path, input.bytes, { contentType: input.contentType || "image/jpeg", upsert: false });
  if (upErr) return { error: "The photo could not be saved. Try again." };
  const now = new Date().toISOString();
  await admin.from("recovery_trips").update({ delivered_at: now, photo_path: path, price_aed: Math.round(input.price * 100) / 100, price_at: now, status: "claimed", updated_by: trip.created_by }).eq("id", trip.id);
  const car = await tripCar(trip);
  if (trip.job_id) {
    await admin.from("job_files").insert({ job_id: trip.job_id, kind: "delivery_photo", storage_path: path, content_type: input.contentType || "image/jpeg", caption: trip.kind === "delivery" ? "Delivered (driver's photo)" : "Loaded (driver's photo)", uploaded_by: trip.created_by }).then(() => null, () => null);
  }
  if (trip.kind === "delivery" && trip.job_id) {
    await admin.from("gate_outs").update({ delivered_at: now, handover_confirmed: true, updated_by: trip.created_by }).eq("job_id", trip.job_id);
    await closeJob(trip.job_id, trip.created_by, trip.driver_name ? `the driver (${trip.driver_name})` : "the driver", `delivered by ${trip.driver_name ?? "the driver"}, price AED ${input.price.toLocaleString("en-GB")} claimed`);
    await notifyStaff(car.advisorIds, { type: "delivery", title: `Delivered · ${car.jobNumber ?? ""}`, body: `${car.plate}: the driver pressed Delivered with the photo; AED ${input.price.toLocaleString("en-GB")} claimed (Recovery page). The job is closed.`, jobId: trip.job_id, href: `/jobs/${trip.job_id}` });
  } else {
    await notifyRoles(["owner"], { type: "delivery", title: `${trip.kind === "pickup" ? "Picked up" : "Delivered"}: ${car.plate || trip.location_details || "trip"}`, body: `AED ${input.price.toLocaleString("en-GB")} claimed by ${trip.driver_name ?? "the driver"} (Recovery page).`, jobId: trip.job_id, href: "/recovery" });
    if (trip.job_id) await notifyStaff(car.advisorIds, { type: "delivery", title: `Picked up · ${car.jobNumber ?? ""}`, body: `${car.plate}: the driver pressed Loaded with the photo; AED ${input.price.toLocaleString("en-GB")} claimed.`, jobId: trip.job_id, href: `/jobs/${trip.job_id}` });
  }
  return { ok: true, kind: trip.kind };
}
