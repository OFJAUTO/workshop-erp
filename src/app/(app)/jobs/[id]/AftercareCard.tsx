"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import { CopyText } from "@/components/CopyText";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";

type Action = (formData: FormData) => void | Promise<void>;

/** The advisor's ready WhatsApp message for the 10-day check, one tap to send. */
export function AftercareMessage({ template, date, phoneDigits }: { template: string; date: string; phoneDigits: string }) {
  const message = template.replaceAll("[date]", date);
  return (
    <div className="flex flex-wrap items-center gap-2" data-aftercare-message>
      <p className="w-full text-sm text-muted">{message}</p>
      {phoneDigits ? (
        <a href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" data-aftercare-send>Send on WhatsApp</a>
      ) : null}
      <CopyText text={message} label="Copy the message" />
    </div>
  );
}

/** The team leader's check: three points, a note and his PIN. */
export function AftercareSignoff({ action, points, jobId, from }: { action: Action; points: string[]; jobId: string; from?: string }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<JobFile[]>([]);
  if (!open) return <Button type="button" tone="secondary" size="md" className="self-start" onClick={() => setOpen(true)} data-aftercare-open>Do the check (team leader)</Button>;
  return (
    <form action={action} className="flex flex-col gap-2 rounded-control bg-chip p-3" data-aftercare-form>
      {from ? <input type="hidden" name="from" value={from} /> : null}
      <span className="text-sm font-bold">Checked and in order (tick each point):</span>
      <div className="flex flex-wrap gap-4">
        {points.map((p) => (
          <label key={p} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="point" value={p} className="h-5 w-5 accent-ink" />
            {p}
          </label>
        ))}
      </div>
      <Textarea name="note" rows={2} placeholder="Anything polished or fixed (optional)" textCase="sentence" />
      <div className="flex flex-col gap-1" data-aftercare-photos={photos.length}>
        <span className="text-xs font-semibold text-muted">Photos of the check (they show on the customer&apos;s warranty page)</span>
        <JobFileUpload jobId={jobId} kind="bodyshop_photo" caption="10-day check" files={photos} label="Photo" compact onAdded={(f) => setPhotos((p) => [...p, f])} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="pin" type="password" inputMode="numeric" placeholder="Your PIN" aria-label="Your PIN" className="text-center text-xl tracking-[0.4em]" style={{ width: "8.5rem" }} data-aftercare-pin />
        <Button type="submit" size="md" data-aftercare-sign>Sign the check off</Button>
        <Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <p className="text-xs text-muted">Signing off activates the customer&apos;s warranty. The owner signs without a PIN.</p>
    </form>
  );
}
