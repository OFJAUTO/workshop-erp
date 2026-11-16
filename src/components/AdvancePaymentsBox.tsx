/**
 * THE PAYMENTS box (16 November 2026, Section 2, the E-00082 case): on every estimate and on the job it becomes. It says
 * what advance was asked (amount and proforma), what came in (amount, date, method, receipt) or NOT RECEIVED YET in red,
 * and the balance, with the one button to record it (owner and accounts) or to tell accounts (everyone else).
 */
import Link from "next/link";
import { Card, SectionLabel } from "@/components/ui";
import { Money } from "@/components/Money";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { PaymentReportButton } from "@/components/PaymentReport";
import { formatDate } from "@/lib/format";
import type { AdvancePayments } from "@/lib/advance-payments";

export function AdvancePaymentsBox({ box, place, jobId = null, canRecord, recordReadOnly, canReport, jobBalance = null }: {
  box: AdvancePayments;
  /** Where the box sits: on the estimate page (links to the job when the money moved there) or on the job card. */
  place: "estimate" | "job";
  jobId?: string | null;
  canRecord: boolean;
  recordReadOnly: boolean;
  canReport: boolean;
  /** On the job card: the job's own balance (the final bill), when known. */
  jobBalance?: number | null;
}) {
  const movedToJob = place === "estimate" && box.job && !box.job.booked;
  const red = box.state === "not_received";
  const fullyPaid = box.total > 0.004 && box.totalLeft <= 0.004;
  const reportBalance = box.advanceLeft > 0.004 ? box.advanceLeft : box.totalLeft > 0.004 ? box.totalLeft : null;
  return (
    <Card className={`flex flex-col gap-3 ${red ? "border-red" : box.state === "received" ? "border-green" : ""}`} data-advance-box={place} data-advance-state={box.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>Payments{box.numbers.length ? ` · ${box.numbers.join(", ")}` : ""}</SectionLabel>
        {movedToJob && box.job ? (
          <Link href={`/jobs/${box.job.id}#money`} className="text-sm font-bold underline underline-offset-4" data-advance-job-link>
            Payments are on {box.job.number}
          </Link>
        ) : place === "estimate" && box.job?.booked ? (
          <span className="text-sm text-muted" data-advance-held>Held as {box.job.number} (car not here yet) · the money follows the car</span>
        ) : null}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Advance requested</dt>
        <dd data-advance-requested={box.requested.toFixed(2)}>
          {box.asks.length ? (
            <span className="flex flex-col gap-0.5">
              {box.asks.map((a) => (
                <span key={a.id} data-advance-ask={a.number}>
                  <Money amount={a.amount} /> · proforma <span className="whitespace-nowrap font-bold">{a.number}</span> · {formatDate(a.at)}{a.complete ? " (the whole bill)" : ""}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted">No proforma yet{box.total > 0.004 ? <> · estimate total <Money amount={box.total} /></> : null}</span>
          )}
        </dd>

        <dt className="text-muted">Received</dt>
        <dd data-advance-received={box.received.toFixed(2)}>
          {box.receipts.length ? (
            <span className="flex flex-col gap-0.5">
              {box.receipts.map((r) => (
                <span key={r.id} data-advance-receipt={r.number} className={r.pending ? "text-amber-text" : ""}>
                  <Money amount={r.amount} /> · {formatDate(r.at)} · {r.method} · receipt <span className="whitespace-nowrap font-bold">{r.number}</span>
                  {r.invoiceNumber ? <> · {r.invoiceNumber.startsWith("kept") ? r.invoiceNumber : <>tax invoice <span className="whitespace-nowrap">{r.invoiceNumber}</span></>}</> : null}
                  {r.pending ? " · waiting for the bank" : ""}
                </span>
              ))}
            </span>
          ) : (
            <span className="font-bold text-red" data-advance-not-received>NOT RECEIVED YET</span>
          )}
        </dd>

        <dt className="text-muted">Balance</dt>
        <dd className="flex flex-col gap-0.5" data-advance-balance={(jobBalance ?? box.totalLeft).toFixed(2)}>
          {box.requested > 0.004 ? (
            <span data-advance-left={box.advanceLeft.toFixed(2)}>
              Advance still to receive: <strong className={box.advanceLeft > 0.004 ? "text-red" : "text-green-text"}><Money amount={box.advanceLeft} /></strong>
            </span>
          ) : null}
          <span>
            {place === "job" && jobBalance !== null ? "Left to pay on the job" : "Left to pay on the estimate"}: <strong><Money amount={place === "job" && jobBalance !== null ? jobBalance : box.totalLeft} /></strong>
            {box.total > 0.004 ? <span className="text-muted"> (of <Money amount={box.total} />)</span> : null}
          </span>
          {box.pending > 0.004 ? <span className="text-amber-text">Plus <Money amount={box.pending} /> waiting for the bank (not counted yet)</span> : null}
          {box.extra > 0.004 ? <span data-advance-extra>Paid <Money amount={box.extra} /> more than asked: kept as the customer&apos;s advance.</span> : null}
        </dd>
      </dl>

      {!fullyPaid && !movedToJob ? (
        <div className="flex flex-wrap gap-2">
          {canRecord || recordReadOnly ? (
            <RecordPaymentButton
              label="Record advance payment"
              customerId={box.customerId}
              vehicleId={box.vehicleId}
              jobId={place === "job" ? jobId : null}
              estimateId={place === "estimate" ? box.estimateId : null}
              readOnly={recordReadOnly}
              size="md"
            />
          ) : null}
          {canReport && !canRecord && !recordReadOnly ? (
            <PaymentReportButton
              label="Tell accounts: payment received"
              jobId={place === "job" ? jobId : null}
              estimateId={place === "estimate" ? box.estimateId : null}
              balance={reportBalance}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
