"use client";

import { useEffect, useState } from "react";
import { Button, Textarea } from "@/components/ui";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { newUuid } from "@/lib/uuid";
import { useSearchParams } from "next/navigation";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * THE "Problem – needs manager" button (28 October 2026, B2): a team leader says what is wrong with a photo; the
 * bodyshop manager and the advisor in charge are told, and the leader hears when it is answered. The photo is tied
 * to the problem by a key made here, so it is saved before the problem itself.
 */
export function ProblemButton({ jobId, stageId, action, from }: { jobId: string; stageId: string | null; action: Action; from?: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => newUuid());
  const [photos, setPhotos] = useState<JobFile[]>([]);
  // The page comes back with the server's answer: the window closes and the next problem starts fresh.
  const answer = useSearchParams().toString();
  const [seen, setSeen] = useState(answer);
  if (answer !== seen) {
    setSeen(answer);
    if (/message=/.test(answer)) {
      setOpen(false);
      setKey(newUuid());
      setPhotos([]);
    }
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)} data-problem-open>Problem – needs manager</Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Problem – needs manager" data-problem-dialog>
          <form action={action} className="flex w-full max-w-md flex-col gap-3 rounded-card bg-white p-5 shadow-xl max-h-[92vh] overflow-y-auto">
            <span className="text-lg font-extrabold">Problem – needs manager</span>
            <input type="hidden" name="problem_id" value={key} />
            {stageId ? <input type="hidden" name="stage_id" value={stageId} /> : null}
            {from ? <input type="hidden" name="from" value={from} /> : null}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">What is wrong?</span>
              <Textarea name="text" rows={3} required minLength={3} maxLength={1000} autoFocus placeholder="For example: a deep scratch under the film on the bonnet" textCase="sentence" data-problem-text />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Photo <span className="font-medium text-muted">(recommended)</span></span>
              <JobFileUpload jobId={jobId} kind="bodyshop_photo" refId={key} files={photos} caption="Problem" removable onAdded={(f) => setPhotos((p) => [...p, f])} onRemoved={(f) => setPhotos((p) => p.filter((x) => x.id !== f.id))} />
            </div>
            <span className="text-xs text-muted">The bodyshop manager and the advisor in charge are told at once.</span>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" data-problem-send>Send to the manager</Button>
              <Button type="button" tone="secondary" size="lg" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
