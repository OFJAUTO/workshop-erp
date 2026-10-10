"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { blankToNull, normalisePhone } from "@/lib/format";
import { mileageChecks, toMiles, type MileageUnit } from "@/lib/mileage";
import { notifyManagers, notifyRoles } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES } from "@/lib/types";

/* ---------------------------------------------------------------------------
   Car picture upload (shared)
   --------------------------------------------------------------------------- */

async function saveCarPicture(vehicleId: string, file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Use a JPG, PNG or WebP picture.";
  if (file.size > 10 * 1024 * 1024) return "The picture must be under 10 MB.";
  const path = `${vehicleId}/profile-${Date.now()}-${randomBytes(4).toString("hex")}.jpg`;
  const supabase = await createClient();
  const { error: upError } = await supabase.storage.from("vehicle-photos").upload(path, file, { contentType: file.type, upsert: false });
  if (upError) return "Picture upload failed: " + upError.message;
  const { error } = await supabase.from("vehicles").update({ photo_path: path }).eq("id", vehicleId);
  if (error) return error.message;
  return null;
}

/* ---------------------------------------------------------------------------
   Gate-in
   --------------------------------------------------------------------------- */

const gateInSchema = z
  .object({
    arrived_by: z.enum(["our_recovery", "customer_drove", "customer_driver", "outside_recovery"], { message: "Choose how the car arrived." }),
    condition: z.enum(["runs_drives", "needs_assistance", "does_not_run"], { message: "Choose the vehicle condition." }),
    fuel_level: z.string(),
    battery_percent: z.string().trim(),
    cleanliness: z.enum(["clean", "average", "dirty", "very_dirty"], { message: "Choose the cleanliness." }),
    dash_cam: z.enum(["yes", "no"], { message: "Is a dash cam fitted?" }),
    major_damage: z.enum(["yes", "no"], { message: "Is there major damage?" }),
    mileage: z.string().trim(),
    mileage_unit: z.string().trim(),
    mileage_entered: z.string().trim(),
    mileage_confirmed: z.string().trim(),
    keys_count: z.string().trim(),
    keys_keychain: z.enum(["yes", "no"], { message: "Did the keys come with a keychain?" }),
    notes: z.string().trim(),
    old_parts_return: z.enum(["yes", "no"], { message: "Does the customer want old parts returned?" }),
    priority: z.enum(["high", "normal", "low"], { message: "Choose the priority." }),
    department: z.enum(["mechanical", "bodyshop", "both"], { message: "Choose Mechanical, Bodyshop or Both." }),
    is_electric: z.string(),
    location_choice: z.string().trim().min(1, "Choose the gate-in location."),
    location_address: z.string().trim(),
    location_lat: z.string().trim(),
    location_lng: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (d.is_electric === "yes") {
      if (!/^\d{1,3}$/.test(d.battery_percent) || Number(d.battery_percent) > 100) {
        ctx.addIssue({ code: "custom", path: ["battery_percent"], message: "Enter the battery percentage (0 to 100)." });
      }
    } else if (!["empty", "quarter", "half", "three_quarters", "full"].includes(d.fuel_level)) {
      ctx.addIssue({ code: "custom", path: ["fuel_level"], message: "Choose the fuel level." });
    }
    if (!/^\d{1,7}$/.test(d.mileage)) ctx.addIssue({ code: "custom", path: ["mileage"], message: "Enter the mileage." });
    if (d.mileage_unit !== "km" && d.mileage_unit !== "mi") ctx.addIssue({ code: "custom", path: ["mileage_unit"], message: "Choose km or miles." });
    if (!/^\d{1,2}$/.test(d.keys_count) || Number(d.keys_count) > 10) {
      ctx.addIssue({ code: "custom", path: ["keys_count"], message: "Enter how many keys were received." });
    }
  });

export async function requestLines(formData: FormData): Promise<string[]> {
  return formData
    .getAll("requests")
    .map((r) => String(r).trim())
    .filter((r) => r.length > 0)
    .slice(0, 50);
}

