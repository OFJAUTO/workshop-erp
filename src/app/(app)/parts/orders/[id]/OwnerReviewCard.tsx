import { Button, Card, Input, SectionLabel, Textarea } from "@/components/ui";

/**
 * LPO "SEND FOR OWNER APPROVAL" (10 November 2026, Section 4): the accounts note at the top of the LPO page, the
 * owner's three answers (Approve · Refuse with a reason · Reply to accounts) and the whole log.
 */
type Entry = { id: string; lines: string[]; open: boolean; supplier: string | null; status: "waiting" | "replied" | "decided"; auto: boolean };

export function OwnerReviewCard({ action, entries, isOwner, pending }: { action: (formData: FormData) => void; entries: Entry[]; isOwner: boolean; pending: boolean }) {
  if (!entries.length) return null;
  const open = entries.filter((e) => e.open);
  return (
    <Card className={`flex flex-col gap-2 ${open.some((e) => e.status === "waiting") ? "border-2 border-amber-bar" : ""}`} id="owner-review" data-owner-review={open.length ? open[open.length - 1].status : "closed"}>
      <SectionLabel>{open.some((e) => e.status === "waiting") ? "Waiting for owner" : "Owner approval"}</SectionLabel>
      {entries.map((e) => (
        <div key={e.id} className="flex flex-col gap-2 rounded-control border border-line bg-white px-3 py-2" data-owner-review-entry={e.status} data-owner-review-supplier={e.supplier ?? ""}>
          {e.supplier ? <span className="text-xs font-bold uppercase tracking-[0.06em] text-muted">{e.supplier}</span> : null}
          <ul className="flex flex-col gap-1 text-sm">
            {e.lines.map((l, i) => <li key={i} className={i === 0 ? "font-semibold" : ""} data-owner-review-line>{l}</li>)}
          </ul>
          {e.status === "waiting" && isOwner && pending ? (
            <div className="flex flex-col gap-2 border-t border-line pt-2" data-owner-options>
              <form action={action} className="flex flex-wrap items-center gap-2">
                {e.supplier ? <input type="hidden" name="supplier" value={e.supplier} /> : null}
                <input type="hidden" name="decision" value="approve" />
                <Input name="note" placeholder="Answer to accounts (optional)" className="min-w-[14rem] flex-1" textCase="sentence" aria-label="Answer with the approval" />
                <Button type="submit" size="md" data-owner-approve>Approve{e.supplier ? ` ${e.supplier}` : ""}</Button>
              </form>
              <form action={action} className="flex flex-wrap items-center gap-2">
                {e.supplier ? <input type="hidden" name="supplier" value={e.supplier} /> : null}
                <input type="hidden" name="decision" value="refuse" />
                <Input name={e.supplier ? "reason" : "note"} required minLength={3} placeholder="Why is it refused?" className="min-w-[14rem] flex-1" textCase="sentence" aria-label="Why it is refused" data-owner-refuse-reason />
                <Button type="submit" size="md" tone="danger" data-owner-refuse>Refuse</Button>
              </form>
              <form action={action} className="flex flex-col gap-2">
                <input type="hidden" name="decision" value="reply" />
                <input type="hidden" name="review_id" value={e.id} />
                <Textarea name="reply" required minLength={2} rows={2} placeholder="Reply to accounts: they decide it with your answer" data-owner-reply-text />
                <Button type="submit" size="md" tone="secondary" className="self-start" data-owner-reply>Reply to accounts</Button>
              </form>
              <p className="text-xs text-muted">A missing deposit or a line with no real price still needs the Approve box below.</p>
            </div>
          ) : null}
          {e.status === "waiting" && !isOwner ? <p className="text-xs text-muted" data-owner-waiting-words>With the owner. You get a bell with his decision or answer.</p> : null}
          {e.status === "replied" && !isOwner ? <p className="text-xs font-semibold" data-owner-replied-words>The owner replied: approve, refuse or send it to him again below.</p> : null}
        </div>
      ))}
    </Card>
  );
}

/** Accounts: the third choice next to Approve / Refuse, with the compulsory note. */
export function SendForOwner({ action, supplier }: { action: (formData: FormData) => void; supplier?: string | null }) {
  return (
    <details data-send-owner={supplier ?? ""}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-control border border-ink px-3 text-sm font-bold [&::-webkit-details-marker]:hidden">Send for owner approval</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        {supplier ? <input type="hidden" name="supplier" value={supplier} /> : null}
        <input type="hidden" name="decision" value="owner" />
        <Textarea name="owner_note" required minLength={3} rows={2} placeholder="What are you unsure about?" aria-label="What are you unsure about?" data-owner-note />
        <Button type="submit" size="md" className="self-start" data-send-owner-save>Send to the owner</Button>
      </form>
    </details>
  );
}
