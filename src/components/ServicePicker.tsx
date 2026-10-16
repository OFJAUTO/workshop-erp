"use client";

import { useMemo, useState } from "react";
import type { Service, ServiceCategory } from "@/lib/quotes";
import { pinnedRank,isFixedService,aed, hoursText } from "@/lib/quotes";

export type PickerKind = "labour" | "service" | "both";

/**
 * The two pickers behind the quotation's name boxes, with the same look: Labour jobs (priced by
 * hours) and Services (a fixed price per unit). One centre window: a search box, the categories on
 * the left (Suggested from the report first, then Most used), one line per item (the name and how
 * it is priced), a tap turns a row light green with a tick, a counter and Done. A name typed that
 * is not on the list can be added as it was typed.
 */
export function ServicePicker({
  kind = "both",
  categories,
  services,
  usage,
  department,
  onDone,
  onSaveCustom,
  onClose,
  suggested = [],
  allowCustom = true,
  editHref,
  title,
}: {
  kind?: PickerKind;
  categories: ServiceCategory[];
  services: Service[];
  usage: Record<string, number>;
  department: string | null;
  /** The picked items in the order they were tapped, then any names typed by hand. */
  onDone: (picked: Service[], custom: string[]) => void;
  /** "Add and save to the list": the typed name joins the services list (category Custom) as well as the quotation. */
  onSaveCustom?: (name: string) => void;
  onClose: () => void;
  /** Services that fit the report's findings, shown first. */
  suggested?: Service[];
  allowCustom?: boolean;
  /** Where the owner edits the list. */
  editHref?: string | null;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Service[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const fitsKind = (s: Service) => kind === "both" || (kind === "labour" ? !isFixedService(s) : isFixedService(s));
  const sortedAll = useMemo(() => {
    const fits = (s: Service) => (s.department === "both" || !department || department === "both" || s.department === department) && fitsKind(s);
    return [...services].filter(fits).sort((a, b) => pinnedRank(a.name) - pinnedRank(b.name) || (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.position - b.position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, usage, department, kind]);
  const suggestedHere = suggested.filter(fitsKind);
  const [tab, setTab] = useState<string>(suggestedHere.length ? "suggested" : "most");
  const q = query.trim().toLowerCase();
  const cats = categories.filter((c) => sortedAll.some((s) => s.category_id === c.id));
  const shown = q
    ? sortedAll.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q)).slice(0, 40)
    : tab === "suggested"
      ? suggestedHere
      : tab === "most"
        ? sortedAll.filter((s) => (usage[s.id] ?? 0) > 0 || pinnedRank(s.name) < 99).slice(0, 14)
        : sortedAll.filter((s) => s.category_id === tab);
  const exact = q ? services.some((s) => s.name.toLowerCase() === q) || custom.some((c) => c.toLowerCase() === q) : true;
  const priceText = (s: Service) => (s.price_aed !== null ? `${aed(s.price_aed)}${s.price_per && s.price_per !== "job" ? ` per ${s.price_per}` : ""}` : s.default_hours !== null ? hoursText(s.default_hours) : "hours typed by you");
  const isPicked = (s: Service) => picked.some((p) => p.id === s.id);
  const toggle = (s: Service) => setPicked((cur) => (cur.some((p) => p.id === s.id) ? cur.filter((p) => p.id !== s.id) : [...cur, s]));
  const count = picked.length + custom.length;
  const heading = title ?? (kind === "labour" ? "Labour jobs" : kind === "service" ? "Services" : "Labour jobs and services");

  const tabBtn = (id: string, label: string, bold = false) => (
    <button key={id} type="button" onClick={() => { setTab(id); setQuery(""); }} className={`min-h-11 rounded-control px-3 text-left text-sm ${bold ? "font-bold" : "font-semibold"} ${tab === id && !q ? "bg-ink text-white" : "bg-chip"}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={heading} onClick={onClose}>
      <div className="w-full max-w-3xl rounded-card bg-white p-4 sm:p-5 flex flex-col gap-3 shadow-xl max-h-[94vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold">{heading}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "service" ? "Type to find a service…" : "Type to find a job…"} autoFocus spellCheck lang="en" aria-label="Search" className="min-h-12 w-full rounded-control border border-line-strong px-3.5 text-base outline-none focus:border-ink" />
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3 min-h-0 flex-1">
          <div className="flex flex-wrap sm:flex-col gap-1 sm:overflow-y-auto sm:max-h-[60vh]">
            {suggestedHere.length ? tabBtn("suggested", `Suggested (${suggestedHere.length})`, true) : null}
            {tabBtn("most", "Most used", true)}
            {cats.map((c) => tabBtn(c.id, c.name))}
          </div>
          <div className="overflow-y-auto flex flex-col gap-1 min-h-[12rem]">
            {shown.length === 0 && !q ? <p className="text-sm text-muted p-2">{tab === "most" ? "Nothing used yet. Pick a category, or start typing." : "Pick a category, or start typing."}</p> : null}
            {shown.length === 0 && q && !allowCustom ? <p className="text-sm text-muted p-2">Nothing on the list matches.</p> : null}
            {shown.map((s) => {
              const on = isPicked(s);
              return (
                <button key={s.id} type="button" onClick={() => toggle(s)} aria-pressed={on} className={`min-h-12 rounded-control border px-3 text-left flex items-center gap-3 ${on ? "border-green bg-green-soft" : "border-line hover:border-ink"}`}>
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${on ? "bg-green text-white" : "border border-line-strong text-transparent"}`}>✓</span>
                  <span className="font-semibold truncate flex-1 min-w-0 uppercase">{s.name}</span>
                  <span className="text-xs font-semibold shrink-0 text-muted">{priceText(s)}</span>
                </button>
              );
            })}
            {custom.map((c) => (
              <button key={`custom-${c}`} type="button" onClick={() => setCustom((cur) => cur.filter((x) => x !== c))} aria-pressed className="min-h-12 rounded-control border border-green bg-green-soft px-3 text-left flex items-center gap-3">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-[11px] font-bold text-white">✓</span>
                <span className="font-semibold truncate flex-1 min-w-0">{c}</span>
                <span className="text-xs font-semibold shrink-0 text-muted">as typed</span>
              </button>
            ))}
            {q && !exact && allowCustom ? (
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => { setCustom((cur) => [...cur, query.trim()]); setQuery(""); }} className="min-h-12 rounded-control border border-dashed border-line-strong px-3 text-left text-sm font-bold">
                  + Add &quot;{query.trim()}&quot; as typed
                </button>
                {onSaveCustom ? (
                  <button type="button" onClick={() => { const name = query.trim(); setCustom((cur) => [...cur, name]); setQuery(""); onSaveCustom(name); }} className="min-h-12 rounded-control border border-dashed border-green px-3 text-left text-sm font-bold text-green" data-save-custom>
                    + Add &quot;{query.trim()}&quot; and save it to the list
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-3">
          {editHref ? <a href={editHref} className="text-xs font-semibold text-muted underline underline-offset-4">Edit the list</a> : <span />}
          <span className="ml-auto text-sm font-semibold">{count ? `${count} selected` : ""}</span>
          <button type="button" onClick={onClose} className="min-h-12 rounded-control px-4 text-sm font-bold text-muted hover:bg-chip">Cancel</button>
          <button type="button" disabled={!count} onClick={() => onDone(picked, custom)} className={`min-h-12 rounded-control px-5 text-sm font-bold text-white ${count ? "bg-ink" : "bg-ink/40"}`}>Done{count ? ` (${count})` : ""}</button>
        </div>
      </div>
    </div>
  );
}
