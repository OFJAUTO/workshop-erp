"use client";

import { useRef, useState } from "react";
import { PhotoButton } from "./PhotoButton";
import { putWithProgress, reportUploadFailure, type UploadStep } from "@/lib/upload-client";

export type InspectionFile = { id: string; kind: "photo" | "video" | "pdf"; url: string | null; caption?: string | null; isPrescan?: boolean };

const MAX_VIDEO_SECONDS = 60;
const MAX_PHOTO_PX = 2000;
const RECODE_ABOVE_BYTES = 1_500_000;
/** A server step that takes longer than this is given up and offered again. */
const STEP_TIMEOUT_MS = 60_000;

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    let settled = false;
    const finish = (d: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(v.src);
      resolve(d);
    };
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    v.src = URL.createObjectURL(file);
  });
}

/**
 * Phone photos arrive as 4 to 8 MB files, and iPhones may hand over HEIC files that other browsers
 * cannot show. Both are redrawn as a JPEG of at most 2000 px on the longer side before the upload:
 * a few hundred KB, shown everywhere. If the browser cannot decode the file, it goes up as it is.
 */
async function toJpeg(file: File): Promise<{ blob: Blob; type: string }> {
  const type = (file.type || "").toLowerCase();
  const isHeic = type === "image/heic" || type === "image/heif" || /\.hei[cf]$/i.test(file.name);
  if (!isHeic && file.size <= RECODE_ABOVE_BYTES && type !== "image/png") return { blob: file, type: type || "image/jpeg" };
  try {
    const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file) : null;
    const img = bitmap ?? (await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = URL.createObjectURL(file);
    }));
    const w = "width" in img ? img.width : 0;
    const h = "height" in img ? img.height : 0;
    if (!w || !h) throw new Error("size");
    const scale = Math.min(1, MAX_PHOTO_PX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("encode");
    return { blob, type: "image/jpeg" };
  } catch {
    if (isHeic) throw new Error("This phone saved the photo in a format the browser cannot read. Change the camera setting to Most compatible, or take the photo again.");
    return { blob: file, type: type || "image/jpeg" };
  }
}

