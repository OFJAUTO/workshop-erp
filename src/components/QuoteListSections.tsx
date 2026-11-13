import { Words } from "./Words";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, SectionLabel } from "@/components/ui";
import { QuoteVersionSelect } from "@/components/QuoteVersionSelect";
import { formatDate, formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, aed, type QuoteStatus } from "@/lib/quotes";
import { LIST_TABS, ageTag, listSearchHit, oldestFirst, ownerApprovedUnsent, tabOf, tagsOf, type ListFacts, type ListTab, type Who } from "@/lib/quote-list-rules";

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
  /** 13 November 2026 (Section 6): the facts behind the tab, the tags and the age, and what search reads. */
  facts: ListFacts;
  search: (string | null | undefined)[];
  ownerApprovedAt: string | null;
};

type Key = "owner" | "ready" | "sent" | "opened" | "noreply" | "draft" | "accepted" | "carried" | "declined" | "closed";

/** Which group a row belongs to (1 November 2026); kept on each row as data-list-section. */
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
    case "carried": return "Carried over to a job";
    case "declined": return "Not going ahead";
    default: return null;
  }
}

const tone = (s: QuoteStatus) => (s === "approved" ? "green" : s === "declined" || s === "expired" ? "red" : s === "draft" || s === "cancelled" ? "outline" : "amber");
const TAG_CLASS = { green: "border-green bg-green-soft text-green-text", amber: "border-amber-bar bg-amber-soft text-amber-text", red: "border-red bg-red-soft text-red", outline: "border-line-strong bg-white text-ink" } as const;

/**
 * THE list of estimates or quotations (13 November 2026, Section 6): tabs PREPARING · SENT · APPROVED with counts,
 * Closed behind a link; search by number, plate, VIN, customer or car; Mine / All (advisors open on Mine); oldest
 * waiting first, each row with its tags and an age tag that turns red. Every row says who it waits on and the whole
 * row opens it. Owner-approved ones not sent for more than 2 days are listed on their own (read-only) above Preparing.
 */
