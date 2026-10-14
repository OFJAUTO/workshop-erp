"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";

export type UpdateKind = "arrived" | "film" | "ready";
export type UpdateState = { kind: UpdateKind; title: string; photoId: string | null; token: string | null; sentAt: string | null; message: string | null };
type Action = (formData: FormData) => void | Promise<void>;

/**
 * The three customer updates. For each: pick one good photo (tap), then Send opens WhatsApp with the short message
 * and the link; "Sent" is written down. Photos come from the job's bodyshop photos; new ones can be added here.
 */
export function UpdatesPanel({ jobId, updates, photos, afterPhotoId, phoneDigits, canAct, onPhoto, onSent, onAfterPhoto }: { jobId: string; updates: UpdateState[]; photos: JobFile[]; afterPhotoId: string | null; phoneDigits: string; canAct: boolean; onPhoto: Action; onSent: Action; onAfterPhoto: Action }) {
  const [files, setFiles] = useState<JobFile[]>(photos);
  const [picking, setPicking] = useState<UpdateKind | "after" | null>(null);
  const [sending, setSending] = useState<UpdateState | null>(null);
  const [sentLocal, setSentLocal] = useState<Set<UpdateKind>>(new Set());
  const urlOf = (id: string | null) => files.find((f) => f.id === id)?.url ?? null;
  return (
    <div className="flex flex-col gap-3" data-updates-panel>
      <ul className="divide-y divide-line">
        {updates.map((u) => {
          const sent = u.sentAt || sentLocal.has(u.kind);
          const photoUrl = urlOf(u.photoId);
          return (
            <li key={u.kind} className="py-2 flex flex-wrap items-center gap-3" data-update={u.kind} data-sent={!!sent}>
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="h-12 w-16 rounded-control object-cover bg-chip" />
              ) : <span className="h-12 w-16 rounded-control bg-chip" />}
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm font-bold">{u.title}</span>
                <span className="text-xs text-muted">{sent ? `Sent${u.sentAt ? ` ${new Date(u.sentAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}` : u.photoId ? "Photo chosen, not sent yet" : "Pick a photo first"}</span>
              </span>
              {canAct ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Button type="button" tone="secondary" size="md" onClick={() => setPicking(picking === u.kind ? null : u.kind)} data-pick-photo={u.kind}>{u.photoId ? "Change photo" : "Pick photo"}</Button>
                  {u.message && u.photoId && !sent ? <Button type="button" size="md" onClick={() => setSending(u)} data-send-update={u.kind}>Send</Button> : null}
                </span>
              ) : null}
            </li>
          );
        })}
        <li className="py-2 flex flex-wrap items-center gap-3" data-update="after">
          {urlOf(afterPhotoId) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urlOf(afterPhotoId) ?? ""} alt="" className="h-12 w-16 rounded-control object-cover bg-chip" />
          ) : <span className="h-12 w-16 rounded-control bg-chip" />}
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-sm font-bold">After photo for the handover page</span>
            <span className="text-xs text-muted">{afterPhotoId ? "Chosen" : "Pick the best finished photo"}</span>
          </span>
          {canAct ? <Button type="button" tone="secondary" size="md" onClick={() => setPicking(picking === "after" ? null : "after")} data-pick-photo="after">{afterPhotoId ? "Change photo" : "Pick photo"}</Button> : null}
        </li>
      </ul>
      {picking ? (
        <div className="rounded-card border border-line bg-canvas p-3 flex flex-col gap-2" data-photo-picker>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Tap the photo for {picking === "after" ? "the handover page" : updates.find((u) => u.kind === picking)?.title}</span>
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <form key={f.id} action={picking === "after" ? onAfterPhoto : onPhoto}>
                <input type="hidden" name="kind" value={picking === "after" ? "" : picking} />
                <input type="hidden" name="photo_id" value={f.id} />
                <button type="submit" className="h-20 w-28 overflow-hidden rounded-control border-2 border-line-strong bg-chip hover:border-ink" aria-label="Use this photo" data-photo-choice>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {f.url ? <img src={f.url} alt="" className="h-full w-full object-cover" /> : null}
                </button>
              </form>
            ))}
          </div>
          <JobFileUpload jobId={jobId} kind="bodyshop_photo" files={[]} label="Add a photo" onAdded={(f) => setFiles((p) => [...p, f])} compact />
        </div>
      ) : null}
      {sending ? (
        <SendLinkDialog
          title={sending.title}
          message={sending.message}
          phoneDigits={phoneDigits}
          onSent={() => { const fd = new FormData(); fd.set("kind", sending.kind); void onSent(fd); setSentLocal((s) => new Set(s).add(sending.kind)); setSending(null); }}
          onClose={() => setSending(null)}
        />
      ) : null}
    </div>
  );
}
