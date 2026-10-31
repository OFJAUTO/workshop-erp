"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Lightbox } from "./Lightbox";
import { PhotoButton } from "./PhotoButton";
import { listRecords, onSendEvent, scopeOf, type SendRecord, type SendTarget } from "@/lib/send-queue";
import { reportUploadFailure } from "@/lib/upload-client";
import { pendingWords, useSendQueue, type PendingFile, type SentResult } from "@/lib/use-send-queue";

export type InspectionFile = { id: string; kind: "photo" | "video" | "pdf"; url: string | null; caption?: string | null; isPrescan?: boolean };

/** One place in the report: a checklist item, a tyre, a measurement, a bodyshop panel, a road-test item or the pre-scan slot. */
export type InspectionWhere = { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean };

const MAX_VIDEO_SECONDS = 60;
const MAX_PHOTO_PX = 2000;
const RECODE_ABOVE_BYTES = 1_500_000;
/** What the inspection's place takes (the same list as the server's): anything else is refused on the device, in words. */
const SENDABLE_PHOTO = ["image/jpeg", "image/png", "image/webp"];
const SENDABLE_VIDEO = ["video/webm", "video/mp4", "video/quicktime"];

/* ------------------------------------------------------------------------------------------------------------ */
/* Which files belong where                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

/** The files of one place, by the details they were queued with (the same rule the form uses for its server list). */
export function whereMatch(where: InspectionWhere): (fields: Record<string, unknown>) => boolean {
  const key = where.itemKey ?? null;
  const request = where.requestId ?? null;
  const prescan = !!where.isPrescan;
  return (f) => (prescan ? f.isPrescan === true : f.isPrescan !== true && (f.itemKey ?? null) === key && (f.requestId ?? null) === request);
}

/** Where a queued file belongs, read back from the details it was queued with. */
export function whereOf(fields: Record<string, unknown>): { itemKey: string | null; requestId: string | null; isPrescan: boolean } {
  return {
    itemKey: typeof fields.itemKey === "string" && fields.itemKey ? fields.itemKey : null,
    requestId: typeof fields.requestId === "string" && fields.requestId ? fields.requestId : null,
    isPrescan: fields.isPrescan === true,
  };
}

