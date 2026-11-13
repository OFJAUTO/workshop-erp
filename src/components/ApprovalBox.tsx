"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Words } from "./Words";
import { useRouter } from "next/navigation";
import { decideApprovalAction, type ApprovalAnswer } from "@/app/(app)/approvals/actions";
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
      <p className="text-xs text-muted">{item.askedBy ? `Asked by ${item.askedBy}` : "Asked"}{item.askedAt ? ` · ${when(item.askedAt)}` : ""}</p>
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

/** What everyone else sees while the owner decides: "Waiting for owner approval: …". */
export function ApprovalWaiting({ item }: { item: ApprovalItem }) {
  return (
    <div className="rounded-card border-2 border-amber-bar bg-amber-soft px-4 py-2 text-sm font-semibold text-amber-text" data-approval-waiting={item.key}>
      Waiting for owner approval: {item.title.replace(/ needs your approval/, "")}{item.money ? ` · ${item.money}` : ""}
    </div>
  );
}
