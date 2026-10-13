"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { devicePlatform } from "./CameraCapture";
import { reportUploadFailure, uploadFile, type UploadKind } from "@/lib/upload-client";
import type { Checklist } from "@/lib/media";
import { refreshWhenIdle } from "@/lib/refresh-idle";

export const MAX_VIDEO_SECONDS = 240;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

type Phase = "idle" | "checking" | "uploading" | "processing" | "done" | "failed";

/** Reads how long a video file is, using the browser's own player. Gives up after eight seconds. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    let settled = false;
    const finish = (d: number | null) => {
      if (settled) return;
      settled = true;
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
    // A format this browser cannot read never fires loadedmetadata: the upload goes ahead without the length.
    setTimeout(() => finish(null), 8000);
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
  attempted = false,
  onChecklist,
}: {
  jobId: string;
  kind: UploadKind;
  label: string;
  hint: string;
  token?: string;
  /** The server counts this video as done (the one truth: a green tick means exactly this). */
  done?: boolean;
  /** Someone tried to finish the gate-in: a missing video shows in red. */
  attempted?: boolean;
  /** The server's fresh checklist once the file is recorded. */
  onChecklist?: (c: Partial<Checklist>) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(done ? "done" : "idle");
  // The tick follows the server: when the gate-in counts the video as done, the box turns green, never before.
  const [seenDone, setSeenDone] = useState(done);
  if (seenDone !== done) {
    setSeenDone(done);
    if (done && phase !== "uploading" && phase !== "checking") setPhase("done");
  }
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; duration: number | null } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ios = typeof navigator !== "undefined" && (devicePlatform() === "iphone" || devicePlatform() === "ipad");

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
      const checklist = (await uploadFile(jobId, kind, p.file, type, (x) => { setProgress(x); if (x >= 1) setPhase("processing"); }, { duration: p.duration ? Math.round(p.duration) : undefined, token })) as Partial<Checklist>;
      const counted = kind === "video_exterior" ? checklist.videoExterior : kind === "video_interior" ? checklist.videoInterior : undefined;
      if (counted === false) {
        reportUploadFailure({ jobId, kind, step: "register", error: "Sent and recorded, but the checklist did not count the video", token, sizeBytes: p.file.size, contentType: type });
        throw new Error("The video was sent but the gate-in did not count it. Tap Retry.");
      }
      setPending(null);
      onChecklist?.(checklist);
      setPhase("done");
      refreshWhenIdle(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPhase("failed");
    }
  }

  const finished = phase === "done";
  const busy = phase === "checking" || phase === "uploading" || phase === "processing";
  const red = phase === "failed" || (attempted && !finished && !busy);

  return (
    <div data-media-item={kind} data-missing={finished ? "false" : "true"} data-media-status={phase} className={`flex flex-col gap-3 rounded-card border-2 p-4 ${finished ? "border-green bg-green-soft" : red ? "border-red-bar bg-red-soft" : phase === "processing" || phase === "uploading" ? "border-amber-bar bg-amber-soft" : "border-line-strong bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-bold">{label}</span>
          <span className="text-xs text-muted">
            {hint} Up to {MAX_VIDEO_SECONDS / 60} minutes.
          </span>
          {attempted && !finished && !busy && phase !== "failed" ? <span className="text-xs font-semibold text-red">Missing. Record it below.</span> : null}
        </span>
        <span className={`text-2xl font-bold ${finished ? "text-green" : red ? "text-red" : "text-faint"}`}>{finished ? "✓" : red ? "!" : "●"}</span>
      </div>

      {!busy ? (
        <>
          <input ref={inputRef} type="file" accept="video/*" capture="environment" onChange={onFile} className="sr-only" tabIndex={-1} aria-hidden />
          <button type="button" onClick={() => { const el = inputRef.current; if (el) { el.value = ""; el.click(); } }} className={`inline-flex min-h-14 w-full items-center justify-center rounded-control px-5 text-base font-bold ${finished ? "border border-line-strong bg-white" : "bg-ink text-white"}`}>
            {finished ? "Record again" : "Record with the camera"}
          </button>
          {ios ? <p className="text-[11px] text-muted">iPhone or iPad: Settings › Camera › Formats › Most Compatible, so the customer&apos;s phone can play the video.</p> : null}
        </>
      ) : null}

      {phase === "checking" ? <p className="text-sm text-muted">Checking the video…</p> : null}
      {phase === "processing" ? <p className="text-sm font-semibold text-amber">Processing… the file is being recorded.</p> : null}

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
        <Button size="lg" onClick={() => upload(pending)} data-retry>
          Retry upload
        </Button>
      ) : null}

      {phase === "done" ? <p className="text-sm font-semibold text-green">Video uploaded.</p> : null}
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
    </div>
  );
}
