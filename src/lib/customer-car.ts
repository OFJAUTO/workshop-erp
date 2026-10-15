import "server-only";
import { z } from "zod";
import { blankToNull, normalisePhone } from "./format";
import { notifyRoles } from "./notifications";
import { createClient } from "./supabase/server";
import { EMIRATES, PLATE_COUNTRIES, formatPlate } from "./types";

/**
 * One way to pick or create the customer and the car wherever a quotation, estimate or booking starts:
 *   existing      an existing customer and one of their cars
 *   new_car       an existing customer, a car not on record yet
 *   new_customer  a new customer and their car
 * Duplicates are caught before anything is written: a phone already on file names the customer (the advisor
 * can still create a second customer on the same phone on purpose); a VIN or plate already on file names the
 * car, which must be used, never doubled.
 */
export type ChooserMode = "existing" | "new_car" | "new_customer";

export type Duplicate = { kind: "customer" | "vehicle"; id: string; label: string; customerId: string; customerLabel: string };

export type ResolveResult = { customerId: string; vehicleId: string; created: ("customer" | "vehicle")[] } | { error: string; duplicate?: Duplicate };

const carSchema = z
  .object({
    no_plate: z.string(),
    plate_country: z.string().trim(),
    plate_emirate: z.string().trim(),
    plate_code: z.string().trim().toUpperCase(),
    plate_number: z.string().trim().toUpperCase(),
    vin: z.string().trim().toUpperCase(),
    make_id: z.string().trim(),
    make_text: z.string().trim(),
    model_id: z.string().trim(),
    model_text: z.string().trim(),
    variant: z.string().trim(),
    model_year: z.string().trim(),
    colour: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (d.no_plate !== "on") {
      if (!(PLATE_COUNTRIES as readonly string[]).includes(d.plate_country)) ctx.addIssue({ code: "custom", path: ["plate_country"], message: "Choose the plate country." });
      if (d.plate_country === "UAE" && !(EMIRATES as readonly string[]).includes(d.plate_emirate)) ctx.addIssue({ code: "custom", path: ["plate_emirate"], message: "Choose the emirate." });
      if (!d.plate_number) ctx.addIssue({ code: "custom", path: ["plate_number"], message: "Enter the plate number, or tick No number plate." });
    }
    if (d.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(d.vin)) ctx.addIssue({ code: "custom", path: ["vin"], message: "A VIN is 17 letters and digits; it never has I, O or Q. Leave it empty if you do not have it yet." });
    if (!d.make_text && !d.make_id) ctx.addIssue({ code: "custom", path: ["make_id"], message: "Choose the make, or type a new one." });
    if (!d.model_text && !d.model_id) ctx.addIssue({ code: "custom", path: ["model_id"], message: "Choose the model, or type a new one." });
    if (d.model_year && !/^\d{4}$/.test(d.model_year)) ctx.addIssue({ code: "custom", path: ["model_year"], message: "Model year is 4 digits." });
  });

const customerSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter the customer's name."),
    company_name: z.string().trim(),
    phone: z.string().trim().min(7, "Enter the customer's phone number."),
    email: z.string().trim().toLowerCase(),
    trn: z.string().trim(),
  })
  .superRefine((d, ctx) => {
    if (d.email && !z.email().safeParse(d.email).success) ctx.addIssue({ code: "custom", path: ["email"], message: "That email does not look right." });
    if (d.trn && !/^\d{15}$/.test(d.trn)) ctx.addIssue({ code: "custom", path: ["trn"], message: "A TRN is 15 digits." });
  });

type VehicleHit = { id: string; customer_id: string; kind: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null; customer: { full_name: string; company_name: string | null } | null };
const VEHICLE_HIT = "id, customer_id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name), customer:customers(full_name, company_name)";

const customerLabel = (c: { full_name: string; company_name: string | null; phone?: string | null } | null) => (c ? `${c.company_name ? `${c.company_name} · ` : ""}${c.full_name}${c.phone ? ` · ${c.phone}` : ""}` : "");
const vehicleLabel = (v: VehicleHit) => `${formatPlate(v)} · ${[v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ")}`;

/** A customer already on file with this phone number, if any. */
export async function findCustomerByPhone(phone: string): Promise<Duplicate | null> {
  const p = normalisePhone(phone);
  if (p.replace(/\D/g, "").length < 7) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).or(`phone.eq.${p},phone2.eq.${p}`).limit(1).maybeSingle();
  if (!data) return null;
  return { kind: "customer", id: data.id, label: customerLabel(data), customerId: data.id, customerLabel: customerLabel(data) };
}

