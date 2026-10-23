import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VehicleRow } from "@/lib/types";

/**
 * The gate-in search (23 October 2026): one box that finds a car by plate or VIN and a customer by name or mobile.
 * It runs on the server with a narrow select, so the gate-in role only ever receives what gate-in needs: the
 * customer's name and mobile and that customer's cars (no customer page, no history, no money).
 */

export type GateInCar = Pick<VehicleRow, "id" | "has_plate" | "plate_country" | "plate_emirate" | "plate_code" | "plate_number" | "vin" | "variant" | "model_year" | "colour"> & {
  kind: "car";
  make: string | null;
  model: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  isVip: boolean;
  openJob: { id: string; job_number: string } | null;
};

export type GateInCustomer = { id: string; name: string; phone: string; isVip: boolean; cars: GateInCar[] };

/** The part of a mobile number that identifies it however it was typed: the last nine digits ("050 123 4567" = "+971501234567"). */
export function phoneKey(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

const CAR_SELECT = "id, kind, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, colour, make:vehicle_makes(name), model:vehicle_models(name)";
const CUSTOMER_SELECT = "id, full_name, company_name, phone, is_vip";
type CarRow = Omit<GateInCar, "kind" | "make" | "model" | "customerId" | "customerName" | "customerPhone" | "isVip" | "openJob"> & { kind: string; customer_id: string; make: { name: string } | null; model: { name: string } | null };
type CustomerRow = { id: string; full_name: string; company_name: string | null; phone: string; is_vip: boolean };

const likeOf = (s: string) => `%${s.replace(/[%_\\]/g, "")}%`;
const nameOf = (c: CustomerRow) => c.company_name || c.full_name;

/** Customers whose mobile (or second number) is this number, newest first. Name and number only. */
export async function customersByPhone(phone: string): Promise<{ id: string; name: string; phone: string }[]> {
  const key = phoneKey(phone);
  if (!key) return [];
  const admin = createAdminClient();
  const [a, b] = await Promise.all([
    admin.from("customers").select(CUSTOMER_SELECT + ", created_at").eq("is_active", true).ilike("phone", likeOf(key)).order("created_at", { ascending: false }).limit(5),
    admin.from("customers").select(CUSTOMER_SELECT + ", created_at").eq("is_active", true).ilike("phone2", likeOf(key)).order("created_at", { ascending: false }).limit(5),
  ]);
  const seen = new Map<string, CustomerRow>();
  for (const c of [...((a.data ?? []) as unknown as CustomerRow[]), ...((b.data ?? []) as unknown as CustomerRow[])]) seen.set(c.id, c);
  return [...seen.values()].map((c) => ({ id: c.id, name: nameOf(c), phone: c.phone }));
}

/** One customer with their cars, for "+ New car for this customer". */
export async function gateInCustomer(id: string): Promise<GateInCustomer | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("customers").select(CUSTOMER_SELECT).eq("id", id).eq("is_active", true).maybeSingle();
  if (!data) return null;
  const c = data as unknown as CustomerRow;
  const cars = await carsOf([c]);
  return { id: c.id, name: nameOf(c), phone: c.phone, isVip: c.is_vip, cars: cars.get(c.id) ?? [] };
}

async function withOpenJobs(rows: CarRow[], owners: Map<string, CustomerRow>): Promise<GateInCar[]> {
  if (!rows.length) return [];
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("jobs").select("id, job_number, vehicle_id").eq("is_open", true).in("vehicle_id", rows.map((r) => r.id));
  const open = new Map((jobs ?? []).map((j) => [j.vehicle_id as string, { id: j.id as string, job_number: j.job_number as string }]));
  return rows.map((r) => {
    const owner = owners.get(r.customer_id);
    return {
      id: r.id, kind: "car" as const, has_plate: r.has_plate, plate_country: r.plate_country, plate_emirate: r.plate_emirate, plate_code: r.plate_code, plate_number: r.plate_number,
      vin: r.vin, variant: r.variant, model_year: r.model_year, colour: r.colour, make: r.make?.name ?? null, model: r.model?.name ?? null,
      customerId: r.customer_id, customerName: owner ? nameOf(owner) : "", customerPhone: owner?.phone ?? "", isVip: !!owner?.is_vip, openJob: open.get(r.id) ?? null,
    };
  });
}

