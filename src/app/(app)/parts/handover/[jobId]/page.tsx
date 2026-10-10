import { CopyVin } from "@/components/CopyVin";
import { LiveRefresh } from "@/components/LiveRefresh";
import { notFound } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { pendingHandoversFor } from "@/lib/handover";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { isBatteryPart, stickerSettings } from "@/lib/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { activeTechnicians } from "@/lib/work-flow";
import { cancelHandoverAction, handoverParts, returnToParts, signHandoverAtCounter } from "../../handover-actions";
import { HandoverForm, ReturnForm, SignHere, type HandoverPart } from "./HandoverForm";

export const dynamic = "force-dynamic";

/** Hand the parts of one car to the technician: he confirms on his device or signs at the counter. Take parts back. */
export default async function HandoverPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || can(role, "manageWork"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const ss = stickerSettings(settings);
  const [{ data: job }, { data: rows }, { data: techs }, onCar, { data: priv }, pending, { data: devices }] = await Promise.all([
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle(),
    admin.from("part_items").select(PART_FULL_SELECT + ", pending_handover_id, sticker_kind, battery_model, serial_number").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned").order("created_at"),
    admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name"),
    activeTechnicians(jobId),
    admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle(),
    pendingHandoversFor(null, jobId),
    admin.from("devices").select("staff_id").eq("kind", "personal").eq("is_active", true).is("blocked_at", null),
  ]);
  if (!job) notFound();
  const j = job as unknown as JobBrief;
  const personal = new Set((devices ?? []).map((d) => d.staff_id).filter(Boolean));
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPartFull(r), pending_handover_id: r.pending_handover_id as string | null, sticker_kind: r.sticker_kind as string | null, battery_model: r.battery_model as string | null, serial_number: r.serial_number as string | null }));
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approved = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const plate = j.vehicle ? formatPlate(j.vehicle) : j.job_number;
  const toHand: HandoverPart[] = parts.filter((p) => p.issue_status !== "confirmed" && !p.pending_handover_id).map((p) => {
    const here = p.received_qty > 0 && (p.availability === "in_stock" || p.order_status === "received" || (!!p.po_id && approved.has(p.po_id)));
    const battery = isBatteryPart(p);
    const typeDefault = p.part_type ? ss.partTypes.includes(String(p.part_type).toLowerCase()) : false;
    return { id: p.id, description: p.description, part_number: p.part_number, quantity: p.received_qty || Number(p.confirmed_quantity ?? p.quantity) || 1, ready: here, why: here ? null : p.expected_date ? `Expected ${p.expected_date}` : "Not here yet", battery, defaultStickers: typeDefault ? p.received_qty || 1 : 0, brand: p.brand ?? null, model: p.battery_model, serial: p.serial_number };
  });
  const handed = parts.filter((p) => p.issue_status === "confirmed");
  const ordered = (techs ?? []).sort((a, b) => (onCar.some((t) => t.staff_id === a.id) ? -1 : onCar.some((t) => t.staff_id === b.id) ? 1 : 0)).map((t) => ({ id: t.id, display_name: t.display_name, personalDevice: personal.has(t.id) }));
  const defaultTech = onCar[0]?.staff_id ?? j.assigned_to ?? null;
  const canHand = can(role, "managePurchaseOrders") && !staff.viewingAs && j.is_open;
  const canSignFor = role === "owner" || can(role, "manageWork");

  return (
    <>
      <LiveRefresh tables={["part_handovers", "part_items"]} jobId={jobId} pollMs={30000} />
      <PageHeader title={`Hand over · ${plate}`} subtitle={`${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}`} actions={<><CopyVin vin={j.vehicle?.vin} /><LinkButton href={`/parts/trail/${jobId}`} tone="secondary" size="lg">Parts trail</LinkButton><LinkButton href={`/parts/${jobId}`} tone="secondary" size="lg">Parts of this car</LinkButton></>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {pending.map((h) => (
        <Card key={h.id} className="flex flex-col gap-3 border-amber-bar">
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel right={formatDateTime(h.created_at)}>Waiting for {h.takerName}&apos;s PIN</SectionLabel>
            <Badge tone="amber">{h.items.length} part{h.items.length === 1 ? "" : "s"}</Badge>
            {Object.keys(h.stickers ?? {}).length ? <Badge tone={h.stickers_printed_at ? "green" : "red"}>{h.stickers_printed_at ? "Stickers printed" : "Stickers not printed yet"}</Badge> : null}
          </div>
          <p className="text-sm">{h.giverName} is handing {h.items.map((i) => `${i.description} × ${i.quantity}`).join(", ")} to <span className="font-semibold">{h.takerName}</span>. {personal.has(h.to_staff ?? "") ? "He has it on his own device and enters his PIN there." : "He signs here at the counter."} The parts count as with Parts until he confirms.</p>
          <div className="flex flex-wrap items-start gap-3">
            {!staff.viewingAs ? <SignHere jobId={jobId} takerName={h.takerName} canSignFor={canSignFor} action={signHandoverAtCounter.bind(null, h.id)} /> : null}
            {Object.keys(h.stickers ?? {}).length ? <LinkButton href={`/print/stickers/${h.id}?back=${encodeURIComponent(`/parts/handover/${jobId}`)}`} tone="secondary" size="md">{h.stickers_printed_at ? "Print the stickers again" : "Print the stickers"}</LinkButton> : null}
            {canHand ? <form action={cancelHandoverAction.bind(null, h.id)}><input type="hidden" name="job_id" value={jobId} /><Button type="submit" tone="ghost" size="md">Cancel this handover</Button></form> : null}
          </div>
        </Card>
      ))}

      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${toHand.filter((p) => p.ready).length} here · ${toHand.filter((p) => !p.ready).length} still coming`}>Hand over</SectionLabel>
        {toHand.length === 0 ? <p className="text-sm text-muted">{pending.length ? "Every other part is with the technician or waiting for his PIN above." : "Every part on this car is with the technician."}</p> : !canHand ? <p className="text-sm text-muted">Parts hand them over from this page.</p> : ordered.length === 0 ? <p className="text-sm text-muted">No technicians on the team yet.</p> : (
          <HandoverForm parts={toHand} technicians={ordered} defaultTechnician={defaultTech} plate={plate} canSignFor={canSignFor} batteryRequired={ss.batteryRequired} action={handoverParts.bind(null, jobId)} />
        )}
      </Card>
      {handed.length ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel right={`${handed.length}`}>With the technician</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {handed.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center gap-3"><span className="font-semibold">{p.description}</span><span className="text-muted">× {p.issued_qty || 1} · handed {formatDateTime(p.issue_confirmed_at)}</span>{p.stickers_printed ? <Badge tone="outline">{p.stickers_printed} sticker{p.stickers_printed === 1 ? "" : "s"}</Badge> : null}</li>
            ))}
          </ul>
          {!staff.viewingAs ? <ReturnForm parts={handed.map((p) => ({ id: p.id, description: p.description, quantity: p.issued_qty || 1 }))} needsPin={!!priv?.pin_hash} action={returnToParts.bind(null, jobId)} /> : null}
        </Card>
      ) : null}
    </>
  );
}
