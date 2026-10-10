import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { JOB_BRIEF_SELECT, type JobBrief } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

type Handover = { id: string; kind: "handover" | "return"; from_staff: string | null; to_staff: string | null; signed_for_by: string | null; pin_used: boolean; items: { description: string; quantity: number }[]; note: string | null; created_at: string };

/** The parts trail of one car: every handover and return, who gave, who took, when, and the part events in between. */
export default async function PartsTrailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "viewPurchaseOrders") || can(role, "manageWork"))) notFound();
  const { jobId } = await params;
  const admin = createAdminClient();
  const [{ data: job }, { data: handovers }, { data: events }, { data: people }] = await Promise.all([
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle(),
    admin.from("part_handovers").select("id, kind, from_staff, to_staff, signed_for_by, pin_used, items, note, created_at").eq("job_id", jobId).eq("is_active", true).order("created_at", { ascending: false }),
    admin.from("job_events").select("id, event_type, note, created_at, created_by").eq("job_id", jobId).in("event_type", ["parts_issued", "part_return", "part_returned", "parts_received", "po_raised", "po_ordered", "parts_delayed", "planning"]).order("created_at", { ascending: false }),
    admin.from("staff").select("id, display_name"),
  ]);
  if (!job) notFound();
  const j = job as unknown as JobBrief;
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const rows = (handovers ?? []) as unknown as Handover[];
  return (
    <>
      <PageHeader title={`Parts trail · ${j.vehicle ? formatPlate(j.vehicle) : j.job_number}`} subtitle={`${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}`} actions={<><CopyVin vin={j.vehicle?.vin} />{can(role, "managePurchaseOrders") ? <LinkButton href={`/parts/handover/${jobId}`} size="lg">Hand over</LinkButton> : null}{can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}</>} />
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${rows.length}`}>Handovers</SectionLabel>
        {rows.length === 0 ? <Empty title="No handover yet" /> : null}
        <ul className="divide-y divide-line text-sm">
          {rows.map((h) => (
            <li key={h.id} className="py-2.5 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={h.kind === "handover" ? "green" : "amber"}>{h.kind === "handover" ? "Handed over" : "Returned to Parts"}</Badge>
                <span className="font-semibold">{h.items.length} part{h.items.length === 1 ? "" : "s"}</span>
                <span className="text-muted">{formatDateTime(h.created_at)}</span>
                <span className="text-muted">from {nameOf.get(h.from_staff ?? "") ?? "Parts"} to {nameOf.get(h.to_staff ?? "") ?? "the technician"}{h.signed_for_by ? ` · signed for by ${nameOf.get(h.signed_for_by) ?? "the manager"}` : h.pin_used ? " · PIN" : ""}</span>
              </div>
              <span className="text-xs">{h.items.map((i) => `${i.description} × ${i.quantity}`).join(" · ")}</span>
              {h.note ? <span className="text-xs text-muted">{h.note}</span> : null}
            </li>
          ))}
        </ul>
      </Card>
      {(events ?? []).length ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>Part events</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="py-2 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4"><span className="text-xs text-muted sm:w-36 shrink-0">{formatDateTime(e.created_at)}</span><span>{e.note}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
