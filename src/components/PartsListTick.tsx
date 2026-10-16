"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";

/** Fired on the window when the review form's autosave changed the parts list (the tick is off again), and when the tick is saved. */
export const PARTS_LIST_CHANGED_EVENT = "erp-parts-list-changed";
export const PARTS_LIST_TICKED_EVENT = "erp-parts-list-ticked";

/**
 * The workshop manager's tick directly under the parts list: "I have checked the parts list", or "I confirm no
 * parts are needed" when it is empty. Approving refuses without it. The tick is live: it turns green the moment
 * it is saved, and a change to the list (the form autosaves) turns it into "Parts list changed: check again"
 * without a refresh, so it is never green while the approval would be refused.
 */
export function PartsListTick({ action, confirmedAt, confirmedByName, count, canTick }: { action: () => Promise<{ at?: string; byName?: string; error?: string }>; confirmedAt: string | null; confirmedByName: string | null; count: number; canTick: boolean }) {
  const [state, setState] = useState<{ at: string; by: string | null } | null>(confirmedAt ? { at: confirmedAt, by: confirmedByName } : null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const onChanged = () => { setState(null); setChanged(true); };
    window.addEventListener(PARTS_LIST_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PARTS_LIST_CHANGED_EVENT, onChanged);
  }, []);
  const label = count ? "I have checked the parts list" : "I confirm no parts are needed";
  if (state) {
    return (
      <p className="inline-flex min-h-11 items-center gap-2 self-start rounded-control border border-green bg-green-soft px-3 text-sm font-bold text-green" data-parts-tick="on">
        ✓ {label} · {state.by ?? "the workshop manager"}, {formatDateTime(state.at)}
      </p>
    );
  }
  if (!canTick) return <p className="text-xs text-muted">The workshop manager ticks the list when approving the report.</p>;
  return (
    <div className="flex flex-col gap-1 self-start" data-parts-tick={changed ? "changed" : "off"}>
      {changed ? <span className="text-xs font-bold text-amber" data-parts-tick-changed>Parts list changed: check again.</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await action();
            if (r.error || !r.at) { setError(r.error ?? "Could not save the tick."); return; }
            setState({ at: r.at, by: r.byName ?? null });
            setChanged(false);
            window.dispatchEvent(new CustomEvent(PARTS_LIST_TICKED_EVENT));
          })
        }
        className={`min-h-12 rounded-control border-2 bg-white px-4 text-sm font-bold ${changed ? "border-amber-bar" : "border-line-strong"}`}
      >
        {pending ? "Saving…" : label}
      </button>
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </div>
  );
}
