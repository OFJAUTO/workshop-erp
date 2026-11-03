import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { partsWithNoHome } from "@/lib/handover";
import { partState } from "@/lib/part-state";
import { CREDIT_NOTE_LATE_DAYS, daysWaiting, endingsFor, isExchanging, type EndingPart } from "@/lib/part-endings";
import { creditNotesAwaited } from "@/lib/part-endings-server";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { approveGoodwillAction, creditNoteAction, dispositionAction } from "../handover-actions";
import { CreditNoteForm, EndingForm, EndingResultHost } from "../handover/[jobId]/PartActions";

export const dynamic = "force-dynamic";

/**
 * The owner's list (Parts see it too): every part with no home across the workshop, not needed, wrong or faulty, or
 * back with Parts, with nothing decided yet; the parts waiting for the owner's goodwill approval; and (3 November 2026)
 * every part returned to a supplier whose credit note has not come yet - tracked here until it is recorded. Parts give
 * each an ending; the owner approves fitting a part as goodwill. The owner is told once a part has waited three working
 * days.
 */
export default async function PartsNoHomePage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(role === "owner" || can(role, "managePurchaseOrders") || can(role, "manageWork"))) notFound();
  const { message, error } = await searchParams;
  const [parts, awaited, { data: people }] = await Promise.all([partsWithNoHome(), creditNotesAwaited(), createAdminClient().from("staff").select("id, display_name")]);
  const poIds = Array.from(new Set(parts.map((p) => p.po_id).filter((x): x is string => !!x)));
  const { data: pos } = poIds.length ? await createAdminClient().from("purchase_orders").select("id, number").in("id", poIds) : { data: [] as { id: string; number: string }[] };
  const poNumber = new Map((pos ?? []).map((o) => [o.id, o.number]));
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const canEnd = !staff.viewingAs && (role === "owner" || can(role, "managePurchaseOrders"));
  const isOwner = role === "owner" && !staff.viewingAs;
  const cost = (p: (typeof parts)[number]) => Math.round(Number(p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1) * 100) / 100;
  // A server page: rendered once per request, the clock is read once.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const awaitedTotal = awaited.reduce((a, r) => a + r.value, 0);
  // The car link opens a page this person can open: the Parts page for Parts, the owner and advisors; the handover page
  // for a workshop manager (the Parts page is not his).
  const carHref = (jobId: string) => (can(role, "priceParts") || can(role, "editQuotes") ? `/parts/${jobId}` : `/parts/handover/${jobId}`);
  return (
    <>
      {/* An ending's result and the message for the supplier open here: the card that was tapped has left the list. */}
      <EndingResultHost />
      <PageHeader title="Returns and leftovers" subtitle="Not needed, wrong or faulty, or back with Parts: each is cancelled with the supplier, goes back to the supplier against its LPO, onto the shelf as stock, to scrap, or on the car with the owner's approval. Returns wait here for their credit note." actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {awaited.length ? (
        <Card className="flex flex-col gap-3 border-amber-bar" data-credit-notes-awaited>
          <SectionLabel right={`${awaited.length} · AED ${awaitedTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}>Waiting for a supplier credit note</SectionLabel>
          <p className="text-xs text-muted">Each part went back to its supplier. Chase the supplier, then record the credit note (number or scan): the return is complete and becomes a supplier credit in Zoho Books.</p>
          <ul className="flex flex-col gap-3">
            {awaited.map((r) => {
              const days = daysWaiting(r.since, now);
              const plate = r.car ? formatPlate(r.car) : r.jobNumber;
              return (
                <li key={r.id} id={`cn-${r.id}`} className="flex flex-col gap-2 rounded-control border border-line p-3" data-credit-note-awaited={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold uppercase">{r.description} × {r.qty}</span>
                    <Badge tone={days >= CREDIT_NOTE_LATE_DAYS ? "amber" : "neutral"}>{days === 0 ? "Returned today" : `Waiting ${days} day${days === 1 ? "" : "s"}`}</Badge>
                  </div>
                  <p className="text-sm">
                    <Link href={carHref(r.jobId)} className="font-semibold underline underline-offset-4">{plate} · {r.jobNumber}</Link>
                    {r.supplier ? <span className="text-muted"> · {r.supplier}</span> : null}
                    {r.lpo && r.lpoId ? <> · <Link href={`/parts/orders/${r.lpoId}`} className="underline underline-offset-4">{r.lpo}</Link></> : null}
                    <span className="text-muted"> · AED {r.value.toFixed(2)} to be credited</span>
                  </p>
                  <p className="text-xs text-muted">Returned by {r.by ?? "Parts"} on {formatDate(r.since)}{r.reason ? ` · ${r.reason}` : ""}</p>
                  {canEnd ? <CreditNoteForm partId={r.id} back="/parts/no-home" action={creditNoteAction.bind(null, r.jobId)} /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {parts.length === 0 && !awaited.length ? <Empty title="Every part has a home" /> : null}
      {parts.map((p) => {
        const s = partState(p);
        const plate = p.job?.vehicle ? formatPlate(p.job.vehicle) : p.job?.job_number ?? "";
        // A part not needed takes THE endings (one replaced by another supplier's part too); only a wrong or faulty part
        // in its exchange keeps its own (null here).
        const endings = isExchanging(p as unknown as EndingPart) ? null : endingsFor(p as unknown as EndingPart);
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
              <div className="flex flex-col gap-2">
                {isOwner ? (
                  <form action={approveGoodwillAction.bind(null, p.job?.id ?? "")} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="part" value={p.id} />
                    <input type="hidden" name="back" value="/parts/no-home" />
                    <Button type="submit" size="md" data-goodwill-approve>Approve: fit it as goodwill (AED {cost(p).toFixed(2)})</Button>
                  </form>
                ) : <p className="text-xs font-semibold text-amber">Waiting for the owner.</p>}
                {/* Not fitted after all: the request is replaced by its real ending. */}
                {canEnd && p.job && endings && !endings.refusal ? <EndingForm partId={p.id} back="/parts/no-home" action={dispositionAction.bind(null, p.job.id)} endings={endings} /> : null}
              </div>
            ) : canEnd && p.job ? (
              <EndingForm partId={p.id} back="/parts/no-home" action={dispositionAction.bind(null, p.job.id)} endings={endings} />
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
