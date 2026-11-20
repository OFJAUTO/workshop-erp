"use client";

import { useState, useTransition } from "react";
import { setCanViewStockAction } from "@/app/(app)/parts/stock/manage-actions";

/** THE personal "Can view stock" switch on a team record (20 November 2026, Section 5): view only, no costs, no actions. */
export function CanViewStockSwitch({ staffId, on }: { staffId: string; on: boolean }) {
  const [value, setValue] = useState(on);
  const [words, setWords] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1" data-can-view-stock>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-ink" checked={value} disabled={pending} onChange={(e) => { const next = e.target.checked; start(async () => { const r = await setCanViewStockAction(staffId, next); if (r.error) setWords({ ok: false, text: r.error }); else { setValue(next); setWords({ ok: true, text: r.words ?? "Saved." }); } }); }} data-can-view-stock-toggle />
        Can view stock
      </label>
      <span className="text-xs text-muted">Items, quantities and status on the Stock page. No costs, no stock value, and no issue, adjust, reorder or edit.</span>
      {words ? <span className={`text-xs font-semibold ${words.ok ? "text-green-text" : "text-red"}`} data-can-view-stock-answer>{words.text}</span> : null}
    </div>
  );
}
