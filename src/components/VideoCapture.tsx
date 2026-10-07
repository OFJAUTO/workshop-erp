"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { uploadFile, type UploadKind } from "@/lib/upload-client";

export const MAX_VIDEO_SECONDS = 240;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

type Phase = "idle" | "checking" | "uploading" | "done" | "failed";

/** Reads how long a video file is, using the browser's own player. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const finish = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) finish(v.duration);
      else {
        // Some phone recordings report the length only after seeking to the end.
        v.currentTime = 1e9;
        v.ontimeupdate = () => finish(Number.isFinite(v.duration) ? v.duration : null);
        setTimeout(() => finish(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null), 3000);
      }
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

/**
 * Video step that opens the phone's own camera app (zoom, flash, normal preview),
 * checks the length afterwards, and uploads with progress and retry.
 */
export function VideoCapture({
  jobId,
  kind,
  label,
  hint,
  token,
  done = false,
}: {
  jobId: string;
  kind: UploadKind;
  label: string;
  hint: string;
  token?: string;
  done?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(done ? "done" : "idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; duration: number | null } | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPhase("checking");
    if (file.size > MAX_VIDEO_BYTES) {
      setError("That video is over 500 MB. Record a shorter one.");
      setPhase(done ? "done" : "idle");
      return;
    }
    const duration = await readDuration(file);
    if (duration !== null && duration > MAX_VIDEO_SECONDS + 1) {
      setError(`That video is ${Math.round(duration)} seconds. The limit is ${MAX_VIDEO_SECONDS} seconds (${MAX_VIDEO_SECONDS / 60} minutes). Please record a shorter one.`);
      setPhase(done ? "done" : "idle");
      return;
    }
    setInfo(`${duration ? Math.round(duration) + "s · " : ""}${(file.size / 1024 / 1024).toFixed(0)} MB`);
    await upload({ file, duration });
  }

  async function upload(p: { file: File; duration: number | null }) {
    setPending(p);
    setPhase("uploading");
    setProgress(0);
    setError(null);
    try {
      const type = (p.file.type || "video/mp4").split(";")[0];
      await uploadFile(jobId, kind, p.file, type, setProgress, { duration: p.duration ? Math.round(p.duration) : undefined, token });
      setPhase("done");
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPhase("failed");
    }
  }

  const finished = phase === "done";
  const busy = phase === "checking" || phase === "uploading";

  return (
    <div className={`flex flex-col gap-3 rounded-card border-2 p-4 ${finished ? "border-green bg-green-soft" : phase === "failed" ? "border-red-bar bg-red-soft" : "border-line-strong bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-bold">{label}</span>
          <span className="text-xs text-muted">
            {hint} Up to {MAX_VIDEO_SECONDS / 60} minutes.
          </span>
        </span>
        <span className={`text-2xl font-bold ${finished ? "text-green" : "text-faint"}`}>{finished ? "✓" : "●"}</span>
      </div>

      {!busy ? (
        <label className="block cursor-pointer">
          <input type="file" accept="video/*" capture="environment" onChange={onFile} className="sr-only" />
          <span className={`inline-flex min-h-14 w-full items-center justify-center rounded-control px-5 text-base font-bold ${finished ? "border border-line-strong bg-white" : "bg-ink text-white"}`}>
            {finished ? "Record again" : "Record with the camera"}
          </span>
        </label>
      ) : null}

      {phase === "checking" ? <p className="text-sm text-muted">Checking the video…</p> : null}

      {phase === "uploading" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">
            Uploading… {Math.round(progress * 100)}%{info ? ` · ${info}` : ""}
          </span>
          <div className="h-2 rounded-full bg-track overflow-hidden">
            <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">Keep this page open until it finishes.</p>
        </div>
      ) : null}

      {phase === "failed" && pending ? (
        <Button size="lg" onClick={() => upload(pending)}>
          Retry upload
        </Button>
      ) : null}

      {phase === "done" ? <p className="text-sm font-semibold text-green">Video uploaded.</p> : null}
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
    </div>
  );
}
