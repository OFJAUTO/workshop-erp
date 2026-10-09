"use client";

import { useMemo, useState } from "react";
import type { Service, ServiceCategory } from "@/lib/quotes";
import { aed, hoursText } from "@/lib/quotes";

/**
 * "Add service": a centre window with a search box, the categories, and each category's services.
 * The services this person uses most come first. One click adds the line, filled in.
 */
export function ServicePicker({ categories, services, usage, department, onPick, onClose }: { categories: ServiceCategory[]; services: Service[]; usage: Record<string, number>; department: string | null; onPick: (service: Service) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const sorted = useMemo(() => {
    const fits = (s: Service) => s.department === "both" || !department || department === "both" || s.department === department;
    return [...services].filter(fits).sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.position - b.position);
  }, [services, usage, department]);
  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q)) : category ? sorted.filter((s) => s.category_id === category) : sorted.filter((s) => (usage[s.id] ?? 0) > 0).slice(0, 8);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Add service" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold">Add service</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to find any service…" autoFocus className="min-h-12 w-full rounded-control border border-line-strong px-3.5 text-base outline-none focus:border-ink" />
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 min-h-0 flex-1">
          <div className="flex sm:flex-col gap-1 overflow-auto">
            <button type="button" onClick={() => { setCategory(null); setQuery(""); }} className={`min-h-11 rounded-control px-3 text-left text-sm font-bold ${!category && !q ? "bg-ink text-white" : "bg-chip"}`}>Most used</button>
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCategory(c.id); setQuery(""); }} className={`min-h-11 rounded-control px-3 text-left text-sm font-semibold ${category === c.id && !q ? "bg-ink text-white" : "bg-chip"}`}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="overflow-auto flex flex-col gap-1">
            {shown.length === 0 ? <p className="text-sm text-muted p-2">{q ? "Nothing matches. Type it as a free line instead." : "Pick a category, or start typing."}</p> : null}
            {shown.map((s) => (
              <button key={s.id} type="button" onClick={() => onPick(s)} className="min-h-12 rounded-control border border-line px-3 py-2 text-left hover:border-ink flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-muted">{catName(s.category_id)}</span>
                <span className="ml-auto text-xs font-semibold">{s.price_aed !== null ? aed(s.price_aed) : s.default_hours !== null ? hoursText(s.default_hours) : "hours to type"}</span>
                {s.parts_requests.length ? <span className="text-[11px] text-muted w-full">Sends to Parts: {s.parts_requests.join(", ")}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 w-full rounded-control text-sm font-bold text-muted hover:bg-chip">Close</button>
      </div>
    </div>
  );
}
