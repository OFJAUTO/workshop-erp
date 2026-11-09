import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, SectionLabel } from "@/components/ui";
import { QuoteVersionSelect } from "@/components/QuoteVersionSelect";
import { formatDate, formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, aed, type QuoteStatus } from "@/lib/quotes";

export type QuoteListRow = {
  id: string;
  number: string;
  version: number;
  status: QuoteStatus;
  href: string;
  total: number;
  sentAt: string | null;
  createdAt: string;
  validUntil: string | null;
  cancelReason: string | null;
  carried: boolean;
  additionalTo: string | null;
  jobNumber: string | null;
  car: string;
  customer: string | null;
  /** The advisor in charge: the one who started it, whoever made the newest version. */
  leadId: string | null;
  leadName: string | null;
  /** "Edited by Omar – check and send" with what changed, while it stands. */
  handback: { words: string; summary: string } | null;
  /** Money from the estimate (4 November 2026): "Prepaid" / "Part paid · AED X of Y" / "Proforma sent – unpaid". */
  money?: { badge: string | null; tone: "green" | "amber" | null; words: string | null } | null;
  followUp: boolean;
  versions: { id: string; version: number; status: string; by?: string | null }[];
  versionBase: string;
  menu?: ReactNode;
};

type Key = "owner" | "ready" | "sent" | "opened" | "noreply" | "draft" | "accepted" | "carried" | "declined" | "closed";

/** Which section a row sits in (1 November 2026): the owner's approval, ready to send, sent, opened, being prepared, then the rest. */
export function bucketOf(r: QuoteListRow): Key {
  if (r.carried && r.status !== "cancelled") return "carried";
  if (r.status === "pending_owner") return "owner";
  if (r.handback && r.status === "draft") return "ready";
  if (r.status === "approved") return "accepted";
  if (r.status === "expired" || r.status === "cancelled") return "closed";
  if (r.status === "declined") return "declined";
  if (r.followUp) return "noreply";
  if (r.status === "opened" || r.status === "urgent_requested") return "opened";
  if (r.status === "sent") return "sent";
  return "draft";
}

/** Who the row waits on, in a few words ("Waiting on Omar", "Waiting on the customer"). */
function waitingOn(key: Key, r: QuoteListRow, ownerName: string, acceptedWords: string): string | null {
  const lead = r.leadName ?? "the advisor";
  switch (key) {
    case "owner": return `Waiting on ${ownerName} (approval)`;
    case "ready": return `Waiting on ${lead}: check and send`;
    case "sent": return "Waiting on the customer";
    case "opened": return "Opened · waiting on the customer";
    case "noreply": return `Waiting on ${lead}: follow up`;
    case "draft": return `Being prepared · ${lead}`;
    case "accepted": return acceptedWords;
    default: return null;
  }
}

const tone = (s: QuoteStatus) => (s === "approved" ? "green" : s === "declined" || s === "expired" ? "red" : s === "draft" || s === "cancelled" ? "outline" : "amber");

/**
 * THE list of estimates or quotations in sections (1 November 2026): Waiting for owner approval · Ready to send ·
 * Sent · Opened by the customer · No reply · Being prepared, then accepted, carried over, declined and the folded
 * cancelled/expired. Every row says who it waits on, the person's own rows come first, and the whole row opens it.
 */
