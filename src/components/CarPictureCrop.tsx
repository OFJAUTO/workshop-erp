"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { PhotoButton } from "./PhotoButton";
import { PendingRows, gateInFields } from "./MediaCapture";
import type { Checklist } from "@/lib/media";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { reportUploadFailure, shrinkPhoto } from "@/lib/upload-client";
import { pendingWords, useSendQueue } from "@/lib/use-send-queue";

const FILL = "#e6e7ea";
const MAX_ZOOM = 4;
const OUT_W = 960;
const OUT_H = 600;

/**
 * The car picture for the dashboard tile, cropped on the spot: a frame in the tile's shape (16:10),
 * pinch and drag on a phone, slider and drag on a PC, then "Use photo". The cropped picture is kept on the device
 * until the server has it (no signal, a reload, the tablet's idle lock: it still goes by itself) and stays on the
 * item as its preview the whole way: amber "on this device" or "Sending…", red with Try again and Remove only when it
 * can never go by itself, Done only when the server's checklist counts it. Closing the crop with a photo in it asks
 * "Use this photo as it is?" instead of throwing it away. Tapping the finished item opens the crop again with the
 * current picture.
 */
export function CarPictureCrop({ jobId, token, done, currentUrl, label = "1. Car picture (for our dashboard)", attempted = false, onChecklist }: { jobId: string; token?: string; done: boolean; currentUrl?: string | null; label?: string; /** Someone tried to finish the gate-in: a missing picture shows in red. */ attempted?: boolean; /** The server's fresh checklist once the file is recorded. */ onChecklist?: (c: Partial<Checklist>) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  // The cropped picture of this visit (made on the device): the item's preview from "Use photo" through to Done.
  const [preview, setPreview] = useState<{ id: string | null; url: string } | null>(null);
  // The server's own address of the picture, for a picture that was waiting from an earlier visit.
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [serverDone, setServerDone] = useState(false);
  const [seenDone, setSeenDone] = useState(done);
  if (seenDone !== done) {
    setSeenDone(done);
    setServerDone(false);
  }
  const [askClose, setAskClose] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const previewRef = useRef<string | null>(null);
  useEffect(() => { previewRef.current = preview?.url ?? null; }, [preview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const { pending, add, retry, remove } = useSendQueue({
    target: "gate_in",
    scopeId: jobId,
    grantBody: gateInFields("car_picture", { token }),
    match: (f) => f.kind === "car_picture",
    onSent: (result) => {
      const checklist = (result.checklist ?? {}) as Partial<Checklist>;
      if (checklist.carPicture !== true) {
        reportUploadFailure({ jobId, kind: "car_picture", step: "register", error: "Sent and recorded, but the checklist did not count the car picture", token, contentType: "image/jpeg", extra: { queued: true } });
      } else {
        setServerDone(true);
      }
      if (typeof result.url === "string" && result.url) setSentUrl(result.url);
      onChecklist?.(checklist);
      refreshWhenIdle(() => router.refresh());
    },
  });

  const minZoom = img ? Math.min(OUT_W / img.naturalWidth, OUT_H / img.naturalHeight) / Math.max(OUT_W / img.naturalWidth, OUT_H / img.naturalHeight) : 1;
  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(minZoom, z)), [minZoom]);
  const layout = useCallback(
    (boxW: number, boxH: number) => {
      if (!img) return null;
      const cover = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight);
      const scale = cover * clampZoom(zoom);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const maxX = Math.abs(dw - boxW) / 2;
      const maxY = Math.abs(dh - boxH) / 2;
      const x = Math.min(maxX, Math.max(-maxX, offset.x));
      const y = Math.min(maxY, Math.max(-maxY, offset.y));
      return { dw, dh, dx: (boxW - dw) / 2 + x, dy: (boxH - dh) / 2 + y };
    },
    [img, zoom, offset, clampZoom],
  );

  // Preview inside the crop frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const l = layout(canvas.width, canvas.height);
    const ctx = canvas.getContext("2d");
    if (!l || !ctx) return;
    ctx.fillStyle = FILL;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, l.dx, l.dy, l.dw, l.dh);
  }, [img, layout]);

  const show = (image: HTMLImageElement) => {
    const cover = Math.max(OUT_W / image.naturalWidth, OUT_H / image.naturalHeight);
    const contain = Math.min(OUT_W / image.naturalWidth, OUT_H / image.naturalHeight);
    setImg(image);
    setZoom(contain / cover);
    setOffset({ x: 0, y: 0 });
    setError(null);
  };

  function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => show(image);
    image.onerror = () => {
      setError("That photo could not be opened. Try another one.");
      reportUploadFailure({ jobId, kind: "car_picture", step: "decode", error: `Could not decode ${file.type || "image"} (${file.size} bytes)`, token, sizeBytes: file.size, contentType: file.type });
    };
    image.src = url;
  }

  /** Opens the crop with the current picture, so it can be re-framed without a new photo. */
  function openWithCurrent() {
    setOpen(true);
    if (!currentUrl || !done) return;
    setLoadingCurrent(true);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { setLoadingCurrent(false); show(image); };
    image.onerror = () => { setLoadingCurrent(false); setImg(null); };
    image.src = currentUrl;
  }

  /** Closing the crop with a photo in it: ask before throwing the photo away. */
  function requestClose() {
    if (img && !loadingCurrent) {
      setAskClose(true);
      return;
    }
    setOpen(false);
    setImg(null);
  }
  function discard() {
    setAskClose(false);
    setOpen(false);
    setImg(null);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = Array.from(pointers.current.values());
      setZoom(clampZoom((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist));
      return;
    }
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ratio = canvas.width / box.clientWidth;
    setOffset((o) => ({ x: o.x + (cur.x - prev.x) * ratio, y: o.y + (cur.y - prev.y) * ratio }));
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  /** Keeps the cropped picture on the device and hands it to the queue: the preview stays on the item the whole way. */
  async function send(blob: Blob) {
    setError(null);
    const small = await shrinkPhoto(blob);
    let url: string | null = null;
    try {
      url = URL.createObjectURL(small.blob);
    } catch {
      url = null;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    setPreview(url ? { id: null, url } : null);
    try {
      const [id] = await add([{ blob: small.blob, contentType: small.type || "image/jpeg", name: "car.jpg", fields: gateInFields("car_picture", { token }) }]);
      if (url && id) setPreview((cur) => (cur && cur.url === url ? { id, url } : cur));
    } catch {
      setError("The picture could not be kept on this device. Take it again.");
      reportUploadFailure({ jobId, kind: "car_picture", step: "upload", error: "Could not put the cropped picture in the send queue", token, sizeBytes: small.blob.size, contentType: small.type });
    }
  }

  /** Remove a picture that never arrived: its preview goes with it. */
  function removeQueued(id: string) {
    if (preview?.id === id) {
      URL.revokeObjectURL(preview.url);
      setPreview(null);
    }
    void remove(id);
  }

  async function usePhoto() {
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUT_W;
    out.height = OUT_H;
    const l = layout(OUT_W, OUT_H);
    const ctx = out.getContext("2d");
    if (!l || !ctx) return;
    ctx.fillStyle = FILL;
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    ctx.drawImage(img, l.dx, l.dy, l.dw, l.dh);
    let blob: Blob | null = null;
    try {
      blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.86));
    } catch {
      blob = null;
    }
    if (!blob) {
      setError("The current picture cannot be re-cropped here. Take or choose a new photo.");
      reportUploadFailure({ jobId, kind: "car_picture", step: "decode", error: "Canvas could not produce the cropped JPEG", token });
      return;
    }
    setAskClose(false);
    setOpen(false);
    setImg(null);
    await send(blob);
  }

  const counted = done || serverDone;
  const stopped = pending.find((p) => p.state === "stopped") ?? null;
  const sending = pending.find((p) => p.state === "sending") ?? null;
  const onDevice = pending.length > 0;
  const lead = stopped ?? sending ?? pending.find((p) => p.state === "waiting") ?? pending[pending.length - 1] ?? null;
  const finished = counted && !onDevice;
  const red = !!stopped || (attempted && !counted && !onDevice);
  const status = stopped ? "failed" : sending ? "uploading" : onDevice ? "device" : counted ? "done" : "waiting";
  // The cropped picture of this visit, else the picture waiting from an earlier visit, else the server's copy.
  const shown = preview?.url ?? lead?.previewUrl ?? sentUrl;
  const previewW = 360;
  const previewH = Math.round((previewW * OUT_H) / OUT_W);
  const sliderValue = Math.round(((clampZoom(zoom) - minZoom) / (MAX_ZOOM - minZoom)) * 100);
  const text = lead
    ? pendingWords(lead)
    : finished
      ? "Done. Tap to replace."
      : attempted
        ? "Missing. Tap to take the photo."
        : "Front three-quarter view. Tap to take a photo, then frame it.";

  return (
    <div className="flex flex-col gap-2" data-media-item="car_picture" data-missing={counted ? "false" : "true"} data-media-status={status} data-device-files={pending.length}>
      <button type="button" data-car-tile onClick={() => (open ? requestClose() : openWithCurrent())} className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-card border-2 px-4 text-left ${finished ? "border-green bg-green-soft" : red ? "border-red-bar bg-red-soft" : onDevice ? "border-amber-bar bg-amber-soft" : "border-line-strong bg-white"}`}>
        <span className="flex items-center gap-3 min-w-0">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className={`h-12 w-[4.8rem] shrink-0 rounded-md object-cover ${stopped ? "opacity-70" : ""}`} data-car-preview />
          ) : null}
          <span className="flex flex-col min-w-0">
            <span className="font-bold">{label}</span>
            <span className={`text-xs ${stopped ? "font-semibold text-red" : onDevice ? "font-semibold text-amber" : "text-muted"}`} data-media-words>{text}</span>
          </span>
        </span>
        <span className={`text-2xl font-bold ${finished ? "text-green" : red ? "text-red" : onDevice ? "text-amber" : "text-faint"}`}>{finished ? "✓" : red ? "!" : onDevice ? "↑" : "+"}</span>
      </button>
      {sending ? (
        <div className="h-2 rounded-full bg-track overflow-hidden">
          <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(sending.progress * 100)}%` }} />
        </div>
      ) : null}
      <PendingRows pending={pending} onRetry={(id) => void retry(id)} onRemove={removeQueued} />
      {error && !open ? <p className="text-sm font-semibold text-red" data-media-problem>{error}</p> : null}
      {open ? (
        <div className="rounded-card border border-ink p-3 flex flex-col gap-3" data-car-crop>
          <div className="flex flex-wrap gap-2">
            <PhotoButton source="camera" className="inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white" title="Car picture" onFiles={onFiles} onProblem={(m) => reportUploadFailure({ jobId, kind: "car_picture", step: "camera", error: m, token })}>
              Take a photo
            </PhotoButton>
            <PhotoButton source="gallery" className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" title="Car picture" onFiles={onFiles}>
              From gallery
            </PhotoButton>
            <Button type="button" tone="ghost" size="md" onClick={requestClose}>Cancel</Button>
          </div>
          {loadingCurrent ? <p className="text-xs text-muted">Loading the current picture…</p> : null}
          {img ? (
            <>
              <div ref={boxRef} className="relative w-full max-w-[360px] overflow-hidden rounded-card bg-chip touch-none select-none cursor-grab active:cursor-grabbing" style={{ aspectRatio: `${OUT_W} / ${OUT_H}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <canvas ref={canvasRef} width={previewW} height={previewH} className="w-full h-full block" />
              </div>
              <div className="flex items-center gap-3 max-w-[360px]">
                <span className="text-xs font-semibold text-muted">Zoom</span>
                <input type="range" min={0} max={100} step={1} value={sliderValue} onChange={(e) => setZoom(minZoom + (Number(e.target.value) / 100) * (MAX_ZOOM - minZoom))} className="flex-1 accent-ink" aria-label="Zoom" />
                <Button type="button" tone="ghost" size="md" onClick={() => { setZoom(minZoom); setOffset({ x: 0, y: 0 }); }}>Fit whole photo</Button>
              </div>
              <p className="text-xs text-muted">Drag to move, pinch or use the slider to zoom. The frame is the dashboard tile.</p>
              <Button type="button" size="lg" onClick={usePhoto}>Use photo</Button>
            </>
          ) : null}
          {askClose ? (
            <div className="rounded-card border border-line-strong bg-chip p-3 flex flex-col gap-2" data-ask-close>
              <span className="text-sm font-bold">Use this photo as it is?</span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="md" onClick={usePhoto}>Use as it is</Button>
                <Button type="button" tone="ghost" size="md" onClick={discard}>Discard the photo</Button>
                <Button type="button" tone="ghost" size="md" onClick={() => setAskClose(false)}>Keep framing</Button>
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
