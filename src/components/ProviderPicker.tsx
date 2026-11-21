"use client";

import { useId, useState } from "react";
import { controlClass } from "@/components/ui";

export type ProviderOption = { id: string; name: string; trn: string | null };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * THE provider box (21 November 2026): type to pick from the SUPPLIER LIST; a name that is not there is added as a new
 * provider when saved. A known provider's TRN fills in by itself. Sends `<prefix>supplier_id`, `<prefix>provider_new` and
 * `<prefix>trn`. Used by the charge's Edit window and the Journal Voucher's "Record as paid".
 */
export function ProviderPicker({ providers, initial = null, prefix = "", label = "Provider (from the supplier list)", showTrn = true, onPick, hook = "provider" }: { providers: ProviderOption[]; initial?: { id: string | null; name: string | null; trn?: string | null } | null; prefix?: string; label?: string; showTrn?: boolean; onPick?: (p: { id: string | null; name: string; trn: string }) => void; hook?: string }) {
  const listId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [trn, setTrn] = useState(initial?.trn ?? "");
  const match = name.trim() ? providers.find((p) => norm(p.name) === norm(name)) ?? null : null;
  const pickedId = match?.id ?? (initial?.id && initial.name && norm(initial.name) === norm(name) ? initial.id : null);
  const isNew = !!name.trim() && !pickedId;
  const change = (v: string) => {
    setName(v);
    const m = v.trim() ? providers.find((p) => norm(p.name) === norm(v)) ?? null : null;
    const nextTrn = m?.trn ?? (m ? "" : trn);
    if (m) setTrn(m.trn ?? "");
    onPick?.({ id: m?.id ?? null, name: v, trn: nextTrn ?? "" });
  };
  return (
    <div className="flex flex-col gap-2" data-provider-picker={hook}>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        {label}
        <input list={listId} value={name} onChange={(e) => change(e.target.value)} className={controlClass} autoComplete="off" spellCheck={false} placeholder="Start typing the name" data-provider-name={hook} />
        <datalist id={listId}>
          {providers.map((p) => <option key={p.id} value={p.name} />)}
        </datalist>
      </label>
      <input type="hidden" name={`${prefix}supplier_id`} value={pickedId ?? ""} />
      <input type="hidden" name={`${prefix}provider_new`} value={isNew ? name.trim() : ""} />
      {isNew ? <span className="text-xs font-semibold text-amber-text" data-provider-new={hook}>New provider: &quot;{name.trim()}&quot; is added to the supplier list when you save.</span> : pickedId ? <span className="text-xs text-green-text" data-provider-known={hook}>From the supplier list ✓</span> : null}
      {showTrn ? (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Provider TRN (optional, 15 digits)
          <input name={`${prefix}trn`} value={trn} onChange={(e) => { setTrn(e.target.value.replace(/[^\d\s-]/g, "")); onPick?.({ id: pickedId, name, trn: e.target.value }); }} inputMode="numeric" className={controlClass} spellCheck={false} data-provider-trn={hook} />
        </label>
      ) : null}
    </div>
  );
}
