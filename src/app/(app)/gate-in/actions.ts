"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { blankToNull, normalisePhone } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
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
    keys_count: z.string().trim(),
    keys_keychain: z.enum(["yes", "no"], { message: "Did the keys come with a keychain?" }),
    customer_requests: z.string().trim().min(3, "Write the customer's requests in their own words."),
    notes: z.string().trim(),
    old_parts_return: z.enum(["yes", "no"], { message: "Does the customer want old parts returned?" }),
    priority: z.enum(["high", "normal", "low"], { message: "Choose the priority." }),
    promised_at: z.string().trim(),
    is_electric: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.is_electric === "yes") {
      if (!/^\d{1,3}$/.test(d.battery_percent) || Number(d.battery_percent) > 100) {
        ctx.addIssue({ code: "custom", path: ["battery_percent"], message: "Enter the battery percentage (0 to 100)." });
      }
    } else if (!["empty", "quarter", "half", "three_quarters", "full"].includes(d.fuel_level)) {
      ctx.addIssue({ code: "custom", path: ["fuel_level"], message: "Choose the fuel level." });
    }
    if (!/^\d{1,7}$/.test(d.mileage)) ctx.addIssue({ code: "custom", path: ["mileage"], message: "Enter the mileage in km." });
    if (!/^\d{1,2}$/.test(d.keys_count) || Number(d.keys_count) > 10) {
      ctx.addIssue({ code: "custom", path: ["keys_count"], message: "Enter how many keys were received." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.promised_at)) {
      ctx.addIssue({ code: "custom", path: ["promised_at"], message: "Choose the promised date." });
    } else if (d.promised_at < dubaiDate()) {
      ctx.addIssue({ code: "custom", path: ["promised_at"], message: "The promised date cannot be in the past." });
    }
  });

function parseGateIn(formData: FormData) {
  const get = (k: string) => formData.get(k) ?? "";
  return gateInSchema.safeParse({
    arrived_by: get("arrived_by"),
    condition: get("condition"),
    fuel_level: get("fuel_level"),
    battery_percent: get("battery_percent"),
    cleanliness: get("cleanliness"),
    dash_cam: get("dash_cam"),
    major_damage: get("major_damage"),
    mileage: get("mileage"),
    keys_count: get("keys_count"),
    keys_keychain: get("keys_keychain"),
    customer_requests: get("customer_requests"),
    notes: get("notes"),
    old_parts_return: get("old_parts_return"),
    priority: get("priority"),
    promised_at: get("promised_at"),
    is_electric: get("is_electric"),
  });
}

export async function createGateIn(vehicleId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateIn");
  const values = formValues(formData);
  const parsed = parseGateIn(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, customer_id, is_active, photo_path")
    .eq("id", vehicleId)
    .maybeSingle();
  if (!vehicle || !vehicle.is_active) return { error: "Car not found.", values };

  const picture = formData.get("car_picture");
  const hasNewPicture = picture instanceof File && picture.size > 0;
  if (!vehicle.photo_path && !hasNewPicture) return { error: "Take a picture of the car.", values };

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

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      vehicle_id: vehicleId,
      customer_id: vehicle.customer_id,
      priority: d.priority,
      promised_at: d.promised_at,
      gated_in_by: staff.id,
    })
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
    mileage: Number(d.mileage),
    keys_count: Number(d.keys_count),
    keys_keychain: d.keys_keychain === "yes",
    customer_requests: d.customer_requests,
    notes: blankToNull(d.notes),
    old_parts_return: d.old_parts_return === "yes",
  });
  if (giError) return { error: giError.message, values };

  await supabase.from("job_events").insert({
    job_id: job.id,
    event_type: "gate_in",
    to_status: "gate_in_pending",
    to_stage: "gate_in",
    to_staff: staff.id,
    note: `Gated in on job ${job.job_number}`,
    created_by: staff.id,
  });
  await supabase.from("vehicles").update({ last_mileage: Number(d.mileage) }).eq("id", vehicleId);

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
    vin: z.string().trim().toUpperCase().min(1, "Enter the VIN."),
    make_id: z.string().trim(),
    new_make: z.string().trim(),
    model_id: z.string().trim(),
    new_model: z.string().trim(),
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
    if (d.make_id === "__new__" ? d.new_make.length < 2 : !d.make_id) {
      ctx.addIssue({ code: "custom", path: ["make_id"], message: "Choose the make, or type a new one." });
    }
    if (d.model_id === "__new__" ? d.new_model.length < 1 : !d.model_id) {
      ctx.addIssue({ code: "custom", path: ["model_id"], message: "Choose the model, or type a new one." });
    }
  });

export async function createCustomerAndVehicle(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("gateIn");
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
    new_make: get("new_make"),
    model_id: get("model_id"),
    new_model: get("new_model"),
    fuel_type: get("fuel_type"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;

  const picture = formData.get("car_picture");
  if (!(picture instanceof File) || picture.size === 0) return { error: "Take a picture of the car.", values };

  const supabase = await createClient();

  let makeId = d.make_id;
  if (makeId === "__new__") {
    const { data: existing } = await supabase.from("vehicle_makes").select("id").ilike("name", d.new_make).maybeSingle();
    if (existing) makeId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_makes").insert({ name: d.new_make }).select("id").single();
      if (error || !data) return { error: "Could not add the make.", values };
      makeId = data.id;
    }
  }
  let modelId: string = d.model_id;
  if (d.model_id === "__new__") {
    const { data: existing } = await supabase.from("vehicle_models").select("id").eq("make_id", makeId).ilike("name", d.new_model).maybeSingle();
    if (existing) modelId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_models").insert({ make_id: makeId, name: d.new_model }).select("id").single();
      if (error || !data) return { error: "Could not add the model.", values };
      modelId = data.id;
    }
  }

  const { data: customer, error: cError } = await supabase
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
  if (cError || !customer) return { error: cError?.message ?? "Could not save the customer.", values };

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

  revalidatePath("/customers");
  revalidatePath("/vehicles");
  redirect(`/gate-in/new?vehicle=${vehicle.id}`);
}
