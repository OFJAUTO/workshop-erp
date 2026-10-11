"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, SectionLabel, Textarea } from "@/components/ui";

/** The workshop manager's one-tap notes under their four headings, one note per line. The most used show first on the approval. */
export function ManagerNotesForm({ action, groups, usage }: { action: FormAction; groups: Record<string, string[]>; usage: Record<string, number> }) {
  const names = Object.keys(groups);
  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel right={`${Object.values(groups).flat().length}`}>Workshop manager&apos;s one-tap notes</SectionLabel>
      <p className="text-xs text-muted">
        Offered as buttons when the manager approves a report: the five most used in one row, the rest under these headings. A tapped note turns green; a second tap takes its sentence out again. &quot;Safe to drive&quot; notes ask for a second tap. One note per line.
      </p>
      <ActionForm action={action} className="flex flex-col gap-3">
        {(v) => (
          <>
            {names.map((g) => (
              <label key={g} className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{g}</span>
                <Textarea name={`group__${g}`} defaultValue={v[`group__${g}`] ?? groups[g].join("\n")} rows={Math.min(10, Math.max(3, groups[g].length + 1))} textCase="sentence" />
              </label>
            ))}
            {Object.keys(usage).length ? (
              <p className="text-xs text-muted">
                Most tapped: {Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`).join(" · ")}
              </p>
            ) : null}
            <div>
              <SubmitButton size="md">Save notes</SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </Card>
  );
}
