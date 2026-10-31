"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { devicePlatform } from "./CameraCapture";
import { PendingRows, gateInFields, videoInfo } from "./MediaCapture";
import { reportUploadFailure, type UploadKind } from "@/lib/upload-client";
import type { Checklist } from "@/lib/media";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { pendingWords, useSendQueue, type PendingFile } from "@/lib/use-send-queue";

export const MAX_VIDEO_SECONDS = 240;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** Video types the gate-in takes (the door and the bucket refuse anything else, for good). */
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

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
 * A small picture of the video (a frame half a second in), made on the device so the waiting video shows with its own
 * picture. Best effort: a format this browser cannot draw, or four seconds without a frame, gives none.
 */
function videoFrame(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    let settled = false;
    const finish = (b: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        // The element is thrown away anyway.
      }
      URL.revokeObjectURL(url);
      resolve(b);
    };
    const timer = setTimeout(() => finish(null), 4000);
    v.onloadeddata = () => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      v.currentTime = Math.min(0.5, d / 2);
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return finish(null);
        const scale = Math.min(1, 320 / Math.max(w, h));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        const ctx = c.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => finish(b), "image/jpeg", 0.7);
      } catch {
        finish(null);
      }
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0").slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

/**
 * Video step that opens the phone's own camera app (zoom, flash, normal preview), checks the size and the length
 * first, then keeps the video on the device until the server has it: it goes by itself when the signal is back, also
 * after a reload or the tablet's idle lock. Amber while it is on this device or sending, red with Try again and Remove
 * only when it can never go by itself, green only when the server's checklist counts it.
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
  // Before the queue: the size, type and length checks, then writing the file to the device (a big video takes a moment).
  const [step, setStep] = useState<"idle" | "checking" | "keeping">("idle");
  const checking = step !== "idle";
  const [error, setError] = useState<string | null>(null);
  // The tick follows the server: when the gate-in counts the video as done, the box turns green, never before.
  const [serverDone, setServerDone] = useState<boolean | null>(null);
  const [seenDone, setSeenDone] = useState(done);
  if (seenDone !== done) {
    setSeenDone(done);
    setServerDone(null);
  }
  // Pictures of the videos taken on this visit (made on the device), freed when they leave.
  const [frames, setFrames] = useState<Record<string, string>>({});
  const framesRef = useRef<Record<string, string>>({});
  useEffect(() => { framesRef.current = frames; }, [frames]);
  useEffect(() => () => Object.values(framesRef.current).forEach((u) => URL.revokeObjectURL(u)), []);
  const dropFrame = (id: string) => {
    const url = framesRef.current[id];
    if (!url) return;
    URL.revokeObjectURL(url);
    setFrames((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const ios = typeof navigator !== "undefined" && (devicePlatform() === "iphone" || devicePlatform() === "ipad");

  const { pending, add, retry, remove } = useSendQueue({
    target: "gate_in",
    scopeId: jobId,
    grantBody: gateInFields(kind, { token }),
    match: (f) => f.kind === kind,
    onSent: (result, _fields, id) => {
      dropFrame(id);
      const checklist = (result.checklist ?? {}) as Partial<Checklist>;
      const counted = kind === "video_exterior" ? checklist.videoExterior : kind === "video_interior" ? checklist.videoInterior : undefined;
      if (counted === false) reportUploadFailure({ jobId, kind, step: "register", error: "Sent and recorded, but the checklist did not count the video", token, extra: { queued: true } });
      if (counted !== undefined) setServerDone(counted);
      onChecklist?.(checklist);
      refreshWhenIdle(() => router.refresh());
    },
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_VIDEO_BYTES) {
      setError("That video is over 500 MB. Record a shorter one.");
      return;
    }
    const type = (file.type || "video/mp4").split(";")[0].trim().toLowerCase();
    if (!VIDEO_TYPES.includes(type)) {
      setError("That kind of video can't be sent. Record it again with the camera's normal video setting.");
      reportUploadFailure({ jobId, kind, step: "decode", error: `Video type ${type} is not accepted`, token, sizeBytes: file.size, contentType: type });
      return;
    }
    setStep("checking");
    const duration = await readDuration(file);
    if (duration !== null && duration > MAX_VIDEO_SECONDS + 1) {
      setStep("idle");
      setError(`That video is ${Math.round(duration)} seconds. The limit is ${MAX_VIDEO_SECONDS} seconds (${MAX_VIDEO_SECONDS / 60} minutes). Please record a shorter one.`);
      return;
    }
    // The picture is only for this screen: a format the browser could not read gives none, and no time is lost on it.
    const frame = duration !== null ? await videoFrame(file).catch(() => null) : null;
    const id = newId();
    if (frame) {
      try {
        const url = URL.createObjectURL(frame);
        setFrames((cur) => ({ ...cur, [id]: url }));
      } catch {
        // No picture: the waiting video shows as a plain tile.
      }
    }
    setStep("keeping");
    try {
      await add([{ id, blob: file, contentType: type, name: file.name || null, fields: gateInFields(kind, { token, duration }) }]);
    } catch {
      setError("The video could not be kept on this device. Record it again.");
      dropFrame(id);
    } finally {
      setStep("idle");
    }
  }

  const finished = done || serverDone === true;
  const stopped = pending.find((p) => p.state === "stopped") ?? null;
  const sending = pending.find((p) => p.state === "sending") ?? null;
  const onDevice = pending.length > 0;
  const red = !!stopped || (attempted && !finished && !onDevice && !checking);
  const green = finished && !onDevice;
  const status = checking ? "checking" : stopped ? "failed" : sending ? (sending.progress >= 0.97 ? "processing" : "uploading") : onDevice ? "device" : finished ? "done" : "idle";
  const describe = (p: PendingFile) => (p.state === "sending" && p.progress >= 0.97 ? `${videoInfo(p)} · Processing… the file is being recorded.` : `${videoInfo(p)} · ${pendingWords(p)}`);

  return (
    <div data-media-item={kind} data-missing={finished ? "false" : "true"} data-media-status={status} data-device-files={pending.length} className={`flex flex-col gap-3 rounded-card border-2 p-4 ${green ? "border-green bg-green-soft" : red ? "border-red-bar bg-red-soft" : onDevice || checking ? "border-amber-bar bg-amber-soft" : "border-line-strong bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-bold">{label}</span>
          <span className="text-xs text-muted">
            {hint} Up to {MAX_VIDEO_SECONDS / 60} minutes.
          </span>
          {attempted && !finished && !onDevice && !checking ? <span className="text-xs font-semibold text-red">Missing. Record it below.</span> : null}
        </span>
        <span className={`text-2xl font-bold ${green ? "text-green" : red ? "text-red" : onDevice ? "text-amber" : "text-faint"}`}>{green ? "✓" : red ? "!" : onDevice ? "↑" : "●"}</span>
      </div>

      {!checking ? (
        <>
          <input ref={inputRef} type="file" accept="video/*" capture="environment" onChange={onFile} className="sr-only" tabIndex={-1} aria-hidden />
          <button type="button" onClick={() => { const el = inputRef.current; if (el) { el.value = ""; el.click(); } }} className={`inline-flex min-h-14 w-full items-center justify-center rounded-control px-5 text-base font-bold ${finished || onDevice ? "border border-line-strong bg-white" : "bg-ink text-white"}`}>
            {finished || onDevice ? "Record again" : "Record with the camera"}
          </button>
          {ios ? <p className="text-[11px] text-muted">iPhone or iPad: Settings › Camera › Formats › Most Compatible, so the customer&apos;s phone can play the video.</p> : null}
        </>
      ) : null}

      {checking ? <p className="text-sm text-muted" data-video-step={step}>{step === "keeping" ? "Saving the video on this device…" : "Checking the video…"}</p> : null}

      {onDevice ? (
        <div className="flex flex-col gap-1.5" data-video-pending>
          <PendingRows pending={pending} full what="video" thumbOf={(p) => frames[p.id] ?? null} describe={describe} onRetry={(id) => void retry(id)} onRemove={(id) => { dropFrame(id); void remove(id); }} />
          <p className="text-xs text-muted">
            {pending.some((p) => p.memoryOnly)
              ? "This device has no room to keep the video: leave this page open until it has gone."
              : "The video stays on this device until it has arrived, and carries on by itself if the signal drops."}
          </p>
        </div>
      ) : null}

      {green ? <p className="text-sm font-semibold text-green">Video uploaded.</p> : null}
      {error ? <p className="text-sm font-semibold text-red" data-media-problem>{error}</p> : null}
    </div>
  );
}
