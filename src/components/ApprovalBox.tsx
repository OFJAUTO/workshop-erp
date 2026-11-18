"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Words } from "./Words";
import { useRouter } from "next/navigation";
import { decideApprovalAction, remindOwnerAction, type ApprovalAnswer } from "@/app/(app)/approvals/actions";
import { ageOf, waitingWords } from "@/lib/approval-age";
import type { ApprovalItem } from "@/lib/approvals";
import { Button } from "@/components/ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "");

/**
 * THE approval box (11 November 2026, Section 4): yellow "NEEDS YOUR APPROVAL" - what it is, who asked and when, the
 * money involved - with Approve and Refuse (a reason). The same box at the top of the item's own page and on the
 * Approvals list; the answer appears inside it. `highlight` (the bell's ?approval=) rings it and scrolls it into view.
 * `link` adds "Open" to the item's page (the list). `extra` carries a kind's own details (the quotation's reasons).
 */
export function ApprovalBox({ item, highlight = false, link = false, extra = null }: { item: ApprovalItem; highlight?: boolean; link?: boolean; extra?: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [answer, setAnswer] = useState<ApprovalAnswer>(null);
  const [busy, start] = useTransition();
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center" });
  }, [highlight]);
  const decide = (decision: "approve" | "refuse") =>
    start(async () => {
      const r = await decideApprovalAction(item.kind, item.id, decision, reason, item.kind === "quote" ? item.what : null);
      setAnswer(r);
      if (r?.ok) router.refresh();
    });
  const done = !!answer?.ok;
  return (
    <div ref={ref} id={`approval-${item.key}`} className={`flex flex-col gap-2 rounded-card border-2 px-4 py-3 ${done ? "border-green bg-green-soft" : "border-amber-bar bg-amber-soft"} ${highlight ? "ring-4 ring-amber-bar/60" : ""}`} data-approval-box={item.key} data-approval-kind={item.kind}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-amber-text">{done ? "Decided" : "Needs your approval"}</span>
        <Words className="font-extrabold" text={item.title} data-approval-title="" />
        {item.money ? <span className="ml-auto font-extrabold" data-approval-money>{item.money}</span> : null}
      </div>
      {item.what ? <p className="text-sm" data-approval-what><Words text={item.what} /></p> : null}
      <p className="text-xs text-muted">{item.askedBy ? `Asked by ${item.askedBy}` : "Asked"}{item.askedAt ? ` · ${when(item.askedAt)}` : ""}{" "}<AgeTag askedAt={item.askedAt} /></p>
      {item.evidence ? <p className="rounded-control border border-red-bar bg-red-soft px-2 py-1 text-sm font-bold text-red" data-approval-evidence>{item.evidence}</p> : null}
      {extra}
      {done ? (
        <p className="text-sm font-bold text-green-text" data-approval-done>{answer?.message}</p>
      ) : (
        <>
          {refusing ? (
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why? (the person who asked sees it)" className="w-full rounded-control border border-line-strong bg-white px-3 py-2 text-sm" aria-label="Reason for refusing" data-approval-reason data-spell="" />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="md" disabled={busy} onClick={() => decide("approve")} data-approval-approve {...(item.kind === "quote" ? { "data-owner-approve": "" } : item.kind === "revision" ? { "data-revision-allow": "" } : {})}>{busy && !refusing ? "…" : item.approveLabel}</Button>
            {refusing ? (
              <Button type="button" size="md" tone="secondary" disabled={busy || reason.trim().length < 3} onClick={() => decide("refuse")} data-approval-refuse-send {...(item.kind === "revision" ? { "data-revision-decline": "" } : {})}>{busy ? "…" : `${item.refuseLabel} – send`}</Button>
            ) : (
              <Button type="button" size="md" tone="secondary" disabled={busy} onClick={() => setRefusing(true)} data-approval-refuse>{item.refuseLabel}</Button>
            )}
            {link ? <a href={`${item.href}${item.href.includes("?") ? "&" : "?"}approval=${encodeURIComponent(item.key)}`} className="ml-auto inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4" data-approval-open>Open</a> : null}
          </div>
          {answer?.error ? <p className="text-sm font-bold text-red" data-approval-error>{answer.error}</p> : null}
        </>
      )}
    </div>
  );
}

/** "waiting 6 days" (red after a day), from the moment it was asked. Drawn in the browser (the clock). */
function AgeTag({ askedAt }: { askedAt: string | null }) {
  const [now] = useState(() => Date.now());
  const a = ageOf(askedAt, now);
  if (!a) return null;
  return <span className={`font-bold ${a.long ? "text-red" : "text-amber-text"}`} data-approval-age={a.hours}>· waiting {a.words}</span>;
}

/**
 * What everyone else sees while the owner decides (18 November 2026, Section 2): "Waiting for the owner – n days",
 * and for the person who asked a "Remind the owner" button, once a day per item.
 */
export function ApprovalWaiting({ item, canRemind = false, remindedToday = false }: { item: ApprovalItem; canRemind?: boolean; remindedToday?: boolean }) {
  const [now] = useState(() => Date.now());
  const [answer, setAnswer] = useState<{ error?: string; words?: string } | null>(null);
  const [busy, start] = useTransition();
  const done = remindedToday || !!answer?.words;
  return (
    <div className="flex flex-col gap-1 rounded-card border-2 border-amber-bar bg-amber-soft px-4 py-2 text-sm font-semibold text-amber-text" data-approval-waiting={item.key}>
      <span>Waiting for owner approval: {item.title.replace(/ needs your approval/, "")}{item.money ? ` · ${item.money}` : ""}</span>
      <span className={(ageOf(item.askedAt, now)?.long ? "text-red " : "") + "font-bold"} data-approval-waiting-age>{waitingWords(item.askedAt, now)}</span>
      {item.evidence ? <span className="text-red" data-approval-evidence>{item.evidence}</span> : null}
      {canRemind ? (
        <span className="flex flex-wrap items-center gap-2">
          <Button type="button" size="md" tone="secondary" disabled={busy || done} onClick={() => start(async () => setAnswer(await remindOwnerAction(item.key)))} data-approval-remind>{done ? "Reminded today" : busy ? "…" : "Remind the owner"}</Button>
          {answer?.words ? <span className="text-green-text" data-approval-reminded>{answer.words}</span> : null}
          {answer?.error ? <span className="text-red" data-approval-remind-error>{answer.error}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** THE "Remind the owner" button on its own (Accounts posting's cheque rows): once a day per approval item. */
export function RemindOwnerButton({ itemKey, askedAt }: { itemKey: string; askedAt: string | null }) {
  const [now] = useState(() => Date.now());
  const [answer, setAnswer] = useState<{ error?: string; words?: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={`font-bold ${ageOf(askedAt, now)?.long ? "text-red" : ""}`} data-approval-waiting-age>{waitingWords(askedAt, now)}</span>
      <Button type="button" size="md" tone="secondary" disabled={busy || !!answer?.words} onClick={() => start(async () => setAnswer(await remindOwnerAction(itemKey)))} data-approval-remind>{answer?.words ? "Reminded today" : busy ? "…" : "Remind the owner"}</Button>
      {answer?.words ? <span className="text-green-text" data-approval-reminded>{answer.words}</span> : null}
      {answer?.error ? <span className="text-red" data-approval-remind-error>{answer.error}</span> : null}
    </span>
  );
}
