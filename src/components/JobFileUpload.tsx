"use client";

import { useRef, useState } from "react";
import { Lightbox } from "./Lightbox";
import { PhotoButton } from "./PhotoButton";
import { putWithProgress, reportUploadFailure, shrinkPhoto, type UploadStep } from "@/lib/upload-client";

export type JobFile = { id: string; path: string; url: string | null; caption?: string | null; contentType?: string | null };

const STEP_TIMEOUT_MS = 60_000;

async function uploadOne(jobId: string, kind: string, refId: string | null, original: File, onProgress: (p: number) => void, caption?: string): Promise<JobFile> {
  const originalType = original.type || (original.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  // 30 October 2026: a photo is shrunk on the phone first (the shared rule: 2000 px, JPEG 80%, about 0.5 MB).
  const small = originalType.startsWith("image/") ? await shrinkPhoto(original) : { blob: original as Blob, type: originalType, shrunk: false };
  const file = small.blob;
  const type = small.type;
  let step: UploadStep = "prepare";
  try {
    const prep = await fetch("/api/files/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, contentType: type }), signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
    const p = (await prep.json()) as { path?: string; url?: string; error?: string };
    if (!prep.ok || !p.path || !p.url) throw new Error(p.error ?? "Could not prepare the upload.");
    step = "upload";
    await putWithProgress(p.url, file, type, onProgress);
    step = "register";
    const reg = await fetch("/api/files/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, kind, refId, path: p.path, contentType: type, caption: caption ?? (type === "application/pdf" ? original.name.slice(0, 120) : undefined) }), signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
    const r = (await reg.json()) as { ok?: boolean; id?: string; url?: string | null; error?: string };
    if (!reg.ok || !r.ok || !r.id) throw new Error(r.error ?? "Could not record the file.");
    return { id: r.id, path: p.path, url: r.url ?? null, caption: caption ?? (type === "application/pdf" ? original.name : null), contentType: type };
  } catch (err) {
    reportUploadFailure({ jobId, kind: `job_${kind}`, step, error: err, sizeBytes: file.size, contentType: type, extra: { refId } });
    throw err;
  }
}

/**
 * Photos (the camera inside the page on a phone or tablet, the picker on a PC) or a PDF attached to a job: work
 * photos per line, the wash, the delivery, a supplier invoice scan, the QC post-scan. Uploads straight to storage
 * with progress; a failure is logged with the device and shown with Retry, and the button always comes back.
 */
export function JobFileUpload({ jobId, kind, refId = null, files, accept = "photo", label, disabled = false, onAdded, onRemoved, removable = false, compact = false, caption }: { jobId: string; kind: string; refId?: string | null; files: JobFile[]; accept?: "photo" | "pdf" | "any"; label?: string; disabled?: boolean; /** Written on every file uploaded here (what the photo shows). */ caption?: string; onAdded?: (f: JobFile) => void; /** The X on each thumbnail: marks the file removed on the server, then tells the holder. */ onRemoved?: (f: JobFile) => void; removable?: boolean; compact?: boolean }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<File[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function removeOne(f: JobFile) {
    setError(null);
    try {
      const res = await fetch("/api/files/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }), signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
      const r = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !r.ok) throw new Error(r.error ?? "Could not remove the file.");
      onRemoved?.(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the file.");
    }
  }
  const isPdf = (f: JobFile) => f.contentType === "application/pdf" || !!f.caption?.toLowerCase().endsWith(".pdf");
  const slides = files.filter((f) => !isPdf(f) && f.url).map((f) => ({ key: f.id, url: f.url as string, label: f.caption ?? "Photo", kind: (f.contentType ?? "").startsWith("video/") ? ("video" as const) : ("image" as const) }));
  const acceptAttr = accept === "pdf" ? "application/pdf,image/*" : "image/*,video/*,application/pdf";

  async function handleFiles(list: File[]) {
    if (!list.length) return;
    setError(null);
    setFailed([]);
    const notDone: File[] = [];
    try {
      for (const file of list) {
        setProgress(0);
        try {
          const added = await uploadOne(jobId, kind, refId, file, setProgress, caption);
          onAdded?.(added);
        } catch (err) {
          notDone.push(file);
          setError(err instanceof Error ? err.message : "Upload failed.");
        }
      }
    } finally {
      setProgress(null);
    }
    setFailed(notDone);
  }

  const busy = progress !== null;
  const btn = `inline-flex ${compact ? "min-h-10" : "min-h-12"} w-fit items-center gap-2 rounded-control border border-line-strong bg-white px-4 text-sm font-bold ${busy ? "opacity-60" : "cursor-pointer"}`;
  const text = progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : (label ?? (accept === "pdf" ? "Attach PDF or photo" : "Add photo"));

  return (
    <div className="flex flex-col gap-2" data-job-file-upload>
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="relative inline-flex" data-invoice-file={f.id}>
              {isPdf(f) ? (
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-3 text-sm font-semibold ${removable ? "pr-9" : ""}`}>PDF · {f.caption ?? "file"}</a>
              ) : (
                <button type="button" onClick={() => setOpen(slides.findIndex((s) => s.key === f.id))} className={`${compact ? "h-16 w-16" : "h-24 w-24"} overflow-hidden rounded-control bg-chip cursor-zoom-in`} aria-label="Enlarge">
                  {(f.contentType ?? "").startsWith("video/") ? <video src={f.url ?? undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url ?? ""} alt="Photo" className="h-full w-full object-cover" />
                  )}
                </button>
              )}
              {removable && !disabled ? (
                <button type="button" onClick={() => void removeOne(f)} aria-label="Remove this file" data-remove-file={f.id} className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-sm font-bold text-white">×</button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          {accept === "photo" ? (
            <>
              <PhotoButton source="camera" multiple disabled={busy} className={btn} title={label ?? "Add photo"} onFiles={(f) => void handleFiles(f)} onProblem={(m) => reportUploadFailure({ jobId, kind: `job_${kind}`, step: "camera", error: m })}>
                {text}
              </PhotoButton>
              <PhotoButton source="gallery" multiple disabled={busy} className={`${btn} text-xs`} title="From gallery" onFiles={(f) => void handleFiles(f)}>
                From gallery
              </PhotoButton>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept={acceptAttr} multiple={accept !== "pdf"} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; void handleFiles(list); }} className="sr-only" tabIndex={-1} aria-hidden />
              <button type="button" disabled={busy} onClick={() => { const el = fileRef.current; if (el) { el.value = ""; el.click(); } }} className={btn}>{text}</button>
            </>
          )}
        </div>
      ) : null}
      {open !== null && slides[open] ? <Lightbox slides={slides} index={open} onClose={() => setOpen(null)} onMove={setOpen} /> : null}
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
      {failed.length && !busy ? <button type="button" onClick={() => void handleFiles(failed)} className="self-start min-h-10 rounded-control bg-ink px-3 text-sm font-bold text-white" data-retry>Retry{failed.length > 1 ? ` (${failed.length} files)` : ""}</button> : null}
    </div>
  );
}
