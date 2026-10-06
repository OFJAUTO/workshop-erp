"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES } from "@/lib/types";

const vehicleSchema = z
  .object({
    customer_id: z.uuid({ message: "Choose the customer." }),
    plate_country: z.enum(PLATE_COUNTRIES, { message: "Choose the plate country." }),
    plate_emirate: z.string().trim(),
    plate_code: z.string().trim().toUpperCase(),
    plate_number: z.string().trim().toUpperCase().min(1, "Enter the plate number."),
    vin: z.string().trim().toUpperCase(),
    make_id: z.string().trim(),
    new_make: z.string().trim(),
    model_id: z.string().trim(),
    new_model: z.string().trim(),
    variant: z.string().trim(),
    model_year: z.string().trim(),
    colour: z.string().trim(),
    fuel_type: z.string().trim(),
    last_mileage: z.string().trim(),
    notes: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (d.plate_country === "UAE" && !(EMIRATES as readonly string[]).includes(d.plate_emirate)) {
      ctx.addIssue({ code: "custom", path: ["plate_emirate"], message: "Choose the emirate." });
    }
    if (d.vin && d.vin.length !== 17) {
      ctx.addIssue({ code: "custom", path: ["vin"], message: "A VIN has exactly 17 characters." });
    }
    if (d.make_id === "__new__" ? d.new_make.length < 2 : !d.make_id) {
      ctx.addIssue({ code: "custom", path: ["make_id"], message: "Choose the make, or type a new one." });
    }
    if (d.model_id === "__new__" && d.new_model.length < 1) {
      ctx.addIssue({ code: "custom", path: ["model_id"], message: "Type the new model name." });
    }
    if (d.model_year && !/^\d{4}$/.test(d.model_year)) {
      ctx.addIssue({ code: "custom", path: ["model_year"], message: "Model year is 4 digits." });
    }
    if (d.last_mileage && !/^\d+$/.test(d.last_mileage)) {
      ctx.addIssue({ code: "custom", path: ["last_mileage"], message: "Mileage is a whole number." });
    }
    if (d.fuel_type && !(FUEL_TYPES as readonly string[]).includes(d.fuel_type)) {
      ctx.addIssue({ code: "custom", path: ["fuel_type"], message: "Choose the fuel type." });
    }
  });

function parse(formData: FormData) {
  const get = (k: string) => formData.get(k) ?? "";
  return vehicleSchema.safeParse({
    customer_id: get("customer_id"),
    plate_country: get("plate_country"),
    plate_emirate: get("plate_emirate"),
    plate_code: get("plate_code"),
    plate_number: get("plate_number"),
    vin: get("vin"),
    make_id: get("make_id"),
    new_make: get("new_make"),
    model_id: get("model_id"),
    new_model: get("new_model"),
    variant: get("variant"),
    model_year: get("model_year"),
    colour: get("colour"),
    fuel_type: get("fuel_type"),
    last_mileage: get("last_mileage"),
    notes: get("notes"),
  });
}

type Parsed = z.infer<typeof vehicleSchema>;

/** Resolves make and model ids, creating new list entries when the user typed one. */
async function resolveMakeModel(d: Parsed): Promise<{ make_id: string; model_id: string | null; error?: string }> {
  const supabase = await createClient();
  let makeId = d.make_id;
  if (makeId === "__new__") {
    const { data: existing } = await supabase.from("vehicle_makes").select("id").ilike("name", d.new_make).maybeSingle();
    if (existing) makeId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_makes").insert({ name: d.new_make }).select("id").single();
      if (error || !data) return { make_id: "", model_id: null, error: "Could not add the make: " + (error?.message ?? "") };
      makeId = data.id;
    }
  }
  let modelId: string | null = d.model_id || null;
  if (d.model_id === "__new__") {
    const { data: existing } = await supabase
      .from("vehicle_models")
      .select("id")
      .eq("make_id", makeId)
      .ilike("name", d.new_model)
      .maybeSingle();
    if (existing) modelId = existing.id;
    else {
      const { data, error } = await supabase
        .from("vehicle_models")
        .insert({ make_id: makeId, name: d.new_model })
        .select("id")
        .single();
      if (error || !data) return { make_id: makeId, model_id: null, error: "Could not add the model: " + (error?.message ?? "") };
      modelId = data.id;
    }
  }
  return { make_id: makeId, model_id: modelId };
}

function toRow(d: Parsed, make_id: string, model_id: string | null) {
  return {
    customer_id: d.customer_id,
    plate_country: d.plate_country,
    plate_emirate: d.plate_country === "UAE" ? d.plate_emirate : null,
    plate_code: blankToNull(d.plate_code),
    plate_number: d.plate_number.replace(/\s+/g, ""),
    vin: blankToNull(d.vin),
    make_id,
    model_id,
    variant: blankToNull(d.variant),
    model_year: d.model_year ? Number(d.model_year) : null,
    colour: blankToNull(d.colour),
    fuel_type: blankToNull(d.fuel_type),
    last_mileage: d.last_mileage ? Number(d.last_mileage) : null,
    notes: blankToNull(d.notes),
  };
}

function friendly(message: string) {
  if (message.includes("vehicles_active_plate_idx")) return "A car with this plate already exists.";
  if (message.includes("vehicles_vin_key")) return "A car with this VIN already exists.";
  return message;
}

export async function createVehicle(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editVehicles");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const mm = await resolveMakeModel(parsed.data);
  if (mm.error) return { error: mm.error, values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert(toRow(parsed.data, mm.make_id, mm.model_id))
    .select("id")
    .single();
  if (error || !data) return { error: friendly(error?.message ?? "Could not save."), values };

  revalidatePath("/vehicles");
  revalidatePath(`/customers/${parsed.data.customer_id}`);
  redirect(`/vehicles/${data.id}`);
}

export async function updateVehicle(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editVehicles");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const mm = await resolveMakeModel(parsed.data);
  if (mm.error) return { error: mm.error, values };

  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update(toRow(parsed.data, mm.make_id, mm.model_id)).eq("id", id);
  if (error) return { error: friendly(error.message), values };

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  redirect(`/vehicles/${id}?message=` + encodeURIComponent("Saved."));
}

export async function setVehicleActive(id: string, active: boolean) {
  await requirePermission("editVehicles");
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update({ is_active: active }).eq("id", id);
  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  if (error) redirect(`/vehicles/${id}?error=` + encodeURIComponent(friendly(error.message)));
  redirect(`/vehicles/${id}?message=` + encodeURIComponent(active ? "Car re-activated." : "Car marked inactive."));
}

export async function addVehiclePhoto(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("editVehicles");
  const file = formData.get("photo");
  const caption = blankToNull(formData.get("caption"));
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: "Use a JPG, PNG or WebP photo." };
  if (file.size > 10 * 1024 * 1024) return { error: "The photo must be under 10 MB." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${id}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const supabase = await createClient();
  const { error: upError } = await supabase.storage
    .from("vehicle-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upError) return { error: "Upload failed: " + upError.message };

  const { error } = await supabase
    .from("vehicle_photos")
    .insert({ vehicle_id: id, storage_path: path, caption, uploaded_by: staff.id });
  if (error) return { error: error.message };

  revalidatePath(`/vehicles/${id}`);
  return { success: "Photo added." };
}
