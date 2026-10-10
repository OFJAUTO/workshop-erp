import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The gate-in check after a clear-out: one customer, one car and one job card made the way the gate-in
 * screen makes them, so the numbering can be read back (C-00001, J-00001). Never in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const admin = createAdminClient();
  const [{ data: owner }, { data: make }] = await Promise.all([
    admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true).limit(1).maybeSingle(),
    admin.from("vehicle_makes").select("id").eq("is_active", true).order("name").limit(1).maybeSingle(),
  ]);
  if (!owner || !make) return NextResponse.json({ error: "Need an owner and a make." }, { status: 400 });
  const { data: customer, error: ce } = await admin.from("customers").insert({ customer_type: "individual", full_name: "Check Customer", phone: "+971500000001", created_by: owner.id, updated_by: owner.id }).select("id, customer_number").single();
  if (ce || !customer) return NextResponse.json({ error: ce?.message ?? "customer" }, { status: 500 });
  const { data: vehicle, error: ve } = await admin.from("vehicles").insert({ customer_id: customer.id, plate_country: "UAE", plate_emirate: "Dubai", plate_code: "C", plate_number: "1", has_plate: true, make_id: make.id, created_by: owner.id, updated_by: owner.id }).select("id").single();
  if (ve || !vehicle) return NextResponse.json({ error: ve?.message ?? "vehicle" }, { status: 500 });
  const { data: job, error: je } = await admin.from("jobs").insert({ vehicle_id: vehicle.id, customer_id: customer.id, priority: "normal", department: "mechanical", gated_in_by: owner.id, created_by: owner.id, updated_by: owner.id }).select("id, job_number").single();
  if (je || !job) return NextResponse.json({ error: je?.message ?? "job" }, { status: 500 });
  const { error: ge } = await admin.from("gate_ins").insert({ job_id: job.id, arrived_by: "customer_drove", condition: "runs_drives", fuel_level: "half", cleanliness: "clean", mileage: 1000, keys_count: 1, customer_requests: "1. Check", location_type: "branch", location_name: "Main", created_by: owner.id, updated_by: owner.id });
  if (ge) return NextResponse.json({ error: ge.message }, { status: 500 });
  await admin.from("job_requests").insert({ job_id: job.id, position: 1, text: "Check" });
  return NextResponse.json({ customer_number: customer.customer_number, job_number: job.job_number, job_id: job.id });
}
