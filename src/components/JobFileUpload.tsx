"use client";

import { useState } from "react";
import { putWithProgress } from "@/lib/upload-client";

export type JobFile = { id: string; path: string; url: string | null; caption?: string | null; contentType?: string | null };

async function uploadOne(jobId: string, kind: string, refId: string | null, file: File, onProgress: (p: number) => void): Promise<JobFile> {
  const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const prep = await fetch("/api/files/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, contentType: type }) });
  const p = (await prep.json()) as { path?: string; url?: string; error?: string };
  if (!prep.ok || !p.path || !p.url) throw new Error(p.error ?? "Could not prepare the upload.");
  await putWithProgress(p.url, file, type, onProgress);
  const reg = await fetch("/api/files/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, kind, refId, path: p.path, contentType: type, caption: type === "application/pdf" ? file.name.slice(0, 120) : undefined }) });
  const r = (await reg.json()) as { ok?: boolean; id?: string; url?: string | null; error?: string };
  if (!reg.ok || !r.ok || !r.id) throw new Error(r.error ?? "Could not record the file.");
  return { id: r.id, path: p.path, url: r.url ?? null, caption: type === "application/pdf" ? file.name : null, contentType: type };
}

/**
 * Photos (phone camera or PC) or a PDF attached to a job: work photos per line, the wash, the
 * delivery, a supplier invoice scan, the QC post-scan. Uploads straight to storage with progress.
 */
export function JobFileUpload({ jobId, kind, refId = null, files, accept = "photo", label, disabled = false, onAdded, compact = false }: { jobId: string; kind: string; refId?: string | null; files: JobFile[]; accept?: "photo" | "pdf" | "any"; label?: string; disabled?: boolean; onAdded?: (f: JobFile) => void; compact?: boolean }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acceptAttr = accept === "pdf" ? "application/pdf,image/*" : accept === "any" ? "image/*,video/*,application/pdf" : "image/*";

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError(null);
    for (const file of list) {
      setProgress(0);
      try {
        const added = await uploadOne(jobId, kind, refId, file, setProgress);
        onAdded?.(added);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setProgress(null);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) =>
            f.contentType === "application/pdf" || f.caption?.toLowerCase().endsWith(".pdf") ? (
              <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-3 text-sm font-semibold">PDF · {f.caption ?? "file"}</a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer"><img src={f.url ?? ""} alt="Photo" className={`${compact ? "h-16 w-16" : "h-24 w-24"} rounded-control object-cover bg-chip`} /></a>
            ),
          )}
        </div>
      ) : null}
      {!disabled ? (
        <label className={`inline-flex ${compact ? "min-h-10" : "min-h-12"} w-fit cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-white px-4 text-sm font-bold`}>
          <input type="file" accept={acceptAttr} capture={accept === "photo" ? "environment" : undefined} multiple={accept !== "pdf"} onChange={onChange} className="sr-only" disabled={progress !== null} />
          {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : (label ?? (accept === "pdf" ? "Attach PDF or photo" : "Add photo"))}
        </label>
      ) : null}
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
    </div>
  );
}
