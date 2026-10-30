"use client";

import { packageDetailsText, toSnapshot, type PackageSnapshot } from "@/lib/packages";

/**
 * A package's included items on the quotation, each with "Not needed" (section 6.5, 30 October 2026): an item switched
 * off leaves the customer's copy and the costing (film, tint, ceramic). The free pick-up & drop-off and the 10-day
 * after-care check switch the same way. Read-only: the plain list.
 */
export function PackageItemsToggle({ raw, disabled, onChange }: { raw: unknown; disabled: boolean; onChange: (next: PackageSnapshot) => void }) {
  const snap = toSnapshot(raw);
  if (!snap) return null;
  if (disabled) return <span className="whitespace-pre-line px-1 text-[11px] leading-relaxed text-muted" data-package-items>{packageDetailsText(raw)}</span>;
  const row = (label: string, on: boolean, toggle: () => void, key: string) => (
    <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-1" data-package-item={label} data-package-item-on={on ? "1" : "0"}>
      <span className={`min-w-0 text-xs ${on ? "font-semibold" : "text-muted line-through"}`}>{label}</span>
      <button type="button" onClick={toggle} aria-pressed={!on} className={`min-h-9 shrink-0 rounded-control border px-2.5 text-xs font-bold ${on ? "border-line-strong bg-white" : "border-ink bg-ink text-white"}`} data-package-item-toggle>
        {on ? "Not needed" : "Put back"}
      </button>
    </li>
  );
  return (
    <ul className="flex flex-col divide-y divide-line px-1" data-package-items data-package-items-edit>
      {snap.items.map((i, k) => row(i.label, !i.off, () => onChange({ ...snap, items: snap.items.map((x, n) => (n === k ? { ...x, off: !x.off } : x)) }), `i${k}`))}
      {row("Complimentary pick-up & drop-off", snap.pickup_dropoff, () => onChange({ ...snap, pickup_dropoff: !snap.pickup_dropoff }), "pickup")}
      {row("Complimentary 10-day after-care check", snap.aftercare_check, () => onChange({ ...snap, aftercare_check: !snap.aftercare_check }), "aftercare")}
    </ul>
  );
}
