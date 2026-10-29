"use client";

import { useMemo, useState } from "react";
import { CATEGORY_ORDER, PAIR_CHOICES, PART_POSITIONS, SINGLE_POSITIONS, goesWithOffers, newEntryId, offerEntry, sortCategories, type CatalogueRow, type PartsListEntry } from "@/lib/parts-list";
import { LINE_TEXT_MAX } from "@/lib/text-limits";

/** A part sold per set is asked Front or Rear; the quantity counts sets. */
const SET_POSITIONS = ["Front", "Rear"] as const;

/**
 * The one parts picker, used wherever a part is chosen: the technician's inspection, the Parts desk and the
 * advisor's "+ Add a part". A centre window over the owner's parts pool: categories on the left (Servicing,
 * Brakes, Wheels and tyres, Suspension and steering, Engine, Fuel and exhaust, Cooling, Air conditioning,
 * Transmission and driveline, Electrical, Other), the parts of that category on the right, a search box on top.
 *
 * Picking: several parts are tapped, each turns light green with a tick, with its quantity and, only where it
 * matters, the position (a paired part asks Front pair, Rear pair or All four, with "One side only…"); parts that
 * go with a picked one are offered under the list, never added by themselves; one Done button.
 * Renaming (mode "rename"): one tap picks the new name and closes.
 * Manual is always there: "Custom part" at the bottom, and a search with no match offers "Use '<typed>' as a custom part".
 */
