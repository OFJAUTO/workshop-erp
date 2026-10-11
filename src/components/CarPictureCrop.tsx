"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { uploadFile } from "@/lib/upload-client";

const FILL = "#e6e7ea";
const MAX_ZOOM = 4;
const OUT_W = 960;
const OUT_H = 600;

/**
 * The car picture for the dashboard tile, cropped on the spot: a frame in the tile's shape (16:10),
 * pinch and drag on a phone, slider and drag on a PC, then "Use photo". Tapping the finished item
 * opens the crop again with the current picture. Nothing here sits inside a form, so no slider value
 * can ever block a save.
 */
export function CarPictureCrop({ jobId, token, done, currentUrl, label = "1. Car picture (for our dashboard)" }: { jobId: string; token?: string; done: boolean; currentUrl?: string | null; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

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

  // Preview
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

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => show(image);
    image.onerror = () => setError("That photo could not be opened. Try another one.");
    image.src = url;
  }

  /** Opens the crop with the current picture, so it can be re-framed without a new photo. */
  function openWithCurrent() {
    setOpen(true);
    setSaved(false);
    if (!currentUrl || !done) return;
    setLoadingCurrent(true);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { setLoadingCurrent(false); show(image); };
    image.onerror = () => { setLoadingCurrent(false); setImg(null); };
    image.src = currentUrl;
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
    if (!blob) { setError("The current picture cannot be re-cropped here. Take or choose a new photo."); return; }
    setError(null);
    setProgress(0);
    try {
      await uploadFile(jobId, "car_picture", new File([blob], "car.jpg", { type: "image/jpeg" }), "image/jpeg", setProgress, { token });
      setSaved(true);
      setOpen(false);
      setImg(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  const finished = done || saved;
  const previewW = 360;
  const previewH = Math.round((previewW * OUT_H) / OUT_W);
  const sliderValue = Math.round(((clampZoom(zoom) - minZoom) / (MAX_ZOOM - minZoom)) * 100);

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => (open ? setOpen(false) : openWithCurrent())} className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-card border-2 px-4 text-left ${finished ? "border-green bg-green-soft" : "border-line-strong bg-white"}`}>
        <span className="flex flex-col">
          <span className="font-bold">{label}</span>
          <span className="text-xs text-muted">{finished ? "Done. Tap to replace." : "Front three-quarter view. Tap to take a photo, then frame it."}</span>
        </span>
        <span className={`text-2xl font-bold ${finished ? "text-green" : "text-faint"}`}>{finished ? "✓" : "+"}</span>
      </button>
      {open ? (
        <div className="rounded-card border border-ink p-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex">
              <input type="file" accept="image/*" capture="environment" onChange={onFile} className="sr-only" />
              <span className="inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white cursor-pointer">Take a photo</span>
            </label>
            <label className="inline-flex">
              <input type="file" accept="image/*" onChange={onFile} className="sr-only" />
              <span className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold cursor-pointer">From gallery</span>
            </label>
            <Button type="button" tone="ghost" size="md" onClick={() => { setOpen(false); setImg(null); }}>Cancel</Button>
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
              <Button type="button" size="lg" onClick={usePhoto} disabled={progress !== null}>{progress !== null ? `Saving… ${Math.round(progress * 100)}%` : "Use photo"}</Button>
            </>
          ) : null}
          {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