/** A car already on file with this VIN or this plate, if any. */
export async function findVehicle(input: { vin?: string | null; plate?: { country: string; emirate: string | null; code: string | null; number: string } | null }): Promise<Duplicate | null> {
  const supabase = await createClient();
  let hit: VehicleHit | null = null;
  if (input.vin && input.vin.length === 17) {
    const { data } = await supabase.from("vehicles").select(VEHICLE_HIT).eq("vin", input.vin.toUpperCase()).limit(1).maybeSingle();
    hit = (data as unknown as VehicleHit | null) ?? null;
  }
  if (!hit && input.plate?.number) {
    let q = supabase.from("vehicles").select(VEHICLE_HIT).eq("is_active", true).eq("has_plate", true).eq("plate_country", input.plate.country).eq("plate_number", input.plate.number.replace(/\s+/g, "").toUpperCase());
    q = input.plate.emirate ? q.eq("plate_emirate", input.plate.emirate) : q.is("plate_emirate", null);
    q = input.plate.code ? q.eq("plate_code", input.plate.code.toUpperCase()) : q.is("plate_code", null);
    const { data } = await q.limit(1).maybeSingle();
    hit = (data as unknown as VehicleHit | null) ?? null;
  }
  if (!hit) return null;
  return { kind: "vehicle", id: hit.id, label: vehicleLabel(hit), customerId: hit.customer_id, customerLabel: customerLabel(hit.customer) };
}

async function resolveMakeModel(d: z.infer<typeof carSchema>, staffName: string): Promise<{ makeId: string; modelId: string | null; error?: string }> {
  const supabase = await createClient();
  const newEntries: string[] = [];
  let makeId = d.make_id && d.make_id !== "__new__" ? d.make_id : "";
  if (!makeId) {
    const { data: existing } = await supabase.from("vehicle_makes").select("id").ilike("name", d.make_text).maybeSingle();
    if (existing) makeId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_makes").insert({ name: d.make_text, needs_review: true }).select("id").single();
      if (error || !data) return { makeId: "", modelId: null, error: "Could not add the make." };
      makeId = data.id;
      newEntries.push(`make "${d.make_text}"`);
    }
  }
  let modelId = d.model_id && d.model_id !== "__new__" ? d.model_id : "";
  if (modelId) {
    const { data: m } = await supabase.from("vehicle_models").select("id").eq("id", modelId).eq("make_id", makeId).maybeSingle();
    if (!m) modelId = "";
  }
  if (!modelId && d.model_text) {
    const { data: existing } = await supabase.from("vehicle_models").select("id").eq("make_id", makeId).ilike("name", d.model_text).maybeSingle();
    if (existing) modelId = existing.id;
    else {
      const { data, error } = await supabase.from("vehicle_models").insert({ make_id: makeId, name: d.model_text, needs_review: true }).select("id").single();
      if (error || !data) return { makeId, modelId: null, error: "Could not add the model." };
      modelId = data.id;
      newEntries.push(`model "${d.model_text}"`);
    }
  }
  if (newEntries.length) await notifyRoles(["owner"], { type: "catalog_review", title: "New make or model to check", body: `${staffName} added ${newEntries.join(" and ")} while starting a quotation. Check the spelling under Settings > Makes and models.`, href: "/settings/catalog" });
  return { makeId, modelId: modelId || null };
}

