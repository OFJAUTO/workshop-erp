"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Button, Textarea } from "@/components/ui";

/** "Wash done" with an optional photo, and "Skip with a reason" for advisors and the owner. */
export function WashForms({ jobId, canSkip, doneAction, skipAction }: { jobId: string; canSkip: boolean; doneAction: (formData: FormData) => void; skipAction: (formData: FormData) => void }) {
  const [photo, setPhoto] = useState<JobFile | null>(null);
  const [skipping, setSkipping] = useState(false);
  return (
    <div className="flex flex-col gap-2 md:items-end">
      {!skipping ? (
        <form action={doneAction} className="flex flex-wrap items-center gap-2">
          <JobFileUpload jobId={jobId} kind="wash_photo" files={photo ? [photo] : []} label="Photo (optional)" compact onAdded={(f) => setPhoto(f)} />
          <input type="hidden" name="photo_path" value={photo?.path ?? ""} />
          <Button type="submit" size="lg">Wash done</Button>
          {canSkip ? <Button type="button" tone="ghost" size="md" onClick={() => setSkipping(true)}>Skip the wash</Button> : null}
        </form>
      ) : (
        <form action={skipAction} className="flex flex-wrap items-end gap-2">
          <Textarea name="reason" rows={1} required placeholder="Why the wash is skipped (logged)" className="min-w-64" />
          <Button type="submit" tone="secondary" size="md">Skip, car is Ready</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => setSkipping(false)}>Back</Button>
        </form>
      )}
    </div>
  );
}