function parseGateIn(formData: FormData) {
  const get = (k: string) => formData.get(k) ?? "";
  return gateInSchema.safeParse({
    arrived_by: get("arrived_by"),
    department: get("department"),
    condition: get("condition"),
    fuel_level: get("fuel_level"),
    battery_percent: get("battery_percent"),
    cleanliness: get("cleanliness"),
    dash_cam: get("dash_cam"),
    major_damage: get("major_damage"),
    mileage: get("mileage"),
    mileage_unit: get("mileage_unit") || "km",
    mileage_entered: get("mileage_entered"),
    mileage_confirmed: get("mileage_confirmed"),
    keys_count: get("keys_count"),
    keys_keychain: get("keys_keychain"),
    notes: get("notes"),
    old_parts_return: get("old_parts_return"),
    priority: get("priority"),
    is_electric: get("is_electric"),
    location_choice: get("location_choice"),
    location_address: get("location_address"),
    location_lat: get("location_lat"),
    location_lng: get("location_lng"),
  });
}

export async function createGateIn(vehicleId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateIn");
  const values = formValues(formData);
  const parsed = parseGateIn(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;
  const requests = await requestLines(formData);
  if (requests.length === 0) return { error: "Add at least one customer request.", values };
  const vipOn = formData.get("vip") === "on";
  const vipNote = blankToNull(formData.get("vip_note"));

  const settings = await getSettings();
  const branch = settings.branches.find((b) => b.name === d.location_choice);
  const locationType = branch ? "branch" : d.location_choice === "customer" ? "customer" : "other";
  if (!branch && d.location_address.length < 3) return { error: "Enter the address or describe where the car is.", values };
  const lat = d.location_lat ? Number(d.location_lat) : null;
  const lng = d.location_lng ? Number(d.location_lng) : null;

  const supabase = await createClient();
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, customer_id, is_active, photo_path, model_year, last_mileage, customer:customers(is_vip, vip_note)")
    .eq("id", vehicleId)
    .maybeSingle();
  if (!vehicle || !vehicle.is_active) return { error: "Car not found.", values };

  // The mileage checks run here too, so a figure that looks wrong is only saved once the advisor confirmed it.
  const unit = d.mileage_unit as MileageUnit;
  const km = Number(d.mileage);
  const { data: lastVisit } = await supabase.from("jobs").select("gated_in_at").eq("vehicle_id", vehicleId).order("gated_in_at", { ascending: false }).limit(1).maybeSingle();
  const checks = mileageChecks(km, { modelYear: vehicle.model_year, lastKm: vehicle.last_mileage, lastVisitAt: lastVisit?.gated_in_at ?? null, unit });
  if (checks.length && d.mileage_confirmed !== "yes") return { error: `The mileage looks unusual: ${checks.map((c) => c.text).join(" ")} Tap "Yes, the mileage is correct" to continue.`, values };

  const picture = formData.get("car_picture");
  const hasNewPicture = picture instanceof File && picture.size > 0;
  // The car picture is taken on the phone checklist now; a picture here is optional and replaces the old one.

  const { data: openJob } = await supabase
    .from("jobs")
    .select("id, job_number")
    .eq("vehicle_id", vehicleId)
    .eq("is_open", true)
    .maybeSingle();
  if (openJob) return { error: `This car is already in the workshop on job ${openJob.job_number}.`, values };

  if (hasNewPicture) {
    const picError = await saveCarPicture(vehicleId, picture);
    if (picError) return { error: picError, values };
  }

  // An accepted estimate for this car becomes the quotation once the inspection is approved.
  const estimateId = blankToNull(formData.get("estimate_id"));
  const { data: estimate } = estimateId ? await supabase.from("quotations").select("id, number, status, vehicle_id").eq("id", estimateId).eq("kind", "estimate").maybeSingle() : { data: null };
  // A comeback: the car is back for a previous job of its own. High priority, linked both ways.
  const comebackId = blankToNull(formData.get("comeback_of"));
  const { data: comebackJob } = comebackId ? await supabase.from("jobs").select("id, job_number, vehicle_id").eq("id", comebackId).eq("vehicle_id", vehicleId).maybeSingle() : { data: null };
  if (comebackId && !comebackJob) return { error: "That previous job does not belong to this car.", values };
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ vehicle_id: vehicleId, customer_id: vehicle.customer_id, priority: comebackJob ? "high" : d.priority, department: d.department, gated_in_by: staff.id, estimate_id: estimate && estimate.status === "approved" && estimate.vehicle_id === vehicleId ? estimate.id : null, comeback_of: comebackJob?.id ?? null })
    .select("id, job_number")
    .single();
  if (jobError || !job) return { error: jobError?.message ?? "Could not open the job card.", values };

  const { error: giError } = await supabase.from("gate_ins").insert({
    job_id: job.id,
    arrived_by: d.arrived_by,
    condition: d.condition,
    fuel_level: d.is_electric === "yes" ? null : d.fuel_level,
    battery_percent: d.is_electric === "yes" ? Number(d.battery_percent) : null,
    cleanliness: d.cleanliness,
    dash_cam: d.dash_cam === "yes",
    major_damage: d.major_damage === "yes",
    mileage: km,
    mileage_unit: unit,
    mileage_miles: unit === "mi" && d.mileage_entered !== "" && Number.isFinite(Number(d.mileage_entered)) ? Number(d.mileage_entered) : toMiles(km),
    keys_count: Number(d.keys_count),
    keys_keychain: d.keys_keychain === "yes",
    customer_requests: requests.map((r, i) => `${i + 1}. ${r}`).join("\n"),
    notes: blankToNull(d.notes),
    old_parts_return: d.old_parts_return === "yes",
    location_type: locationType,
    location_name: branch ? branch.name : locationType === "customer" ? "Customer location" : "Other location",
    location_address: branch ? branch.address : d.location_address,
    location_lat: Number.isFinite(lat) ? lat : null,
    location_lng: Number.isFinite(lng) ? lng : null,
  });
  if (giError) return { error: giError.message, values };

  await supabase.from("job_requests").insert(requests.map((text, i) => ({ job_id: job.id, position: i + 1, text })));

  // Started from a calendar appointment: mark it arrived and link the job.
  const appointmentId = blankToNull(formData.get("appointment_id"));
  if (appointmentId) {
    await createAdminClient()
      .from("appointments")
      .update({ status: "arrived", job_id: job.id, vehicle_id: vehicleId, updated_by: staff.id })
      .eq("id", appointmentId)
      .in("status", ["booked", "arrived"]);
  }

  // VIP is a customer mark; the gate-in switch sets it and the change is logged with who and when.
  const cust = vehicle.customer as unknown as { is_vip: boolean; vip_note: string | null } | null;
  const wasVip = cust?.is_vip ?? false;
  if (vipOn !== wasVip || (vipOn && vipNote && vipNote !== cust?.vip_note)) {
    await supabase.from("customers").update({ is_vip: vipOn, vip_note: vipOn ? vipNote ?? cust?.vip_note ?? null : cust?.vip_note ?? null }).eq("id", vehicle.customer_id);
    if (vipOn !== wasVip) {
      await supabase.from("job_events").insert({ job_id: job.id, event_type: "vip_change", note: `VIP switched ${vipOn ? "on" : "off"} at gate-in`, created_by: staff.id });
    }
  }

  if (estimate && estimate.status === "approved" && estimate.vehicle_id === vehicleId) {
    await supabase.from("job_events").insert({ job_id: job.id, event_type: "estimate_attached", note: `Accepted estimate ${estimate.number} attached at gate-in`, created_by: staff.id });
  }
  if (comebackJob) {
    await supabase.from("job_events").insert({ job_id: job.id, event_type: "comeback", note: `Comeback of ${comebackJob.job_number}, marked at gate-in by ${staff.display_name}. High priority.`, created_by: staff.id });
    await supabase.from("job_events").insert({ job_id: comebackJob.id, event_type: "comeback", note: `The car came back on ${job.job_number} (gate-in by ${staff.display_name})`, created_by: staff.id });
    await notifyRoles(["owner"], { type: "comeback", title: `Comeback · ${job.job_number}`, body: `The car is back for ${comebackJob.job_number}. The manager picks the cause after the inspection; you confirm it.`, jobId: job.id, href: `/jobs/${job.id}#comeback` });
  }
  await supabase.from("job_events").insert({
    job_id: job.id,
    event_type: "gate_in",
    to_status: "gate_in_pending",
    to_stage: "gate_in",
    to_staff: staff.id,
    note: `Gated in on job ${job.job_number} at ${branch ? branch.name : d.location_address}`,
    created_by: staff.id,
  });
  // The car remembers the unit for its next visit.
  await supabase.from("vehicles").update({ last_mileage: km, mileage_unit: unit }).eq("id", vehicleId);
  await notifyManagers(d.department, {
    type: "job_gated_in",
    title: `Car gated in · ${job.job_number}`,
    body: `${d.department === "both" ? "Mechanical and bodyshop" : d.department === "bodyshop" ? "Bodyshop" : "Mechanical"} · gated in by ${staff.display_name}`,
    jobId: job.id,
    href: `/jobs/${job.id}`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  revalidatePath("/vehicles");
  redirect(`/jobs/${job.id}/media`);
}

/* ---------------------------------------------------------------------------
   Quick "new customer and car" for walk-ins
   --------------------------------------------------------------------------- */

const quickSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter the customer's name."),
    phone: z.string().trim().min(7, "Enter the customer's phone number."),
    email: z.string().trim().toLowerCase(),
    trn: z.string().trim(),
    no_plate: z.string(),
    plate_country: z.string().trim(),
    plate_emirate: z.string().trim(),
    plate_code: z.string().trim().toUpperCase(),
    plate_number: z.string().trim().toUpperCase(),
    vin: z.string().trim().toUpperCase().min(1, "Enter the VIN.").regex(/^[A-HJ-NPR-Z0-9]{17}$/, "A VIN is 17 letters and digits; it never has I, O or Q."),
    make_id: z.string().trim(),
    make_text: z.string().trim(),
    model_id: z.string().trim(),
    model_text: z.string().trim(),
    variant: z.string().trim(),
    model_year: z.string().trim().regex(/^\d{4}$/, "Enter the model year (4 digits)."),
    fuel_type: z.enum(FUEL_TYPES, { message: "Choose the fuel type." }),
  })
  .superRefine((d, ctx) => {
    if (d.email && !z.email().safeParse(d.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "That email does not look right." });
    }
    if (d.trn && !/^\d{15}$/.test(d.trn)) ctx.addIssue({ code: "custom", path: ["trn"], message: "A TRN is 15 digits." });
    if (d.no_plate !== "on") {
      if (!(PLATE_COUNTRIES as readonly string[]).includes(d.plate_country)) {
        ctx.addIssue({ code: "custom", path: ["plate_country"], message: "Choose the plate country." });
      }
      if (d.plate_country === "UAE" && !(EMIRATES as readonly string[]).includes(d.plate_emirate)) {
        ctx.addIssue({ code: "custom", path: ["plate_emirate"], message: "Choose the emirate." });
      }
      if (!d.plate_number) ctx.addIssue({ code: "custom", path: ["plate_number"], message: "Enter the plate number, or tick No number plate." });
    }
    if (d.vin.length !== 17) ctx.addIssue({ code: "custom", path: ["vin"], message: "A VIN has exactly 17 characters." });
    if (!d.make_text) ctx.addIssue({ code: "custom", path: ["make_id"], message: "Choose or type the make." });
    if (!d.model_text) ctx.addIssue({ code: "custom", path: ["model_id"], message: "Choose or type the model." });
    const year = Number(d.model_year);
    if (year < 1950 || year > new Date().getFullYear() + 1) ctx.addIssue({ code: "custom", path: ["model_year"], message: "Check the model year." });
  });

