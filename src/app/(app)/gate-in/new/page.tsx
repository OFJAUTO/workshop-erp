import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, DescriptionList, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { describeMileage } from "@/lib/mileage";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleRow } from "@/lib/types";
import { createGateIn } from "../actions";
import { GateInForm } from "../GateInForm";

type Row = VehicleRow & {
  make: { name: string } | null;
  model: { name: string } | null;
  customer: { id: string; full_name: string; company_name: string | null; phone: string; is_vip: boolean; vip_note: string | null } | null;
};

export default async function NewGateInPage({ searchParams }: { searchParams: Promise<{ vehicle?: string; appointment?: string }> }) {
  await requirePermission("gateIn");
  const { vehicle: vehicleId, appointment: appointmentId } = await searchParams;
  if (!vehicleId) redirect("/gate-in");

  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicles")
    .select(
      "kind, id, customer_id, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, mileage_unit, notes, is_active, created_at, updated_at, make:vehicle_makes(name), model:vehicle_models(name), customer:customers(id, full_name, company_name, phone, is_vip, vip_note)",
    )
    .eq("id", vehicleId)
    .maybeSingle();
  if (!data) notFound();
  const v = data as unknown as Row;

  const { data: history } = await supabase
    .from("jobs")
    .select("id, job_number, status, gated_in_at, gated_out_at, is_open, gate_in:gate_ins(customer_requests, mileage, mileage_unit)")
    .eq("vehicle_id", v.id)
    .order("gated_in_at", { ascending: false })
    .limit(5);
  type Hist = { id: string; job_number: string; status: JobStatus; gated_in_at: string; gated_out_at: string | null; is_open: boolean; gate_in: { customer_requests: string; mileage: number; mileage_unit: "km" | "mi" } | null };
  const visits = (history ?? []) as unknown as Hist[];
  const openVisit = visits.find((h) => h.is_open);
  if (openVisit) redirect(`/jobs/${openVisit.id}`);

  const settings = await getSettings();
  const admin = createAdminClient();
  // Declined work from earlier visits, and accepted estimates waiting for this car.
  const [{ data: declined }, { data: estimates }] = await Promise.all([
    admin.from("declined_work").select("id, title, details, amount_aed, declined_at").eq("vehicle_id", v.id).eq("is_active", true).order("declined_at", { ascending: false }).limit(10),
    admin.from("quotations").select("id, number, total_aed, responded_at, approver_name").eq("kind", "estimate").eq("vehicle_id", v.id).eq("status", "approved").eq("is_active", true).order("responded_at", { ascending: false }),
  ]);
  const { data: attachedJobs } = (estimates ?? []).length ? await admin.from("jobs").select("estimate_id").in("estimate_id", (estimates ?? []).map((e) => e.id)) : { data: [] };
  const used = new Set((attachedJobs ?? []).map((j) => j.estimate_id));
  // A car back within the comeback window: ask whether it is a comeback for one of its recent jobs.
  const windowDays = Number(settings.comeback_window_days) || 90;
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const nowMs = Date.now();
  const recentJobs = visits.filter((h) => !h.is_open && h.gated_out_at && nowMs - Date.parse(h.gated_out_at) < windowDays * 86400000).map((h) => ({ id: h.id, label: `${h.job_number} · ${formatDate(h.gated_out_at)}`, hint: (h.gate_in?.customer_requests ?? "").slice(0, 80) }));
  const openEstimates = (estimates ?? []).filter((e) => !used.has(e.id)).map((e) => ({ id: e.id, label: `${e.number} · AED ${Number(e.total_aed).toLocaleString("en-GB")}`, hint: `Accepted by ${e.approver_name ?? "the customer"} ${formatDate(e.responded_at)}` }));

  // Started from the calendar: the appointment's reason becomes the first request line.
  const { data: appointment } = appointmentId
    ? await supabase.from("appointments").select("id, reason, status, department").eq("id", appointmentId).maybeSingle()
    : { data: null };

  return (
    <>
      <PageHeader
        title={`Gate in ${formatPlate(v)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{[v.make?.name, v.model?.name, v.variant].filter(Boolean).join(" ")}</span>
            {v.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
          </span>
        }
      />

      <div className="grid grid-cols-1 2xl:grid-cols-4 gap-6">
        <div className="2xl:col-span-3">
          <GateInForm
            action={createGateIn.bind(null, v.id)}
            isElectric={v.fuel_type === "electric"}
            branches={settings.branches}
            requests={appointment ? [appointment.reason] : []}
            mileageUnit={v.mileage_unit ?? "km"}
            mileageContext={{ modelYear: v.model_year, lastKm: v.last_mileage, lastVisitAt: visits[0]?.gated_in_at ?? null }}
            estimates={openEstimates}
            comebacks={recentJobs}
            initialValues={{ priority: "normal", keys_count: "1", major_damage: "no", vip: v.customer?.is_vip ? "on" : "", vip_note: v.customer?.vip_note ?? "", appointment_id: appointment?.id ?? "", department: appointment?.department ?? "" }}
          />
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Customer</SectionLabel>
            <Link href={`/customers/${v.customer?.id}`} className="font-bold hover:underline underline-offset-4">
              {v.customer?.company_name ?? v.customer?.full_name}
            </Link>
            <span className="text-sm text-muted">{v.customer?.phone}</span>
            {v.customer?.is_vip && v.customer.vip_note ? (
              <div className="rounded-control border border-ink p-3 text-sm font-medium whitespace-pre-wrap">{v.customer.vip_note}</div>
            ) : null}
            <DescriptionList
              items={[
                { label: "VIN", value: v.vin ? <span className="font-mono">{v.vin}</span> : null },
                { label: "Last known mileage", value: v.last_mileage != null ? describeMileage(v.last_mileage, v.mileage_unit ?? "km") : null },
              ]}
            />
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionLabel right={visits.length ? `${visits.length}` : undefined}>Previous visits</SectionLabel>
            {visits.length === 0 ? (
              <p className="text-sm text-muted">First visit. No history yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {visits.map((h) => (
                  <li key={h.id} className="py-2.5 flex flex-col gap-0.5">
                    <Link href={`/jobs/${h.id}`} className="font-semibold hover:underline underline-offset-4">
                      {formatDate(h.gated_in_at)} · {h.job_number}
                    </Link>
                    <span className="text-xs text-muted">{STATUS_LABELS[h.status]}{h.gate_in?.mileage ? ` · ${describeMileage(h.gate_in.mileage, h.gate_in.mileage_unit ?? "km")}` : ""}</span>
                    {h.gate_in?.customer_requests ? <span className="text-xs">{h.gate_in.customer_requests.slice(0, 140)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-2">
            <SectionLabel right={declined?.length ? `${declined.length}` : undefined}>Previously declined work</SectionLabel>
            {declined?.length ? (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {declined.map((d) => (
                  <li key={d.id} className="py-2 flex flex-col">
                    <span className="font-semibold">{d.title}</span>
                    <span className="text-xs text-muted">{d.details ? `${d.details} · ` : ""}{d.amount_aed != null ? `AED ${Number(d.amount_aed).toLocaleString("en-GB")} · ` : ""}declined {formatDate(d.declined_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None recorded.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
