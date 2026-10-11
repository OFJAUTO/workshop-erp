"use client";

import { useMemo, useState } from "react";
import type { Service, ServiceCategory } from "@/lib/quotes";
import { aed, hoursText } from "@/lib/quotes";

/**
 * "+ Add": one centre window for every job and service. Suggested (from the report's findings) comes
 * first, then Most used, then the categories; a search box finds anything; a job not on the list is
 * added as a custom job. Each line shows its pricing. "Edit the list" opens Settings.
 */
export function ServicePicker({
  categories,
  services,
  usage,
  department,
  onPick,
  onClose,
  suggested = [],
  onCustom,
  editHref,
  title = "Add a job or service",
}: {
  categories: ServiceCategory[];
  services: Service[];
  usage: Record<string, number>;
  department: string | null;
  onPick: (service: Service) => void;
  onClose: () => void;
  /** Services that fit the report's findings, shown first. */
  suggested?: Service[];
  /** A job typed by hand, not on the list. */
  onCustom?: (title: string) => void;
  /** Where the owner edits the list. */
  editHref?: string | null;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>(suggested.length ? "suggested" : "most");
  const sorted = useMemo(() => {
    const fits = (s: Service) => s.department === "both" || !department || department === "both" || s.department === department;
    return [...services].filter(fits).sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.position - b.position);
  }, [services, usage, department]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? sorted.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q)).slice(0, 40)
    : tab === "suggested"
      ? suggested
      : tab === "most"
        ? sorted.filter((s) => (usage[s.id] ?? 0) > 0).slice(0, 12)
        : sorted.filter((s) => s.category_id === tab);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";
  const exact = q ? services.some((s) => s.name.toLowerCase() === q) : true;
  const priceText = (s: Service) => (s.price_aed !== null ? `${aed(s.price_aed)}${s.price_per && s.price_per !== "job" ? ` per ${s.price_per}` : ""}` : s.default_hours !== null ? hoursText(s.default_hours) : "hours to type");

  const tabBtn = (id: string, label: string, bold = false) => (
    <button key={id} type="button" onClick={() => { setTab(id); setQuery(""); }} className={`min-h-11 rounded-control px-3 text-left text-sm whitespace-nowrap ${bold ? "font-bold" : "font-semibold"} ${tab === id && !q ? "bg-ink text-white" : "bg-chip"}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to find any job or service…" autoFocus spellCheck lang="en" className="min-h-12 w-full rounded-control border border-line-strong px-3.5 text-base outline-none focus:border-ink" />
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 min-h-0 flex-1">
          <div className="flex sm:flex-col gap-1 overflow-auto">
            {suggested.length ? tabBtn("suggested", `Suggested (${suggested.length})`, true) : null}
            {tabBtn("most", "Most used", true)}
            {categories.map((c) => tabBtn(c.id, c.name))}
          </div>
          <div className="overflow-auto flex flex-col gap-1">
            {shown.length === 0 && !q ? <p className="text-sm text-muted p-2">{tab === "most" ? "Nothing used yet. Pick a category, or start typing." : "Pick a category, or start typing."}</p> : null}
            {shown.map((s) => (
              <button key={s.id} type="button" onClick={() => onPick(s)} className="min-h-12 rounded-control border border-line px-3 py-2 text-left hover:border-ink flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-muted">{catName(s.category_id)}</span>
                <span className="ml-auto text-xs font-semibold">{priceText(s)}</span>
                {s.position_ask ? <span className="text-[11px] text-muted w-full">Asks: front, rear or both</span> : null}
                {s.parts_requests.length ? <span className="text-[11px] text-muted w-full">Sends to Parts: {s.parts_requests.join(", ")}</span> : null}
              </button>
            ))}
            {q && !exact && onCustom ? (
              <button type="button" onClick={() => onCustom(query.trim())} className="min-h-12 rounded-control border border-dashed border-line-strong px-3 text-left text-sm font-bold">
                + Add &quot;{query.trim()}&quot; as a custom job (hours typed by you)
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          {editHref ? <a href={editHref} className="text-xs font-semibold text-muted underline underline-offset-4">Edit the list</a> : <span />}
          <button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 text-sm font-bold text-muted hover:bg-chip">Close</button>
        </div>
      </div>
    </div>
  );
}
