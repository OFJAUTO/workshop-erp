import "server-only";
import { SAVE_FAILED, logAppError } from "./app-errors";
import { appendOldPlates, oldPlateEntry } from "./plate-rules";
import { plateHistoryReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * MERGING TWO CAR RECORDS (6 November 2026): the same physical car saved twice (one usually without its plate).
 * Everything moves under ONE record - jobs, estimates and quotations, invoices, payments, payment reports,
 * appointments, declined work, battery warranties, QR links and photos - and the duplicate is taken off the list
 * (never deleted) with a note saying where it went. The KEPT record is the one that already carries the plate or
 * VIN; the confirmation names it before anything moves. Every step is idempotent: if one write fails midway, the
 * answer says so and pressing Merge again finishes the rest.
 */

/**
 * Every table that points at a car (checked against the database's foreign keys on 6 November 2026), with the
 * column that names its rows. A new vehicle_id column elsewhere must join this list.
 */
const FK_TABLES = [
  { table: "jobs", key: "id", words: "job" },
  { table: "quotations", key: "id", words: "estimate or quotation" },
  { table: "invoices", key: "id", words: "invoice" },
  { table: "payments", key: "id", words: "payment" },
  { table: "payment_reports", key: "id", words: "payment report" },
  { table: "appointments", key: "id", words: "booking" },
  { table: "declined_work", key: "id", words: "declined-work note" },
  { table: "battery_warranties", key: "id", words: "battery warranty" },
  { table: "charge_entries", key: "id", words: "pending charge" },
  { table: "qr_links", key: "code", words: "sticker link" },
  { table: "vehicle_photos", key: "id", words: "photo" },
] as const;

type V = {
  id: string;
  kind: string | null;
  is_active: boolean;
  customer_id: string;
  has_plate: boolean;
  plate_country: string;
  plate_emirate: string | null;
  plate_code: string | null;
  plate_number: string | null;
  vin: string | null;
  photo_path: string | null;
  model_year: number | null;
  colour: string | null;
  fuel_type: string | null;
  variant: string | null;
  last_mileage: number | null;
  mileage_unit: string | null;
  notes: string | null;
  make: { name: string } | null;
  model: { name: string } | null;
};

const V_SELECT = "id, kind, is_active, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, photo_path, model_year, colour, fuel_type, variant, last_mileage, mileage_unit, notes, make:vehicle_makes(name), model:vehicle_models(name)";

export function vehicleWords(v: Pick<V, "has_plate" | "plate_country" | "plate_emirate" | "plate_code" | "plate_number" | "vin" | "make" | "model" | "kind">): string {
  const car = [v.make?.name, v.model?.name].filter(Boolean).join(" ");
  return [formatPlate({ ...v, kind: v.kind ?? "car" }), car].filter(Boolean).join(" · ").toUpperCase();
}

async function readCar(id: string): Promise<V | null> {
  const { data } = await createAdminClient().from("vehicles").select(V_SELECT).eq("id", id).maybeSingle();
  return (data as unknown as V) ?? null;
}

/** The checks before any merge is offered or run. Null = fine. */
export function mergeRefusal(keep: V | null, gone: V | null): string | null {
  if (!keep || !gone) return "One of the two car records could not be read. Reload the page and try again.";
  if (keep.id === gone.id) return "That is the same record.";
  if (keep.kind === "loose" || gone.kind === "loose") return "A loose-items record is never merged.";
  if (!keep.is_active) return "The record to keep was taken off the list. Tell the owner.";
  if (!gone.is_active) return "This record was already merged or taken off the list.";
  if (keep.vin && gone.vin && keep.vin !== gone.vin) return `These look like two DIFFERENT cars: their VINs differ (${keep.vin} and ${gone.vin}). Check the VINs before merging anything.`;
  return null;
}

/**
 * Moves everything from `goneId` under `keepId`, then takes `goneId` off the list with a note. Returns the words of
 * what moved, or the error in plain words (a halfway failure says to press Merge again; re-running finishes it).
 */
export async function mergeVehicles(keepId: string, goneId: string, staff: { id: string; display_name: string }): Promise<{ error?: string; message?: string }> {
  const admin = createAdminClient();
  const [keep, gone] = await Promise.all([readCar(keepId), readCar(goneId)]);
  const refusal = mergeRefusal(keep, gone);
  if (refusal) return { error: refusal };
  const k = keep!;
  const g = gone!;

  // 1. Re-point every table (idempotent: a re-run moves whatever is left).
  const moved: string[] = [];
  for (const t of FK_TABLES) {
    const { data, error } = await admin.from(t.table).update({ vehicle_id: keepId }).eq("vehicle_id", goneId).select(t.key);
    if (error) {
      await logAppError("vehicle-merge", error, { detail: { table: t.table, keepId, goneId } });
      return { error: `Partly merged (${t.table.replace(/_/g, " ")} could not move). ${SAVE_FAILED} Press Merge again to finish the rest.` };
    }
    const n = (data ?? []).length;
    if (n > 0) moved.push(`${n} ${t.words}${n === 1 ? "" : "s"}`);
  }

  // 2. Facts the keeper is missing come across (the VIN must leave the duplicate first: it is unique).
  if (g.vin && !k.vin) {
    const { error: e1 } = await admin.from("vehicles").update({ vin: null, updated_by: staff.id }).eq("id", goneId);
    if (!e1) {
      const { error: e2 } = await admin.from("vehicles").update({ vin: g.vin, updated_by: staff.id }).eq("id", keepId);
      if (e2) await logAppError("vehicle-merge", e2, { detail: { step: "vin", keepId, goneId } });
      else moved.push("the VIN");
    }
  }
  const fill: Record<string, unknown> = {};
  if (!k.photo_path && g.photo_path) fill.photo_path = g.photo_path;
  if (!k.model_year && g.model_year) fill.model_year = g.model_year;
  if (!k.colour && g.colour) fill.colour = g.colour;
  if (!k.fuel_type && g.fuel_type) fill.fuel_type = g.fuel_type;
  if (!k.variant && g.variant) fill.variant = g.variant;
  if (k.last_mileage == null && g.last_mileage != null) Object.assign(fill, { last_mileage: g.last_mileage, mileage_unit: g.mileage_unit ?? "km" });
  if (g.notes) fill.notes = [k.notes, `From the merged record: ${g.notes}`].filter(Boolean).join("\n");

  // 3. The duplicate's plate and VIN stay searchable on the keeper (once the columns are applied).
  const ready = await plateHistoryReady();
  if (ready) {
    const { data: kNow } = await admin.from("vehicles").select("old_plates").eq("id", keepId).maybeSingle();
    let olds = (kNow?.old_plates as string | null) ?? null;
    const { data: gNow } = await admin.from("vehicles").select("old_plates").eq("id", goneId).maybeSingle();
    for (const part of String((gNow?.old_plates as string | null) ?? "").split(" · ").map((s) => s.trim()).filter(Boolean)) olds = appendOldPlates(olds, part);
    olds = appendOldPlates(olds, oldPlateEntry(g));
    if (g.vin && k.vin && g.vin !== k.vin) olds = appendOldPlates(olds, `VIN ${g.vin}`);
    fill.old_plates = olds;
  }
  if (Object.keys(fill).length) {
    const { error } = await admin.from("vehicles").update({ ...fill, updated_by: staff.id }).eq("id", keepId);
    if (error) await logAppError("vehicle-merge", error, { detail: { step: "fill", keepId, goneId } });
  }

  // 4. The duplicate leaves the list (never deleted), pointing home.
  const keepWords = vehicleWords(k);
  const { error: offError } = await admin
    .from("vehicles")
    .update({
      is_active: false,
      ...(ready ? { merged_into: keepId } : {}),
      notes: [g.notes, `Merged into ${keepWords} by ${staff.display_name}.`].filter(Boolean).join("\n"),
      updated_by: staff.id,
    })
    .eq("id", goneId);
  if (offError) {
    await logAppError("vehicle-merge", offError, { detail: { step: "deactivate", keepId, goneId } });
    return { error: `Everything moved, but the duplicate record could not be taken off the list. ${SAVE_FAILED} Press Merge again.` };
  }

  // 5. The record of who merged what (the audit trigger logs the rows; this entry carries the story in one place).
  await admin
    .from("audit_log")
    .insert({ table_name: "vehicles", record_id: keepId, action: "merge", new_data: { merged_from: goneId, merged_from_words: vehicleWords(g), moved, by: staff.display_name } })
    .then(({ error }) => (error ? logAppError("vehicle-merge", error, { detail: { step: "audit", keepId, goneId } }) : null));

  return { message: `Merged. ${keepWords} is kept${moved.length ? `; moved across: ${moved.join(", ")}` : ""}.` };
}
