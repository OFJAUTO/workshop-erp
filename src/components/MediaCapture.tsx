"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { uploadFile, type UploadKind } from "@/lib/upload-client";
import type { Checklist } from "@/lib/media";
import { refreshWhenIdle } from "@/lib/refresh-idle";

/** Whether the server's checklist counts this kind of photo as done. */
function countedDone(c: Partial<Checklist>, kind: UploadKind): boolean | undefined {
  switch (kind) {
    case "dashboard_photo": return c.dashboard;
    case "keys_photo_front": return c.keysFront;
    case "keys_photo_back": return c.keysBack;
    case "car_picture": return c.carPicture;
    case "damage_photo": return c.damageCount === undefined ? undefined : c.damageCount > 0;
    default: return undefined;
  }
}

/** One-tap photo capture and upload with a progress bar and retry. */
export function MediaCapture({
  jobId,
  kind,
  label,
  done = false,
  token,
  caption,
  multiple = false,
  disabled = false,
  hint,
  onUploaded,
  onChecklist,
}: {
  /** The server's fresh checklist once a file is recorded. */
  onChecklist?: (c: Partial<Checklist>) => void;
  jobId: string;
  kind: UploadKind;
  label: string;
  done?: boolean;
  token?: string;
  caption?: string;
  multiple?: boolean;
  disabled?: boolean;
  hint?: string;
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  // Green only when the server counts the photo: the checklist from the upload, or the page's refresh.
  const [serverDone, setServerDone] = useState<boolean | null>(null);
  const [seenDone, setSeenDone] = useState(done);
  if (seenDone !== done) {
    setSeenDone(done);
    setServerDone(null);
  }

  async function uploadAll(files: File[]) {
    setError(null);
    setFailed([]);
    const notDone: File[] = [];
    for (const file of files) {
      const type = file.type || "image/jpeg";
      setProgress(0);
      try {
        const checklist = (await uploadFile(jobId, kind, file, type, (x) => { setProgress(x); if (x >= 1) setProcessing(true); }, { token, caption })) as Partial<Checklist>;
        setProcessing(false);
        setCount((c) => c + 1);
        const counted = countedDone(checklist, kind);
        if (counted !== undefined) setServerDone(counted);
        onChecklist?.(checklist);
        onUploaded?.();
      } catch (err) {
        setProcessing(false);
        notDone.push(file);
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    }
    setProgress(null);
    setFailed(notDone);
    if (notDone.length < files.length) refreshWhenIdle(() => router.refresh());
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    await uploadAll(files);
  }

  const finished = done || serverDone === true;

  return (
    <div className="flex flex-col gap-2">
      <label className="block cursor-pointer">
        <input type="file" accept="image/*" capture="environment" multiple={multiple} onChange={onChange} className="sr-only" disabled={progress !== null || disabled} />
        <span
          className={`flex min-h-16 items-center justify-between gap-3 rounded-card border-2 px-4 text-left ${
            finished ? "border-green bg-green-soft" : failed.length ? "border-red-bar bg-red-soft" : processing ? "border-amber-bar bg-amber-soft" : disabled ? "border-line bg-chip opacity-60" : "border-line-strong bg-white"
          }`}
        >
          <span className="flex flex-col">
            <span className="font-bold">{label}</span>
            <span className="text-xs text-muted">
              {processing
                ? "Processing… the file is being recorded."
                : progress !== null
                ? `Uploading… ${Math.round(progress * 100)}%`
                : finished
                  ? multiple
                    ? `${count ? count + " added. " : ""}Tap to add more.`
                    : "Done. Tap to add another."
                  : disabled
                    ? (hint ?? "Finish the step above first")
                    : (hint ?? "Tap to take a photo")}
            </span>
          </span>
          <span className={`text-2xl font-bold ${finished ? "text-green" : "text-faint"}`}>{finished ? "✓" : "+"}</span>
        </span>
      </label>
      {progress !== null ? (
        <div className="h-2 rounded-full bg-track overflow-hidden">
          <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      {failed.length ? (
        <Button size="md" onClick={() => uploadAll(failed)}>
          Retry upload{failed.length > 1 ? ` (${failed.length} photos)` : ""}
        </Button>
      ) : null}
    </div>
  );
}
