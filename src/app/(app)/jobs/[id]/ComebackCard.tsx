import Link from "next/link";
import { Badge, Button, Card, ChoiceButtons, Input, SectionLabel, Textarea } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { COMEBACK_CAUSES, COMEBACK_CAUSE_LABELS } from "@/lib/comebacks";
import type { RoleId } from "@/lib/roles";
import type { JobRow } from "@/lib/types";
import { claimFromSupplier, confirmComeback, markComebackAction, setComebackCause } from "../comeback-actions";
import type { ComebackExtra } from "@/lib/comeback-cost";

type Related = { id: string; job_number: string; comeback_cause: string | null; comeback_free: boolean; gated_in_at: string };

/**
 * A car back for a previous job: the link both ways, the cause the manager picks after the inspection,
 * the owner's confirmation and "free of charge", and the claim from the supplier when a part failed.
 */
export function ComebackCard({ jobId, job, role, viewingAs, original, comebacks, inspectionApproved, extra = null, earlier = [] }: { jobId: string; job: JobRow; role: RoleId; viewingAs: boolean; original: Related | null; comebacks: Related[]; inspectionApproved: boolean; /** Comeback at our cost (10 November 2026, Section 9): the reason, the old invoice number, the deduction switch. */ extra?: ComebackExtra | null; earlier?: { id: string; job_number: string; gated_in_at: string }[] }) {
  const isComeback = !!job.comeback_of || !!extra?.originalRef;
  const canMark = !!extra && !isComeback && job.is_open && !viewingAs && ["owner", "service_advisor", "workshop_manager"].includes(role);
  const canCause = (role === "owner" || role === "workshop_manager") && !viewingAs && job.is_open;
  const canConfirm = role === "owner" && !viewingAs && job.is_open;
  const canClaim = (role === "owner" || role === "parts") && !viewingAs;
  const paid = job.comeback_cause === "unrelated" || job.comeback_cause === "customer_caused";
  return (
    <Card id="comeback" className={`flex flex-col gap-3 ${isComeback && !paid ? "border-red-bar" : "border-line"}`} data-comeback-card={isComeback ? (job.comeback_free ? "at_our_cost" : "comeback") : "none"}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>{isComeback ? (paid ? "Return visit" : job.comeback_free ? "Comeback – at our cost" : "Comeback") : comebacks.length ? "Came back" : "Comeback"}</SectionLabel>
        {job.comeback_cause ? <Badge tone={paid ? "outline" : "red"}>{COMEBACK_CAUSE_LABELS[job.comeback_cause]}</Badge> : job.comeback_of ? <Badge tone="amber">Cause not set yet</Badge> : null}
        {job.comeback_free ? <Badge tone="ink">At our cost</Badge> : null}
        {job.comeback_confirmed_at ? <Badge tone="green">Confirmed by the owner</Badge> : null}
      </div>
      {extra?.reason ? <p className="text-sm" data-comeback-reason><span className="font-semibold">What went wrong:</span> {extra.reason}</p> : null}
      {extra?.originalRef ? <p className="text-sm" data-comeback-outside>Original job not in the ERP: invoice <span className="font-semibold">{extra.originalRef}</span>.</p> : null}
      {canMark ? (
        <details data-comeback-mark>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-control border border-ink px-3 text-sm font-bold [&::-webkit-details-marker]:hidden">Comeback – at our cost</summary>
          <form action={markComebackAction.bind(null, jobId)} className="mt-2 flex flex-col gap-2">
            <span className="text-sm font-semibold">The original job (this car&apos;s earlier jobs, found by VIN)</span>
            <ChoiceButtons name="original" columns={2} options={[...earlier.map((j) => ({ value: j.id, label: j.job_number, hint: formatDate(j.gated_in_at) })), { value: "outside", label: "Original job not in the ERP", hint: "Type its old invoice number" }]} />
            <Input name="original_ref" placeholder="Old invoice number (when the original job is not in the ERP)" data-comeback-ref />
            <Textarea name="reason" required minLength={10} rows={2} placeholder="What went wrong, and who did the original work?" data-comeback-reason-box />
            <div><Button type="submit" size="md" data-comeback-mark-save>Send to the owner</Button></div>
          </form>
        </details>
      ) : null}
      {original ? <p className="text-sm">Previous job: <Link href={`/jobs/${original.id}`} className="font-semibold underline underline-offset-4">{original.job_number}</Link> ({formatDate(original.gated_in_at)}). High priority.</p> : null}
      {comebacks.length ? <p className="text-sm">This car came back on {comebacks.map((c) => <span key={c.id}><Link href={`/jobs/${c.id}`} className="font-semibold underline underline-offset-4">{c.job_number}</Link>{c.comeback_cause ? ` (${COMEBACK_CAUSE_LABELS[c.comeback_cause as keyof typeof COMEBACK_CAUSE_LABELS]})` : ""} </span>)}</p> : null}

      {isComeback && canCause && !job.comeback_confirmed_at ? (
        <form action={setComebackCause.bind(null, jobId)} className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-sm font-semibold">What caused it?{inspectionApproved ? "" : " (after the inspection)"}</span>
          <ChoiceButtons name="cause" columns={2} defaultValue={job.comeback_cause ?? undefined} options={COMEBACK_CAUSES.map((c) => ({ value: c, label: COMEBACK_CAUSE_LABELS[c] }))} />
          <div><Button type="submit" tone="secondary" size="md">Save the cause</Button></div>
        </form>
      ) : null}
      {job.comeback_cause_at ? <p className="text-xs text-muted">Cause set {formatDateTime(job.comeback_cause_at)}.</p> : null}

      {isComeback && job.comeback_cause && canConfirm ? (
        <form action={confirmComeback.bind(null, jobId)} className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-sm font-semibold">{job.comeback_confirmed_at ? "Change the decision" : "Owner: confirm the cause and decide"}</span>
          <ChoiceButtons name="free" columns={2} defaultValue={job.comeback_free ? "yes" : "no"} options={[{ value: "yes", label: "At our cost (warranty repair)", hint: "Every line at our cost: the customer sees \"Covered by OFJ warranty – no charge\", nothing invoiced; a line can still be charged" }, { value: "no", label: "The customer pays", hint: "Normal quotation and invoice" }]} />
          {extra ? <ChoiceButtons name="deduct" columns={2} defaultValue={extra.deduct ? "yes" : "no"} options={[{ value: "yes", label: "Take the cost off the original job", hint: "Its profit and its advisor bonus" }, { value: "no", label: "Do not take it off", hint: "The cost stays on this job only" }]} /> : null}
          <Textarea name="note" rows={1} placeholder="Note (optional, logged)" />
          <div><Button type="submit" size="md">{job.comeback_confirmed_at ? "Save" : "Confirm"}</Button></div>
        </form>
      ) : null}

      {job.comeback_of && job.comeback_cause === "faulty_part" && canClaim ? (
        <form action={claimFromSupplier.bind(null, jobId)} className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Claim from the supplier</span>
            <Badge tone={job.comeback_claim_status === "paid" ? "green" : job.comeback_claim_status === "none" ? "neutral" : "amber"}>{job.comeback_claim_status === "none" ? "Not claimed" : job.comeback_claim_status === "to_claim" ? "To claim" : job.comeback_claim_status === "claimed" ? "Claimed, waiting" : "Paid"}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input name="supplier" defaultValue={job.comeback_claim_supplier ?? ""} placeholder="Supplier" />
            <Input name="po" defaultValue={job.comeback_claim_po ?? ""} placeholder="LPO number" />
            <Input name="amount" defaultValue={job.comeback_claim_amount ?? ""} inputMode="decimal" placeholder="Amount (AED)" />
          </div>
          <ChoiceButtons name="status" columns={3} defaultValue={job.comeback_claim_status === "none" ? "to_claim" : job.comeback_claim_status} options={[{ value: "to_claim", label: "To claim" }, { value: "claimed", label: "Claimed" }, { value: "paid", label: "Paid by the supplier" }]} />
          <div><Button type="submit" tone="secondary" size="md">Save the claim</Button></div>
        </form>
      ) : null}
    </Card>
  );
}
