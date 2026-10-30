"use client";

import { useState, useTransition } from "react";
import { removeRecoveryProviderAction } from "@/app/(app)/recovery/provider-actions";
import { reloadIfStale } from "@/lib/app-version";
import type { RecoveryProvider } from "@/lib/recovery-providers";

/**
 * The owner's list of saved outside recovery companies (30 October 2026, section 3.5): names that look like a typing
 * mistake ("YGHUHGHU") come first, in red, with Remove. The same list THE picker on the quotation offers.
 */
export function RecoveryProvidersCard({ providers }: { providers: RecoveryProvider[] }) {
  const [list, setList] = useState(providers);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const junk = list.filter((p) => p.junk);
  const remove = (name: string) => {
    setError(null);
    start(async () => {
      try {
        const r = await removeRecoveryProviderAction(name);
        if (r.error) setError(r.error);
        else setList((cur) => cur.filter((p) => p.name !== name));
      } catch (e) {
        if (!reloadIfStale(e)) setError("No connection. Try again.");
      }
    });
  };
  const ordered = [...junk, ...list.filter((p) => !p.junk)];
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-white p-4" id="providers" data-recovery-providers-card>
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Saved recovery companies · {list.length}</span>
      {junk.length ? <p className="text-sm font-bold text-red" data-providers-junk>{junk.length} name{junk.length === 1 ? " looks" : "s look"} like a typing mistake: {junk.map((p) => p.name).join(", ")}. Remove {junk.length === 1 ? "it" : "them"} below.</p> : <p className="text-sm text-muted">The quotation&apos;s recovery line picks from this list; &quot;+ Add new&quot; asks the name and the phone.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {ordered.map((p) => (
          <li key={p.name} className="flex min-h-11 flex-wrap items-center gap-2 py-1 text-sm" data-provider-row={p.name} data-provider-junk={p.junk ? "1" : "0"}>
            <span className={`font-semibold ${p.junk ? "text-red" : ""}`}>{p.name}</span>
            <span className="text-xs text-muted">{p.phone ?? "no phone saved"}</span>
            <button type="button" disabled={pending} onClick={() => remove(p.name)} className="ml-auto min-h-9 rounded-control border border-line-strong px-3 text-xs font-bold" data-provider-remove>Remove</button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
    </div>
  );
}
