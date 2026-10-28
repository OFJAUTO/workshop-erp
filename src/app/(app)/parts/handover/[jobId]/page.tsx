import { CopyVin } from "@/components/CopyVin";
import { LiveRefresh } from "@/components/LiveRefresh";
import { notFound } from "next/navigation";
import { Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { inspectionDangerous, loadInspection } from "@/lib/inspection-data";
import { hasNoHome, partState } from "@/lib/part-state";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { reasonsFor } from "@/lib/reasons";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { dispositionAction, exchangePartAction, markPartsReadyAction, notNeededAction, returnToParts } from "../../handover-actions";
import { ReadyForm, ReturnForm, type DeskPart } from "./HandoverForm";
import { EndingForm, PartActions, PartStateBadge } from "./PartActions";

export const dynamic = "force-dynamic";

/**
 * Hand the parts of one car to the technician: he ticks what he receives and confirms on his device
 * or signs at the counter; a manager or the owner can sign for him. Every part shows exactly one
 * state. Wrong or faulty parts go back to the supplier with the correct one raised for ordering;
 * parts not needed get an ending: back to the supplier, to stock, or fitted with the owner's approval.
 */
export default async function HandoverPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || can(role, "manageWork"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: rows }, { data: priv }, { data: names }] = await Promise.all([
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle(),
    admin.from("part_items").select(PART_FULL_SELECT + ", pending_handover_id, sticker_kind, battery_model, serial_number").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").order("created_at"),
    admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle(),
    admin.from("staff").select("id, display_name").eq("is_active", true),
  ]);
  if (!job) notFound();
  const j = job as unknown as JobBrief;
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));
  const all = ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPartFull(r), pending_handover_id: r.pending_handover_id as string | null, sticker_kind: r.sticker_kind as string | null, battery_model: r.battery_model as string | null, serial_number: r.serial_number as string | null }));
  const noHome = all.filter(hasNoHome);
  const parts = all.filter((p) => p.return_status !== "returned" && !hasNoHome(p));
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approved = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const plate = j.vehicle ? formatPlate(j.vehicle) : j.job_number;
  const toHandParts = parts.filter((p) => p.issue_status !== "confirmed" && !p.pending_handover_id);
  const toHand: DeskPart[] = toHandParts.map((p) => {
    const here = p.received_qty > 0 && (p.availability === "in_stock" || p.order_status === "received" || (!!p.po_id && approved.has(p.po_id)));
    return { id: p.id, description: p.description, part_number: p.part_number, quantity: p.received_qty || Number(p.confirmed_quantity ?? p.quantity) || 1, here, why: here ? null : p.expected_date ? `Expected ${p.expected_date}` : "Not here yet", readyAt: p.ready_for_handover_at ? formatDateTime(p.ready_for_handover_at) : null, notReceived: !!p.not_received_at };
  });
  const handed = parts.filter((p) => p.issue_status === "confirmed");
  const canHand = can(role, "managePurchaseOrders") && !staff.viewingAs && j.is_open;
  const canSettle = !staff.viewingAs && j.is_open;
  const canEnd = !staff.viewingAs && (role === "owner" || can(role, "managePurchaseOrders"));
  const inspBundle = await loadInspection(jobId);
  const dangers = inspBundle ? inspectionDangerous(inspBundle) : [];
  const back = `/parts/handover/${jobId}`;

  return (
    <>
      <LiveRefresh tables={["part_handovers", "part_items"]} jobId={jobId} />
      <PageHeader title={`Hand over · ${plate}`} subtitle={<span className="flex flex-wrap items-center gap-2"><span>{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · {j.job_number}</span>{dangers.length ? <Badge tone="red">Dangerous to drive</Badge> : null}</span>} actions={<><CopyVin vin={j.vehicle?.vin} /><LinkButton href={`/parts/trail/${jobId}`} tone="secondary" size="lg">Parts trail</LinkButton><LinkButton href={`/parts/${jobId}`} tone="secondary" size="lg">Parts page</LinkButton>{can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}</>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${toHand.filter((p) => p.here).length} here · ${toHand.filter((p) => !p.here).length} still coming`}>At the desk</SectionLabel>
        {toHand.length === 0 ? <p className="text-sm text-muted">{handed.length ? "Every part on this car is with the technician." : "No parts to hand over on this car."}</p> : null}
        {toHand.some((p) => p.readyAt) ? (
          <ul className="flex flex-col gap-1 text-sm" data-ready-list>
            {toHand.filter((p) => p.readyAt).map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-control border border-amber-bar bg-white px-2 py-2" data-ready-part={p.id}>
                <span className="font-semibold">{p.description}</span><span className="text-muted">× {p.quantity}</span>
                <span className="ml-auto text-xs font-semibold text-amber">Ready · waiting for the technician, {p.readyAt}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canHand ? <ReadyForm parts={toHand} action={markPartsReadyAction.bind(null, jobId)} /> : toHand.some((p) => p.here && !p.readyAt) ? <p className="text-sm text-muted">Parts mark them ready from this page.</p> : null}
        {toHand.some((p) => !p.here) ? (
          <ul className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
            {toHand.filter((p) => !p.here).map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-2">
                <span className="font-semibold text-muted">{p.description}</span><span className="text-muted">× {p.quantity}</span>
                <span className="ml-auto text-xs text-muted">{p.why}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canSettle && toHandParts.length ? (
          <ul className="divide-y divide-line border-t border-line pt-2 text-sm">
            {toHandParts.map((p) => (
              <li key={p.id} className="py-2 flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.description}</span><PartStateBadge state={partState(p)} />{p.not_received_at ? <span className="text-xs text-muted">not received {formatDateTime(p.not_received_at)}</span> : null}</span>
                <PartActions partId={p.id} back={back} canExchange={p.received_qty > 0} canNotNeeded exchangeAction={exchangePartAction.bind(null, jobId)} notNeededAction={notNeededAction.bind(null, jobId)} notNeededReasons={reasonsFor(settings, "remove_part")} />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {handed.length ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel right={`${handed.length}`}>With the technician</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {handed.map((p) => (
              <li key={p.id} className="py-2 flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.description}</span><span className="text-muted">× {p.tech_received_qty ?? p.issued_qty ?? 1} · received by {nameOf.get(p.issue_confirmed_by ?? "") ?? "the technician"}, {formatDateTime(p.issue_confirmed_at)}</span><PartStateBadge state={partState(p)} />{p.stickers_printed ? <Badge tone="outline">{p.stickers_printed} sticker{p.stickers_printed === 1 ? "" : "s"}</Badge> : null}</span>
                {canSettle ? <PartActions partId={p.id} back={back} canExchange canNotNeeded exchangeAction={exchangePartAction.bind(null, jobId)} notNeededAction={notNeededAction.bind(null, jobId)} notNeededReasons={reasonsFor(settings, "remove_part")} /> : null}
              </li>
            ))}
          </ul>
          {!staff.viewingAs ? <ReturnForm parts={handed.map((p) => ({ id: p.id, description: p.description, quantity: p.issued_qty || 1 }))} needsPin={!!priv?.pin_hash} action={returnToParts.bind(null, jobId)} /> : null}
        </Card>
      ) : null}

      {noHome.length ? (
        <Card className="flex flex-col gap-3 border-amber-bar">
          <SectionLabel right={`${noHome.length}`}>Parts without a home</SectionLabel>
          <p className="text-xs text-muted">Not needed, wrong or faulty, or back with Parts: each one needs an ending. The owner sees these on one list after three working days.</p>
          <ul className="divide-y divide-line text-sm">
            {noHome.map((p) => (
              <li key={p.id} className="py-2 flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.description}</span><span className="text-muted">× {Number(p.confirmed_quantity ?? p.quantity) || 1}</span><PartStateBadge state={partState(p)} /></span>
                {p.not_needed_reason ? <span className="text-xs text-muted">Not needed: {p.not_needed_reason} ({nameOf.get(p.not_needed_by ?? "") ?? ""}, {formatDateTime(p.not_needed_at)})</span> : null}
                {p.exchange_note || p.exchange_at ? <span className="text-xs text-muted">{p.exchange_note ? `${p.exchange_note} · ` : ""}{formatDateTime(p.exchange_at)}{p.replacement_part_id ? " · the correct part is on the Parts desk to order" : ""}</span> : null}
                {p.return_note && !p.not_needed_reason && !p.exchange_at ? <span className="text-xs text-muted">{p.return_note}</span> : null}
                {canEnd ? <EndingForm partId={p.id} back={back} action={dispositionAction.bind(null, jobId)} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
