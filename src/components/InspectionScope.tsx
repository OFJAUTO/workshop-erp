"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNotChecked, resolveNotChecked, setCarCondition, setInspectionScope, type ScopeAnswer } from "@/app/(app)/jobs/inspection-scope-actions";
import { CONDITIONS, NOT_CHECKED_REASONS, SCOPES, scopeLabel, scopeStatusWords, type NotChecked } from "@/lib/inspection-scope";

/*
 * THE INSPECTION TYPE AND "COULD NOT CHECK" on screen (11 November 2026, Section 10): one file, three pieces - the
 * advisor's type picker (job card), the technician's condition and Could-not-check panel (inspection screen), and the
 * list of items not checked with the advisor's Customer declined / Not applicable.
 */
const chip = (on: boolean) => `min-h-11 rounded-control border px-3 text-sm font-bold ${on ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`;
function useAct() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [answer, setAnswer] = useState<ScopeAnswer>(null);
  const run = (fn: () => Promise<ScopeAnswer>) => start(async () => { const r = await fn(); setAnswer(r); if (r?.ok) router.refresh(); });
  return { busy, answer, run };
}
function Answer({ a }: { a: ScopeAnswer }) {
  if (!a) return null;
  return a.error ? <p className="text-sm font-bold text-red" data-scope-error>{a.error}</p> : a.message ? <p className="text-sm font-bold text-green-text" data-scope-done>{a.message}</p> : null;
}

/** The advisor's pick (no default); a smaller type after the start asks the owner with a reason. */
export function ScopeChoice({ jobId, scope, request, started, canChoose, checked, pending }: { jobId: string; scope: string | null; request: { scope: string; reason: string | null } | null; started: boolean; canChoose: boolean; checked: number; pending: number }) {
  const { busy, answer, run } = useAct();
  const [why, setWhy] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const size: Record<string, number> = { complaints: 1, full: 2, pre_purchase: 3 };
  const needsWhy = !!pick && started && !!scope && size[pick] < size[scope];
  return (
    <div className="flex flex-col gap-2 rounded-card border-2 border-line bg-white p-4" id="inspection-type" data-scope-box={scope ?? "none"}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Inspection type</span>
        <span className={`font-extrabold ${scope ? "" : "text-amber-text"}`} data-scope-label>{scope ? scopeLabel(scope) : "Type: not set"}</span>
        {scope && started ? <span className="text-sm font-semibold text-muted" data-scope-status>{scopeStatusWords(scope, checked, pending)}</span> : null}
      </div>
      {request ? <p className="text-sm font-bold text-amber-text" data-scope-request>Waiting for the owner: change to {scopeLabel(request.scope)}{request.reason ? ` – ${request.reason}` : ""}</p> : null}
      {canChoose ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {SCOPES.map((s) => (
              <button key={s.key} type="button" disabled={busy} aria-pressed={scope === s.key} onClick={() => { setPick(s.key); const down = started && !!scope && size[s.key] < size[scope]; if (!down) run(() => setInspectionScope(jobId, s.key)); }} className={chip(scope === s.key)} data-scope-pick={s.key}>{s.label}</button>
            ))}
          </div>
          {!scope ? <p className="text-xs font-semibold text-amber-text">The inspection cannot start until the type is picked.</p> : null}
          {needsWhy ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why smaller now? (the owner decides)" className="min-h-11 min-w-64 flex-1 rounded-control border border-line-strong px-3 text-sm" data-scope-why data-spell="" />
              <button type="button" disabled={busy || why.trim().length < 5} onClick={() => run(() => setInspectionScope(jobId, pick!, why))} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-scope-ask>Ask the owner</button>
            </div>
          ) : null}
        </>
      ) : null}
      <Answer a={answer} />
    </div>
  );
}

