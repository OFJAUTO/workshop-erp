"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui";

type Shape = "circle" | "wide";

const FILL = "#e6e7ea"; // neutral grey behind photos that do not fill the frame
const MAX_ZOOM = 4;

/**
 * Pick a photo, then drag and zoom it to fit the frame. Starts with the whole
 * photo visible inside the frame; zooming in crops, zooming out never goes
 * below "whole photo fits". The result goes into a hidden file field so an
 * ordinary form submit uploads it. The slider is kept out of the form, so it
 * can never block saving, and the cropped picture survives a failed save.
 */
export function ImageCropper({
  name,
  shape,
  outputWidth,
  outputHeight,
  capture,
  label = "Choose a photo",
}: {
  name: string;
  shape: Shape;
  outputWidth: number;
  outputHeight: number;
  capture?: "user" | "environment";
  label?: string;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const minZoom = img
    ? Math.min(outputWidth / img.naturalWidth, outputHeight / img.naturalHeight) /
      Math.max(outputWidth / img.naturalWidth, outputHeight / img.naturalHeight)
    : 1;

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

  function putBlobInField(blob: Blob) {
    const input = hiddenRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    input.files = dt.files;
  }

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

  // Export into the hidden file field whenever the crop changes
  useEffect(() => {
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = outputWidth;
    out.height = outputHeight;
    const l = layout(outputWidth, outputHeight);
    const ctx = out.getContext("2d");
    if (!l || !ctx) return;
    ctx.fillStyle = FILL;
    ctx.fillRect(0, 0, outputWidth, outputHeight);
    ctx.drawImage(img, l.dx, l.dy, l.dw, l.dh);
    out.toBlob(
      (blob) => {
        if (!blob) return;
        blobRef.current = blob;
        putBlobInField(blob);
        setReady(true);
      },
      "image/jpeg",
      0.86,
    );
  }, [img, layout, outputWidth, outputHeight]);

  // After a failed save the browser may reset the form; put the picture back.
  useEffect(() => {
    const input = hiddenRef.current;
    if (!input) return;
    const restore = () => {
      if (blobRef.current && input.files?.length === 0) putBlobInField(blobRef.current);
    };
    const form = input.form;
    form?.addEventListener("reset", () => setTimeout(restore, 0));
    const t = setInterval(restore, 800);
    return () => clearInterval(t);
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const cover = Math.max(outputWidth / image.naturalWidth, outputHeight / image.naturalHeight);
      const contain = Math.min(outputWidth / image.naturalWidth, outputHeight / image.naturalHeight);
      setImg(image);
      setZoom(contain / cover);
      setOffset({ x: 0, y: 0 });
      setReady(false);
    };
    image.src = url;
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
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(clampZoom((pinch.current.zoom * dist) / pinch.current.dist));
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

  const previewW = 360;
  const previewH = Math.round((previewW * outputHeight) / outputWidth);
  // The slider works in whole steps from 0 (whole photo) to 100 (4x), so it never fails number checks.
  const sliderValue = Math.round(((clampZoom(zoom) - minZoom) / (MAX_ZOOM - minZoom)) * 100);

  return (
    <div className="flex flex-col gap-3">
      <input type="file" name={name} ref={hiddenRef} className="hidden" tabIndex={-1} aria-hidden />
      <label className="inline-flex">
        <input type="file" accept="image/*" capture={capture} onChange={onFile} className="sr-only" form="__not_part_of_any_form" />
        <span className="inline-flex items-center justify-center min-h-11 px-5 rounded-control border border-line-strong bg-white text-sm font-bold cursor-pointer hover:bg-canvas">
          {img ? "Choose a different photo" : label}
        </span>
      </label>

      {img ? (
        <>
          <div
            ref={boxRef}
            className={`relative w-full max-w-[360px] overflow-hidden bg-chip touch-none select-none cursor-grab active:cursor-grabbing ${
              shape === "circle" ? "rounded-full" : "rounded-card"
            }`}
            style={{ aspectRatio: `${outputWidth} / ${outputHeight}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas ref={canvasRef} width={previewW} height={previewH} className="w-full h-full block" />
          </div>
          <div className="flex items-center gap-3 max-w-[360px]">
            <span className="text-xs font-semibold text-muted">Zoom</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sliderValue}
              form="__not_part_of_any_form"
              onChange={(e) => setZoom(minZoom + (Number(e.target.value) / 100) * (MAX_ZOOM - minZoom))}
              className="flex-1 accent-ink"
              aria-label="Zoom"
            />
            <Button
              tone="ghost"
              size="md"
              onClick={() => {
                setZoom(minZoom);
                setOffset({ x: 0, y: 0 });
              }}
            >
              Fit whole photo
            </Button>
          </div>
          <p className="text-xs text-muted">
            Drag to move, pinch or use the slider to zoom. Empty space is filled with grey.{" "}
            {ready ? "Ready to save." : "Preparing…"}
          </p>
        </>
      ) : null}
    </div>
  );
}
