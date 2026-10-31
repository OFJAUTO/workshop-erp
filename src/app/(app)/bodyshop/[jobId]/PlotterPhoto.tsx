"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Button } from "@/components/ui";

/**
 * The plotter photo that goes with the metres (optional), 31 October 2026: a job file ("Film plotter") sent straight to
 * storage from the device, never with the form. The newest one the server has goes with "Save the metres" as its path;
 * while a picked photo is still on its way, Save waits for it (it would otherwise be left out). Each car starts afresh.
 */
export function PlotterPhoto({ jobId }: { jobId: string }) {
  return <PlotterPhotoOf key={jobId} jobId={jobId} />;
}

function PlotterPhotoOf({ jobId }: { jobId: string }) {
  const [files, setFiles] = useState<JobFile[]>([]);
  const [waiting, setWaiting] = useState(0);
  const newest = files.length ? files[files.length - 1] : null;
  return (
    <div className="flex flex-col gap-1 text-xs font-semibold text-muted" data-plotter-photo>
      <span>Plotter photo (optional)</span>
      <JobFileUpload jobId={jobId} kind="work_photo" caption="Film plotter" files={files} compact label="Plotter photo" onAdded={(f) => setFiles((xs) => [...xs, f])} onPending={(w) => setWaiting(w.count)} />
      {newest ? <input type="hidden" name="photo_path" value={newest.path} /> : null}
      <Button type="submit" size="md" disabled={waiting > 0} data-save-metres>{waiting > 0 ? "Photo sending…" : "Save the metres"}</Button>
    </div>
  );
}
