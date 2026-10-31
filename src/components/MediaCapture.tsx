"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoButton } from "./PhotoButton";
import { reportUploadFailure, shrinkPhoto, type UploadKind } from "@/lib/upload-client";
import type { Checklist } from "@/lib/media";
import type { MissingItem } from "@/lib/media-checklist";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { listRecords, onSendEvent, scopeOf } from "@/lib/send-queue";
import { pendingWords, useSendQueue, type PendingFile } from "@/lib/use-send-queue";

/* ------------------------------------------------------------------------------------------------------------ */
/* The gate-in on THE send queue (31 October 2026, uploads section 10). Every gate-in file - the checklist tiles, */
/* the outline's panel photos ("panel:<key>"), the photos of damage found after check-in ("after:<id>") - is kept */
/* on the device until the server has it, and goes by itself when the signal is back. The pieces below are shared */
/* by the photo tiles, the videos, the car picture, the checklist, the finish button, the outline and the job     */
/* card. A tick is green only from the server's checklist, never from a file that is only on the device.          */
/* ------------------------------------------------------------------------------------------------------------ */

/** Photo types the gate-in takes (the door and the bucket refuse anything else). */
export const GATE_IN_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** What the gate-in door reads with each file: its kind, the phone link (the /u page), where it belongs, a video's length. */
export function gateInFields(kind: string, opts: { token?: string | null; caption?: string | null; duration?: number | null } = {}): Record<string, unknown> {
  return {
    kind,
    ...(opts.token ? { token: opts.token } : {}),
    ...(opts.caption ? { caption: opts.caption } : {}),
    ...(opts.duration ? { duration: Math.round(opts.duration) } : {}),
  };
}

/** "phone", "tablet" or "computer": the words for "still sending from this …". Browser only. */
export function deviceWord(): "phone" | "tablet" | "computer" {
  if (typeof window === "undefined") return "tablet";
  const coarse = (window.matchMedia?.("(pointer: coarse)")?.matches ?? false) || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  if (!coarse) return "computer";
  return Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) < 600 ? "phone" : "tablet";
}

/** One gate-in file of this car still on this device (whichever screen queued it), and how it is getting on. */
export type DeviceFile = { id: string; kind: string; caption: string | null; state: PendingFile["state"]; progress: number };

/**
 * Every gate-in file of one car still on this device, live: the checklist, the finish button, the outline and the job
 * card read it to say "on this device" and "2 still sending from this tablet". Read-only: the tiles queue the files.
 */
export function useDeviceFiles(jobId: string | null | undefined): DeviceFile[] {
  const [files, setFiles] = useState<DeviceFile[]>([]);
  const known = useRef(new Set<string>());
  const gone = useRef(new Set<string>());
  useEffect(() => {
    if (!jobId) return;
    const scope = scopeOf("gate_in", jobId);
    let live = true;
    const read = () => {
      void listRecords(scope)
        .then((rows) => {
          if (!live) return;
          // A file sent while this read was on its way never comes back as "on the device".
          const here = rows.filter((r) => !gone.current.has(r.id));
          known.current = new Set(here.map((r) => r.id));
          setFiles((cur) =>
            here.map((r) => {
              const had = cur.find((f) => f.id === r.id);
              const state: DeviceFile["state"] = r.permanent ? "stopped" : had && had.state !== "stopped" ? had.state : r.attempts > 0 ? "waiting" : "queued";
              return { id: r.id, kind: String(r.fields.kind ?? ""), caption: typeof r.fields.caption === "string" ? r.fields.caption : null, state, progress: state === "sending" ? (had?.progress ?? 0) : 0 };
            }),
          );
        })
        .catch(() => undefined);
    };
    read();
    const off = onSendEvent((e) => {
      if (e.scope !== scope) return;
      if (e.type === "sent" || e.type === "removed") {
        gone.current.add(e.id);
        known.current.delete(e.id);
        setFiles((cur) => cur.filter((f) => f.id !== e.id));
        return;
      }
      if (e.type === "queued" || !known.current.has(e.id)) {
        read();
        return;
      }
      const state: DeviceFile["state"] = e.type === "sending" ? "sending" : e.type === "waiting" ? "waiting" : "stopped";
      const progress = e.type === "sending" ? e.progress : 0;
      setFiles((cur) => {
        const f = cur.find((x) => x.id === e.id);
        // A big video reports progress many times a second: the screen moves only by whole per cents.
        if (!f || (f.state === state && Math.abs(f.progress - progress) < 0.01)) return cur;
        return cur.map((x) => (x.id === e.id ? { ...x, state, progress } : x));
      });
    });
    return () => {
      live = false;
      off();
    };
  }, [jobId]);
  return files;
}

