"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { saveCountLineAction, submitCountAction, type StockAnswer } from "./manage-actions";

type Line = { id: string; name: string; unit: string; partNumber: string | null; systemQty: number; counted: string; notFound: boolean };

/**
 * THE stock count (20 November 2026, Section 5): item by item, each figure saved as it is typed (the count can be
 * continued another day). The differences and their value are worked out on the server and shown above; nothing
 * changes on the shelf until the owner approves the batch.
 */
export function StockCountForm({ countId, lines, submitted }: { countId: string; lines: Line[]; submitted: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [vals, setVals] = useState<Record<string, { counted: string; notFound: boolean }>>(() => Object.fromEntries(lines.map((l) => [l.id, { counted: l.counted, notFound: l.notFound }])));
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sent, submitAction, submitting] = useActionState<StockAnswer, FormData>(submitCountAction.bind(null, countId), null);
  const save = async (id: string, counted: string, notFound: boolean) => {
    setSaving((s) => ({ ...s, [id]: "saving" }));
    const r = await saveCountLineAction(countId, id, counted, notFound);
    setSaving((s) => ({ ...s, [id]: r.error ?? "saved" }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 800);
  };
  const shown = lines.filter((l) => !q.trim() || `${l.name} ${l.partNumber ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-3" data-stock-count-form>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item by name or part number" spell={false} data-count-search />
      <ul className="divide-y divide-line">
        {shown.map((l) => {
          const v = vals[l.id];
          const st = saving[l.id];
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-count-line={l.id}>
              <span className="min-w-48 flex-1"><span className="font-semibold uppercase">{l.name}</span><span className="block text-xs text-muted">{l.partNumber ? `${l.partNumber} · ` : ""}system says {l.systemQty} {l.unit}</span></span>
              <label className="flex items-center gap-2 text-xs font-semibold text-muted">Counted
                <Input value={v.counted} disabled={submitted || v.notFound} inputMode="decimal" spell={false} className="!w-24" onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...s[l.id], counted: e.target.value } }))} onBlur={(e) => save(l.id, e.currentTarget.value, false)} data-count-input={l.id} />
                {l.unit}
              </label>
              <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={v.notFound} disabled={submitted} className="h-5 w-5 accent-ink" onChange={(e) => { const nf = e.target.checked; setVals((s) => ({ ...s, [l.id]: { counted: nf ? "" : s[l.id].counted, notFound: nf } })); save(l.id, "", nf); }} data-count-not-found={l.id} />
                Not found
              </label>
              <span className={`w-16 text-xs ${st && st !== "saving" && st !== "saved" ? "font-bold text-red" : "text-muted"}`} data-count-saved={l.id}>{st === "saving" ? "Saving…" : st === "saved" ? "Saved ✓" : st ?? ""}</span>
            </li>
          );
        })}
      </ul>
      {!submitted ? (
        <form action={submitAction} className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="lg" disabled={submitting} data-count-submit>Send the count to the owner</Button>
          <span className="text-xs text-muted">Nothing changes on the shelf until the owner approves it as one batch.</span>
        </form>
      ) : <p className="text-sm font-semibold" data-count-waiting>Waiting for the owner&apos;s approval: nothing has changed on the shelf yet.</p>}
      {sent?.error ? <p className="text-sm font-bold text-red">{sent.error}</p> : null}
      {sent?.words ? <p className="text-sm font-bold text-green-text" data-count-sent>{sent.words}</p> : null}
    </div>
  );
}
