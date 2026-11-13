"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui";
import type { StandIn } from "@/lib/standin-rules";
import { endStandInAction, saveStandInAction, type StandInAnswer } from "./standin-actions";

/**
 * Settings > Approvals: "Send my approvals to <person>" (13 November 2026, Section 15). The person, the two dates, the
 * approval types that go to them with a cost limit each (above it, it still comes to the owner). One tap ends it early.
 */
export function StandInForm({ cfg, active, people, kinds, today }: { cfg: StandIn; active: boolean; people: { id: string; name: string; role: string }[]; kinds: { key: string; label: string }[]; today: string }) {
  const [saved, save, saving] = useActionState<StandInAnswer, FormData>(saveStandInAction, null);
  const [ended, end, ending] = useActionState<StandInAnswer, FormData>(endStandInAction, null);
  const answer = ended ?? saved;
  const box = "min-h-11 rounded-control border border-line-strong bg-white px-3 text-base";
  return (
    <div className="flex flex-col gap-4" data-standin-form>
      {answer?.error ? <Notice tone="error">{answer.error}</Notice> : null}
      {answer?.ok ? <div data-standin-saved><Notice tone="success">{answer.message}</Notice></div> : null}
      {active ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2" data-standin-active>
          <span className="flex-1 text-sm font-bold">Your approvals go to {cfg.staffName} until {cfg.until}.</span>
          <form action={end}>
            <button type="submit" disabled={ending} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-standin-end>{ending ? "Ending…" : "End now"}</button>
          </form>
        </div>
      ) : null}
      <form action={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">Send my approvals to
            <select name="staff_id" defaultValue={cfg.staffId ?? ""} required className={box} data-standin-person>
              <option value="" disabled>Pick a person…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">From
            <input type="date" name="from" defaultValue={cfg.from ?? today} min={today} required className={box} data-standin-from />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Until (it ends by itself)
            <input type="date" name="until" defaultValue={cfg.until ?? ""} min={today} required className={box} data-standin-until />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Which approvals go to them? (cost limit per item; empty = no limit; above it, it comes to you)</span>
          <ul className="flex flex-col divide-y divide-line rounded-control border border-line bg-white">
            {kinds.map((k) => (
              <li key={k.key} className="flex min-h-12 flex-wrap items-center gap-3 px-3 py-1.5" data-standin-type={k.key}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" name={`type_${k.key}`} defaultChecked={!!cfg.types[k.key]?.on} className="h-5 w-5 accent-ink" />
                  {k.label}
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-muted">up to AED
                  <input name={`limit_${k.key}`} inputMode="decimal" defaultValue={cfg.types[k.key]?.limit ?? ""} placeholder="no limit" className="min-h-11 w-28 rounded-control border border-line-strong bg-white px-2 text-sm text-ink" data-standin-limit={k.key} />
                </label>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">Nobody approves their own request: those still come to you. Every decision is logged as &quot;approved by &lt;name&gt; on behalf of the owner&quot;, you get one summary each evening, and the team gets a short notice.</p>
        <div><button type="submit" disabled={saving} className="inline-flex min-h-12 items-center rounded-control bg-ink px-5 text-sm font-bold text-on-dark" data-standin-save>{saving ? "Saving…" : active ? "Save changes" : "Send my approvals"}</button></div>
      </form>
    </div>
  );
}
