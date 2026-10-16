import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { partState } from "@/lib/part-state";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

type Handover = { stickers?: Record<string, unknown> | null; stickers_printed_at?: string | null; status?: string; id: string; kind: "handover" | "return"; from_staff: string | null; to_staff: string | null; signed_for_by: string | null; pin_used: boolean; items: { description: string; quantity: number; not_received?: boolean }[]; note: string | null; created_at: string; confirmed_at: string | null };

/** The parts trail of one car: every part with its one state and the times behind it, every handover and return, and the part events in between. */
export default async function PartsTrailPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ part?: string }> }) {
  const { part: highlight } = await searchParams;
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "viewPurchaseOrders") || can(role, "manageWork"))) notFound();
  const { jobId } = await params;
  const admin = createAdminClient();
  const [{ data: job }, { data: handovers }, { data: events }, { data: people }, { data: partRows }] = await Promise.all([
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle(),
    admin.from("part_handovers").select("id, kind, from_staff, to_staff, signed_for_by, pin_used, items, note, created_at, confirmed_at, stickers, stickers_printed_at, status").eq("job_id", jobId).eq("is_active", true).order("created_at", { ascending: false }),
    admin.from("job_events").select("id, event_type, note, created_at, created_by").eq("job_id", jobId).in("event_type", ["parts_issued", "part_return", "part_returned", "parts_received", "po_raised", "po_ordered", "parts_delayed", "planning", "part_exchange", "part_not_needed", "part_disposition", "goodwill", "handover_requested", "handover_cancelled"]).order("created_at", { ascending: false }),
    admin.from("staff").select("id, display_name"),
    admin.from("part_items").select(PART_FULL_SELECT + ", pending_handover_id").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").order("created_at"),
  ]);
  if (!job) notFound();
  const j = job as unknown as JobBrief;
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const rows = (handovers ?? []) as unknown as Handover[];
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPartFull(r), pending_handover_id: (r.pending_handover_id as string | null) ?? null }));
  // The LPO and the supplier's invoice number behind each part (what a staff scan of the sticker shows).
  const poIds = Array.from(new Set(parts.map((p) => p.po_id).filter((x): x is string => !!x)));
  const { data: poRows } = poIds.length ? await admin.from("purchase_orders").select("id, number, supplier_invoice_number").in("id", poIds) : { data: [] as { id: string; number: string; supplier_invoice_number: string | null }[] };
  const poOf = new Map((poRows ?? []).map((r) => [r.id as string, r as { id: string; number: string; supplier_invoice_number: string | null }]));
  const times = (p: (typeof parts)[number]) => {
    const out: string[] = [];
    if (p.expected_date && (p.order_status === "ordered" || p.order_status === "partly_received")) out.push(`expected ${p.expected_date}`);
    if (p.received_qty > 0 && p.order_status === "received") out.push("received by Parts");
    if (p.issue_confirmed_at) out.push(`handed ${formatDateTime(p.issue_confirmed_at)} to ${nameOf.get(p.issue_confirmed_by ?? "") ?? "the technician"}`);
    if (p.not_received_at) out.push(`not received ${formatDateTime(p.not_received_at)}`);
    if (p.exchange_at) out.push(`wrong or faulty ${formatDateTime(p.exchange_at)}`);
    if (p.not_needed_at) out.push(`not needed ${formatDateTime(p.not_needed_at)}${p.not_needed_reason ? `: ${p.not_needed_reason}` : ""}`);
    const po = p.po_id ? poOf.get(p.po_id) : null;
    if (po) out.push(`${po.number}${po.supplier_invoice_number ? ` · supplier invoice ${po.supplier_invoice_number}` : ""}`);
    if (p.disposition_at) out.push(`${p.disposition === "returned" ? "returned to the supplier" : p.disposition === "stock" ? "moved to stock" : p.disposition === "fit_approved" ? "goodwill approved" : "ending asked"} ${formatDateTime(p.disposition_at)}${p.disposition_note ? ` · ${p.disposition_note}` : ""}`);
    return out;
  };
  return (
    <>
      <PageHeader title={`Parts trail · ${j.vehicle ? formatPlate(j.vehicle) : j.job_number}`} subtitle={`${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}`} actions={<><CopyVin vin={j.vehicle?.vin} />{can(role, "managePurchaseOrders") || can(role, "manageWork") ? <LinkButton href={`/parts/handover/${jobId}`} tone="secondary" size="lg">Hand over</LinkButton> : null}{can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}</>} />
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${parts.length}`}>Parts on this car</SectionLabel>
        {parts.length === 0 ? <Empty title="No approved parts yet" /> : null}
        <ul className="divide-y divide-line text-sm">
          {parts.map((p) => {
            const s = partState(p);
            return (
              <li key={p.id} id={`part-${p.id}`} className={`py-2 flex flex-col gap-1 ${highlight === p.id ? "bg-amber-soft/50 -mx-2 px-2 rounded-control" : ""}`} data-trail-part={p.id}>
                <span className="flex flex-wrap items-center gap-2"><span className="font-semibold uppercase">{p.description}</span><span className="text-muted">× {Number(p.confirmed_quantity ?? p.quantity) || 1}</span><Badge tone={s.tone}>{s.label}</Badge>{p.replaced_part_id ? <Badge tone="outline">Replacement</Badge> : null}</span>
                {times(p).length ? <span className="text-xs text-muted">{times(p).join(" · ")}</span> : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${rows.length}`}>Handovers</SectionLabel>
        {rows.length === 0 ? <Empty title="No handover yet" /> : null}
        <ul className="divide-y divide-line text-sm">
          {rows.map((h) => (
            <li key={h.id} className="py-2.5 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={h.status === "cancelled" ? "neutral" : h.status === "pending" ? "amber" : h.kind === "handover" ? "green" : "amber"}>{h.status === "cancelled" ? "Cancelled" : h.status === "pending" ? "Waiting for the PIN" : h.kind === "handover" ? "Handed over" : "Returned to Parts"}</Badge>
                <span className="font-semibold">{h.items.length} part{h.items.length === 1 ? "" : "s"}</span>
                <span className="text-muted">{formatDateTime(h.confirmed_at ?? h.created_at)}</span>
                <span className="text-muted">from {nameOf.get(h.from_staff ?? "") ?? "Parts"} to {nameOf.get(h.to_staff ?? "") ?? "the technician"}{h.signed_for_by ? ` · signed for by ${nameOf.get(h.signed_for_by) ?? "the manager"}` : h.pin_used ? " · PIN" : ""}</span>
              </div>
              <span className="text-xs">{h.items.map((i) => `${i.description} × ${i.quantity}${i.not_received ? " (not received)" : ""}`).join(" · ")}</span>
              {h.kind === "handover" && h.stickers && Object.keys(h.stickers as Record<string, unknown>).length ? <a href={`/print/stickers/${h.id}?back=${encodeURIComponent(`/parts/trail/${jobId}`)}`} target="_blank" rel="noreferrer" className="self-start text-xs font-bold underline underline-offset-4">Print the stickers again (new tab, logged)</a> : null}
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