/** Items that could not be checked: the reason, and how each is settled. */
export function NotCheckedList({ jobId, items, canResolve, canReopen }: { jobId: string; items: (NotChecked & { label: string })[]; canResolve: boolean; canReopen: boolean }) {
  const { busy, answer, run } = useAct();
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-card border-2 border-amber-bar bg-amber-soft p-3" data-not-checked={items.filter((i) => !i.resolution).length}>
      <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-amber-text">Could not check ({items.filter((i) => !i.resolution).length} pending)</span>
      <ul className="flex flex-col divide-y divide-amber-bar/40">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" data-not-checked-item={i.key}>
            <span className="font-bold uppercase">{i.label}</span>
            <span className="text-muted">{i.reason}{i.auto ? " (from the car's condition)" : ""}</span>
            {i.resolution ? <span className="rounded-full border border-line-strong bg-white px-2 py-0.5 text-xs font-bold">{i.resolution === "declined" ? "Customer declined" : i.resolution === "not_applicable" ? "Not applicable" : "Checked"}</span> : null}
            {!i.resolution && canResolve ? (
              <span className="ml-auto flex gap-1.5">
                <button type="button" disabled={busy} onClick={() => run(() => resolveNotChecked(jobId, i.key, "declined"))} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-not-checked-declined={i.key}>Customer declined</button>
                <button type="button" disabled={busy} onClick={() => run(() => resolveNotChecked(jobId, i.key, "not_applicable"))} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-not-checked-na={i.key}>Not applicable</button>
              </span>
            ) : null}
            {!i.resolution && canReopen ? <button type="button" disabled={busy} onClick={() => run(() => markNotChecked(jobId, i.key, null))} className="ml-auto min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-not-checked-reopen={i.key}>Check it after all</button> : null}
          </li>
        ))}
      </ul>
      <Answer a={answer} />
    </div>
  );
}

/** The technician's top of the inspection: the type large, CHECK ONLY for complaints, the car's condition, Could not check. */
export function InspectionTop({ jobId, scope, requests, condition, items }: { jobId: string; scope: string | null; requests: string[]; condition: string | null; items: { key: string; label: string }[] }) {
  const { busy, answer, run } = useAct();
  const [itemKey, setItemKey] = useState("");
  return (
    <div className="flex flex-col gap-3 rounded-card border-2 border-ink bg-white p-4" data-inspection-top>
      <span className="text-2xl font-extrabold uppercase" data-inspection-type={scope ?? "none"}>{scopeLabel(scope)}</span>
      {scope === "complaints" ? (
        <div className="rounded-control border-2 border-ink px-3 py-2" data-check-only>
          <span className="text-sm font-extrabold">CHECK ONLY:</span>
          <ol className="text-base font-bold">{requests.map((r, i) => <li key={i}>{i + 1}. {r.toUpperCase()}</li>)}</ol>
          <span className="text-xs text-muted">Anything else you notice while working: add it as &quot;Noticed while working&quot; (Additional work found).</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]">The car&apos;s condition (first)</span>
        <div className="flex flex-wrap gap-1.5">
          {CONDITIONS.map((c) => <button key={c.key} type="button" disabled={busy} aria-pressed={condition === c.key} onClick={() => run(() => setCarCondition(jobId, c.key))} className={chip(condition === c.key)} data-condition={c.key}>{c.label}</button>)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Could not check an item?</span>
        <select value={itemKey} onChange={(e) => setItemKey(e.target.value)} className="min-h-11 rounded-control border border-line-strong bg-white px-2 text-sm" data-not-checked-pick>
          <option value="">Pick the item…</option>
          {items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </select>
        {itemKey ? (
          <div className="flex flex-wrap gap-1.5">
            {NOT_CHECKED_REASONS.map((r) => <button key={r} type="button" disabled={busy} onClick={() => { run(() => markNotChecked(jobId, itemKey, r)); setItemKey(""); }} className={chip(false)} data-not-checked-reason={r}>{r}</button>)}
          </div>
        ) : null}
      </div>
      <Answer a={answer} />
    </div>
  );
}
