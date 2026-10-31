"use client";

import { useEffect, useState } from "react";
import { Button, Textarea } from "@/components/ui";
import { JobFileUpload, markFormSent, useFormKey, useRenewAfterAnswer, type FilesWaiting, type JobFile } from "@/components/JobFileUpload";
import { useSearchParams } from "next/navigation";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * THE "Problem – needs manager" button (28 October 2026, B2): a team leader says what is wrong with a photo; the
 * bodyshop manager and the advisor in charge are told, and the leader hears when it is answered. The photo is tied
 * to the problem by a key made here, so it is saved before the problem itself. Since 31 October 2026 the photo goes
 * through the send queue: the key stays the same across a reload (a photo still waiting on the device stays with the
 * problem), and Send waits until the server has the photo - the problem picks its photo up once, when it is saved.
 */
export function ProblemButton({ jobId, stageId, action, from }: { jobId: string; stageId: string | null; action: Action; from?: string }) {
  const [open, setOpen] = useState(false);
  const formTag = `problem:${jobId}:${stageId ?? "car"}`;
  const { key, renew } = useFormKey(formTag, jobId);
  // The photos the server has for THIS problem's key (the next problem starts with none).
  const [photoState, setPhotoState] = useState<{ key: string | null; files: JobFile[] }>({ key: null, files: [] });
  if (photoState.key !== key) setPhotoState({ key, files: [] });
  const photos = photoState.key === key ? photoState.files : [];
  const [wait, setWait] = useState<FilesWaiting>({ count: 0, stopped: 0 });
  // The page comes back with the server's answer: the window closes so it is seen.
  const answer = useSearchParams().toString();
  const [seen, setSeen] = useState(answer);
  if (answer !== seen) {
    setSeen(answer);
    if (/message=/.test(answer)) setOpen(false);
  }
  // This problem was sent: its key is spent, the next problem starts fresh.
  useRenewAfterAnswer(formTag, key, renew);
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
          <form action={action} onSubmit={() => markFormSent(formTag, key)} className="flex w-full max-w-md flex-col gap-3 rounded-card bg-white p-5 shadow-xl max-h-[92vh] overflow-y-auto">
            <span className="text-lg font-extrabold">Problem – needs manager</span>
            <input type="hidden" name="problem_id" value={key ?? ""} />
            {stageId ? <input type="hidden" name="stage_id" value={stageId} /> : null}
            {from ? <input type="hidden" name="from" value={from} /> : null}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">What is wrong?</span>
              <Textarea name="text" rows={3} required minLength={3} maxLength={1000} autoFocus placeholder="For example: a deep scratch under the film on the bonnet" textCase="sentence" data-problem-text />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Photo <span className="font-medium text-muted">(recommended)</span></span>
              {key ? (
                <JobFileUpload
                  jobId={jobId}
                  kind="bodyshop_photo"
                  refId={key}
                  form={{ tag: formTag, key }}
                  files={photos}
                  caption="Problem"
                  removable
                  onAdded={(f) => setPhotoState((s) => (f.refId === s.key && !s.files.some((x) => x.id === f.id) ? { ...s, files: [...s.files, f] } : s))}
                  onRemoved={(f) => setPhotoState((s) => ({ ...s, files: s.files.filter((x) => x.id !== f.id) }))}
                  onPending={setWait}
                />
              ) : null}
            </div>
            <span className="text-xs text-muted">The bodyshop manager and the advisor in charge are told at once.</span>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={!key || wait.count > 0} data-problem-send>Send to the manager</Button>
              <Button type="button" tone="secondary" size="lg" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
            {wait.count ? (
              <span className={`text-xs font-semibold ${wait.stopped ? "text-red" : "text-amber"}`} data-problem-photo-sending>
                {wait.stopped ? "The photo could not be sent – try again, or remove it to send without it." : "The photo is still sending – Send works once it has arrived (or remove it to send without it)."}
              </span>
            ) : null}
          </form>
        </div>
      ) : null}
    </>
  );
}
