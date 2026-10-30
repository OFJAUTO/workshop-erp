import Link from "next/link";
import { feeBoundsFor } from "@/lib/inspection-fee-server";
import { ppfJobsOfCar } from "@/lib/recheck";
import { CustomerName } from "@/components/CustomerPanel";
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
import { OPEN_ESTIMATE_STATUSES } from "@/lib/quote-history";

type Row = VehicleRow & {
  make: { name: string } | null;
  model: { name: string } | null;
  customer: { id: string; full_name: string; company_name: string | null; phone: string; is_vip: boolean; vip_note: string | null } | null;
};

export default async function NewGateInPage({ searchParams }: { searchParams: Promise<{ vehicle?: string; appointment?: string; visit?: string }> }) {
  const staff = await requirePermission("gateIn");
  // The gate-in role gets what gate-in needs only: no customer page, no earlier visits, no money (23 October 2026).
  const gateInOnly = staff.role_id === "gate_in";
  const sp = await searchParams;
  const { vehicle: vehicleId, appointment: appointmentId } = sp;
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
  // A car already in the workshop: its job card, or for the gate-in person (who cannot open job cards, 30 October 2026)
  // its photos and video page, as the gate-in search does.
  if (openVisit) redirect(gateInOnly ? `/jobs/${openVisit.id}/media` : `/jobs/${openVisit.id}`);

  const settings = await getSettings();
  const admin = createAdminClient();
  // Declined work from earlier visits, and accepted estimates waiting for this car.
  const [{ data: declined }, { data: estimates }] = await Promise.all([
    gateInOnly ? Promise.resolve({ data: [] as { id: string; title: string; details: string | null; amount_aed: number | null; declined_at: string; severity: string | null }[] }) : admin.from("declined_work").select("id, title, details, amount_aed, declined_at, severity").eq("vehicle_id", v.id).eq("is_active", true).is("done_at", null).order("declined_at", { ascending: false }).limit(10),
    // 30 October 2026: EVERY open estimate of the car (accepted, or still with the customer) carries over to the job.
    admin.from("quotations").select("id, number, status, total_aed, rounded_total_aed, sent_at, opened_at, responded_at, approver_name, created_at, additional_to_id").eq("kind", "estimate").eq("vehicle_id", v.id).in("status", OPEN_ESTIMATE_STATUSES).eq("is_active", true).is("deleted_at", null).is("carried_job_id", null).order("created_at"),
  ]);
  const { data: attachedJobs } = (estimates ?? []).length ? await admin.from("jobs").select("estimate_id").in("estimate_id", (estimates ?? []).map((e) => e.id)) : { data: [] };
  const used = new Set((attachedJobs ?? []).map((j) => j.estimate_id));
  // A car back within the comeback window: ask whether it is a comeback for one of its recent jobs.
  const windowDays = Number(settings.comeback_window_days) || 90;
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const nowMs = Date.now();
  const recentJobs = visits.filter((h) => !h.is_open && h.gated_out_at && nowMs - Date.parse(h.gated_out_at) < windowDays * 86400000).map((h) => ({ id: h.id, label: `${h.job_number} · ${formatDate(h.gated_out_at)}`, hint: gateInOnly ? "" : (h.gate_in?.customer_requests ?? "").slice(0, 80) }));
  // An additional estimate points at the version it was made from, which may since have been replaced: read its number.
  const estNumber = new Map((estimates ?? []).map((e) => [e.id as string, e.number as string]));
  const baseIds = Array.from(new Set((estimates ?? []).map((e) => e.additional_to_id as string | null).filter((x): x is string => !!x && !estNumber.has(x))));
  if (baseIds.length) {
    const { data: bases } = await admin.from("quotations").select("id, number").in("id", baseIds);
    for (const q of bases ?? []) estNumber.set(q.id as string, q.number as string);
  }
  const openEstimates = (estimates ?? []).filter((e) => !used.has(e.id)).map((e) => {
    const status = e.status === "approved" ? `Accepted by ${e.approver_name ?? "the customer"} ${formatDate(e.responded_at)}` : e.status === "draft" ? "Being prepared, not sent" : e.sent_at ? `Sent ${formatDate(e.sent_at)}, not accepted yet` : "Not accepted yet";
    const adds = e.additional_to_id && estNumber.get(e.additional_to_id) ? ` · additional to ${estNumber.get(e.additional_to_id)}` : "";
    return { id: e.id as string, label: gateInOnly ? (e.number as string) : `${e.number} · AED ${Number(e.rounded_total_aed ?? e.total_aed).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, hint: gateInOnly ? (adds ? adds.slice(3) : "") : `${status}${adds}` };
  });

  // 30 October 2026: the car's delivered PPF jobs, for a PPF RECHECK (FREE) visit.
  const rechecks = await ppfJobsOfCar(v.id);

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
            draftKey={`gate-in-${v.id}`}
            isElectric={v.fuel_type === "electric"}
            branches={settings.branches}
            recoveryTypes={(settings.recovery_types ?? []) as { key: string; label: string }[]}
            requests={appointment ? [appointment.reason] : []}
            mileageUnit={v.mileage_unit ?? "km"}
            mileageContext={{ modelYear: v.model_year, lastKm: v.last_mileage, lastVisitAt: visits[0]?.gated_in_at ?? null }}
            estimates={openEstimates}
            rechecks={rechecks}
            initialVisit={sp.visit === "recheck" ? "recheck" : "normal"}
            comebacks={recentJobs}
            // 30 October 2026: an advisor or the owner doing the gate-in chooses the fee here; the gate-in person leaves it for the advisor (approval link).
            inspectionFee={staff.role_id === "service_advisor" || staff.role_id === "owner" ? { initial: { choice: null, amount: null, reason: null, note: null, type: "full" }, bounds: feeBoundsFor(settings, v.make?.name), isOwner: staff.role_id === "owner", locked: false, words: "" } : null}
            initialValues={{ priority: "normal", keys_count: "1", major_damage: "no", vip: v.customer?.is_vip ? "on" : "", vip_note: v.customer?.vip_note ?? "", appointment_id: appointment?.id ?? "", department: appointment?.department ?? "" }}
          />
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Customer</SectionLabel>
            {gateInOnly ? (
              <span className="font-bold">{v.customer?.company_name ?? v.customer?.full_name}</span>
            ) : (
              <CustomerName name={v.customer?.company_name ?? v.customer?.full_name ?? "Customer"} customerId={v.customer?.id} className="font-bold" />
            )}
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

          {gateInOnly ? null : (
          <>
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
                    <span className="font-semibold">{d.title}{d.severity ? <span className={d.severity === "Advisory" ? "font-normal text-muted" : "font-bold text-red"}> · {d.severity}</span> : null}</span>
                    <span className="text-xs text-muted">{d.details ? `${d.details} · ` : ""}{d.amount_aed != null ? `AED ${Number(d.amount_aed).toLocaleString("en-GB")} · ` : ""}declined {formatDate(d.declined_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None recorded.</p>
            )}
          </Card>
          </>
          )}
        </div>
      </div>
    </>
  );
}
