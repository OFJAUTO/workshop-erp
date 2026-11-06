"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { SAVE_FAILED, logAppError, dbDetail } from "@/lib/app-errors";
import { appendOldPlates, checkPlateInput, friendlyVehicleError, oldPlateEntry, plateChanged, plateFieldsOf } from "@/lib/plate-rules";
import { plateHistoryReady } from "@/lib/schema-ready";
import { mergeVehicles, vehicleWords } from "@/lib/vehicle-merge";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FUEL_TYPES } from "@/lib/types";

const vehicleSchema = z
  .object({
    customer_id: z.uuid({ message: "Choose the customer." }),
    no_plate: z.string(),
    plate_country: z.string().trim(),
    plate_emirate: z.string().trim(),
    plate_code: z.string().trim().toUpperCase(),
    plate_number: z.string().trim().toUpperCase(),
    plate_remark: z.string().trim(),
    vin: z.string().trim().toUpperCase().refine((v) => v === "" || /^[A-HJ-NPR-Z0-9]{17}$/.test(v), "A VIN is 17 letters and digits; it never has I, O or Q."),
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
    // THE plate check (plate-rules.ts): formats for every emirate, number codes, other countries and export plates.
    const plateProblem = checkPlateInput({ noPlate: d.no_plate === "on", country: d.plate_country, emirate: d.plate_emirate, code: d.plate_code, number: d.plate_number });
    if (plateProblem) ctx.addIssue({ code: "custom", path: ["plate_number"], message: plateProblem });
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
    no_plate: get("no_plate"),
    plate_country: get("plate_country"),
    plate_emirate: get("plate_emirate"),
    plate_code: get("plate_code"),
    plate_number: get("plate_number"),
    plate_remark: get("plate_remark"),
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
      if (error || !data) return { make_id: "", model_id: null, error: "Could not add the make: " + (error ? dbDetail(error, "vehicles/actions") : "") };
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
      if (error || !data) return { make_id: makeId, model_id: null, error: "Could not add the model: " + (error ? dbDetail(error, "vehicles/actions") : "") };
      modelId = data.id;
    }
  }
  return { make_id: makeId, model_id: modelId };
}

