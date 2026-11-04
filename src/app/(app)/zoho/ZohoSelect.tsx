"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { kindWord } from "@/lib/zoho-sync-rules";
import { openZohoSync } from "./ZohoSyncButton";

/** Every tick box on the Waiting rows, read from the page itself (the Parts table's own pattern). */
const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>("[data-zoho-tick]"));

/**
 * Choose what goes to Zoho (Mathew, 3 November 2026): a tick on every waiting row, Select all, select by
 * type, select by date, and "Sync N selected" opening the same confirm window with only those rows.
 */
export function ZohoSelectBar({ kinds, days }: { kinds: { kind: string; count: number }[]; days: string[] }) {
  const [picked, setPicked] = useState(0);

  useEffect(() => {
    const count = () => setPicked(boxes().filter((b) => b.checked).length);
    count();
    document.addEventListener("change", count);
    return () => document.removeEventListener("change", count);
  }, []);

  const set = (filter: (b: HTMLInputElement) => boolean, on: boolean) => {
    for (const b of boxes()) if (filter(b)) b.checked = on;
    setPicked(boxes().filter((b) => b.checked).length);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-zoho-select-bar>
      <Button type="button" tone="secondary" size="md" onClick={() => set(() => true, true)} data-zoho-select-all>
        Select all
      </Button>
      <Button type="button" tone="ghost" size="md" onClick={() => set(() => true, false)} data-zoho-select-none>
        Clear
      </Button>
      <label className="flex items-center gap-1.5 text-sm font-semibold">
        Type
        <select
          className="h-11 rounded-control border border-line-strong bg-white px-2 text-sm"
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            set((b) => b.getAttribute("data-kind") === e.target.value, true);
            e.target.value = "";
          }}
          aria-label="Select by type"
          data-zoho-select-type
        >
          <option value="">Select by type…</option>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {kindWord(k.kind)} · {k.count}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-sm font-semibold">
        Date
        <select
          className="h-11 rounded-control border border-line-strong bg-white px-2 text-sm"
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            set((b) => (b.getAttribute("data-day") ?? "") <= e.target.value, true);
            e.target.value = "";
          }}
          aria-label="Select by date"
          data-zoho-select-date
        >
          <option value="">Select by date (up to)…</option>
          {days.map((d) => (
            <option key={d} value={d}>
              up to {d}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="md"
        disabled={!picked}
        onClick={() => {
          const ids = boxes().filter((b) => b.checked).map((b) => b.getAttribute("data-zoho-tick")!).filter(Boolean);
          if (ids.length) openZohoSync(ids);
        }}
        data-zoho-sync-selected={picked}
      >
        Sync {picked} selected
      </Button>
    </div>
  );
}

/** The one-row "Sync this" button Mathew drew next to "Waiting": the same confirm window, one item. */
export function SyncThisButton({ id }: { id: string }) {
  return (
    <Button type="button" tone="secondary" size="md" onClick={() => openZohoSync([id])} data-zoho-sync-this={id}>
      Sync this
    </Button>
  );
}
