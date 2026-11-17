import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { partChangeView } from "@/lib/part-change";
import { Badge, Button, Card, Input, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { decidePartChangeAction } from "../../part-change-actions";

/**
 * ONE supplier change to approve (17 November 2026, Section 4): the bell's link. The whole decision on one page - the
 * part, old and new supplier and price, the difference, delivery time, the profit on the line before and after, the
 * reason - with Approve / Refuse right under it. The job's advisor decides a dearer change that still makes the minimum
 * markup; the owner decides the rest (below the minimum, another part type, a new customer price).
 */
export default async function PartChangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  if (!["owner", "parts", "service_advisor"].includes(staff.role_id)) return refuse("no_permission");
  const { id } = await params;
  const sp = await searchParams;
  const c = await partChangeView(id);
  if (!c) notFound();
  const mayDecide = !staff.viewingAs && c.status === "pending" && (staff.role_id === "owner" || (c.approver === "advisor" && staff.role_id === "service_advisor" && c.advisorIds.includes(staff.id)));
  const who = c.approver === "owner" ? "the owner" : c.approver === "advisor" ? "the advisor in charge of this car" : "nobody";
  return (
    <div className="flex max-w-2xl flex-col gap-4" data-part-change-page>
      <PageHeader title={`Supplier change · ${c.partName}`} subtitle={`${c.jobNumber} · decided by ${who}`} actions={<Link href={`/jobs/${c.jobId}`} className="text-sm font-bold underline underline-offset-4">Open the job</Link>} />
      <Card className="flex flex-col gap-2" data-part-change-decision>
        <SectionLabel right={<Badge tone={c.status === "pending" ? "amber" : c.status === "applied" ? "green" : "neutral"}>{c.status === "pending" ? "Waiting" : c.status === "applied" ? "Approved" : "Refused"}</Badge>}>The decision</SectionLabel>
        <ul className="flex flex-col gap-1 text-sm">
          {c.lines.map((l) => <li key={l} data-part-change-line>{l}</li>)}
          <li data-part-change-reason><b>Why:</b> {c.reason}</li>
          {c.choice === "keep" ? <li className="font-semibold">Keep the customer&apos;s price: we absorb AED {(c.absorb ?? 0).toFixed(2)}.</li> : c.choice === "revise" ? <li className="font-semibold">Revise the quotation: the customer approves the new price.</li> : null}
        </ul>
        {c.decisionNote ? <p className="text-xs text-muted">Note: {c.decisionNote}</p> : null}
      </Card>
      <div id="decide" className="flex flex-col gap-2 scroll-mt-24">
        {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
        {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
        {mayDecide ? (
          <Card className="flex flex-col gap-3" data-part-change-actions>
            <form action={decidePartChangeAction.bind(null, c.id, true)}>
              <Button type="submit" size="lg" data-part-change-approve>Approve the change</Button>
            </form>
            <form action={decidePartChangeAction.bind(null, c.id, false)} className="flex flex-wrap items-center gap-2">
              <Input name="note" placeholder="Why not? (optional)" className="w-72" textCase="sentence" aria-label="Why it is refused" />
              <Button type="submit" size="lg" tone="secondary" data-part-change-refuse>Refuse</Button>
            </form>
          </Card>
        ) : c.status === "pending" ? (
          <p className="text-sm text-muted" data-part-change-not-yours>Waiting for {who}.</p>
        ) : null}
      </div>
    </div>
  );
}
