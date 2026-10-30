"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, SectionLabel, Select } from "@/components/ui";
import { COMP_REASONS, COMP_REASON_LABELS, compCostWords, needsOriginalJob, type CompCost, type CompReason } from "@/lib/complimentary";
import { reloadIfStale } from "@/lib/app-version";
import { saveCompReason } from "./comp-actions";

const chip = (on: boolean) => `min-h-11 rounded-control border px-3 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;

/**
 * THE complimentary box on a quotation (section 5, 30 October 2026): what is free, why (our mistake / goodwill /
 * warranty), the original job or the note, and what it costs us. While the owner has not approved, the quotation
 * cannot go out ("Waiting for owner approval – complimentary"); the owner's own choices are approved by themselves.
 */
export function CompBox({ quotationId, what, cost, reason, originalJobId, note, status, decisionNote, jobs, isOwner, disabled }: { quotationId: string; what: string[]; cost: CompCost; reason: string | null; originalJobId: string | null; note: string | null; status: string | null; decisionNote: string | null; jobs: { id: string; label: string }[]; isOwner: boolean; disabled: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<string | null>(reason);
  const [job, setJob] = useState(originalJobId ?? "");
  const [text, setText] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = r !== reason || (job || null) !== (originalJobId ?? null) || text.trim() !== (note ?? "");
  async function save(next = r) {
    if (!next) return;
    setSaving(true);
    setError(null);
    const res = await saveCompReason(quotationId, { reason: next, originalJobId: job || null, note: text }).catch((e) => ({ error: reloadIfStale(e) ? "A new version is loading…" : "No connection. Try again." }));
    setSaving(false);
    if (res.error) setError(res.error);
    else router.refresh();
  }
  const needsJob = needsOriginalJob((r as CompReason) ?? null);
  const state = status === "approved" ? "Approved by the owner" : status === "rejected" ? `Rejected by the owner${decisionNote ? `: ${decisionNote}` : ""}` : isOwner ? "Your own choice: approved when you send it" : "Waiting for owner approval – complimentary (when you send it)";
  return (
    <Card id="item-comp" className={`flex flex-col gap-3 border-2 ${status === "rejected" ? "border-red-bar" : status === "approved" ? "border-green" : "border-amber-bar"}`} data-comp-box data-comp-status={status ?? "none"}>
      <SectionLabel right={state}>Complimentary</SectionLabel>
      <p className="text-sm"><span className="font-bold">Free: </span>{what.join(", ")}</p>
      <p className="text-sm font-semibold" data-comp-cost>{compCostWords(cost)}</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold">Why is it free?</span>
        <div className="flex flex-wrap gap-1.5">
          {COMP_REASONS.map((c) => (
            <button key={c} type="button" disabled={disabled} aria-pressed={r === c} onClick={() => setR(c)} className={chip(r === c)} data-comp-reason={c}>{COMP_REASON_LABELS[c]}</button>
          ))}
        </div>
      </div>
      {needsJob ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold">The original job</span>
          <Select value={job} onChange={(e) => setJob(e.target.value)} disabled={disabled} data-comp-original>
            <option value="">Pick the job…</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </Select>
          {!jobs.length ? <span className="text-xs text-muted">No earlier job for this customer or car: choose Goodwill instead.</span> : null}
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">{r === "goodwill" ? "Why (required)" : "Note"}</span>
        <Input value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} placeholder={r === "goodwill" ? "e.g. long-standing customer, small chip" : "Optional"} textCase="sentence" data-comp-note />
      </label>
      {!disabled ? (
        <Button type="button" className="self-start" disabled={saving || !r || !changed} onClick={() => save()} data-comp-save>{saving ? "Saving…" : "Save the reason"}</Button>
      ) : null}
      {error ? <span className="text-xs font-semibold text-red" data-comp-error>{error}</span> : null}
    </Card>
  );
}
