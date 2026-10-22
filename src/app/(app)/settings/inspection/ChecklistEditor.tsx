"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, Card, Input } from "@/components/ui";
import { ITEM_STYLE_LABELS, slugKey, type ChecklistSection, type ItemStyle } from "@/lib/inspection";

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

/**
 * Add, remove, rename and reorder the sections and items of the inspection checklist. Every item has an
 * answer style: Good / Average / Bad for a part of the car, OK / Required for a service item. Each section
 * can carry the customer-complaint words that tag it on the technician's screen.
 */
export function ChecklistEditor({ action, initial, initialComplaints = {} }: { action: FormAction; initial: ChecklistSection[]; initialComplaints?: Record<string, string[]> }) {
  const [sections, setSections] = useState<ChecklistSection[]>(initial);
  const [complaints, setComplaints] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initialComplaints).map(([k, v]) => [k, (v ?? []).join(", ")])));

  const setSection = (i: number, patch: Partial<ChecklistSection>) => setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const setItem = (si: number, ii: number, patch: { label?: string; style?: ItemStyle; due?: boolean }) =>
    setSections((prev) => prev.map((s, idx) => (idx === si ? { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : s)));

  const small = "min-h-9 min-w-9 rounded-control border border-line-strong bg-white px-2 text-xs font-bold";
  const complaintJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(complaints)
        .map(([k, text]) => [k, text.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean)])
        .filter(([, words]) => (words as string[]).length > 0),
    ),
  );

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {() => (
        <>
          <input type="hidden" name="checklist" value={JSON.stringify(sections)} />
          <input type="hidden" name="complaint_keywords" value={complaintJson} />
          {sections.map((s, si) => (
            <Card key={s.key} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} className="flex-1 font-bold" aria-label="Section title" />
                <button type="button" className={small} onClick={() => setSections((p) => move(p, si, si - 1))} aria-label="Move section up">↑</button>
                <button type="button" className={small} onClick={() => setSections((p) => move(p, si, si + 1))} aria-label="Move section down">↓</button>
                <button type="button" className={`${small} text-red`} onClick={() => setSections((p) => p.filter((_, idx) => idx !== si))} aria-label="Remove section">✕</button>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Customer complaint words (comma separated): a request with one of these words tags this section &quot;Customer complaint&quot;</span>
                <Input value={complaints[s.key] ?? ""} onChange={(e) => setComplaints((c) => ({ ...c, [s.key]: e.target.value }))} placeholder="For example: brake, squeal, vibration" />
              </label>
              <ul className="flex flex-col gap-2 pl-2">
                {s.items.map((it, ii) => {
                  const style: ItemStyle = it.style ?? "grade";
                  // Tap to go round the three answer styles: Good / Average / Bad, OK / Required, Good / Low / Empty (A/C gas).
                  const nextStyle: ItemStyle = style === "grade" ? "job" : style === "job" ? "gas" : "grade";
                  return (
                    <li key={it.key} className="flex items-center gap-2">
                      <Input value={it.label} onChange={(e) => setItem(si, ii, { label: e.target.value })} className="flex-1" aria-label="Item name" />
                      <button
                        type="button"
                        onClick={() => setItem(si, ii, { style: nextStyle })}
                        className={`min-h-9 whitespace-nowrap rounded-control border px-2 text-xs font-bold ${style !== "grade" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}
                        aria-label="Answer style"
                        title="Tap to switch the answer style"
                      >
                        {ITEM_STYLE_LABELS[style]}
                      </button>
                      <button type="button" onClick={() => setItem(si, ii, { due: !it.due })} aria-pressed={!!it.due} className={`min-h-9 whitespace-nowrap rounded-control border px-2 text-xs font-bold ${it.due ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-muted"}`} title="The item also asks: Service due?" data-item-due>{it.due ? "Asks: service due ✓" : "Service due?"}</button>
                      <button type="button" className={small} onClick={() => setSection(si, { items: move(s.items, ii, ii - 1) })} aria-label="Move item up">↑</button>
                      <button type="button" className={small} onClick={() => setSection(si, { items: move(s.items, ii, ii + 1) })} aria-label="Move item down">↓</button>
                      <button type="button" className={`${small} text-red`} onClick={() => setSection(si, { items: s.items.filter((_, j) => j !== ii) })} aria-label="Remove item">✕</button>
                    </li>
                  );
                })}
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
        </>
      )}
    </ActionForm>
  );
}
