"use client";

import { useMemo, useState } from "react";
import { PAIR_CHOICES, PART_POSITIONS, SINGLE_POSITIONS, goesWithOffers, newEntryId, offerEntry, type CatalogueRow, type PartsListEntry } from "@/lib/parts-list";

/** A part sold per set is asked Front or Rear; the quantity counts sets. */
const SET_POSITIONS = ["Front", "Rear"] as const;

/**
 * "+ Parts": a centre window over the owner's parts pool. Several parts are ticked, each with its
 * quantity and, where it matters, the position. A paired part (control arms, discs...) asks Front pair,
 * Rear pair or All four, with "One side only…" for a single corner. Parts that go with a picked one
 * (a wear sensor with brake pads) are offered under the list, never added by themselves. Suggested parts
 * for the finding come first, then the most used, then the categories; a search box finds anything; a part
 * not in the pool is added as a custom part. The window stays open for several taps; one Done button.
 */
export function PartPicker({
  title,
  catalogue,
  selected,
  suggested = [],
  itemKey,
  source = "item",
  onDone,
  onClose,
}: {
  title: string;
  catalogue: CatalogueRow[];
  /** The entries already chosen here; they come back edited or removed. */
  selected: PartsListEntry[];
  /** Parts that fit this finding, shown first. */
  suggested?: CatalogueRow[];
  itemKey: string | null;
  source?: PartsListEntry["source"];
  onDone: (entries: PartsListEntry[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>(suggested.length ? "suggested" : "most");
  const [picked, setPicked] = useState<Map<string, PartsListEntry>>(() => new Map(selected.map((e) => [keyOf(e), e])));
  // Paired parts whose single corners were asked for with "One side only…".
  const [singles, setSingles] = useState<Set<string>>(new Set());
  const categories = useMemo(() => Array.from(new Set(catalogue.map((c) => c.category))), [catalogue]);
  const mostUsed = useMemo(() => [...catalogue].sort((a, b) => b.usage_count - a.usage_count).slice(0, 12), [catalogue]);
  const q = query.trim().toLowerCase();
  const shown: CatalogueRow[] = q
    ? catalogue.filter((c) => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)).slice(0, 40)
    : tab === "suggested"
      ? suggested
      : tab === "most"
        ? mostUsed
        : catalogue.filter((c) => c.category === tab);
  // Picked custom parts show with the list so they can be edited too.
  const customPicked = Array.from(picked.values()).filter((e) => !e.catalogue_id && !shown.some((c) => keyOf(e) === c.id));
  const exact = q ? catalogue.some((c) => c.name.toLowerCase() === q) : true;
  const offers = goesWithOffers(Array.from(picked.values()), catalogue);

  function toggle(row: CatalogueRow) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, { id: newEntryId(), catalogue_id: row.id.startsWith("custom:") ? null : row.id, name: row.name, qty: 1, positions: [], item_key: itemKey, source, note: null, unit: row.unit === "set" ? "set" : "pc" });
      return next;
    });
  }
  function addCustom() {
    const name = query.trim().slice(0, 120);
    if (!name) return;
    const key = `custom:${name.toLowerCase()}`;
    setPicked((prev) => new Map(prev).set(key, { id: newEntryId(), catalogue_id: null, name, qty: 1, positions: [], item_key: itemKey, source, note: null, unit: "pc" }));
    setQuery("");
  }
  function update(key: string, patch: Partial<PartsListEntry>) {
    setPicked((prev) => {
      const cur = prev.get(key);
      if (!cur) return prev;
      return new Map(prev).set(key, { ...cur, ...patch });
    });
  }
  function togglePosition(key: string, pos: string) {
    const cur = picked.get(key);
    if (!cur) return;
    const positions = cur.positions.includes(pos) ? cur.positions.filter((p) => p !== pos) : [...cur.positions, pos];
    // The quantity follows the positions until it is changed by hand.
    const qty = cur.qty === Math.max(1, cur.positions.length) ? Math.max(1, positions.length) : cur.qty;
    update(key, { positions, qty });
  }
  /** Front pair, Rear pair or All four: the positions and the quantity in one tap. */
  function setPair(key: string, choice: (typeof PAIR_CHOICES)[number]) {
    const cur = picked.get(key);
    if (!cur) return;
    const same = cur.positions.length === choice.positions.length && choice.positions.every((p) => cur.positions.includes(p));
    update(key, same ? { positions: [], qty: 1 } : { positions: [...choice.positions], qty: choice.qty });
  }
  function acceptOffer(o: ReturnType<typeof goesWithOffers>[number]) {
    const entry = offerEntry(o);
    setPicked((prev) => new Map(prev).set(keyOf(entry), entry));
  }

  const tabBtn = (id: string, label: string) => (
    <button key={id} type="button" onClick={() => { setTab(id); setQuery(""); }} className={`min-h-11 rounded-control px-3 text-left text-sm font-semibold whitespace-nowrap ${tab === id && !q ? "bg-ink text-white" : "bg-chip"}`}>
      {label}
    </button>
  );
  const posBtn = (on: boolean, big = false) => `${big ? "min-h-11 px-3 text-sm" : "min-h-9 px-2 text-xs"} rounded-control border font-bold ${on ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`;

  const row = (c: CatalogueRow | { id: string; name: string; needs_position: boolean; category: string; unit?: "each" | "set"; paired?: boolean }, entry: PartsListEntry | undefined) => {
    const key = entry ? keyOf(entry) : c.id;
    const pairOn = (choice: (typeof PAIR_CHOICES)[number]) => !!entry && entry.positions.length === choice.positions.length && choice.positions.every((p) => entry.positions.includes(p));
    const showSingles = singles.has(key) || (!!entry && entry.positions.length > 0 && !PAIR_CHOICES.some(pairOn));
    return (
      <div key={c.id} className={`rounded-control border ${entry ? "border-green bg-green-soft" : "border-line"} flex flex-col`}>
        <button type="button" onClick={() => toggle(c as CatalogueRow)} aria-pressed={!!entry} className="min-h-12 flex items-center gap-3 px-3 py-2 text-left">
          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-extrabold ${entry ? "border-green bg-green text-white" : "border-line-strong bg-white"}`}>{entry ? "✓" : ""}</span>
          <span className="font-semibold">{c.name}</span>
          <span className="ml-auto text-xs text-muted">{c.category}</span>
        </button>
        {entry ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <span className="inline-flex items-center rounded-control border border-line-strong bg-white">
              <button type="button" aria-label="One less" onClick={() => update(key, { qty: Math.max(1, entry.qty - 1) })} className="min-h-10 w-10 text-lg font-bold">−</button>
              <span className="min-w-8 px-1 text-center text-sm font-bold">{entry.qty}{entry.unit === "set" ? ` set${entry.qty === 1 ? "" : "s"}` : ""}</span>
              <button type="button" aria-label="One more" onClick={() => update(key, { qty: entry.qty + 1 })} className="min-h-10 w-10 text-lg font-bold">+</button>
            </span>
            {c.paired ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {PAIR_CHOICES.map((p) => (
                  <button key={p.label} type="button" onClick={() => setPair(key, p)} aria-pressed={pairOn(p)} className={posBtn(pairOn(p), true)}>{pairOn(p) ? "✓ " : ""}{p.label}</button>
                ))}
                {!showSingles ? <button type="button" onClick={() => setSingles((s) => new Set(s).add(key))} className="min-h-9 px-2 text-xs font-semibold text-muted underline underline-offset-4">One side only…</button> : null}
                {showSingles ? SINGLE_POSITIONS.map((p) => <button key={p} type="button" onClick={() => togglePosition(key, p)} aria-pressed={entry.positions.includes(p)} className={posBtn(entry.positions.includes(p))}>{p}</button>) : null}
              </span>
            ) : c.needs_position || entry.positions.length || !entry.catalogue_id ? (
              <span className="flex flex-wrap gap-1">
                {(c.unit === "set" ? SET_POSITIONS : PART_POSITIONS).map((p) => (
                  <button key={p} type="button" onClick={() => togglePosition(key, p)} aria-pressed={entry.positions.includes(p)} className={posBtn(entry.positions.includes(p))}>
                    {p}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to find a part…" autoFocus spellCheck lang="en" className="min-h-12 w-full rounded-control border border-line-strong px-3.5 text-base outline-none focus:border-ink" />
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3 min-h-0 flex-1">
          <div className="flex sm:flex-col gap-1 overflow-auto">
            {suggested.length ? tabBtn("suggested", "Suggested") : null}
            {tabBtn("most", "Most used")}
            {categories.map((c) => tabBtn(c, c))}
          </div>
          <div className="overflow-auto flex flex-col gap-1.5">
            {shown.length === 0 && !q ? <p className="text-sm text-muted p-2">Pick a category, or start typing.</p> : null}
            {shown.map((c) => row(c, picked.get(c.id)))}
            {customPicked.map((e) => row({ id: keyOf(e), name: e.name, needs_position: true, category: "Custom" }, e))}
            {q && !exact ? (
              <button type="button" onClick={addCustom} className="min-h-12 rounded-control border border-dashed border-line-strong px-3 text-left text-sm font-bold">
                + Add &quot;{query.trim()}&quot; as a custom part
              </button>
            ) : null}
          </div>
        </div>
        {offers.length ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-chip p-2 text-xs" data-goes-with>
            <span className="font-semibold">Goes with:</span>
            {offers.map((o) => (
              <button key={o.key} type="button" onClick={() => acceptOffer(o)} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 font-bold">+ Add {o.label.charAt(0).toLowerCase()}{o.label.slice(1)}?</button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-sm text-muted">{picked.size ? `${picked.size} part${picked.size === 1 ? "" : "s"} picked. Keep tapping, then Done.` : "Nothing picked yet"}</span>
          <button type="button" onClick={() => onDone(Array.from(picked.values()))} className="min-h-12 rounded-control bg-ink px-6 text-base font-bold text-white">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function keyOf(e: PartsListEntry) {
  return e.catalogue_id ?? `custom:${e.name.toLowerCase()}`;
}
