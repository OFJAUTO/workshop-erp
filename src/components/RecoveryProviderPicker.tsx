"use client";

import { useState, useTransition } from "react";
import { addRecoveryProviderAction } from "@/app/(app)/recovery/provider-actions";
import { reloadIfStale } from "@/lib/app-version";
import type { RecoveryProvider } from "@/lib/recovery-providers";

/**
 * THE outside recovery company picker (30 October 2026, night batch section 3.5): one tap from the saved list, or
 * "+ Add new" with the name AND the phone - never free typing (that is how "YGHUHGHU" got in). Names that look like a
 * typing mistake are not offered; the owner removes them on the Recovery page.
 */
export function RecoveryProviderPicker({ value, providers, disabled = false, onPick }: { value: string | null; providers: RecoveryProvider[]; disabled?: boolean; onPick: (name: string) => void }) {
  const [list, setList] = useState(providers);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = list.filter((p) => !p.junk || p.name === value);
  const add = () => {
    setError(null);
    start(async () => {
      try {
        const r = await addRecoveryProviderAction(name, phone);
        if (r.error || !r.provider) {
          setError(r.error ?? "Could not save the company.");
          return;
        }
        const p = r.provider;
        setList((cur) => [...cur.filter((x) => x.name.toLowerCase() !== p.name.toLowerCase()), p].sort((a, b) => a.name.localeCompare(b.name)));
        onPick(p.name);
        setAdding(false);
        setName("");
        setPhone("");
      } catch (e) {
        if (reloadIfStale(e)) return;
        setError("No connection. Try again.");
      }
    });
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-recovery-provider-picker>
      <select
        value={adding ? "__new" : (value ?? "")}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === "__new") setAdding(true);
          else {
            setAdding(false);
            onPick(e.target.value);
          }
        }}
        aria-label="Recovery company"
        className="min-h-9 rounded-control border border-line-strong bg-white px-2 text-sm"
        style={{ width: "12rem" }}
        data-recovery-provider
      >
        <option value="">Choose the company…</option>
        {shown.map((p) => <option key={p.name} value={p.name}>{p.name}{p.phone ? ` · ${p.phone}` : ""}</option>)}
        <option value="__new">+ Add new</option>
      </select>
      {adding ? (
        <span className="inline-flex flex-wrap items-center gap-1" data-recovery-provider-add>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company or driver's name" spellCheck lang="en" className="min-h-9 rounded-control border border-line-strong px-2 text-sm" style={{ width: "11rem" }} data-recovery-provider-name />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel" inputMode="tel" className="min-h-9 rounded-control border border-line-strong px-2 text-sm" style={{ width: "8rem" }} data-recovery-provider-phone />
          <button type="button" disabled={pending} onClick={add} className="min-h-9 rounded-control bg-ink px-3 text-xs font-bold text-white disabled:opacity-50" data-recovery-provider-save>{pending ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => { setAdding(false); setError(null); }} className="min-h-9 px-2 text-xs font-semibold underline">Cancel</button>
        </span>
      ) : null}
      {error ? <span className="basis-full text-xs font-semibold text-red" data-recovery-provider-error>{error}</span> : null}
    </span>
  );
}
