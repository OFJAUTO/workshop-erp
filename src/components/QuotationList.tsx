import Link from "next/link";
import { newQuotation, reviseQuotation } from "@/app/(app)/quotes/actions";
import { aed } from "@/lib/quotes";
import { quoteMoney, statusWords, type QuoteFamily } from "@/lib/quote-history";
import { QuoteVersionSelect } from "./QuoteVersionSelect";
import { Button, LinkButton } from "./ui";

/**
 * THE list of a job's quotations (29 October 2026, batch section 1), oldest first: every number with its role
 * (ORIGINAL / ADDITIONAL), amount, status, a versions dropdown (old versions open read-only) and Open / PDF /
 * Revise; the money under it; New quotation at the bottom. Nothing here ever hides an earlier quotation.
 * The same list shows a car's ESTIMATES (30 October 2026, `kind="estimate"`) on the car and customer pages: each
 * with its versions, ADDITIONAL with the estimate it adds to, and the job it was carried over to at gate-in.
 */
const REVISABLE = ["sent", "opened", "expired", "declined", "urgent_requested"];
const PREPARING = ["draft", "pending_owner"];
const CHIP: Record<QuoteFamily["role"], string | null> = { original: "ORIGINAL", additional: "ADDITIONAL", single: null };

export function QuotationList({ jobId, families, canQuote, jobOpen, kind = "quotation" }: { jobId?: string; families: QuoteFamily[]; canQuote: boolean; jobOpen: boolean; kind?: "quotation" | "estimate" }) {
  if (!families.length) return null;
  const estimates = kind === "estimate";
  const money = quoteMoney(families);
  const preparing = families.find((f) => PREPARING.includes(f.current.status));
  const openHref = (id: string) => (estimates ? `/estimates/${id}` : `/jobs/${jobId}/quote/${id}`);
  return (
    <div className="flex flex-col gap-2" data-quotation-list={families.length} data-list-kind={kind}>
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line bg-white">
        {families.map((f) => {
          const c = f.current;
          const approved = c.status === "approved";
          const chip = CHIP[f.role];
          return (
            <li key={f.number} className="flex flex-col gap-1.5 px-3 py-2.5" data-quote-row={f.number} data-quote-role={f.role} data-quote-status={c.status}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-extrabold whitespace-nowrap">{f.number}</span>
                {chip ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-[0.08em] whitespace-nowrap ${f.role === "original" ? "bg-ink text-white" : "border border-ink text-ink"}`}>{chip}</span> : null}
                {f.addsTo ? <span className="text-xs font-semibold text-muted whitespace-nowrap" data-quote-adds-to={f.addsTo}>in addition to {f.addsTo}</span> : null}
                <span className="ml-auto text-sm font-extrabold whitespace-nowrap" data-quote-amount>{aed(f.amount)}</span>
              </div>
              <span className={`text-xs font-semibold ${approved ? "text-green" : c.status === "declined" || c.status === "expired" || c.status === "cancelled" ? "text-red" : "text-muted"}`} data-quote-words>
                {estimates && approved ? statusWords(c).replace(/^Approved/, "Accepted") : statusWords(c)}
                {f.versions.length > 1 ? ` · v${c.version} of ${f.versions.length}` : ""}
                {f.carriedTo ? (
                  <>
                    {" · carried over to "}
                    <Link href={`/jobs/${f.carriedTo.id}`} className="underline underline-offset-4 whitespace-nowrap" data-quote-carried={f.carriedTo.number}>{f.carriedTo.number}</Link>
                  </>
                ) : null}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <QuoteVersionSelect jobId={jobId} base={estimates ? "/estimates/" : undefined} versions={f.versions.map((v) => ({ id: v.id, version: v.version, status: v.status }))} selectedId={c.id} />
                <LinkButton href={openHref(c.id)} tone={PREPARING.includes(c.status) && canQuote ? "primary" : "secondary"} size="md" data-quote-open={f.number}>
                  Open
                </LinkButton>
                <a href={`/api/pdf/quotation/${c.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold hover:bg-canvas" data-quote-pdf={f.number}>
                  PDF
                </a>
                {canQuote && !estimates && REVISABLE.includes(c.status) ? (
                  <form action={reviseQuotation.bind(null, c.id)}>
                    <Button type="submit" tone="secondary" size="md" data-quote-revise={f.number}>Revise</Button>
                  </form>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs font-semibold" data-quote-money>
        <span className="text-green">{estimates ? "Accepted" : "Approved"} so far {aed(money.approved)}</span>
        <span className="text-muted"> · </span>
        <span className={money.waiting > 0 ? "text-amber" : "text-muted"}>Waiting for {estimates ? "the customer" : "approval"} {aed(money.waiting)}</span>
        <span className="text-muted"> · </span>
        <span className={money.declined > 0 ? "text-red" : "text-muted"}>Declined {aed(money.declined)}</span>
      </p>
      {canQuote && jobOpen && !estimates && jobId ? (
        preparing ? (
          <span className="text-xs text-muted" data-new-quote-wait>Finish <Link href={openHref(preparing.current.id)} className="font-semibold underline underline-offset-4">{preparing.number}</Link> first: one quotation is prepared at a time.</span>
        ) : (
          <form action={newQuotation.bind(null, jobId)} className="flex flex-col gap-1">
            <Button type="submit" tone="secondary" size="md" data-new-quotation>New quotation</Button>
            <span className="text-xs text-muted">For extra work: an additional quotation. The ones above stay as they are.</span>
          </form>
        )
      ) : null}
    </div>
  );
}