/** A missing checklist item that a file on this device will fill once it arrives (a wheel's condition never is). */
export function coveredByDevice(m: MissingItem, check: Checklist, device: DeviceFile[]): boolean {
  if (m.key === "damage_photo") return device.some((f) => f.kind === "damage_photo");
  const wheel = check.wheels.find((w) => w.kind === m.key);
  if (wheel) return !wheel.photo && device.some((f) => f.kind === m.key);
  return device.some((f) => f.kind === m.key);
}

/** The words a Remove asks before a file that never arrived is thrown away. */
export function confirmRemove(what: string): boolean {
  try {
    return window.confirm(`Remove this ${what}? It has not been sent yet and will be lost.`);
  } catch {
    return true;
  }
}

const mbWords = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "45 s · 120 MB" for a video waiting on the device. */
export function videoInfo(p: PendingFile): string {
  const d = Number(p.fields.duration ?? 0);
  return `${d > 0 ? `${Math.round(d)} s · ` : ""}${mbWords(p.size)}`;
}

/** A pending file's own picture (made on the device), or a plain tile for a video without one. */
export function PendingThumb({ p, src, className = "h-12 w-12" }: { p: PendingFile; src?: string | null; className?: string }) {
  const url = src ?? p.previewUrl;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${className} shrink-0 rounded-md object-cover ${p.state === "stopped" ? "opacity-70" : ""}`} data-pending-thumb />;
  }
  return (
    <span className={`${className} shrink-0 rounded-md bg-ink text-white flex items-center justify-center text-base font-bold`} aria-hidden data-pending-thumb>
      {p.kind === "video" ? "▶" : "↑"}
    </span>
  );
}

/**
 * The files of one item still on this device. Each one shows with its own picture and what is happening to it; a file
 * that stopped, or waits for the signal, has "Try again" and "Remove". With one file of a tile, the tile above already
 * shows its picture and words, so only the buttons are added (`full` shows the whole row anyway, for the video box).
 */
export function PendingRows({
  pending,
  onRetry,
  onRemove,
  what = "photo",
  full = false,
  thumbOf,
  describe,
}: {
  pending: PendingFile[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  what?: string;
  full?: boolean;
  thumbOf?: (p: PendingFile) => string | null;
  describe?: (p: PendingFile) => string;
}) {
  const compact = !full && pending.length === 1;
  const rows = compact ? pending.filter((p) => p.state === "stopped" || p.state === "waiting") : pending;
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-1.5" data-pending-files={pending.length}>
      {rows.map((p) => {
        const stuck = p.state === "stopped" || p.state === "waiting";
        return (
          <li
            key={p.id}
            className={compact ? "flex flex-wrap gap-2" : `flex flex-wrap items-center gap-2 rounded-control border px-2 py-1.5 ${p.state === "stopped" ? "border-red-soft bg-red-soft" : "border-line bg-white"}`}
            data-pending-file={p.id}
            data-pending-state={p.state}
          >
            {!compact ? <PendingThumb p={p} src={thumbOf?.(p) ?? null} /> : null}
            {!compact ? (
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={`text-xs ${p.state === "stopped" ? "font-semibold text-red" : "text-muted"}`}>{describe ? describe(p) : pendingWords(p)}</span>
                {p.state === "sending" ? (
                  <span className="block h-1.5 rounded-full bg-track overflow-hidden">
                    <span className="block h-full bg-ink transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </span>
                ) : null}
              </span>
            ) : null}
            {stuck ? (
              <span className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onRetry(p.id)} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white" data-retry>
                  {p.state === "stopped" ? "Try again" : "Send now"}
                </button>
                <button type="button" onClick={() => { if (confirmRemove(what)) onRemove(p.id); }} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-remove-queued>
                  Remove
                </button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Whether the server's checklist counts this kind of photo as done. */
function countedDone(c: Partial<Checklist>, kind: UploadKind): boolean | undefined {
  switch (kind) {
    case "dashboard_photo": return c.dashboard;
    case "keys_photo_front": return c.keysFront;
    case "keys_photo_back": return c.keysBack;
    case "car_picture": return c.carPicture;
    case "damage_photo": return c.damageCount === undefined ? undefined : c.damageCount > 0;
    case "wheel_fl": case "wheel_fr": case "wheel_rl": case "wheel_rr": return c.wheels?.find((w) => w.kind === kind)?.photo;
    default: return undefined;
  }
}

const PHOTO_TYPE_WORDS = "This photo can't be sent from here (the phone saved it in a format the browser can't read). Take it with the camera button, or choose a JPEG.";

/**
 * One photo item of the gate-in: the camera opens inside the page (the picker on a PC), the photo is made small on
 * the device and kept there until the server has it (no signal, a reload, the tablet's idle lock: it still goes by
 * itself). It shows at once with its own picture: amber while it is on this device or sending, red with Try again and
 * Remove only when it can never go by itself, and green only when the server's checklist counts it.
 */
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
  attempted = false,
  itemKey,
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
  /** Someone tried to finish the gate-in: a missing item shows in red. */
  attempted?: boolean;
  /** The item's key for "Go to next" (defaults to the kind); null when a wrapper carries the marker instead. */
  itemKey?: string | null;
  /** A file of this item was recorded by the server (never earlier). */
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  // Green only when the server counts the photo: the checklist from the upload, or the page's refresh.
  const [serverDone, setServerDone] = useState<boolean | null>(null);
  const [seenDone, setSeenDone] = useState(done);
  if (seenDone !== done) {
    setSeenDone(done);
    setServerDone(null);
  }
  const { pending, add, retry, remove } = useSendQueue({
    target: "gate_in",
    scopeId: jobId,
    grantBody: gateInFields(kind, { token, caption }),
    match: (f) => f.kind === kind && (f.caption ?? null) === (caption ?? null),
    onSent: (result) => {
      const checklist = (result.checklist ?? {}) as Partial<Checklist>;
      const counted = countedDone(checklist, kind);
      if (counted === false) reportUploadFailure({ jobId, kind, step: "register", error: "Recorded, but the gate-in checklist did not count it", token, extra: { queued: true } });
      setCount((c) => c + 1);
      if (counted !== undefined) setServerDone(counted);
      if (typeof result.url === "string" && result.url) setLastSent(result.url);
      onChecklist?.(checklist);
      onUploaded?.();
      refreshWhenIdle(() => router.refresh());
    },
  });

  async function onFiles(files: File[]) {
    setProblem(null);
    setPreparing((n) => n + files.length);
    // One after another, so the first photo is on the device (and on its way) while the next is made small.
    for (const file of files) {
      try {
        const small = await shrinkPhoto(file);
        const type = (small.type || "image/jpeg").toLowerCase();
        if (!GATE_IN_PHOTO_TYPES.includes(type)) {
          setProblem(PHOTO_TYPE_WORDS);
          reportUploadFailure({ jobId, kind, step: "decode", error: `Could not turn ${file.type || "the photo"} into a JPEG (${file.size} bytes)`, token, sizeBytes: file.size, contentType: file.type || null });
          continue;
        }
        await add([{ blob: small.blob, contentType: type, name: file.name || null, fields: gateInFields(kind, { token, caption }) }]);
      } catch {
        setProblem("This photo could not be kept on this device. Take it again.");
      } finally {
        setPreparing((n) => Math.max(0, n - 1));
      }
    }
  }

  const finished = done || serverDone === true;
  const stopped = pending.filter((p) => p.state === "stopped");
  const sending = pending.find((p) => p.state === "sending") ?? null;
  const onDevice = pending.length + preparing > 0;
  const lead = stopped[0] ?? sending ?? pending.find((p) => p.state === "waiting") ?? pending[pending.length - 1] ?? null;
  const red = stopped.length > 0 || (attempted && !finished && !onDevice);
  const green = finished && !onDevice;
  const status = stopped.length ? "failed" : sending ? "uploading" : onDevice ? "device" : finished ? "done" : "waiting";
  const thumb = lead?.previewUrl ?? lastSent;
  const text = lead
    ? `${pending.length > 1 ? `${pending.length} photos on this device · ` : ""}${pendingWords(lead)}`
    : preparing
      ? "Getting the photo ready…"
      : finished
        ? multiple
          ? `${count ? count + " added. " : ""}Tap to add more.`
          : "Done. Tap to take another."
        : disabled
          ? (hint ?? "Finish the step above first")
          : attempted
            ? "Missing. Tap to take the photo."
            : (hint ?? "Tap to take a photo");
  const tile = `flex min-h-16 w-full items-center justify-between gap-3 rounded-card border-2 px-4 text-left ${
    green ? "border-green bg-green-soft" : red ? "border-red-bar bg-red-soft" : onDevice ? "border-amber-bar bg-amber-soft" : disabled ? "border-line bg-chip opacity-60" : "border-line-strong bg-white"
  }`;

  return (
    <div className="flex flex-col gap-2" data-media-item={itemKey === null ? undefined : (itemKey ?? kind)} data-missing={itemKey === null ? undefined : finished ? "false" : "true"} data-media-status={status} data-device-files={pending.length}>
      <div className="flex items-stretch gap-2">
        <PhotoButton source="camera" multiple={multiple} disabled={disabled} className={`${tile} flex-1`} title={label} onFiles={onFiles} onProblem={(m) => reportUploadFailure({ jobId, kind, step: "camera", error: m, token })}>
          <span className="flex items-center gap-3 min-w-0">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className={`h-12 w-12 shrink-0 rounded-md object-cover ${stopped.length ? "opacity-70" : ""}`} />
            ) : null}
            <span className="flex flex-col min-w-0">
              <span className="font-bold">{label}</span>
              <span className={`text-xs ${stopped.length ? "font-semibold text-red" : onDevice ? "font-semibold text-amber" : "text-muted"}`} data-media-words>{text}</span>
            </span>
          </span>
          <span className={`text-2xl font-bold ${green ? "text-green" : red ? "text-red" : onDevice ? "text-amber" : "text-faint"}`}>{green ? "✓" : red ? "!" : onDevice ? "↑" : "+"}</span>
        </PhotoButton>
        {!disabled ? (
          <PhotoButton source="gallery" multiple={multiple} className="shrink-0 w-20 rounded-card border-2 border-line bg-white text-[11px] font-bold leading-tight px-1" title={label} onFiles={onFiles}>
            From gallery
          </PhotoButton>
        ) : null}
      </div>
      {sending ? (
        <div className="h-2 rounded-full bg-track overflow-hidden">
          <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(sending.progress * 100)}%` }} />
        </div>
      ) : null}
      {problem ? <p className="text-sm font-semibold text-red" data-media-problem>{problem}</p> : null}
      <PendingRows pending={pending} onRetry={(id) => void retry(id)} onRemove={(id) => void remove(id)} />
    </div>
  );
}