export async function createCustomerAndVehicle(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateIn");
  const values = formValues(formData);
  const get = (k: string) => formData.get(k) ?? "";
  const parsed = quickSchema.safeParse({
    full_name: get("full_name"),
    phone: get("phone"),
    email: get("email"),
    trn: get("trn"),
    no_plate: get("no_plate"),
    plate_country: get("plate_country"),
    plate_emirate: get("plate_emirate"),
    plate_code: get("plate_code"),
    plate_number: get("plate_number"),
    vin: get("vin"),
    make_id: get("make_id"),
    make_text: get("make_text"),
    model_id: get("model_id"),
    model_text: get("model_text"),
    variant: get("variant"),
    model_year: get("model_year_choice") === "__other__" ? get("model_year_other") : get("model_year_choice"),
    fuel_type: get("fuel_type"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;

  const picture = formData.get("car_picture"); // optional now: the phone checklist asks for it

  const supabase = await createClient();
  const newEntries: string[] = [];

  // Make: existing by id, else by name, else create for review.
  let makeId = d.make_id !== "__new__" ? d.make_id : "";
  if (!makeId) {
    const { data: existing } = await supabase.from("vehicle_makes").select("id").ilike("name", d.make_text).maybeSingle();
    if (existing) makeId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_makes").insert({ name: d.make_text, needs_review: true }).select("id").single();
      if (error || !data) return { error: "Could not add the make.", values };
      makeId = data.id;
      newEntries.push(`make "${d.make_text}"`);
    }
  }
  // Model: existing by id (must belong to the make), else by name, else create for review.
  let modelId = d.model_id !== "__new__" ? d.model_id : "";
  if (modelId) {
    const { data: m } = await supabase.from("vehicle_models").select("id").eq("id", modelId).eq("make_id", makeId).maybeSingle();
    if (!m) modelId = "";
  }
  if (!modelId) {
    const { data: existing } = await supabase.from("vehicle_models").select("id").eq("make_id", makeId).ilike("name", d.model_text).maybeSingle();
    if (existing) modelId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_models").insert({ make_id: makeId, name: d.model_text, needs_review: true }).select("id").single();
      if (error || !data) return { error: "Could not add the model.", values };
      modelId = data.id;
      newEntries.push(`model "${d.model_text}"`);
    }
  }

  // From an appointment, the customer already exists: use that record instead of adding a second one.
  const appointmentId = blankToNull(formData.get("appointment_id"));
  let customer: { id: string } | null = null;
  if (appointmentId) {
    const { data: appt } = await supabase.from("appointments").select("customer_id").eq("id", appointmentId).maybeSingle();
    if (appt) {
      customer = { id: appt.customer_id };
      await supabase.from("customers").update({ email: blankToNull(d.email) ?? undefined, trn: blankToNull(d.trn) ?? undefined }).eq("id", appt.customer_id);
    }
  }
  const { data: newCustomer, error: cError } = customer
    ? { data: customer, error: null }
    : await supabase
    .from("customers")
    .insert({
      customer_type: d.trn ? "company" : "individual",
      full_name: d.full_name,
      company_name: d.trn ? d.full_name : null,
      phone: normalisePhone(d.phone),
      email: blankToNull(d.email),
      trn: blankToNull(d.trn),
    })
    .select("id")
    .single();
  if (cError || !newCustomer) return { error: cError?.message ?? "Could not save the customer.", values };
  customer = newCustomer;

  const noPlate = d.no_plate === "on";
  const { data: vehicle, error: vError } = await supabase
    .from("vehicles")
    .insert({
      customer_id: customer.id,
      has_plate: !noPlate,
      plate_country: noPlate ? "UAE" : d.plate_country,
      plate_emirate: !noPlate && d.plate_country === "UAE" ? d.plate_emirate : null,
      plate_code: noPlate ? null : blankToNull(d.plate_code),
      plate_number: noPlate ? null : d.plate_number.replace(/\s+/g, ""),
      vin: d.vin,
      make_id: makeId,
      model_id: modelId,
      variant: blankToNull(d.variant),
      model_year: Number(d.model_year),
      fuel_type: d.fuel_type,
    })
    .select("id")
    .single();
  if (vError || !vehicle) {
    const msg = vError?.message ?? "";
    return {
      error: msg.includes("vehicles_active_plate_idx")
        ? "A car with this plate already exists. Search for it instead."
        : msg.includes("vehicles_vin_key")
          ? "A car with this VIN already exists. Search for it instead."
          : msg || "Could not save the car.",
      values,
    };
  }

  const picError = await saveCarPicture(vehicle.id, picture);
  if (picError) return { error: picError, values };

  if (newEntries.length) {
    await notifyRoles(["owner", "workshop_manager"], {
      type: "catalog_review",
      title: "New " + newEntries.join(" and ") + " added at gate-in",
      body: `Added by ${staff.display_name}. Review it in Settings, Makes and models.`,
      href: "/settings/catalog",
    });
  }

  revalidatePath("/customers");
  revalidatePath("/vehicles");
  redirect(`/gate-in/new?vehicle=${vehicle.id}${appointmentId ? `&appointment=${appointmentId}` : ""}`);
}
