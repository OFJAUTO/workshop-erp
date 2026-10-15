import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { partsWithNoHome } from "@/lib/handover";
import { partState } from "@/lib/part-state";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { approveGoodwillAction, dispositionAction } from "../handover-actions";
import { EndingForm } from "../handover/[jobId]/PartActions";

export const dynamic = "force-dynamic";

/**
 * The owner's list (Parts see it too): every part with no home across the workshop, not needed,
 * wrong or faulty, or back with Parts, with nothing decided yet. Parts give each an ending; the
 * owner approves fitting a part as goodwill. The owner is told once a part has waited three working days.
 */
export default async function PartsNoHomePage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(role === "owner" || can(role, "managePurchaseOrders") || can(role, "manageWork"))) notFound();
  const { message, error } = await searchParams;
  const [parts, { data: people }] = await Promise.all([partsWithNoHome(), createAdminClient().from("staff").select("id, display_name")]);
  const poIds = Array.from(new Set(parts.map((p) => p.po_id).filter((x): x is string => !!x)));
  const { data: pos } = poIds.length ? await createAdminClient().from("purchase_orders").select("id, number").in("id", poIds) : { data: [] as { id: string; number: string }[] };
  const poNumber = new Map((pos ?? []).map((o) => [o.id, o.number]));
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const canEnd = !staff.viewingAs && (role === "owner" || can(role, "managePurchaseOrders"));
  const isOwner = role === "owner" && !staff.viewingAs;
  const cost = (p: (typeof parts)[number]) => Math.round(Number(p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1) * 100) / 100;
  return (
    <>
      <PageHeader title="Returns and leftovers" subtitle="Not needed, wrong or faulty, or back with Parts: each goes back to the supplier against its LPO, onto the shelf as stock, to scrap, or on the car with the owner's approval." actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {parts.length === 0 ? <Empty title="Every part has a home" /> : null}
      {parts.map((p) => {
        const s = partState(p);
        const plate = p.job?.vehicle ? formatPlate(p.job.vehicle) : p.job?.job_number ?? "";
        return (
          <Card key={p.id} data-no-home={p.id} className={`flex flex-col gap-2 ${s.key === "fit_pending" ? "border-amber-bar" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel right={`since ${formatDateTime(p.since)}`}>{p.description} × {Number(p.confirmed_quantity ?? p.quantity) || 1}</SectionLabel>
              <Badge tone={s.tone}>{s.label}</Badge>
            </div>
            <p className="text-sm">
              {p.job ? <Link href={`/parts/handover/${p.job.id}`} className="font-semibold underline underline-offset-4">{plate} · {p.job.job_number}</Link> : null}
              {p.job?.vehicle ? <span className="text-muted"> · {[p.job.vehicle.make?.name, p.job.vehicle.model?.name].filter(Boolean).join(" ")}</span> : null}
              {p.cost_aed !== null ? <span className="text-muted"> · cost AED {cost(p).toFixed(2)}</span> : null}
              {p.po_id && poNumber.get(p.po_id) ? <span className="text-muted"> · came on {poNumber.get(p.po_id)}</span> : null}
            </p>
            {p.not_needed_reason ? <p className="text-xs text-muted">Not needed: {p.not_needed_reason} ({nameOf.get(p.not_needed_by ?? "") ?? ""}, {formatDateTime(p.not_needed_at)})</p> : null}
            {p.exchange_at ? <p className="text-xs text-muted">{p.exchange_note ? `${p.exchange_note} · ` : ""}wrong or faulty {formatDateTime(p.exchange_at)}{p.replacement_part_id ? " · the correct part is on the Parts desk to order" : ""}</p> : null}
            {p.disposition_note && s.key === "fit_pending" ? <p className="text-xs text-muted">Parts say: {p.disposition_note}</p> : null}
            {s.key === "fit_pending" ? (
              isOwner ? (
                <form action={approveGoodwillAction.bind(null, p.job?.id ?? "")} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="part" value={p.id} />
                  <input type="hidden" name="back" value="/parts/no-home" />
                  <Button type="submit" size="md">Approve: fit it as goodwill (AED {cost(p).toFixed(2)})</Button>
                </form>
              ) : <p className="text-xs font-semibold text-amber">Waiting for the owner.</p>
            ) : canEnd && p.job ? (
              <EndingForm partId={p.id} back="/parts/no-home" action={dispositionAction.bind(null, p.job.id)} />
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
