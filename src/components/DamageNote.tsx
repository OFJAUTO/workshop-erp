"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "./ui";
import { saveMediaDetails } from "@/lib/upload-client";

/** One optional note under the damage close-ups, for example "scratches and dents all around". */
export function DamageNote({ jobId, initial, token }: { jobId: string; initial: string; token?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveMediaDetails(jobId, { damageNote: value }, token);
      setSavedValue(value.trim());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = value.trim() !== savedValue;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Damage note <span className="text-xs font-medium text-muted">(optional)</span></span>
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} maxLength={500} placeholder="For example: scratches and dents all around" />
      </label>
      <div className="flex items-center gap-3">
        <Button size="md" tone={dirty ? "primary" : "secondary"} disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save note"}
        </Button>
        {!dirty && savedValue ? <span className="text-xs font-semibold text-green">Saved</span> : null}
        {error ? <span className="text-sm font-semibold text-red">{error}</span> : null}
      </div>
    </div>
  );
}