export function QuoteListSections({ rows, me, ownerName, noun, acceptedWords, tab, who, q, basePath, now, keep = {} }: { rows: QuoteListRow[]; me: string; ownerName: string; noun: "estimate" | "quotation"; acceptedWords: string; tab: ListTab; who: Who; q: string; basePath: string; now: number; keep?: Record<string, string> }) {
  const mineOf = (r: QuoteListRow) => r.leadId === me;
  const pool = rows.filter((r) => (who === "all" || mineOf(r)) && listSearchHit([r.number, r.jobNumber, r.car, r.customer, r.leadName, ...r.search], q));
  const inTab = (t: ListTab) => pool.filter((r) => tabOf(r.facts) === t);
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const all = { ...keep, tab, who, q, ...over };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "tab" && v === "preparing")) p.set(k, v);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const shown = oldestFirst(inTab(tab).map((r) => ({ ...r, facts: r.facts })));
  const closedCount = inTab("closed").length;
  const late = tab === "preparing" ? oldestFirst(pool.filter((r) => ownerApprovedUnsent({ status: r.status, carried: r.carried, ownerApprovedAt: r.ownerApprovedAt, sentAt: r.sentAt }, now))) : [];
  const plural = noun === "estimate" ? "estimates" : "quotations";

  return (
    <div className="flex flex-col gap-3" data-quote-list={noun}>
      <form action={basePath} method="get" className="flex flex-wrap items-center gap-2" data-list-search-form>
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {tab !== "preparing" ? <input type="hidden" name="tab" value={tab} /> : null}
        <input type="hidden" name="who" value={who} />
        <input type="search" name="q" defaultValue={q} placeholder="Search: number, plate, VIN, customer, car" aria-label={`Search ${plural}`} className="min-h-11 min-w-0 flex-1 basis-60 rounded-control border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink" data-list-search />
        <button type="submit" className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-on-dark">Search</button>
        {q ? <Link href={href({ q: null })} className="text-sm font-bold underline underline-offset-4" data-list-search-clear>Clear</Link> : null}
        <span className="ml-auto inline-flex overflow-hidden rounded-control border border-line-strong" data-list-who={who}>
          {(["mine", "all"] as const).map((w) => (
            <Link key={w} href={href({ who: w })} aria-pressed={who === w} className={`inline-flex min-h-11 items-center px-4 text-sm font-bold ${who === w ? "bg-ink text-on-dark" : "bg-white text-ink"}`} data-list-who-choice={w}>
              {w === "mine" ? "Mine" : "All"}
            </Link>
          ))}
        </span>
      </form>
      <nav className="flex flex-wrap items-center gap-2" data-quote-tabs>
        {LIST_TABS.map((t) => {
          const on = tab === t.key;
          const n = inTab(t.key).length;
          return (
            <Link key={t.key} href={href({ tab: t.key })} aria-current={on ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-extrabold uppercase tracking-[0.06em] ${on ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white text-ink"}`} data-quote-tab={t.key} data-quote-tab-on={on ? "1" : "0"}>
              {t.label}<span className={`rounded-full px-2 py-0.5 text-xs ${on ? "bg-white text-ink" : "bg-canvas"}`} data-quote-tab-count>{n}</span>
            </Link>
          );
        })}
        {tab === "closed" ? (
          <Link href={href({ tab: "preparing" })} className="ml-auto text-sm font-bold underline underline-offset-4" data-closed-back>← Back to open {plural}</Link>
        ) : (
          <Link href={href({ tab: "closed" })} className="ml-auto inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4" data-closed-link>Closed ({closedCount}) →</Link>
        )}
      </nav>
      {late.length ? (
        <Card className="flex flex-col gap-2 border-amber-bar" data-owner-approved-unsent>
          <SectionLabel right={`${late.length}`}>Approved or edited by the owner, not sent for more than 2 days</SectionLabel>
          <ul className="flex flex-col gap-1 text-sm">
            {late.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2" data-owner-approved-row={r.number}>
                <Link href={r.href} className="font-extrabold underline underline-offset-4">{r.number}</Link>
                <span>{r.car}</span>
                <span className="text-muted">approved {formatDate(r.ownerApprovedAt!)} · {ageTag({ ...r.facts, handback: true, handedBackAt: r.ownerApprovedAt }, now).words} · {r.leadName ?? "no advisor"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {tab === "closed" ? <SectionLabel right={`${shown.length}`}>Closed: carried over, not going ahead, cancelled or expired</SectionLabel> : null}
      {shown.length === 0 ? <p className="py-3 text-sm text-muted" data-list-empty>{q ? "Nothing matches the search." : who === "mine" ? `None of your ${plural} here. Tap All to see everyone's.` : `No ${plural} here.`}</p> : null}
      {shown.map((r) => {
        const key = bucketOf(r);
        const wait = waitingOn(key, r, ownerName, acceptedWords);
        const age = ageTag(r.facts, now);
        const tags = tagsOf(r.facts);
        return (
          <Card key={r.id} className={`relative !p-0 hover:border-ink ${age.red && tab !== "closed" ? "border-red" : ""}`} data-estimate-row={r.number} data-quote-list-row={r.number} data-estimate-status={r.status} data-list-section={key} data-list-tab={tabOf(r.facts)} data-mine={mineOf(r) ? "true" : "false"}>
            <Link href={r.href} aria-label={`Open ${r.number}`} className="absolute inset-0 z-0 rounded-card" data-overlap-ok data-quote-list-open />
            <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
              <span className="font-extrabold">{r.number}</span>
              {r.jobNumber ? <span className="text-sm font-semibold text-muted">{r.jobNumber}</span> : null}
              <span className="font-semibold">{r.car}</span>
              {r.customer ? <span className="text-sm text-muted">{r.customer}</span> : null}
              <Badge tone={r.handback && key === "ready" ? "green" : tone(r.status)}>{r.handback && key === "ready" ? r.handback.words : r.status === "declined" ? "Not going ahead" : QUOTE_STATUS_LABELS[r.status]}</Badge>
              {tags.map((t) => <span key={t.key} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${TAG_CLASS[t.tone]}`} data-row-tag={t.key}>{t.words}</span>)}
              {r.additionalTo !== null ? <span className="rounded-full border border-ink px-2 py-0.5 text-xs font-extrabold tracking-[0.08em]" data-estimate-additional-chip>ADDITIONAL{r.additionalTo ? ` · to ${r.additionalTo}` : ""}</span> : null}
              {r.money?.badge ? <Badge tone={r.money.tone === "green" ? "green" : "amber"} data-em-list-badge={r.money.badge}>{r.money.badge}</Badge> : null}
              {(r.status === "cancelled" || r.status === "declined") && r.cancelReason ? <span className="text-xs font-semibold text-muted" data-cancel-reason>{r.cancelReason}</span> : null}
              {tab !== "closed" ? <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${age.red ? "border-red bg-red-soft text-red" : "border-line-strong bg-white text-muted"}`} data-row-age={age.days} data-age-red={age.red ? "1" : "0"}>{age.words}</span> : null}
              <span className="ml-auto text-sm font-semibold">{aed(r.total)}</span>
              <span className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1">
                {r.versions.length > 1 ? <QuoteVersionSelect base={r.versionBase} versions={r.versions} selectedId={r.id} /> : null}
                {r.menu ?? null}
              </span>
              <span className="basis-full text-xs text-muted">
                {wait ? <span className="font-bold text-ink" data-waiting-on>{wait}</span> : null}
                {wait ? " · " : ""}
                {r.sentAt ? `sent ${formatDateTime(r.sentAt)}` : `started ${formatDateTime(r.createdAt)}`}
                {r.validUntil ? ` · valid until ${formatDate(r.validUntil)}` : ""}
                {r.leadName ? <span data-started-by> · started by {r.leadName}</span> : null}
                {r.money?.words ? <span data-em-list-paid> · <Words text={r.money.words} /></span> : null}
              </span>
              {r.handback && key === "ready" && r.handback.summary ? <span className="basis-full text-sm font-semibold" data-handback-summary>{r.handback.summary}</span> : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
