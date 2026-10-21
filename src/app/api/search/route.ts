import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The top search: any car, open or gone, by plate, customer, VIN or job number. Eight best hits, open cars first. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 403 });
  const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const admin = createAdminClient();
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const compact = `%${q.replace(/[^\p{L}\p{N}]/gu, "")}%`;
  const [{ data: vehicles }, { data: customers }, { data: byNumber }] = await Promise.all([
    admin.from("vehicles").select("id").or(`plate_number.ilike.${compact},vin.ilike.${like}`).limit(25),
    admin.from("customers").select("id").or(`full_name.ilike.${like},company_name.ilike.${like},phone.ilike.${compact}`).limit(25),
    admin.from("jobs").select("id").ilike("job_number", like).limit(10),
  ]);
  const vehicleIds = (vehicles ?? []).map((v) => v.id);
  const customerIds = (customers ?? []).map((c) => c.id);
  const jobIds = (byNumber ?? []).map((j) => j.id);
  const ors: string[] = [];
  if (jobIds.length) ors.push(`id.in.(${jobIds.join(",")})`);
  if (vehicleIds.length) ors.push(`vehicle_id.in.(${vehicleIds.join(",")})`);
  if (customerIds.length) ors.push(`customer_id.in.(${customerIds.join(",")})`);
  if (!ors.length) return NextResponse.json({ hits: [] });
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, job_number, status, is_open, customer_id, gated_in_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, photo_path, model_year, make:vehicle_makes(name), model:vehicle_models(name))")
    .or(ors.join(","))
    .order("is_open", { ascending: false })
    .order("gated_in_at", { ascending: false })
    .limit(8);
  const rows = (jobs ?? []) as unknown as { id: string; job_number: string; status: string; is_open: boolean; customer_id: string; vehicle: (Parameters<typeof formatPlate>[0] & { photo_path: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null }[];
  const seesCustomers = can(staff.role_id as RoleId, "viewCustomers");
  const { data: names } = seesCustomers && rows.length ? await admin.from("customers").select("id, full_name, company_name").eq("is_active", true).in("id", rows.map((r) => r.customer_id)) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.company_name ?? n.full_name]));
  const pictures = await signCarPictures(rows.map((r) => r.vehicle?.photo_path));
  const hits = rows.map((r) => ({
    href: `/jobs/${r.id}`,
    plate: r.vehicle ? formatPlate(r.vehicle) : r.job_number,
    title: [r.vehicle?.make?.name, r.vehicle?.model?.name, r.vehicle?.model_year].filter(Boolean).join(" "),
    customer: seesCustomers ? (nameOf.get(r.customer_id) ?? null) : null,
    stage: r.is_open ? (STATUS_LABELS[r.status as JobStatus] ?? r.status) : "Gone",
    pictureUrl: r.vehicle?.photo_path ? (pictures.get(r.vehicle.photo_path) ?? null) : null,
    open: r.is_open,
  }));
  return NextResponse.json({ hits });
}
