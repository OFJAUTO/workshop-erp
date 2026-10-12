"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, Input, SectionLabel, Textarea } from "@/components/ui";
import type { ChipRow } from "@/lib/road-test-chips";

/** Settings: the one-tap remarks of the road test, per item, rows of chips one per line. Most used chips come first on the form. */
export function RoadTestChipsForm({ action, items, rows }: { action: FormAction; items: { key: string; label: string }[]; rows: Record<string, ChipRow[]> }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(v) => (
        <Card className="flex flex-col gap-4">
          <SectionLabel>Road test: one-tap remarks</SectionLabel>
          <p className="text-xs text-muted">Chips appear when an item is marked Bad or Average. One tap from each row writes the sentence (Clunk + Front left + Over bumps = &quot;Clunk from the front left over bumps.&quot;). One chip per line; a row left empty is not shown. The most used chips come first on the road test.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {items.map((it) => (
              <div key={it.key} className="flex flex-col gap-2 rounded-control border border-line p-3">
                <span className="text-sm font-extrabold">{it.label}</span>
                {[0, 1, 2].map((i) => {
                  const row = (rows[it.key] ?? [])[i];
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <Input name={`label__${it.key}__${i}`} defaultValue={v[`label__${it.key}__${i}`] ?? row?.label ?? ["What", "Where", "When"][i]} aria-label={`${it.label} row ${i + 1} heading`} className="min-h-9 text-xs font-bold w-40" />
                      <Textarea name={`chips__${it.key}__${i}`} defaultValue={v[`chips__${it.key}__${i}`] ?? (row?.chips ?? []).join("\n")} rows={Math.min(8, Math.max(2, (row?.chips.length ?? 0) + 1))} className="min-h-12 text-xs" aria-label={`${it.label} row ${i + 1} chips`} textCase="sentence" />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div><SubmitButton>Save road test remarks</SubmitButton></div>
        </Card>
      )}
    </ActionForm>
  );
}