export function QuoteListSections({ rows, me, ownerName, noun, acceptedWords }: { rows: QuoteListRow[]; me: string; ownerName: string; noun: "estimate" | "quotation"; acceptedWords: string }) {
  const sections: { key: Key; title: string; folded?: boolean }[] = [
    { key: "owner", title: "Waiting for owner approval" },
    { key: "ready", title: "Ready to send (approved or edited by the owner)" },
    { key: "sent", title: "Sent" },
    { key: "opened", title: "Opened by the customer" },
    { key: "noreply", title: "No reply: follow up" },
    { key: "draft", title: "Being prepared" },
    { key: "accepted", title: noun === "estimate" ? "Accepted" : "Approved by the customer" },
    { key: "carried", title: "Carried over to a job" },
    { key: "declined", title: "Declined" },
    { key: "closed", title: "Cancelled / expired", folded: true },
  ];
  return (
    <>
      {sections.map((s) => {
        // The person's own first, then newest first (the rows arrive newest first).
        const items = rows.filter((r) => bucketOf(r) === s.key).map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.leadId === me) - Number(a.r.leadId === me) || a.i - b.i).map((x) => x.r);
        if (!items.length) return null;
        const cards = items.map((r) => {
          const wait = waitingOn(s.key, r, ownerName, acceptedWords);
          return (
            <Card key={r.id} className={`relative !p-0 hover:border-ink ${s.key === "noreply" ? "border-amber-bar" : ""} ${s.key === "ready" ? "!border-ink" : ""}`} data-estimate-row={r.number} data-quote-list-row={r.number} data-estimate-status={r.status} data-list-section={s.key} data-mine={r.leadId === me ? "true" : "false"}>
              <Link href={r.href} aria-label={`Open ${r.number}`} className="absolute inset-0 z-0 rounded-card" data-overlap-ok data-quote-list-open />
              <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
                <span className="font-extrabold">{r.number}</span>
                {r.jobNumber ? <span className="text-sm font-semibold text-muted">{r.jobNumber}</span> : null}
                <span className="font-semibold">{r.car}</span>
                {r.customer ? <span className="text-sm text-muted">{r.customer}</span> : null}
                <Badge tone={r.handback && s.key === "ready" ? "green" : tone(r.status)}>{r.handback && s.key === "ready" ? r.handback.words : QUOTE_STATUS_LABELS[r.status]}</Badge>
                {r.additionalTo !== null ? <span className="rounded-full border border-ink px-2 py-0.5 text-xs font-extrabold tracking-[0.08em]" data-estimate-additional-chip>ADDITIONAL{r.additionalTo ? ` · to ${r.additionalTo}` : ""}</span> : null}
                {r.money?.badge ? <Badge tone={r.money.tone === "green" ? "green" : "amber"} data-em-list-badge={r.money.badge}>{r.money.badge}</Badge> : null}
                {r.status === "cancelled" && r.cancelReason ? <span className="text-xs font-semibold text-muted" data-cancel-reason>{r.cancelReason}</span> : null}
                <span className="ml-auto text-sm font-semibold">{aed(r.total)}</span>
                <span className="pointer-events-auto flex items-center gap-1">
                  {r.versions.length > 1 ? <QuoteVersionSelect base={r.versionBase} versions={r.versions} selectedId={r.id} /> : null}
                  {r.menu ?? null}
                </span>
                <span className="basis-full text-xs text-muted">
                  {wait ? <span className="font-bold text-ink" data-waiting-on>{wait}</span> : null}
                  {wait ? " · " : ""}
                  {r.sentAt ? `sent ${formatDateTime(r.sentAt)}` : `started ${formatDateTime(r.createdAt)}`}
                  {r.validUntil ? ` · valid until ${formatDate(r.validUntil)}` : ""}
                  {r.leadName ? <span data-started-by> · started by {r.leadName}</span> : null}
                  {r.money?.words ? <span data-em-list-paid> · {r.money.words}</span> : null}
                </span>
                {r.handback && s.key === "ready" && r.handback.summary ? <span className="basis-full text-sm font-semibold" data-handback-summary>{r.handback.summary}</span> : null}
              </div>
            </Card>
          );
        });
        return s.folded ? (
          <details key={s.key} className="flex flex-col gap-3" data-estimates-closed>
            <summary className="cursor-pointer list-none"><SectionLabel right={`${items.length}`}>{s.title} ▸</SectionLabel></summary>
            <div className="mt-3 flex flex-col gap-3">{cards}</div>
          </details>
        ) : (
          <section key={s.key} className="flex flex-col gap-3" data-estimates-section={s.key}>
            <SectionLabel right={`${items.length}`}>{s.title}</SectionLabel>
            {cards}
          </section>
        );
      })}
    </>
  );
}
