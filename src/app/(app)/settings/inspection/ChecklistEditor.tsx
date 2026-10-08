"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, Card, Input } from "@/components/ui";
import { slugKey, type ChecklistSection } from "@/lib/inspection";

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Add, remove, rename and reorder the sections and items of the inspection checklist. */
export function ChecklistEditor({ action, initial }: { action: FormAction; initial: ChecklistSection[] }) {
  const [sections, setSections] = useState<ChecklistSection[]>(initial);

  const setSection = (i: number, patch: Partial<ChecklistSection>) => setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const setItem = (si: number, ii: number, label: string) => setSections((prev) => prev.map((s, idx) => (idx === si ? { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, label } : it)) } : s)));

  const small = "min-h-9 min-w-9 rounded-control border border-line-strong bg-white px-2 text-xs font-bold";

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {() => (
        <>
          <input type="hidden" name="checklist" value={JSON.stringify(sections)} />
          {sections.map((s, si) => (
            <Card key={s.key} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} className="flex-1 font-bold" aria-label="Section title" />
                <button type="button" className={small} onClick={() => setSections((p) => move(p, si, si - 1))} aria-label="Move section up">↑</button>
                <button type="button" className={small} onClick={() => setSections((p) => move(p, si, si + 1))} aria-label="Move section down">↓</button>
                <button type="button" className={`${small} text-red`} onClick={() => setSections((p) => p.filter((_, idx) => idx !== si))} aria-label="Remove section">✕</button>
              </div>
              <ul className="flex flex-col gap-2 pl-2">
                {s.items.map((it, ii) => (
                  <li key={it.key} className="flex items-center gap-2">
                    <Input value={it.label} onChange={(e) => setItem(si, ii, e.target.value)} className="flex-1" aria-label="Item name" />
                    <button type="button" className={small} onClick={() => setSection(si, { items: move(s.items, ii, ii - 1) })} aria-label="Move item up">↑</button>
                    <button type="button" className={small} onClick={() => setSection(si, { items: move(s.items, ii, ii + 1) })} aria-label="Move item down">↓</button>
                    <button type="button" className={`${small} text-red`} onClick={() => setSection(si, { items: s.items.filter((_, j) => j !== ii) })} aria-label="Remove item">✕</button>
                  </li>
                ))}
              </ul>
              <div>
                <Button type="button" tone="secondary" size="md" onClick={() => setSection(si, { items: [...s.items, { key: `${s.key}.${slugKey("new item")}_${Date.now().toString(36)}`, label: "" }] })}>
                  Add item
                </Button>
              </div>
            </Card>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" tone="secondary" onClick={() => setSections((p) => [...p, { key: `section_${Date.now().toString(36)}`, title: "", items: [{ key: `section_${Date.now().toString(36)}.item`, label: "" }] }])}>
              Add section
            </Button>
            <SubmitButton>Save checklist</SubmitButton>
          </div>
          <p className="text-xs text-muted">Reports already started keep the checklist they were started with. New inspections use the saved list.</p>
        </>
      )}
    </ActionForm>
  );
}
