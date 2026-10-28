import { Button, Card, SectionLabel, Textarea } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuoteRow } from "@/lib/quotes";
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
export function OwnerApprovalBox({ q, mayApprove, discountBy, approveFocus = false, revision = null }: { q: Pick<QuoteRow, "id" | "status" | "owner_approval_reason">; mayApprove: boolean; discountBy: { name: string; owner: boolean } | null; approveFocus?: boolean; revision?: { pending: boolean; requesterName: string | null; kind: string | null; reason: string | null } | null }) {
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
          <p className="text-xs text-muted">The customer approved this quotation. Allow one revision, or decline.</p>
          <form action={decideRevision.bind(null, q.id)} className="flex flex-col gap-2">
            <Textarea name="note" rows={2} placeholder="Note (optional)" />
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="allow" size="md" data-revision-allow>Allow one revision</Button>
              <Button type="submit" name="decision" value="decline" tone="secondary" size="md" data-revision-decline>Decline</Button>
            </div>
          </form>
        </>
      ) : null}
    </Card>
  );
}
