"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/ui";
import { archiveCategoryAction, saveCategoryAction, type StockAnswer } from "./manage-actions";

function Answer({ s }: { s: StockAnswer }) {
  if (!s) return null;
  return s.error ? <p className="text-sm font-semibold text-red">{s.error}</p> : <p className="text-sm font-semibold text-green-text" data-category-answer>{s.words}</p>;
}

function CategoryRow({ c }: { c: { id: string; name: string } }) {
  const [renamed, rename, renaming] = useActionState<StockAnswer, FormData>(saveCategoryAction, null);
  const [gone, archive, archiving] = useActionState<StockAnswer>(archiveCategoryAction.bind(null, c.id), null);
  return (
    <li className="flex flex-col gap-1 py-2" data-category-row={c.name}>
      <form action={rename} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={c.id} />
        <Input name="name" defaultValue={c.name} className="!w-auto min-w-48 flex-1" />
        <Button type="submit" tone="secondary" size="md" disabled={renaming}>Rename</Button>
        <Button type="button" tone="ghost" size="md" disabled={archiving} onClick={() => archive()}>Archive</Button>
      </form>
      <Answer s={renamed ?? gone} />
    </li>
  );
}

/** MANAGE CATEGORIES (20 November 2026, Section 5): the owner and the parts desk add, rename and archive them. */
export function CategoriesBox({ categories, canEdit }: { categories: { id: string; name: string }[]; canEdit: boolean }) {
  const [added, add, adding] = useActionState<StockAnswer, FormData>(saveCategoryAction, null);
  if (!canEdit) return <ul className="flex flex-wrap gap-2">{categories.map((c) => <li key={c.id} className="rounded-control border border-line px-2 py-1 text-sm">{c.name}</li>)}</ul>;
  return (
    <div className="flex flex-col gap-2" data-categories-box>
      <ul className="divide-y divide-line">{categories.map((c) => <CategoryRow key={c.id} c={c} />)}</ul>
      <form action={add} className="flex flex-wrap items-center gap-2">
        <Input name="name" placeholder="New category" className="!w-auto min-w-48 flex-1" data-category-new />
        <Button type="submit" size="md" disabled={adding} data-category-add>Add category</Button>
      </form>
      <Answer s={added} />
    </div>
  );
}

/** LABELS (20 November 2026, Section 5): tick the items, print black shelf labels with a QR code. */
export function LabelsPicker({ items }: { items: { id: string; name: string; partNumber: string | null }[] }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const all = ticked.size === items.length && items.length > 0;
  return (
    <div className="flex flex-col gap-2" data-labels-picker>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" tone="secondary" size="md" onClick={() => setTicked(all ? new Set() : new Set(items.map((i) => i.id)))}>{all ? "Untick all" : "Tick all"}</Button>
        <Button type="button" size="md" disabled={!ticked.size} onClick={() => window.open(`/print/stock-labels?ids=${Array.from(ticked).join(",")}`, "_blank", "noopener")} data-labels-print>Print {ticked.size || ""} label{ticked.size === 1 ? "" : "s"}</Button>
        <span className="text-xs text-muted">Black only, with a QR code: scanning it opens the item to issue or count it.</span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex min-h-11 items-center gap-2 rounded-control border border-line px-3 text-sm" data-label-item={i.id}>
              <input type="checkbox" className="h-5 w-5 accent-ink" checked={ticked.has(i.id)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setTicked(n); }} />
              <span className="font-semibold uppercase">{i.name}</span>
              {i.partNumber ? <span className="text-xs text-muted">{i.partNumber}</span> : null}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
