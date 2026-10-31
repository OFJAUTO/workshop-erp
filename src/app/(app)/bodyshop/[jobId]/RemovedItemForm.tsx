"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Button, Input } from "@/components/ui";

type Action = (formData: FormData) => void | Promise<void>;
const QUICK = ["Badges", "Door handles", "Headlights", "Tail lights", "Mirrors", "Emblems", "Grille", "Wheel arch trims", "Spoiler", "Sensors"];

/** At Strip: tick what came off (one tap on a common part, or type it) with a photo. */
export function RemovedItemForm({ jobId, action }: { jobId: string; action: Action }) {
  const [label, setLabel] = useState("");
  const [photo, setPhoto] = useState<JobFile | null>(null);
  // The photo still on this device: Add waits for it (the item is recorded with its photo).
  const [waiting, setWaiting] = useState(0);
  return (
    <form action={action} className="flex flex-col gap-2" data-removed-form>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => setLabel(q)} aria-pressed={label === q} className={`min-h-9 rounded-control border px-2.5 text-xs font-bold ${label === q ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{q}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What came off" className="w-56" textCase="sentence" aria-label="What came off" data-removed-label />
        <input type="hidden" name="photo_path" value={photo?.path ?? ""} />
        <JobFileUpload jobId={jobId} kind="bodyshop_removed" files={photo ? [photo] : []} label={photo ? "Photo added" : "Photo"} onAdded={(f) => setPhoto(f)} onPending={(w) => setWaiting(w.count)} single compact />
        <Button type="submit" size="md" disabled={!label.trim() || waiting > 0} data-removed-add>{waiting > 0 ? "Photo sending…" : "Add"}</Button>
      </div>
    </form>
  );
}