async function carsOf(customers: CustomerRow[]): Promise<Map<string, GateInCar[]>> {
  const out = new Map<string, GateInCar[]>();
  if (!customers.length) return out;
  const admin = createAdminClient();
  const { data } = await admin.from("vehicles").select(CAR_SELECT).eq("is_active", true).eq("kind", "car").in("customer_id", customers.map((c) => c.id)).order("created_at", { ascending: false });
  const cars = await withOpenJobs((data ?? []) as unknown as CarRow[], new Map(customers.map((c) => [c.id, c])));
  for (const car of cars) out.set(car.customerId, [...(out.get(car.customerId) ?? []), car]);
  return out;
}

/** Cars by plate or VIN, and customers by name or mobile with their cars. */
export async function gateInSearch(raw: string): Promise<{ cars: GateInCar[]; customers: GateInCustomer[] }> {
  const term = raw.trim();
  if (!term) return { cars: [], customers: [] };
  const admin = createAdminClient();
  const compact = term.replace(/\s+/g, "");
  const letters = term.replace(/[^\p{L}]/gu, "").length;

  // Cars by plate or VIN (the plate is stored without spaces).
  const [byPlate, byVin] = await Promise.all([
    admin.from("vehicles").select(CAR_SELECT).eq("is_active", true).eq("kind", "car").ilike("plate_number", likeOf(compact)).limit(20),
    compact.length >= 4 ? admin.from("vehicles").select(CAR_SELECT).eq("is_active", true).eq("kind", "car").ilike("vin", likeOf(compact)).limit(20) : Promise.resolve({ data: [] }),
  ]);
  const carRows = new Map<string, CarRow>();
  for (const r of [...((byPlate.data ?? []) as unknown as CarRow[]), ...((byVin.data ?? []) as unknown as CarRow[])]) carRows.set(r.id, r);

  // Customers by name (two letters or more) or by mobile (seven digits or more).
  const key = phoneKey(term);
  const queries = [];
  if (letters >= 2) {
    queries.push(admin.from("customers").select(CUSTOMER_SELECT).eq("is_active", true).ilike("full_name", likeOf(term)).limit(10));
    queries.push(admin.from("customers").select(CUSTOMER_SELECT).eq("is_active", true).ilike("company_name", likeOf(term)).limit(10));
  }
  if (key && letters === 0) {
    queries.push(admin.from("customers").select(CUSTOMER_SELECT).eq("is_active", true).ilike("phone", likeOf(key)).limit(10));
    queries.push(admin.from("customers").select(CUSTOMER_SELECT).eq("is_active", true).ilike("phone2", likeOf(key)).limit(10));
  }
  const found = new Map<string, CustomerRow>();
  for (const q of await Promise.all(queries)) for (const c of (q.data ?? []) as unknown as CustomerRow[]) found.set(c.id, c);
  const customerList = [...found.values()].slice(0, 10);

  // The owners of the cars found, for their name and mobile on the car card.
  const ownerIds = [...new Set([...carRows.values()].map((r) => r.customer_id))].filter((id) => !found.has(id));
  const owners = new Map(customerList.map((c) => [c.id, c]));
  if (ownerIds.length) {
    const { data } = await admin.from("customers").select(CUSTOMER_SELECT).in("id", ownerIds);
    for (const c of (data ?? []) as unknown as CustomerRow[]) owners.set(c.id, c);
  }
  const [cars, carsByCustomer] = await Promise.all([withOpenJobs([...carRows.values()], owners), carsOf(customerList)]);
  return {
    cars,
    customers: customerList.map((c) => ({ id: c.id, name: nameOf(c), phone: c.phone, isVip: c.is_vip, cars: carsByCustomer.get(c.id) ?? [] })),
  };
}
