import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { seesCustomers } from "@/lib/customer-data";
import { arrivedWords, customerName } from "@/lib/customer-view";
import { jobBalance } from "@/lib/invoice-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

const DUBAI_OFFSET_MS = 4 * 3600 * 1000;
const vehicleSelect = "id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)";
type Vehicle = Parameters<typeof formatPlate>[0] & { id: string; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
const carWords = (v: Vehicle | null) => (v ? [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ").toUpperCase() : "");

/**
 * THE owner details panel's data (29 October 2026, batch 2 section 1): `?job=<id>` (the job's customer) or
 * `?customer=<id>`. Only the owner, advisors and accounts get an answer; everyone else gets 403 and nothing else.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 403 });
  const role = staff.role_id;
  if (!seesCustomers(role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const admin = createAdminClient();
  const jobId = request.nextUrl.searchParams.get("job");
  let customerId = request.nextUrl.searchParams.get("customer");
  let job: { id: string; job_number: string; customer_id: string; vehicle_id: string } | null = null;
  if (jobId) {
    const { data } = await admin.from("jobs").select("id, job_number, customer_id, vehicle_id").eq("id", jobId).maybeSingle();
    job = data ?? null;
    customerId = job?.customer_id ?? null;
  }
  if (!customerId) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  const yearStart = new Date(Date.UTC(new Date(Date.now() + DUBAI_OFFSET_MS).getUTCFullYear(), 0, 1) - DUBAI_OFFSET_MS).toISOString();
  const [{ data: c }, { data: contacts }, { data: jobs }, { data: cars }, { data: declined }, { data: invoices }, gateIn, approval] = await Promise.all([
    admin.from("customers").select("id, customer_number, full_name, company_name, phone, phone2, email, is_vip").eq("id", customerId).maybeSingle(),
    admin.from("customer_contacts").select("name, phone, relationship, can_approve").eq("customer_id", customerId).eq("is_active", true).order("can_approve", { ascending: false }),
    admin.from("jobs").select(`id, job_number, gated_in_at, is_open, vehicle:vehicles(${vehicleSelect})`).eq("customer_id", customerId).order("gated_in_at", { ascending: false }).limit(60),
    admin.from("vehicles").select(vehicleSelect).eq("customer_id", customerId).eq("is_active", true),
    admin.from("declined_work").select("id, title, declined_at, job_id, vehicle_id").eq("customer_id", customerId).eq("is_active", true).order("declined_at", { ascending: false }).limit(12),
    admin.from("invoices").select("job_id, kind, total_aed, issued_at").eq("customer_id", customerId).eq("is_active", true).eq("status", "issued").in("kind", ["tax_invoice", "credit_note"]),
    job ? admin.from("gate_ins").select("arrived_by").eq("job_id", job.id).maybeSingle() : Promise.resolve({ data: null }),
    job ? admin.from("approval_requests").select("sent_to_name, sent_to_phone, approver_name, kind, status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  const totalOf = new Map<string, number>();
  let spentThisYear = 0;
  for (const i of invoices ?? []) {
    const sign = i.kind === "credit_note" ? -1 : 1;
    const amount = sign * Number(i.total_aed ?? 0);
    if (i.job_id) totalOf.set(i.job_id as string, (totalOf.get(i.job_id as string) ?? 0) + amount);
    if (i.issued_at && String(i.issued_at) >= yearStart) spentThisYear += amount;
  }
  const allJobs = ((jobs ?? []) as unknown as { id: string; job_number: string; gated_in_at: string | null; is_open: boolean; vehicle: Vehicle | null }[]);
  const previous = allJobs.filter((j) => j.id !== job?.id);
  // Open balance: what is still owed on this customer's invoices (the jobs with an invoice out).
  let openBalance = 0;
  for (const j of allJobs.filter((x) => totalOf.has(x.id) || x.is_open).slice(0, 12)) {
    const b = await jobBalance(j.id);
    if (b.invoice && b.balance > 0.005) openBalance += b.balance;
  }
  const name = customerName({ full_name: c.full_name as string | null, company_name: c.company_name as string | null });
  const approver = (approval as { data: { sent_to_name: string | null; sent_to_phone: string | null; approver_name: string | null } | null }).data;
  const approverName = approver?.approver_name?.trim() || approver?.sent_to_name?.trim() || null;
  return NextResponse.json({
    customer: {
      id: c.id,
      number: c.customer_number,
      name,
      kind: c.company_name ? "Company" : "Person",
      person: c.company_name ? (c.full_name ?? null) : null,
      phone: c.phone ?? null,
      phone2: c.phone2 ?? null,
      email: c.email ?? null,
      vip: !!c.is_vip,
    },
    contacts: (contacts ?? []).map((x) => ({ name: x.name, phone: x.phone, relationship: x.relationship, canApprove: !!x.can_approve })),
    job: job ? { id: job.id, number: job.job_number } : null,
    arrived: arrivedWords((gateIn as { data: { arrived_by: string | null } | null }).data?.arrived_by),
    approvedBy: approverName && approverName.toLowerCase() !== name.toLowerCase() ? { name: approverName, phone: approver?.sent_to_phone ?? null } : null,
    previous: {
      count: previous.length,
      last: previous.slice(0, 3).map((j) => ({ id: j.id, number: j.job_number, date: j.gated_in_at, car: [j.vehicle ? formatPlate(j.vehicle) : "", carWords(j.vehicle)].filter(Boolean).join(" · "), total: totalOf.get(j.id) ?? null })),
    },
    spentThisYear: Math.round(spentThisYear * 100) / 100,
    openBalance: Math.round(openBalance * 100) / 100,
    cars: ((cars ?? []) as unknown as Vehicle[]).filter((v) => v.id !== job?.vehicle_id).map((v) => ({ id: v.id, plate: formatPlate(v), car: carWords(v) })),
    declined: (declined ?? []).map((d) => ({ id: d.id, title: d.title, date: d.declined_at })),
  });
}
