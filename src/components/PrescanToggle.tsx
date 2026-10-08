"use client";

import { useState } from "react";

/** Two buttons side by side: Show to customer / Hide from customer. The chosen one is solid black. Hide is the default. */
export function PrescanToggle({ inspectionId, initial, disabled = false }: { inspectionId: string; initial: boolean; disabled?: boolean }) {
  const [visible, setVisible] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  async function set(v: boolean) {
    setVisible(v);
    setError(null);
    try {
      const res = await fetch("/api/inspection/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId, prescanVisible: v }) });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setVisible(!v);
    }
  }
  const cls = (on: boolean) => `min-h-11 flex-1 rounded-control border-2 px-3 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} ${disabled ? "opacity-60" : ""}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button type="button" disabled={disabled} onClick={() => set(true)} aria-pressed={visible} className={cls(visible)}>
          Show to customer
        </button>
        <button type="button" disabled={disabled} onClick={() => set(false)} aria-pressed={!visible} className={cls(!visible)}>
          Hide from customer
        </button>
      </div>
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </div>
  );
}
