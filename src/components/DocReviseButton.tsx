"use client";

import { useState } from "react";
import { ReasonChips } from "./ReasonChips";
import { Button } from "./ui";
import { formatDayTime } from "@/lib/format";

/**
 * REVISE AT THE TOP (5 November 2026, E-00056): the one revise control of an estimate or a quotation, in the shared
 * header's top-right row next to Preview PDF - never a box at the bottom of the page. "Revise → version N" makes the
 * next version (a copy of this one); on a quotation the customer approved, an advisor without the owner's allowance
 * gets the same button asking the owner first (the revision rules are unchanged). Owner and advisors only: the page
 * passes nothing to anyone else.
 */
export function DocReviseButton({
  version,
  onRevise,
  onAskRevise = null,
  revision = null,
  reasons = [],
  reviseDefault = null,
  reviseOpen = false,
}: {
  /** This version's number: the button makes version + 1. */
  version: number;
  /** Make the next version now (owner, an allowed revision, or a document not approved yet). */
  onRevise: ((formData: FormData) => void | Promise<void>) | null;
  /** Ask the owner to allow a revision (an advisor on an approved quotation). */
  onAskRevise?: ((formData: FormData) => void | Promise<void>) | null;
  revision?: { requestedAt: string | null; allowedAt: string | null; declinedAt: string | null; declinedNote: string | null } | null;
  reasons?: string[];
  /** "Parts changed after approval: …" - the ask comes prefilled (5 November 2026). */
  reviseDefault?: string | null;
  /** Arriving from the notice: the ask opens by itself. */
  reviseOpen?: boolean;
}) {
  const [ask, setAsk] = useState(reviseOpen && !onRevise && !!onAskRevise);
  const label = `Revise → version ${version + 1}`;
  if (onRevise) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-revise-top>
        <form action={onRevise}>
          <Button type="submit" size="lg" data-revise data-revise-bar>{label}</Button>
        </form>
        {revision?.allowedAt ? <span className="text-xs font-semibold text-green" data-revise-allowed>Owner allowed one revision</span> : null}
      </span>
    );
  }
  if (!onAskRevise) return null;
  const waiting = !!revision?.requestedAt && !revision.allowedAt && !revision.declinedAt;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-revise-top>
      {waiting ? (
        <span className="inline-flex min-h-14 items-center rounded-control border border-amber-bar bg-amber-soft px-4 text-sm font-semibold text-amber" data-revise-pending>Revise: owner asked {formatDayTime(revision!.requestedAt!)}, waiting</span>
      ) : (
        <Button type="button" size="lg" onClick={() => setAsk(true)} title="The customer approved it: the owner allows a revision first" data-ask-revise>{label}</Button>
      )}
      {revision?.declinedAt && !revision.allowedAt ? <span className="text-xs font-semibold text-red" data-revise-declined>Declined by the owner{revision.declinedNote ? `: ${revision.declinedNote}` : ""}</span> : null}
      {ask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-revise-ask>
          <form action={onAskRevise} className="flex w-full max-w-md flex-col gap-3 rounded-card bg-white p-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <span className="text-lg font-extrabold">Ask the owner to allow a revision</span>
            <p className="text-sm text-muted">The customer approved this quotation. Say why it has to change; the owner allows one revision or declines.</p>
            <ReasonChips name="reason" label="Why?" rows={2} options={reasons} defaultValue={reviseDefault ?? ""} required placeholder="Tap a reason, or type" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="md" data-ask-revise-send>Ask the owner</Button>
              <Button type="button" tone="ghost" size="md" onClick={() => setAsk(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      ) : null}
    </span>
  );
}