/** The stored row - with `has_plate`, whose absence was the whole cause of the raw error (6 November 2026). */
function toRow(d: Parsed, make_id: string, model_id: string | null) {
  const plate = plateFieldsOf({ noPlate: d.no_plate === "on", country: d.plate_country || "UAE", emirate: d.plate_emirate, code: d.plate_code, number: d.plate_number });
  return {
    customer_id: d.customer_id,
    ...plate,
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

/** A database refusal in plain words; anything unknown is logged for the owner and shown as the shared SAVE_FAILED. */
async function plainDbError(message: string, where: string, extra: Record<string, unknown>): Promise<string> {
  const friendly = friendlyVehicleError(message);
  if (friendly) return friendly;
  await logAppError(where, { message }, { detail: extra });
  return SAVE_FAILED;
}

type Twin = { id: string; words: string; kind: "plate" | "vin"; active: boolean };
type TwinRow = { id: string; kind: string | null; is_active: boolean; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null };

/**
 * Another car record already carrying this plate or VIN. An ACTIVE twin is offered as a merge on the form; an
 * inactive one (an old merged record still holding the unique VIN) is named in plain words instead.
 */
async function plateOrVinTwin(row: ReturnType<typeof toRow>, exceptId: string | null): Promise<Twin | null> {
  const admin = createAdminClient();
  const W = "id, kind, is_active, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)";
  if (row.has_plate && row.plate_number) {
    let q = admin.from("vehicles").select(W).eq("is_active", true).eq("has_plate", true).eq("plate_country", row.plate_country).eq("plate_number", row.plate_number).limit(5);
    if (exceptId) q = q.neq("id", exceptId);
    const { data } = await q;
    const hit = ((data ?? []) as unknown as TwinRow[]).find((x) => (x.plate_emirate ?? "") === (row.plate_emirate ?? "") && (x.plate_code ?? "") === (row.plate_code ?? ""));
    if (hit) return { id: hit.id, words: vehicleWords(hit), kind: "plate", active: true };
  }
  if (row.vin) {
    let q = admin.from("vehicles").select(W).eq("vin", row.vin).limit(1);
    if (exceptId) q = q.neq("id", exceptId);
    const { data } = await q;
    const hit = ((data ?? []) as unknown as TwinRow[])[0];
    if (hit) return { id: hit.id, words: vehicleWords(hit), kind: "vin", active: hit.is_active };
  }
  return null;
}

export async function createVehicle(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editVehicles");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const mm = await resolveMakeModel(parsed.data);
  if (mm.error) return { error: mm.error, values };
  const row = toRow(parsed.data, mm.make_id, mm.model_id);

  // A new car cannot be a second record of an existing one: name the car that already has the plate or VIN.
  const twin = await plateOrVinTwin(row, null);
  if (twin) return { error: `This ${twin.kind === "plate" ? "plate" : "VIN"} is already on ${twin.words}${twin.active ? " - open that car instead of making a second record" : " - an old record taken off the list still holds it; tell the owner"}.`, values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicles").insert(row).select("id").single();
  if (error || !data) return { error: await plainDbError(error?.message ?? "Could not save.", "vehicle-create", { customer: parsed.data.customer_id }), values };

  revalidatePath("/vehicles");
  revalidatePath(`/customers/${parsed.data.customer_id}`);
  redirect(`/vehicles/${data.id}`);
}

export async function updateVehicle(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("editVehicles");
  const values = formValues(formData);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };

  const mm = await resolveMakeModel(parsed.data);
  if (mm.error) return { error: mm.error, values };
  const row = toRow(parsed.data, mm.make_id, mm.model_id);

  const admin = createAdminClient();
  const { data: beforeRaw } = await admin.from("vehicles").select("id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin").eq("id", id).maybeSingle();
  if (!beforeRaw) return { error: "This car could not be read. Reload the page.", values };
  const before = beforeRaw as { id: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null };

  // A plate TRANSFER (the car already had one and it changes): who and why are kept, so the remark is compulsory.
  const changed = plateChanged(before, row);
  if (changed && parsed.data.plate_remark.length < 3) {
    return { error: "This car already has a plate. Write why it is changing (a few words) - it is kept in the history.", values };
  }

  // Another record already carries this plate or VIN: offer the merge instead of the raw duplicate error.
  const twin = await plateOrVinTwin(row, id);
  if (twin) {
    if (!twin.active) return { error: `This VIN is on an old record that was taken off the list (${twin.words}). Tell the owner.`, values };
    return {
      error: `This ${twin.kind === "plate" ? "plate" : "VIN"} is on ${twin.words}.`,
      values: { ...values, dup_vehicle_id: twin.id, dup_vehicle_words: twin.words, dup_kind: twin.kind },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update(row).eq("id", id);
  if (error) return { error: await plainDbError(error.message, "vehicle-update", { id }), values };

  let message = "Saved.";
  if (changed) {
    const oldWords = oldPlateEntry(before)?.split(" ").slice(0, -1).join(" ") ?? "no plate";
    // The old plate stays searchable and finds this same car (once the history column is applied).
    if (await plateHistoryReady()) {
      const { data: cur } = await admin.from("vehicles").select("old_plates").eq("id", id).maybeSingle();
      await admin.from("vehicles").update({ old_plates: appendOldPlates((cur?.old_plates as string | null) ?? null, oldPlateEntry(before)), updated_by: staff.id }).eq("id", id);
    }
    await admin
      .from("audit_log")
      .insert({ table_name: "vehicles", record_id: id, action: "update", changed_by: staff.id, new_data: { plate_changed_from: oldWords, plate_changed_to: row.has_plate ? [row.plate_emirate ?? row.plate_country, row.plate_code, row.plate_number].filter(Boolean).join(" ") : "no plate", remark: parsed.data.plate_remark, by: staff.display_name } })
      .then(({ error: e }) => (e ? logAppError("vehicle-update", e, { detail: { id, step: "audit" } }) : null));
    message = `Saved. Plate changed from ${oldWords}. The old plate still finds this car.`;
  } else if (!before.has_plate && row.has_plate) {
    await admin
      .from("audit_log")
      .insert({ table_name: "vehicles", record_id: id, action: "update", changed_by: staff.id, new_data: { plate_added: [row.plate_emirate ?? row.plate_country, row.plate_code, row.plate_number].filter(Boolean).join(" "), by: staff.display_name } })
      .then(({ error: e }) => (e ? logAppError("vehicle-update", e, { detail: { id, step: "audit" } }) : null));
    message = "Saved. The plate is on the car now - every page and document still to be issued shows it.";
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  redirect(`/vehicles/${id}?message=` + encodeURIComponent(message));
}

/**
 * "This plate is on car X. Merge?" - everything from THIS record moves under X (the car that already carries the
 * plate or VIN), and this record leaves the list with a note. Owner and advisors only; confirmed on the form first.
 */
export async function mergeVehicleAction(keepId: string, goneId: string) {
  const staff = await requirePermission("editVehicles");
  const out = await mergeVehicles(keepId, goneId, { id: staff.id, display_name: staff.display_name });
  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${keepId}`);
  if (out.error) redirect(`/vehicles/${goneId}/edit?error=` + encodeURIComponent(out.error));
  redirect(`/vehicles/${keepId}?message=` + encodeURIComponent(out.message ?? "Merged."));
}

export async function setVehicleActive(id: string, active: boolean) {
  await requirePermission("editVehicles");
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update({ is_active: active }).eq("id", id);
  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  if (error) redirect(`/vehicles/${id}?error=` + encodeURIComponent(await plainDbError(error.message, "vehicle-active", { id })));
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
  if (upError) return { error: "Upload failed: " + dbDetail(upError, "vehicles/actions") };

  const { error } = await supabase
    .from("vehicle_photos")
    .insert({ vehicle_id: id, storage_path: path, caption, uploaded_by: staff.id });
  if (error) return { error: await plainDbError(error.message, "vehicle-photo", { id }) };

  revalidatePath(`/vehicles/${id}`);
  return { success: "Photo added." };
}

/** Sets the car's profile picture (wide, cropped on the client). The old file stays in storage. */
export async function setVehicleProfilePhoto(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("editVehicles");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a picture first." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: "Use a JPG, PNG or WebP picture." };
  if (file.size > 10 * 1024 * 1024) return { error: "The picture must be under 10 MB." };

  const path = `${id}/profile-${Date.now()}-${randomBytes(4).toString("hex")}.jpg`;
  const supabase = await createClient();
  const { error: upError } = await supabase.storage
    .from("vehicle-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upError) return { error: "Upload failed: " + dbDetail(upError, "vehicles/actions") };

  const { error } = await supabase.from("vehicles").update({ photo_path: path }).eq("id", id);
  if (error) return { error: await plainDbError(error.message, "vehicle-photo", { id }) };

  revalidatePath(`/vehicles/${id}`);
  revalidatePath("/vehicles");
  return { success: "Picture saved." };
}
