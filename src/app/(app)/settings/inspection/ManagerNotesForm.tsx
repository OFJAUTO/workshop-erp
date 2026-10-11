"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, SectionLabel, Textarea } from "@/components/ui";

/** The workshop manager's one-tap notes on the report approval: one per line. The most used float to the top on their own. */
export function ManagerNotesForm({ action, initial, usage }: { action: FormAction; initial: string[]; usage: Record<string, number> }) {
  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel right={`${initial.length}`}>Workshop manager&apos;s one-tap notes</SectionLabel>
      <p className="text-xs text-muted">
        Offered as buttons when the manager approves a report; several can be tapped and the text edited. The most used come first. &quot;Safe to drive&quot; notes ask for a second tap. One note per line.
      </p>
      <ActionForm action={action} className="flex flex-col gap-3">
        {(v) => (
          <>
            <Textarea name="presets" defaultValue={v.presets ?? initial.join("\n")} rows={Math.min(18, Math.max(6, initial.length + 1))} required textCase="sentence" />
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