async function uploadOne(inspectionId: string, file: File, where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }, onProgress: (p: number) => void) {
  let type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const kind = type.startsWith("video/") ? "video" : type === "application/pdf" ? "pdf" : "photo";
  let step: UploadStep = "decode";
  try {
    let duration: number | null = null;
    let body: Blob = file;
    if (kind === "video") {
      duration = await readDuration(file);
      if (duration !== null && duration > MAX_VIDEO_SECONDS + 1) throw new Error(`That video is ${Math.round(duration)} seconds. The limit is ${MAX_VIDEO_SECONDS} seconds. Please record a shorter one.`);
    } else if (kind === "photo") {
      const re = await toJpeg(file);
      body = re.blob;
      type = re.type;
    }
    step = "prepare";
    const prep = await fetch("/api/inspection-media/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId, contentType: type }), signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
    const p = (await prep.json().catch(() => ({}))) as { path?: string; url?: string; error?: string };
    if (!prep.ok || !p.path || !p.url) throw new Error(p.error ?? "Could not prepare the upload.");
    step = "upload";
    await putWithProgress(p.url, body, type, onProgress);
    step = "register";
    const reg = await fetch("/api/inspection-media/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionId, path: p.path, kind, itemKey: where.itemKey ?? null, requestId: where.requestId ?? null, isPrescan: !!where.isPrescan, duration: duration ?? undefined, caption: kind === "pdf" ? file.name : undefined }),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    const r = (await reg.json().catch(() => ({}))) as { ok?: boolean; id?: string; url?: string | null; error?: string };
    if (!reg.ok || !r.ok || !r.id) throw new Error(r.error ?? "Could not record the file.");
    return { id: r.id, kind, url: r.url ?? null, caption: kind === "pdf" ? file.name : null, isPrescan: !!where.isPrescan } as InspectionFile;
  } catch (err) {
    reportUploadFailure({ inspectionId, kind: `inspection_${kind}`, step, error: err, sizeBytes: file.size, contentType: type, extra: { itemKey: where.itemKey ?? null, prescan: !!where.isPrescan } });
    throw err;
  }
}

/**
 * Photos, short videos (up to 60 seconds, with sound) or PDFs attached to one place in the
 * report: a checklist item, a customer request, the pre-scan slot or the report as a whole.
 * "+ Photo" opens the camera inside the page on a phone or tablet (never the camera app, so the page
 * cannot reload behind it); "+ From gallery" picks saved photos (several at once). Every button is a
 * real button; a camera the browser has blocked shows the steps to allow it. A failed upload is
 * logged with the device and the step and shown with Retry.
 */
export function InspectionMedia({
  inspectionId,
  files,
  where,
  accept = "photo_video",
  disabled = false,
  compact = false,
  onAdded,
}: {
  inspectionId: string;
  files: InspectionFile[];
  where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean };
  accept?: "photo_video" | "pdf";
  disabled?: boolean;
  compact?: boolean;
  onAdded?: (f: InspectionFile) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [failed, setFailed] = useState<File[]>([]);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: File[]) {
    if (!list.length) return;
    setError(null);
    setFailed([]);
    const notDone: File[] = [];
    let i = 0;
    try {
      for (const file of list) {
        i++;
        setBusyLabel(list.length > 1 ? `Uploading ${i} of ${list.length}` : "Uploading");
        setProgress(0);
        try {
          const added = await uploadOne(inspectionId, file, where, setProgress);
          onAdded?.(added);
        } catch (err) {
          notDone.push(file);
          setError(err instanceof Error ? err.message : "Upload failed.");
        }
      }
    } finally {
      // Whatever happened, the buttons come back: a hung upload can never leave them dead.
      setProgress(null);
      setBusyLabel(null);
    }
    setFailed(notDone);
  }
  function pick(ref: React.RefObject<HTMLInputElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.value = "";
    el.click();
  }
  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    void handleFiles(list);
  }

  const busy = progress !== null;
  const btn = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong bg-white px-3 text-sm font-semibold ${disabled || busy ? "opacity-50" : "cursor-pointer hover:border-ink"}`;
  const logProblem = (m: string) => reportUploadFailure({ inspectionId, kind: "inspection_photo", step: "camera", error: m, extra: { itemKey: where.itemKey ?? null } });

  return (
    <div className="flex flex-col gap-2" data-inspection-media>
      {files.length ? (
        <div className={`flex flex-wrap gap-2 ${compact ? "" : ""}`}>
          {files.map((f) =>
            f.kind === "pdf" ? (
              <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-chip px-3 text-sm font-semibold">
                PDF · {f.caption ?? "scan report"}
              </a>
            ) : f.kind === "video" ? (
              <video key={f.id} src={f.url ?? undefined} controls playsInline preload="metadata" className="h-24 w-36 rounded-control bg-black object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer"><img src={f.url ?? ""} alt={f.caption ?? "Photo"} className="h-24 w-24 rounded-control object-cover bg-chip" /></a>
            ),
          )}
        </div>
      ) : null}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          {accept === "pdf" ? (
            <>
              <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple onChange={onInput} className="sr-only" tabIndex={-1} aria-hidden />
              <button type="button" onClick={() => pick(pdfRef)} disabled={busy} className={btn}>+ Add PDF</button>
            </>
          ) : (
            <>
              <PhotoButton source="camera" disabled={busy} className={btn} title="Photo" onFiles={(f) => void handleFiles(f)} onProblem={logProblem}>+ Photo</PhotoButton>
              <PhotoButton source="gallery" multiple disabled={busy} className={btn} title="From gallery" onFiles={(f) => void handleFiles(f)}>+ From gallery</PhotoButton>
              <input ref={videoRef} type="file" accept="video/*" capture="environment" onChange={onInput} className="sr-only" tabIndex={-1} aria-hidden />
              <button type="button" onClick={() => pick(videoRef)} disabled={busy} className={btn}>+ Video (60 s)</button>
            </>
          )}
        </div>
      ) : null}
      {progress !== null ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{busyLabel}… {Math.round(progress * 100)}%</span>
          <div className="h-2 rounded-full bg-track overflow-hidden">
            <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      {failed.length && !busy ? (
        <button type="button" onClick={() => void handleFiles(failed)} className="self-start min-h-10 rounded-control bg-ink px-3 text-sm font-bold text-white" data-retry>
          Retry{failed.length > 1 ? ` (${failed.length} files)` : ""}
        </button>
      ) : null}
    </div>
  );
}