/** The server's answer for a file that arrived, as the report's file (null when the answer has no row). */
export function fileOfSent(r: SentResult): InspectionFile | null {
  if (!r.id) return null;
  const kind: InspectionFile["kind"] = r.kind === "video" ? "video" : r.kind === "pdf" ? "pdf" : "photo";
  return { id: r.id, kind, url: r.url ?? null, caption: typeof r.caption === "string" ? r.caption : null, isPrescan: r.isPrescan === true };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Every file of a place still on this device, whoever queued it                                                */
/* ------------------------------------------------------------------------------------------------------------ */

const kindOfType = (contentType: string): PendingFile["kind"] => (contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : contentType === "application/pdf" ? "pdf" : "file");

function asPending(r: SendRecord, prev: PendingFile | undefined): PendingFile {
  const sending = prev?.state === "sending";
  return {
    id: r.id,
    kind: kindOfType(r.contentType),
    previewUrl: null,
    name: r.name,
    state: sending ? "sending" : r.permanent ? "stopped" : r.attempts > 0 ? "waiting" : "queued",
    progress: sending ? (prev?.progress ?? 0) : 0,
    error: sending ? null : r.lastError,
    fields: r.fields,
    memoryOnly: !!r.memoryOnly,
    takenAt: r.takenAt,
    size: r.size,
  };
}

/**
 * Every file of one place (a report, a job's post-scan) still on this device, whoever queued it: any uploader on this
 * screen, one that has gone off the screen, another tab. For the screens that hold the Send / Save / Approve button:
 * they must know about every file, not only the ones an uploader of theirs picked. No pictures (the uploaders show
 * those). `onSent` hears each file the server confirmed, once, so the screen's list never misses one whose uploader
 * was not on the screen when it arrived.
 */
export function useFilesOnDevice({ target, scopeId, match, onSent }: { target: SendTarget; scopeId: string | null; match?: (fields: Record<string, unknown>) => boolean; onSent?: (result: SentResult, fields: Record<string, unknown>, id: string) => void }): PendingFile[] {
  const [rows, setRows] = useState<PendingFile[]>([]);
  const matchRef = useRef(match);
  const sentRef = useRef(onSent);
  useLayoutEffect(() => {
    matchRef.current = match;
    sentRef.current = onSent;
  });
  useEffect(() => {
    if (!scopeId) return;
    const scope = scopeOf(target, scopeId);
    let live = true;
    let seq = 0;
    // Files already sent or taken off: a listing that was read just before they went never brings them back.
    const gone = new Set<string>();
    const read = () => {
      const mine = ++seq;
      void listRecords(scope).then((recs) => {
        if (!live || mine !== seq) return;
        setRows((cur) => recs.filter((r) => !gone.has(r.id) && (!matchRef.current || matchRef.current(r.fields))).map((r) => asPending(r, cur.find((p) => p.id === r.id))));
      });
    };
    read();
    const off = onSendEvent((e) => {
      if (e.scope !== scope) return;
      if (e.type === "queued") return read();
      if (e.type === "sent" || e.type === "removed") {
        gone.add(e.id);
        setRows((cur) => cur.filter((p) => p.id !== e.id));
        if (e.type === "sent" && (!matchRef.current || matchRef.current(e.fields))) sentRef.current?.(e.result, e.fields, e.id);
        return;
      }
      setRows((cur) =>
        cur.map((p) => {
          if (p.id !== e.id) return p;
          if (e.type === "sending") return { ...p, state: "sending", progress: e.progress, error: null };
          if (e.type === "waiting") return { ...p, state: "waiting", progress: 0, error: e.error };
          if (e.type === "stopped") return { ...p, state: "stopped", progress: 0, error: e.error };
          return p;
        }),
      );
    });
    return () => {
      live = false;
      off();
    };
  }, [target, scopeId]);
  return rows;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Words                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------ */

const kindWord = (k: "photo" | "video" | "pdf", n: number) => (k === "video" ? (n === 1 ? "video" : "videos") : k === "pdf" ? (n === 1 ? "PDF" : "PDFs") : n === 1 ? "photo" : "photos");
const kindOf = (p: PendingFile): "photo" | "video" | "pdf" => (p.kind === "video" ? "video" : p.kind === "pdf" ? "pdf" : "photo");

/** "2 photos and 1 video". */
export function filesWords(list: PendingFile[]): string {
  const counts = { photo: 0, video: 0, pdf: 0 };
  for (const p of list) counts[kindOf(p)]++;
  const parts = (["photo", "video", "pdf"] as const).filter((k) => counts[k]).map((k) => `${counts[k]} ${kindWord(k, counts[k])}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/** "Photo", "Video" or "PDF · scan.pdf": one file in a line. */
function fileName(p: PendingFile): string {
  return p.kind === "pdf" ? `PDF · ${p.name ?? "scan report"}` : p.kind === "video" ? "Video" : "Photo";
}

/** "this tablet", "this phone" or "this computer" (only ever shown in the browser). */
export function thisDevice(): string {
  if (typeof window === "undefined") return "this device";
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarse ? (window.innerWidth < 640 ? "this phone" : "this tablet") : "this computer";
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
/** Whether the device has a signal, following it as it comes and goes. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The work done on the device before a file is queued                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

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
 * A frame of the video, half a second in, as a small JPEG: the video's picture on the customer's PDF (23 October
 * 2026), and its picture on this screen while it waits to send. Null when the device cannot draw one; the video then
 * goes without a picture.
 */
function videoPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (b: Blob | null) => {
      if (settled) return;
      settled = true;
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(b);
    };
    v.onloadeddata = () => {
      v.pause();
      try {
        v.currentTime = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 10);
      } catch {
        finish(null);
      }
    };
    v.onseeked = () => {
      if (!v.videoWidth || !v.videoHeight) return finish(null);
      const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      try {
        canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), "image/jpeg", 0.8);
      } catch {
        finish(null);
      }
    };
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    v.src = url;
    // Phones load a video's pictures only once it starts; muted and inline it may start (it is paused at once).
    void v.play().catch(() => null);
  });
}

/**
 * Phone photos arrive as 4 to 8 MB files, and iPhones may hand over HEIC files that other browsers cannot show. Both
 * (and any picture format the report cannot take) are redrawn as a JPEG of at most 2000 px on the longer side: a few
 * hundred KB, shown everywhere. If the browser cannot decode the file, it goes as it is (a HEIC is refused in words).
 */
async function toJpeg(file: File, type: string): Promise<{ blob: Blob; type: string }> {
  const isHeic = type === "image/heic" || type === "image/heif" || /\.hei[cf]$/i.test(file.name);
  if (!isHeic && file.size <= RECODE_ABOVE_BYTES && (type === "image/jpeg" || type === "image/webp")) return { blob: file, type };
  const madeUrls: string[] = [];
  try {
    const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file).catch(() => null) : null;
    const img =
      bitmap ??
      (await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode"));
        const u = URL.createObjectURL(file);
        madeUrls.push(u);
        el.src = u;
      }));
    const w = "naturalWidth" in img ? img.naturalWidth || img.width : img.width;
    const h = "naturalHeight" in img ? img.naturalHeight || img.height : img.height;
    if (!w || !h) throw new Error("size");
    const scale = Math.min(1, MAX_PHOTO_PX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    if (bitmap) bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("encode");
    return { blob, type: "image/jpeg" };
  } catch {
    if (isHeic) throw new Error("This phone saved the photo in a format the browser cannot read. Change the camera setting to Most compatible, or take the photo again.");
    return { blob: file, type: type || "image/jpeg" };
  } finally {
    for (const u of madeUrls) URL.revokeObjectURL(u);
  }
}

/** The file's type from the browser, or (when it gives none) from the name and the button it came from. */
function typeOf(file: File, from: "photo" | "video" | "pdf"): string {
  const t = (file.type || "").toLowerCase().split(";")[0].trim();
  if (t) return t === "image/jpg" ? "image/jpeg" : t;
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (/\.(mp4|m4v)$/.test(n)) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return "video/webm";
  if (/\.(3gp|3g2)$/.test(n)) return "video/3gpp";
  if (/\.hei[cf]$/.test(n)) return "image/heic";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return from === "video" ? "video/mp4" : from === "pdf" ? "application/pdf" : "image/jpeg";
}

type Ready = { blob: Blob; contentType: string; kind: "photo" | "video" | "pdf"; name: string; duration: number | null; poster: Blob | null };

/** A photo redrawn small, a video checked (60 seconds at most) with its picture taken, a PDF as it is. Throws in words. */
async function readyOnDevice(file: File, from: "photo" | "video" | "pdf", accept: "photo_video" | "pdf"): Promise<Ready> {
  const type = typeOf(file, from);
  if (accept === "pdf" && type !== "application/pdf") throw new Error("Pick the scan report as a PDF file.");
  if (type === "application/pdf") return { blob: file, contentType: type, kind: "pdf", name: file.name, duration: null, poster: null };
  if (type.startsWith("video/")) {
    if (!SENDABLE_VIDEO.includes(type)) throw new Error("This video's format can't be sent. Record it with the camera's normal video setting (MP4).");
    const duration = await readDuration(file);
    if (duration !== null && duration > MAX_VIDEO_SECONDS + 1) throw new Error(`That video is ${Math.round(duration)} seconds. The limit is ${MAX_VIDEO_SECONDS} seconds. Please record a shorter one.`);
    const poster = await videoPoster(file);
    return { blob: file, contentType: type, kind: "video", name: file.name, duration, poster };
  }
  const re = await toJpeg(file, type);
  if (!SENDABLE_PHOTO.includes(re.type)) throw new Error("This picture's format can't be read here. Take the photo again with the camera button.");
  return { blob: re.blob, contentType: re.type, kind: "photo", name: file.name, duration: null, poster: null };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The uploader                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

/** A small camera, drawn inline so it is sharp everywhere. */
function CameraIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.7c.3-.5.8-.8 1.4-.8h3.6c.6 0 1.1.3 1.4.8L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}

/** A file still on this device: its own picture, amber while it waits or sends (with the %), red when it was stopped. Never green. */
function PendingTile({ p, size, small }: { p: PendingFile; size: string; small: boolean }) {
  const stopped = p.state === "stopped";
  const pct = Math.round(p.progress * 100);
  const band = stopped ? "Not sent" : p.state === "sending" ? `${pct}%` : "Waiting";
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-control border-2 bg-chip ${size} ${stopped ? "border-red-bar" : "border-dashed border-amber-bar"}`} title={pendingWords(p)} data-inspection-pending={p.id} data-pending-state={p.state}>
      {p.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.previewUrl} alt={fileName(p)} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted">{p.kind === "video" ? "Video" : "File"}</span>
      )}
      {p.kind === "video" && p.previewUrl ? <span className="absolute inset-0 flex items-center justify-center text-lg text-white" aria-hidden>▶</span> : null}
      <span className={`absolute inset-x-0 bottom-0 truncate px-0.5 text-center font-bold text-white ${small ? "text-[9px] leading-3" : "text-[11px]"} ${stopped ? "bg-red-bar" : "bg-ink/75"}`}>{band}</span>
      {p.state === "sending" ? <span className="absolute left-0 top-0 h-1 bg-amber-bar" style={{ width: `${Math.max(4, pct)}%` }} aria-hidden /> : null}
    </span>
  );
}

