import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { activeTechnicians } from "@/lib/work-flow";
import { handoverParts, returnToParts } from "../../handover-actions";
import { HandoverForm, ReturnForm, type HandoverPart } from "./HandoverForm";

export const dynamic = "force-dynamic";

/** Hand the parts of one car to the technician with one PIN; take parts back; see the trail. */
export default async function HandoverPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || can(role, "manageWork"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const [{ data: job }, { data: rows }, { data: techs }, onCar, { data: priv }] = await Promise.all([
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle(),
    admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned").order("created_at"),
    admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name"),
    activeTechnicians(jobId),
    admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle(),
  ]);
  if (!job) notFound();
  const j = job as unknown as JobBrief;
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approved = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const plate = j.vehicle ? formatPlate(j.vehicle) : j.job_number;
  const toHand: HandoverPart[] = parts.filter((p) => p.issue_status !== "confirmed").map((p) => {
    const here = p.received_qty > 0 && (p.availability === "in_stock" || p.order_status === "received" || (!!p.po_id && approved.has(p.po_id)));
    return { id: p.id, description: p.description, part_number: p.part_number, quantity: p.received_qty || Number(p.confirmed_quantity ?? p.quantity) || 1, label_code: p.label_code, ready: here, why: here ? null : p.expected_date ?? p.delivery_date ? `Coming ${p.expected_date ?? p.delivery_date}` : "Not here yet" };
  });
  const handed = parts.filter((p) => p.issue_status === "confirmed");
  const ordered = (techs ?? []).sort((a, b) => (onCar.some((t) => t.staff_id === a.id) ? -1 : onCar.some((t) => t.staff_id === b.id) ? 1 : 0));
  const defaultTech = onCar[0]?.staff_id ?? j.assigned_to ?? null;
  const canHand = can(role, "managePurchaseOrders") && !staff.viewingAs && j.is_open;
  const canSignFor = role === "owner" || can(role, "manageWork");

  return (
    <>
      <PageHeader title={`Hand over · ${plate}`} subtitle={`${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}`} actions={<><CopyVin vin={j.vehicle?.vin} /><LinkButton href={`/parts/trail/${jobId}`} tone="secondary" size="lg">Parts trail</LinkButton><LinkButton href={`/parts/labels/${jobId}`} tone="secondary" size="lg">Labels</LinkButton><LinkButton href={`/parts/${jobId}`} tone="secondary" size="lg">Parts desk</LinkButton></>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${toHand.filter((p) => p.ready).length} here · ${toHand.filter((p) => !p.ready).length} still coming`}>Hand over</SectionLabel>
        {toHand.length === 0 ? <p className="text-sm text-muted">Every part on this car is with the technician.</p> : !canHand ? <p className="text-sm text-muted">Parts hand them over from this page.</p> : ordered.length === 0 ? <p className="text-sm text-muted">No technician with handheld login yet.</p> : (
          <HandoverForm parts={toHand} technicians={ordered} defaultTechnician={defaultTech} plate={plate} canSignFor={canSignFor} action={handoverParts.bind(null, jobId)} />
        )}
      </Card>
      {handed.length ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel right={`${handed.length}`}>With the technician</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {handed.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center gap-3"><span className="font-semibold">{p.description}</span><span className="text-muted">× {p.issued_qty || 1} · handed {formatDateTime(p.issue_confirmed_at)}</span></li>
            ))}
          </ul>
          {!staff.viewingAs ? <ReturnForm parts={handed.map((p) => ({ id: p.id, description: p.description, quantity: p.issued_qty || 1 }))} needsPin={!!priv?.pin_hash} action={returnToParts.bind(null, jobId)} /> : null}
        </Card>
      ) : null}
    </>
  );
}