/** Reads the chooser's fields and returns the customer and car ids, creating the records the chooser asked for. */
export async function resolveCustomerCar(formData: FormData, staff: { id: string; display_name: string }): Promise<ResolveResult> {
  const get = (k: string) => String(formData.get(k) ?? "");
  const mode = (["existing", "new_car", "new_customer"].includes(get("mode")) ? get("mode") : "existing") as ChooserMode;
  const force = get("force") === "1";
  const supabase = await createClient();
  const created: ("customer" | "vehicle")[] = [];

  let customerId = get("customer_id");
  if (mode === "existing") {
    const vehicleId = get("vehicle_id");
    if (!customerId) return { error: "Choose the customer." };
    if (!vehicleId) return { error: "Choose the car." };
    const { data: vehicle } = await supabase.from("vehicles").select("id, customer_id").eq("id", vehicleId).maybeSingle();
    if (!vehicle || vehicle.customer_id !== customerId) return { error: "That car does not belong to the chosen customer." };
    return { customerId, vehicleId, created };
  }

  // The car's details are the same for both "new car" modes; they are checked first so nothing is created in vain.
  const yearChoice = get("model_year_choice");
  const modelYear = yearChoice === "__other__" ? get("model_year_other") : yearChoice || get("model_year");
  const car = carSchema.safeParse({ no_plate: get("no_plate"), plate_country: get("plate_country") || "UAE", plate_emirate: get("plate_emirate"), plate_code: get("plate_code"), plate_number: get("plate_number"), vin: get("vin"), make_id: get("make_id"), make_text: get("make_text"), model_id: get("model_id"), model_text: get("model_text"), variant: get("variant"), model_year: modelYear, colour: get("colour") });
  if (!car.success) return { error: car.error.issues[0]?.message ?? "Check the car's details." };
  const d = car.data;
  const noPlate = d.no_plate === "on";
  const dupCar = await findVehicle({ vin: d.vin || null, plate: noPlate ? null : { country: d.plate_country, emirate: d.plate_country === "UAE" ? d.plate_emirate : null, code: blankToNull(d.plate_code), number: d.plate_number } });
  if (dupCar) return { error: `${dupCar.label} is already on record under ${dupCar.customerLabel}. Use that car instead of adding it twice.`, duplicate: dupCar };

  if (mode === "new_customer") {
    const cust = customerSchema.safeParse({ full_name: get("full_name"), company_name: get("company_name"), phone: get("phone"), email: get("email"), trn: get("trn") });
    if (!cust.success) return { error: cust.error.issues[0]?.message ?? "Check the customer's details." };
    const c = cust.data;
    if (!force) {
      const dup = await findCustomerByPhone(c.phone);
      if (dup) return { error: `This phone number belongs to ${dup.label}. Use that customer, or create a second customer on the same number on purpose.`, duplicate: dup };
    }
    const { data: newCustomer, error } = await supabase
      .from("customers")
      .insert({ customer_type: c.company_name ? "company" : "individual", full_name: c.full_name, company_name: blankToNull(c.company_name), phone: normalisePhone(c.phone), email: blankToNull(c.email), trn: blankToNull(c.trn) })
      .select("id")
      .single();
    if (error || !newCustomer) return { error: error?.message ?? "Could not save the customer." };
    customerId = newCustomer.id;
    created.push("customer");
  } else {
    if (!customerId) return { error: "Choose the customer." };
    const { data: c } = await supabase.from("customers").select("id").eq("id", customerId).maybeSingle();
    if (!c) return { error: "Customer not found." };
  }

  const mm = await resolveMakeModel(d, staff.display_name);
  if (mm.error) return { error: mm.error };
  const { data: vehicle, error: vError } = await supabase
    .from("vehicles")
    .insert({
      customer_id: customerId,
      has_plate: !noPlate,
      plate_country: noPlate ? "UAE" : d.plate_country,
      plate_emirate: !noPlate && d.plate_country === "UAE" ? d.plate_emirate : null,
      plate_code: noPlate ? null : blankToNull(d.plate_code),
      plate_number: noPlate ? null : d.plate_number.replace(/\s+/g, ""),
      vin: blankToNull(d.vin),
      make_id: mm.makeId,
      model_id: mm.modelId,
      variant: blankToNull(d.variant),
      model_year: d.model_year ? Number(d.model_year) : null,
      colour: blankToNull(d.colour),
    })
    .select("id")
    .single();
  if (vError || !vehicle) {
    const msg = vError?.message ?? "";
    return { error: msg.includes("vehicles_active_plate_idx") ? "A car with this plate already exists. Use it instead." : msg.includes("vehicles_vin_key") ? "A car with this VIN already exists. Use it instead." : msg || "Could not save the car." };
  }
  created.push("vehicle");
  return { customerId, vehicleId: vehicle.id, created };
}

/** The values the chooser keeps after a refused submit, with the duplicate it should offer. */
export function chooserValues(values: Record<string, string>, r: { error: string; duplicate?: Duplicate }): Record<string, string> {
  if (!r.duplicate) return values;
  return { ...values, duplicate_kind: r.duplicate.kind, duplicate_id: r.duplicate.id, duplicate_label: r.duplicate.label, duplicate_customer_id: r.duplicate.customerId, duplicate_customer_label: r.duplicate.customerLabel };
}
