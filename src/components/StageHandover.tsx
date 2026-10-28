"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { useSearchParams } from "next/navigation";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * THE stage hand-over (28 October 2026, B2): a team signs its stage off with photos of the finished work and the
 * leader's own PIN, in one window; the next team is told. Used on My section and the bodyshop job page. The photos
 * are job files of kind bodyshop_photo tied to the stage; the server checks the photos, the PIN and the team.
 */
export function StageHandover({ jobId, stage, nextLabel, photos: initial, needPin, action, from }: { jobId: string; stage: { id: string; key: string; label: string }; nextLabel: string | null; photos: JobFile[]; needPin: boolean; action: Action; from?: string }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<JobFile[]>(initial);
  // The page comes back with the server's answer (a refusal or the sign-off): the window closes so it is seen.
  const answer = useSearchParams().toString();
  const [seen, setSeen] = useState(answer);
  if (answer !== seen) {
    setSeen(answer);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <Button type="button" size="md" onClick={() => setOpen(true)} data-stage-handover-open={stage.key}>{stage.label} done</Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={`Hand over: ${stage.label}`} data-stage-handover={stage.key}>
          <form action={action} className="flex w-full max-w-md flex-col gap-3 rounded-card bg-white p-5 shadow-xl max-h-[92vh] overflow-y-auto">
            <span className="text-lg font-extrabold">{stage.label} done</span>
            <span className="text-sm text-muted">{nextLabel ? `Next: ${nextLabel}. That team is told.` : "This is the last stage before QC and the handover."}</span>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Photos of the finished work <span className="font-medium text-muted">(at least one)</span></span>
              <JobFileUpload jobId={jobId} kind="bodyshop_photo" refId={stage.id} files={photos} caption={`${stage.label} done`} removable onAdded={(f) => setPhotos((p) => [...p, f])} onRemoved={(f) => setPhotos((p) => p.filter((x) => x.id !== f.id))} />
            </div>
            {needPin ? (
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Your PIN</span>
                <Input name="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} required className="w-40" autoFocus data-handover-pin />
              </label>
            ) : null}
            {from ? <input type="hidden" name="from" value={from} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={!photos.length} data-stage-handover-send>Sign off and hand over</Button>
              <Button type="button" tone="secondary" size="lg" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
            {!photos.length ? <span className="text-xs font-semibold text-amber">Add a photo first.</span> : null}
          </form>
        </div>
      ) : null}
    </>
  );
}
