"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";

/** Section 11: the photo after the tint is fitted, on the bodyshop page (the PPF tablet takes the same photo with a PIN). */
export function TintFittedPhotos({ jobId, files: initial, canAdd }: { jobId: string; files: JobFile[]; canAdd: boolean }) {
  const [files, setFiles] = useState(initial);
  return (
    <div data-tint-photos={files.length}>
      <JobFileUpload jobId={jobId} kind="bodyshop_photo" caption="Tint fitted" files={files} label="Photo after fitting" disabled={!canAdd} removable={canAdd} compact onAdded={(f) => setFiles((p) => [...p, f])} onRemoved={(f) => setFiles((p) => p.filter((x) => x.id !== f.id))} />
    </div>
  );
}
