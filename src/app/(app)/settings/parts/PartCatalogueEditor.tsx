"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, Card, Input } from "@/components/ui";

export type EditRow = { id: string | null; key: string; category: string; name: string; needs_position: boolean; /** Comes in pairs: Front pair / Rear pair / All four. */ paired: boolean; /** Parts offered alongside, comma separated. */ goes_with: string; remove?: boolean };

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

/** The parts pool by category: rename, reorder, say whether a part needs a position or comes in pairs, what goes with it, remove, add. One Save. */
export function PartCatalogueEditor({ action, initial }: { action: FormAction; initial: EditRow[] }) {
  const [rows, setRows] = useState<EditRow[]>(initial);
  const [newCategory, setNewCategory] = useState("");
  const categories = Array.from(new Set(rows.map((r) => r.category)));
  const small = "min-h-9 min-w-9 rounded-control border border-line-strong bg-white px-2 text-xs font-bold";
  const live = rows.filter((r) => !r.remove);
  const update = (key: string, patch: Partial<EditRow>) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const toggleBtn = (on: boolean) => `min-h-9 whitespace-nowrap rounded-control border px-2 text-xs font-bold ${on ? "border-green bg-green-soft text-green" : "border-line-strong bg-white text-muted"}`;

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {() => (
        <>
          <input type="hidden" name="rows" value={JSON.stringify(rows.map((r, i) => ({ ...r, position: i + 1 })))} />
          <p className="text-xs text-muted">Position asked: the technician picks Front left, Rear and so on. Paired: Front pair, Rear pair or All four with the quantity to match (control arms, discs, shock absorbers). Goes with: parts offered alongside when this one is picked, never added by themselves (a wear sensor with brake pads).</p>
          {categories.map((cat) => {
            const inCat = rows.filter((r) => r.category === cat && !r.remove);
            return (
              <Card key={cat} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={cat} onChange={(e) => setRows((p) => p.map((r) => (r.category === cat ? { ...r, category: e.target.value } : r)))} className="flex-1 font-bold" aria-label="Category" textCase="sentence" />
                  <span className="text-xs text-muted">{inCat.length} part{inCat.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="flex flex-col gap-2 pl-2">
                  {inCat.map((r) => {
                    const idx = rows.indexOf(r);
                    return (
                      <li key={r.key} className="flex flex-wrap items-center gap-2">
                        <Input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} className="flex-1 min-w-40" aria-label="Part name" textCase="sentence" />
                        <button type="button" onClick={() => update(r.key, { needs_position: !r.needs_position })} aria-pressed={r.needs_position} className={toggleBtn(r.needs_position)}>
                          {r.needs_position ? "✓ Position asked" : "No position"}
                        </button>
                        <button type="button" onClick={() => update(r.key, { paired: !r.paired })} aria-pressed={r.paired} className={toggleBtn(r.paired)}>
                          {r.paired ? "✓ Paired" : "Paired?"}
                        </button>
                        <Input value={r.goes_with} onChange={(e) => update(r.key, { goes_with: e.target.value })} placeholder="Goes with (comma separated)" aria-label={`${r.name || "Part"} goes with`} className="min-h-9 w-56 text-xs" textCase="sentence" />
                        <button type="button" className={small} onClick={() => setRows((p) => move(p, idx, idx - 1))} aria-label="Move up">↑</button>
                        <button type="button" className={small} onClick={() => setRows((p) => move(p, idx, idx + 1))} aria-label="Move down">↓</button>
                        <button type="button" className={`${small} text-red`} onClick={() => (r.id ? update(r.key, { remove: true }) : setRows((p) => p.filter((x) => x.key !== r.key)))} aria-label="Remove part">✕</button>
                      </li>
                    );
                  })}
                </ul>
                <div>
                  <Button type="button" tone="secondary" size="md" onClick={() => setRows((p) => { const last = p.map((r) => r.category).lastIndexOf(cat); const copy = [...p]; copy.splice(last + 1, 0, { id: null, key: `new-${Date.now().toString(36)}`, category: cat, name: "", needs_position: false, paired: false, goes_with: "" }); return copy; })}>
                    Add part
                  </Button>
                </div>
              </Card>
            );
          })}
          <Card className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-48">
              <span className="text-xs font-semibold text-muted">New category</span>
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="For example: Bodywork" textCase="sentence" />
            </label>
            <Button type="button" tone="secondary" size="md" disabled={!newCategory.trim()} onClick={() => { setRows((p) => [...p, { id: null, key: `new-${Date.now().toString(36)}`, category: newCategory.trim(), name: "", needs_position: false, paired: false, goes_with: "" }]); setNewCategory(""); }}>
              Add category
            </Button>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton>Save parts list</SubmitButton>
            <span className="text-xs text-muted">{live.length} parts. A removed part stays on old reports; it just leaves the list.</span>
          </div>
        </>
      )}
    </ActionForm>
  );
}