/**
 * Photos, short videos (up to 60 seconds, with sound) or PDFs attached to one place in the report: a checklist item,
 * a tyre, the A/C reading, the pre-scan slot, a bodyshop panel or a road-test item. One neat row: Photo (the camera
 * inside the page on a phone or tablet), Gallery, Video, and whatever the caller slots in beside them (the phone QR).
 * Since 31 October 2026 every file goes through THE send queue: it is kept on this device and shown at once with its own
 * picture and what is happening ("Saved on this device – sending", "Sending… 40%", "No signal – …"), and joins the
 * report's files only when the server has it (`onAdded`). The buttons never freeze while files send. Tapping a sent
 * thumbnail opens the full-screen viewer; the X takes a file off again. "iconOnly": a small camera icon that opens the
 * camera straight away, for the tyres, the discs, the pads and the A/C box, with the thumbnails beside it.
 */
export function InspectionMedia({
  inspectionId,
  files,
  where,
  accept = "photo_video",
  disabled = false,
  compact = false,
  iconOnly = false,
  label,
  extra = null,
  onAdded,
  onRemoved,
}: {
  inspectionId: string;
  files: InspectionFile[];
  where: InspectionWhere;
  accept?: "photo_video" | "pdf";
  disabled?: boolean;
  compact?: boolean;
  /** A small camera icon only (several photos allowed), for the tyres and the A/C reading. */
  iconOnly?: boolean;
  /** The icon button's title ("Front left tyre photo"). */
  label?: string;
  /** Something that belongs in the same row (the "Photo from my phone" QR button). */
  extra?: ReactNode;
  /** A file the server has recorded (never before: a file only on this device is not part of the report yet). */
  onAdded?: (f: InspectionFile) => void;
  onRemoved?: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const online = useOnline();
  const match = whereMatch(where);
  const { pending, add, retry, remove: unqueue } = useSendQueue({
    target: "inspection",
    scopeId: inspectionId,
    // What the permit check needs to see: the place (a bodyshop panel or a road-test item has its own rule) and the kind.
    grantBody: { itemKey: where.itemKey ?? null, kind: accept === "pdf" ? "pdf" : "photo", contentType: accept === "pdf" ? "application/pdf" : "image/jpeg" },
    match,
    onSent: (r) => {
      const f = fileOfSent(r);
      if (f) onAdded?.(f);
    },
  });
  // The place's own files still on this device (the hook may also hold files picked here for another panel).
  const mine = pending.filter((p) => match(p.fields));

  async function handleFiles(list: File[], from: "photo" | "video" | "pdf") {
    if (!list.length) return;
    setError(null);
    // When the person took them: a file that arrives late (no signal) still belongs to the report it was taken for.
    const pickedAt = Date.now();
    const place = { itemKey: where.itemKey ?? null, requestId: where.requestId ?? null, isPrescan: !!where.isPrescan };
    setPreparing((n) => n + list.length);
    let problem: string | null = null;
    for (const file of list) {
      try {
        const ready = await readyOnDevice(file, from, accept);
        await add([
          {
            blob: ready.blob,
            contentType: ready.contentType,
            name: ready.name,
            poster: ready.poster,
            takenAt: pickedAt,
            fields: { kind: ready.kind, ...place, ...(ready.duration !== null ? { duration: Math.round(ready.duration) } : {}) },
          },
        ]);
      } catch (err) {
        problem = err instanceof Error ? err.message : "That file could not be added. Take it again.";
        reportUploadFailure({ inspectionId, kind: `inspection_${from}`, step: "decode", error: err, sizeBytes: file.size, contentType: file.type || null, extra: { itemKey: place.itemKey, prescan: place.isPrescan } });
      } finally {
        setPreparing((n) => Math.max(0, n - 1));
      }
    }
    if (problem) setError(problem);
  }
  function pick(ref: React.RefObject<HTMLInputElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.value = "";
    el.click();
  }
  function takeInput(e: React.ChangeEvent<HTMLInputElement>, from: "video" | "pdf") {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    void handleFiles(list, from);
  }
  async function remove(id: string) {
    setRemoving(id);
    try {
      const res = await fetch("/api/inspection-media/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId, id }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not remove it.");
      onRemoved?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove it.");
    } finally {
      setRemoving(null);
    }
  }
  function dropPending(p: PendingFile) {
    if (!window.confirm(`Remove this ${kindWord(kindOf(p), 1)}? It will not be sent.`)) return;
    void unqueue(p.id);
  }

  const btn = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong bg-white px-3 text-sm font-semibold ${disabled ? "opacity-50" : "cursor-pointer hover:border-ink"}`;
  const logProblem = (m: string) => reportUploadFailure({ inspectionId, kind: "inspection_photo", step: "camera", error: m, extra: { itemKey: where.itemKey ?? null } });
  // Every photo and video of this place that the server has, in one viewer.
  const slides = files.filter((f) => f.kind !== "pdf" && f.url).map((f) => ({ key: f.id, url: f.url as string, label: f.caption ?? (f.kind === "video" ? "Video" : "Photo"), kind: f.kind === "video" ? ("video" as const) : ("image" as const) }));
  const thumb = iconOnly ? "h-12 w-12" : compact ? "h-16 w-16" : "h-24 w-24";

  // What is on its way, in one line; a file that hit a problem gets its own line with Try again and Remove.
  const moving = mine.filter((p) => p.state === "queued" || p.state === "sending");
  const troubled = mine.filter((p) => p.state === "waiting" || p.state === "stopped");
  const sendingNow = moving.find((p) => p.state === "sending");
  const device = mine.length ? thisDevice() : "";
  const movingLine = moving.length
    ? !online
      ? `${filesWords(moving)} saved on ${device} – no signal. ${moving.length === 1 ? "It sends by itself" : "They send by themselves"} when the signal is back.`
      : sendingNow
        ? `Sending ${filesWords(moving)}… ${Math.round(sendingNow.progress * 100)}%`
        : `${filesWords(moving)} saved on ${device} – sending`
    : null;
  const keepOpen = moving.some((p) => p.memoryOnly);

  // Phrasing elements only: the icon layout sits inside a line of text (the tyre's heading).
  const thumbs =
    files.length || mine.length ? (
      <span className="flex flex-wrap items-center gap-2">
        {files.map((f) =>
          f.kind === "pdf" ? (
            <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-chip px-3 text-sm font-semibold">
              PDF · {f.caption ?? "scan report"}
            </a>
          ) : (
            <span key={f.id} className="relative inline-block" data-inspection-thumb>
              <button type="button" onClick={() => setOpen(slides.findIndex((s) => s.key === f.id))} className={`${thumb} overflow-hidden rounded-control bg-chip cursor-zoom-in block`} aria-label={f.kind === "video" ? "Play the video" : "Enlarge the photo"}>
                {f.kind === "video" ? (
                  <span className="relative block h-full w-full bg-black">
                    <video src={f.url ?? undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center text-white text-xl">▶</span>
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url ?? ""} alt={f.caption ?? "Photo"} className="h-full w-full object-cover" loading="lazy" />
                )}
              </button>
              {!disabled ? (
                <button type="button" onClick={() => void remove(f.id)} disabled={removing === f.id} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white shadow" aria-label="Remove this file" data-remove-file>
                  {removing === f.id ? "…" : "✕"}
                </button>
              ) : null}
            </span>
          ),
        )}
        {mine.map((p) =>
          p.kind === "pdf" ? (
            <span key={p.id} className={`inline-flex min-h-11 items-center gap-2 rounded-control border-2 px-3 text-sm font-semibold ${p.state === "stopped" ? "border-red-bar text-red" : "border-dashed border-amber-bar"}`} title={pendingWords(p)} data-inspection-pending={p.id} data-pending-state={p.state}>
              {fileName(p)} · {p.state === "stopped" ? "not sent" : p.state === "sending" ? `${Math.round(p.progress * 100)}%` : "waiting"}
            </span>
          ) : (
            <PendingTile key={p.id} p={p} size={thumb} small={iconOnly} />
          ),
        )}
      </span>
    ) : null;

  const status = (
    <>
      {preparing ? (
        <span className="text-xs font-semibold text-muted" data-preparing>
          Getting {preparing === 1 ? "the file" : `${preparing} files`} ready…
        </span>
      ) : null}
      {movingLine ? (
        <span className={`text-xs font-semibold text-amber ${iconOnly ? "basis-full" : ""}`} data-pending-summary>
          {movingLine}
          {keepOpen ? " Keep this page open until it has gone." : ""}
        </span>
      ) : null}
      {troubled.map((p) => (
        <span key={p.id} className={`flex flex-wrap items-center gap-2 ${iconOnly ? "basis-full" : ""}`} data-pending-line={p.id} data-pending-state={p.state}>
          <span className={`text-xs font-semibold ${p.state === "stopped" ? "text-red" : "text-amber"}`}>
            {fileName(p)}: {pendingWords(p)}
          </span>
          <button type="button" onClick={() => void retry(p.id)} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-retry>
            {p.state === "stopped" ? "Try again" : "Try again now"}
          </button>
          <button type="button" onClick={() => dropPending(p)} className="min-h-11 rounded-control border border-line px-3 text-xs font-semibold text-muted" data-remove-pending>
            Remove
          </button>
        </span>
      ))}
    </>
  );

  const viewer = open !== null && slides[open] && typeof document !== "undefined" ? createPortal(<Lightbox slides={slides} index={open} onClose={() => setOpen(null)} onMove={setOpen} />, document.body) : null;

  if (iconOnly) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-inspection-media data-icon-media data-media-where={where.itemKey ?? (where.isPrescan ? "prescan" : undefined)}>
        {!disabled ? (
          <PhotoButton source="camera" multiple className="inline-flex h-11 w-11 items-center justify-center rounded-control border border-line-strong bg-white text-ink hover:border-ink" title={label ?? "Photo"} onFiles={(f) => void handleFiles(f, "photo")} onProblem={logProblem}>
            <CameraIcon />
            <span className="sr-only">{label ?? "Photo"}</span>
          </PhotoButton>
        ) : null}
        {thumbs}
        {status}
        {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
        {viewer}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-inspection-media data-media-where={where.itemKey ?? (where.isPrescan ? "prescan" : undefined)}>
      {thumbs}
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          {accept === "pdf" ? (
            <>
              <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple onChange={(e) => takeInput(e, "pdf")} className="sr-only" tabIndex={-1} aria-hidden />
              <button type="button" onClick={() => pick(pdfRef)} className={btn}>+ Add PDF</button>
            </>
          ) : (
            <>
              <PhotoButton source="camera" className={btn} title="Photo" onFiles={(f) => void handleFiles(f, "photo")} onProblem={logProblem}><CameraIcon className="h-4 w-4" /> Photo</PhotoButton>
              <PhotoButton source="gallery" multiple className={btn} title="Gallery" onFiles={(f) => void handleFiles(f, "photo")}>Gallery</PhotoButton>
              <input ref={videoRef} type="file" accept="video/*" capture="environment" onChange={(e) => takeInput(e, "video")} className="sr-only" tabIndex={-1} aria-hidden />
              <button type="button" onClick={() => pick(videoRef)} className={btn} title="A video of up to 60 seconds">Video</button>
              {extra}
            </>
          )}
        </div>
      ) : null}
      {status}
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      {viewer}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */
/* "Still sending from this tablet": the question before a report goes                                          */
/* ------------------------------------------------------------------------------------------------------------ */

export type SendGuardWords = {
  /** The button that waits, then goes by itself ("Wait, then send"). */
  wait: string;
  /** The button that goes now ("Send the report now"). */
  now: string;
  /** Why going now is fine, or what it means ("Photos taken before you send still join the report when they arrive."). */
  nowNote: string;
  /** What happens once they have arrived ("the report goes by itself."). */
  goes: string;
};

/**
 * THE question before a report, a road test, an approval or a QC check goes while files of it are still on this device
 * (31 October 2026). Next to the button it says so ("2 photos still sending from this tablet"); a tap on the button
 * asks once: wait (it then goes by itself the moment they have arrived), or go now. A file the server has not
 * confirmed never counts as sent. `blocked`: going now is not possible, said in plain words (a bodyshop finding whose
 * only photo is still on the device). `placeOf` names where each file belongs, with a Show button that scrolls to it.
 */
export function useSendGuard({
  pending,
  go,
  words,
  blocked = null,
  placeOf,
}: {
  pending: PendingFile[];
  go: () => void;
  words: SendGuardWords;
  blocked?: string | null;
  placeOf?: (p: PendingFile) => { label: string; key: string | null };
}): { mayGo: () => boolean; note: ReactNode; dialog: ReactNode; waiting: boolean } {
  const [asking, setAsking] = useState(false);
  const [waitIds, setWaitIds] = useState<string[] | null>(null);
  // The files the person already said to go without ("ask once"): a second tap for the same files goes straight on.
  const accepted = useRef(new Set<string>());
  const goRef = useRef(go);
  const pendingRef = useRef(pending);
  useLayoutEffect(() => {
    goRef.current = go;
    pendingRef.current = pending;
  });
  const online = useOnline();
  const moving = pending.filter((p) => p.state !== "stopped");
  const stopped = pending.filter((p) => p.state === "stopped");
  const waitedOpen = waitIds ? moving.filter((p) => waitIds.includes(p.id)) : [];
  const arrived = !!waitIds && waitedOpen.length === 0;
  const device = pending.length ? thisDevice() : "";

  // Everything waited for has arrived (or was taken off): go, unless one was stopped or new ones came meanwhile.
  useEffect(() => {
    if (!arrived || !waitIds) return;
    const waited = new Set(waitIds);
    const t = setTimeout(() => {
      setWaitIds(null);
      const now = pendingRef.current;
      const stoppedWaited = now.some((p) => waited.has(p.id) && p.state === "stopped");
      const fresh = now.some((p) => !waited.has(p.id) && !accepted.current.has(p.id));
      if (stoppedWaited || fresh) setAsking(true);
      else goRef.current();
    }, 0);
    return () => clearTimeout(t);
  }, [arrived, waitIds]);

  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAsking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  const mayGo = () => {
    const list = pendingRef.current;
    if (!list.length) return true;
    if (!blocked && list.every((p) => accepted.current.has(p.id))) return true;
    setAsking(true);
    return false;
  };
  const waitThenGo = () => {
    setWaitIds(moving.map((p) => p.id));
    setAsking(false);
  };
  const goNow = () => {
    for (const p of pendingRef.current) accepted.current.add(p.id);
    setAsking(false);
    setWaitIds(null);
    goRef.current();
  };
  const show = (key: string) => {
    setAsking(false);
    // The place's own photo row, else its item, else (a bodyshop panel not open now) the bodyshop card.
    const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key;
    const el = document.querySelector(`[data-media-where="${safe}"]`) ?? document.getElementById(`item-${key}`) ?? (key.startsWith("body.") ? document.getElementById("body") : null);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const note =
    waitIds && waitedOpen.length ? (
      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber" data-send-waiting={waitedOpen.length}>
        <span>
          Waiting for {filesWords(waitedOpen)} to arrive – {words.goes} Keep this page open.
        </span>
        {!blocked ? (
          <button type="button" onClick={goNow} className="min-h-11 rounded-control border-2 border-ink bg-white px-3 text-xs font-bold text-ink" data-send-now>
            {words.now}
          </button>
        ) : null}
        <button type="button" onClick={() => setWaitIds(null)} className="min-h-11 rounded-control px-2 text-xs font-semibold text-muted underline underline-offset-4" data-send-stop-waiting>
          Stop waiting
        </button>
      </span>
    ) : pending.length ? (
      <span className={`text-sm font-semibold ${stopped.length ? "text-red" : "text-amber"}`} data-send-pending={pending.length}>
        {[moving.length ? `${filesWords(moving)} still sending from ${device}${online ? "" : " – no signal yet"}` : null, stopped.length ? `${filesWords(stopped)} could not be sent` : null].filter(Boolean).join(" · ")}
      </span>
    ) : null;

  // Everything arrived while the question was open: it stays, so a tap meant for "Wait" never lands on the page below.
  const allIn = asking && !pending.length;
  const dialog =
    asking && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setAsking(false)} data-send-question>
            <div role="dialog" aria-modal="true" aria-label="Files still sending" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-card bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-base font-extrabold">{allIn ? "Everything has arrived" : moving.length ? `${filesWords(moving)} still sending from ${device}` : `${filesWords(stopped)} could not be sent`}</p>
              {moving.length ? (
                <p className="text-sm">
                  {moving.length === 1 ? `It is saved on ${device} and sends by itself` : `They are saved on ${device} and send by themselves`}
                  {online ? "." : " when the signal is back."}
                  {stopped.length ? ` ${filesWords(stopped)} could not be sent: see below.` : ""}
                </p>
              ) : null}
              <ul className="flex flex-col gap-1.5 text-sm">
                {pending.map((p) => {
                  const place = placeOf?.(p) ?? null;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-2" data-send-question-file={p.state}>
                      <span className="font-semibold">{place?.label ?? fileName(p)}</span>
                      <span className={p.state === "stopped" ? "font-semibold text-red" : "text-muted"}>{pendingWords(p)}</span>
                      {place?.key ? (
                        <button type="button" onClick={() => show(place.key as string)} className="min-h-11 px-2 text-xs font-bold underline underline-offset-4">
                          Show
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {allIn ? null : blocked ? (
                <p className="text-sm font-semibold text-red" data-send-blocked>
                  {blocked}
                </p>
              ) : (
                <p className="text-sm text-muted">{words.nowNote}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {moving.length ? (
                  <button type="button" onClick={waitThenGo} className="min-h-12 rounded-control bg-ink px-4 text-sm font-bold text-white" data-send-wait>
                    {words.wait}
                  </button>
                ) : null}
                {!blocked || allIn ? (
                  <button type="button" onClick={goNow} className={`min-h-12 rounded-control border-2 border-ink px-4 text-sm font-bold ${moving.length ? "bg-white text-ink" : "bg-ink text-white"}`} data-send-now>
                    {words.now}
                  </button>
                ) : null}
                <button type="button" onClick={() => setAsking(false)} className="min-h-12 rounded-control px-4 text-sm font-semibold text-muted" data-send-cancel>
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { mayGo, note, dialog, waiting: !!waitIds && waitedOpen.length > 0 };
}
