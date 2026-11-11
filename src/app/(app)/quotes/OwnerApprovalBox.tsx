import { Button, Card, SectionLabel, Textarea } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { aed, revisionRowRed, revisionRowWarning, type QuoteRow, type RevisionPreviewRow } from "@/lib/quotes";
import { decideQuoteApproval, decideRevision } from "./actions";

/** Who gave the labour discount: the editor's words and the box follow them (B3). */
export async function discountByOf(q: Pick<QuoteRow, "discount_set_by">): Promise<{ name: string; owner: boolean } | null> {
  if (!q.discount_set_by) return null;
  const { data } = await createAdminClient().from("staff").select("display_name, role_id").eq("id", q.discount_set_by).maybeSingle();
  return data ? { name: data.display_name as string, owner: data.role_id === "owner" } : null;
}

/**
 * THE owner's approval box (B3), on the job quotation and the estimate page alike: shown while the quotation waits for
 * the owner (his own discount is never one of the reasons - it needs no approval), with the reason in the exact words
 * saved at sending and the advisor who gave the discount; and, on a job quotation, the revision request. The reason
 * goes back with the answer, so a box left open never approves figures that changed since.
 */
export function OwnerApprovalBox({ q, mayApprove, discountBy, approveFocus = false, revision = null }: { q: Pick<QuoteRow, "id" | "status" | "owner_approval_reason">; mayApprove: boolean; discountBy: { name: string; owner: boolean } | null; approveFocus?: boolean; revision?: { pending: boolean; requesterName: string | null; kind: string | null; reason: string | null; /** What allowing would put on the new version, part by part (2 November 2026). */ preview?: RevisionPreviewRow[]; /** Every part the Parts request names was taken off since: allowing closes it. */ allGone?: boolean } | null }) {
  const preview = revision?.preview ?? [];
  const reds = preview.filter(revisionRowRed);
  const waiting = q.status === "pending_owner";
  if (!mayApprove || (!waiting && !revision?.pending)) return null;
  return (
    <Card className="flex flex-col gap-3 border-ink" data-owner-box>
      {waiting ? (
        <>
          <SectionLabel>Owner&apos;s approval</SectionLabel>
          <p className="text-sm" data-owner-box-reason>{q.owner_approval_reason ?? "The quotation is above an advisor's limit."}{discountBy && !discountBy.owner && (q.owner_approval_reason ?? "").includes("discount") ? <span className="text-muted"> · discount given by {discountBy.name}</span> : null}</p>
          <form action={decideQuoteApproval.bind(null, q.id)} className="flex flex-col gap-2">
            <input type="hidden" name="seen" value={q.owner_approval_reason ?? ""} />
            <Textarea name="note" rows={2} placeholder="Note to the advisor (optional)" />
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="approve" size="md" autoFocus={approveFocus} data-owner-approve>Approve</Button>
              <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Ask for changes</Button>
            </div>
          </form>
        </>
      ) : null}
      {revision?.pending ? (
        <>
          <SectionLabel>Revision requested</SectionLabel>
          <p className="text-sm"><span className="font-semibold">{revision.requesterName ?? (revision.kind === "parts" ? "Parts" : "The advisor")}</span>: {revision.reason}</p>
          {revision.allGone ? <p className="text-sm text-muted" data-revision-empty>Nothing left to change: every part behind this request was taken off by Parts. Allowing closes the request.</p> : preview.length ? <RevisionPreview rows={preview} /> : revision.kind === "parts" ? <p className="text-sm text-muted" data-revision-empty>No price, quantity or charge is waiting: allowing makes a new version for the advisor to check and send.</p> : null}
          {reds.length ? (
            <div className="rounded-control border border-red-bar bg-red-soft px-3 py-2 text-sm font-bold text-red" data-revision-red>
              {reds.map((r) => <p key={r.partId}>{revisionRowWarning(r)}</p>)}
            </div>
          ) : null}
          <p className="text-xs text-muted">The customer approved this quotation. Allow one revision, or decline.</p>
          <form action={decideRevision.bind(null, q.id)} className="flex flex-col gap-2">
            <Textarea name="note" rows={2} placeholder={reds.length ? "Why you allow it anyway (needed, it is logged)" : "Note (optional)"} required={reds.length > 0} minLength={reds.length ? 5 : undefined} data-revision-note />
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="allow" size="md" data-revision-allow>Allow one revision</Button>
              <Button type="submit" name="decision" value="decline" tone="secondary" size="md" formNoValidate data-revision-decline>Decline</Button>
            </div>
          </form>
        </>
      ) : null}
    </Card>
  );
}

/** The parts behind a revision request, with every figure labelled: list, discount, cost, and the selling price each would get. */
export function RevisionPreview({ rows }: { rows: RevisionPreviewRow[] }) {
  const money = (n: number | null) => (n === null ? "—" : aed(n));
  // One block per part, the four figures labelled in two columns: the owner's box is narrow (a side column on a
  // computer, the whole width on a phone), and a five-column table hid the selling price off to the side.
  const figure = (label: string, value: React.ReactNode, hook: Record<string, string>, strong = false) => (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs font-bold uppercase tracking-[0.06em] text-muted">{label}</span>
      <span className={`${strong ? "font-semibold" : ""}`} {...hook}>{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col divide-y divide-line text-xs" data-revision-preview>
      {rows.map((r) => {
        const red = revisionRowRed(r);
        return (
          <div key={r.partId + r.kind} className={`flex flex-col gap-1.5 py-2 ${red ? "text-red" : ""}`} data-revision-row={r.kind} data-revision-row-red={red ? "1" : undefined}>
            <div>
              <span className="font-semibold">{r.title}</span>
              <span className="block text-muted">{r.kind === "added" ? "Added" : r.kind === "charge" ? "Early charge" : r.kind === "changed" ? `Changed${r.oldCost !== null && r.oldCost !== r.cost ? ` (cost was ${aed(r.oldCost)})` : ""}` : "Taken off"}{r.qty > 1 ? ` · qty ${r.qty}` : ""}{r.supplier ? ` · ${r.supplier}` : ""}</span>
              {r.changes?.length ? <span className="block text-muted" data-revision-changes>{r.changes.join(" · ")}</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {figure("List", money(r.list), { "data-revision-list": "" })}
              {figure("Discount", r.discount === null ? "—" : `${r.discount}%`, { "data-revision-discount": "" })}
              {figure("Cost", money(r.cost), { "data-revision-cost": "" }, true)}
              {figure("Selling price", r.kind === "removed" ? "off the quotation" : <><span className="font-semibold">{money(r.sell)}</span>{r.markupWords ? <span className="block text-muted">{r.markupWords}</span> : null}</>, { "data-revision-sell": "" })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