export function PartPicker({
  title,
  catalogue,
  selected,
  suggested = [],
  itemKey,
  source = "item",
  mode = "pick",
  onDone,
  onPick,
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
  /** "pick": several parts with quantity and position, then Done. "rename": one tap chooses a name. */
  mode?: "pick" | "rename";
  onDone?: (entries: PartsListEntry[]) => void;
  /** Rename mode: the chosen pool part (or a custom name with no pool row). */
  onPick?: (name: string, row: CatalogueRow | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>(suggested.length ? "suggested" : "most");
  const [picked, setPicked] = useState<Map<string, PartsListEntry>>(() => new Map(selected.map((e) => [keyOf(e), e])));
  // Paired parts whose single corners were asked for with "One side only…".
  const [singles, setSingles] = useState<Set<string>>(new Set());
  // "Custom part" at the bottom: a box to type the name.
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const categories = useMemo(() => sortCategories(Array.from(new Set(catalogue.map((c) => c.category)))), [catalogue]);
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
  const renaming = mode === "rename";

  function toggle(row: CatalogueRow) {
    if (renaming) {
      onPick?.(row.name, row.id.startsWith("custom:") ? null : row);
      return;
    }
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, { id: newEntryId(), catalogue_id: row.id.startsWith("custom:") ? null : row.id, name: row.name, qty: 1, positions: [], item_key: itemKey, source, note: null, unit: row.unit === "set" ? "set" : "pc" });
      return next;
    });
  }
  function addCustom(raw: string) {
    const name = raw.trim();
    if (!name || name.length > LINE_TEXT_MAX) return;
    if (renaming) {
      onPick?.(name, null);
      return;
    }
    const key = `custom:${name.toLowerCase()}`;
    setPicked((prev) => new Map(prev).set(key, { id: newEntryId(), catalogue_id: null, name, qty: 1, positions: [], item_key: itemKey, source, note: null, unit: "pc" }));
    setQuery("");
    setCustomText("");
    setCustomOpen(false);
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
    <button key={id} type="button" onClick={() => { setTab(id); setQuery(""); }} className={`min-h-11 rounded-control px-3 py-1.5 text-left text-sm font-semibold leading-tight whitespace-nowrap sm:whitespace-normal ${tab === id && !q ? "bg-ink text-white" : "bg-chip"}`} data-category={id}>
      {label}
    </button>
  );
  const posBtn = (on: boolean, big = false) => `${big ? "min-h-11 px-3 text-sm" : "min-h-9 px-2 text-xs"} rounded-control border font-bold ${on ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`;

  const row = (c: CatalogueRow | { id: string; name: string; needs_position: boolean; category: string; unit?: "each" | "set"; paired?: boolean }, entry: PartsListEntry | undefined) => {
    const key = entry ? keyOf(entry) : c.id;
    const pairOn = (choice: (typeof PAIR_CHOICES)[number]) => !!entry && entry.positions.length === choice.positions.length && choice.positions.every((p) => entry.positions.includes(p));
    const showSingles = singles.has(key) || (!!entry && entry.positions.length > 0 && !PAIR_CHOICES.some(pairOn));
    return (
      <div key={c.id} className={`rounded-control border ${entry ? "border-green bg-green-soft" : "border-line"} flex flex-col`} data-part-row={c.name}>
        <button type="button" onClick={() => toggle(c as CatalogueRow)} aria-pressed={renaming ? undefined : !!entry} className="min-h-12 flex items-center gap-3 px-3 py-2 text-left">
          {!renaming ? <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-extrabold ${entry ? "border-green bg-green text-white" : "border-line-strong bg-white"}`}>{entry ? "✓" : ""}</span> : null}
          <span className="font-semibold">{c.name}</span>
          <span className="ml-auto text-xs text-muted">{c.category}</span>
        </button>
        {entry && !renaming ? (
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose} data-part-picker={mode}>
      <div className="w-full max-w-2xl rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q && !exact) { e.preventDefault(); addCustom(query); } }} placeholder="Type to find a part…" autoFocus spellCheck lang="en" className="min-h-12 w-full rounded-control border border-line-strong px-3.5 text-base outline-none focus:border-ink" aria-label="Find a part" />
        <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)] gap-3 min-h-0 flex-1">
          <div className="flex sm:flex-col gap-1 overflow-auto" data-categories>
            {suggested.length ? tabBtn("suggested", "Suggested") : null}
            {tabBtn("most", "Most used")}
            {categories.map((c) => tabBtn(c, c))}
          </div>
          <div className="overflow-auto flex flex-col gap-1.5" data-part-list>
            {shown.length === 0 && !q ? <p className="text-sm text-muted p-2">Pick a category, or start typing.</p> : null}
            {shown.map((c) => row(c, picked.get(c.id)))}
            {!renaming ? customPicked.map((e) => row({ id: keyOf(e), name: e.name, needs_position: true, category: "Custom" }, e)) : null}
            {q && !exact ? (
              <button type="button" onClick={() => addCustom(query)} className="min-h-12 rounded-control border border-dashed border-line-strong px-3 text-left text-sm font-bold" data-use-custom>
                Use &quot;{query.trim()}&quot; as a custom part
              </button>
            ) : null}
          </div>
        </div>
        {offers.length && !renaming ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-chip p-2 text-xs" data-goes-with>
            <span className="font-semibold">Goes with:</span>
            {offers.map((o) => (
              <button key={o.key} type="button" onClick={() => acceptOffer(o)} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 font-bold">+ Add {o.label.charAt(0).toLowerCase()}{o.label.slice(1)}?</button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {customOpen ? (
            <div className="flex flex-wrap items-center gap-2" data-custom-part>
              <input value={customText} onChange={(e) => setCustomText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(customText); } }} placeholder="Part name, in your own words" autoFocus spellCheck lang="en" className="min-h-11 flex-1 min-w-[12rem] rounded-control border border-line-strong px-3 text-sm outline-none focus:border-ink" aria-label="Custom part name" />
              <button type="button" onClick={() => addCustom(customText)} disabled={!customText.trim()} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white disabled:opacity-40">{renaming ? "Use this name" : "Add"}</button>
              <button type="button" onClick={() => setCustomOpen(false)} className="min-h-11 rounded-control px-3 text-sm font-semibold text-muted">Cancel</button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {!customOpen ? (
              <button type="button" onClick={() => { setCustomText(query.trim()); setCustomOpen(true); }} className="min-h-11 rounded-control border border-dashed border-line-strong px-3 text-sm font-bold" data-custom-part-button>Custom part</button>
            ) : <span />}
            {renaming ? (
              <span className="text-sm text-muted">Tap the new name.</span>
            ) : (
              <>
                <span className="text-sm text-muted ml-auto">{picked.size ? `${picked.size} part${picked.size === 1 ? "" : "s"} picked. Keep tapping, then Done.` : "Nothing picked yet"}</span>
                <button type="button" onClick={() => onDone?.(Array.from(picked.values()))} className="min-h-12 rounded-control bg-ink px-6 text-base font-bold text-white">
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function keyOf(e: PartsListEntry) {
  return e.catalogue_id ?? `custom:${e.name.toLowerCase()}`;
}

export { CATEGORY_ORDER };
