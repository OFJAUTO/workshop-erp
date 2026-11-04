"use client";

import { useEffect, useRef, useState } from "react";
import { CameraCapture } from "./CameraCapture";
import { detectQuad, enhance, insetQuad, outputSize, pagesToPdf, warp, type EnhanceMode, type Pt, type Quad, type Rgba } from "@/lib/doc-scan";

/**
 * "Scan document" (4 November 2026): the camera opens, the paper's edges are found by themselves (drag a
 * corner if the frame is off), the page is straightened and cleaned for reading (black & white, greyscale
 * or colour), more pages can be added, and everything is saved as ONE PDF. On a computer (no touch) it
 * falls back to choosing files: picked photos go through the same straightening; a picked PDF is used as
 * it is. Used from the shared uploader next to every photo button.
 */

type Page = { jpeg: Uint8Array; width: number; height: number; thumb: string };
type Shot = { bitmap: ImageBitmap; url: string; w: number; h: number; quad: Quad; auto: boolean };

const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

async function bitmapOf(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

/** The photo as a shown picture (capped), with the paper found in a small copy. */
async function prepareShot(file: File): Promise<Shot> {
  const bitmap = await bitmapOf(file);
  const scale = Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // The paper is looked for in a small copy (fast) and the corners scaled up to the shown picture.
  const smallScale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
  const sw = Math.max(1, Math.round(canvas.width * smallScale));
  const sh = Math.max(1, Math.round(canvas.height * smallScale));
  const sc = document.createElement("canvas");
  sc.width = sw;
  sc.height = sh;
  const sctx = sc.getContext("2d");
  let quad: Quad | null = null;
  if (sctx) {
    sctx.drawImage(canvas, 0, 0, sw, sh);
    const found = detectQuad(sctx.getImageData(0, 0, sw, sh) as unknown as Rgba);
    if (found) quad = found.map((p) => ({ x: p.x / smallScale, y: p.y / smallScale })) as Quad;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("no picture");
  return { bitmap, url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height, quad: quad ?? insetQuad(canvas.width, canvas.height), auto: !!quad };
}

/** The straightened, cleaned page as a JPEG (the full photo is used, capped at ~2200 px before the warp). */
async function makePage(shot: Shot, mode: EnhanceMode): Promise<Page> {
  const { bitmap } = shot;
  const cap = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  const src = document.createElement("canvas");
  src.width = Math.max(1, Math.round(bitmap.width * cap));
  src.height = Math.max(1, Math.round(bitmap.height * cap));
  const ctx = src.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, src.width, src.height);
  const toSrc = src.width / shot.w;
  const quad = shot.quad.map((p) => ({ x: p.x * toSrc, y: p.y * toSrc })) as Quad;
  const size = outputSize(quad, 1700);
  const page = warp(ctx.getImageData(0, 0, src.width, src.height) as unknown as Rgba, quad, size.w, size.h);
  enhance(page, mode);
  const out = document.createElement("canvas");
  out.width = size.w;
  out.height = size.h;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("no canvas");
  octx.putImageData(new ImageData(page.data as Uint8ClampedArray<ArrayBuffer>, page.width, page.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("The page could not be saved.");
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: size.w, height: size.h, thumb: URL.createObjectURL(blob) };
}

export function DocumentScanner({ title = "Scan document", onDone, onClose }: { title?: string; onDone: (file: File) => void; onClose: () => void }) {
  const [step, setStep] = useState<"capture" | "crop" | "pages">(isTouchDevice() ? "capture" : "pages");
  const [shot, setShot] = useState<Shot | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [mode, setMode] = useState<EnhanceMode>("bw");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const touch = isTouchDevice();

  // The thumbnails are freed when the scanner closes.
  const pagesRef = useRef<Page[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.thumb)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // On a computer the picker opens at once: "Scan document" falls back to choosing a file.
  const opened = useRef(false);
  useEffect(() => {
    if (!touch && !opened.current) {
      opened.current = true;
      pickRef.current?.click();
    }
  }, [touch]);

  async function takeFiles(files: File[]) {
    setError(null);
    for (const f of files) {
      if (f.type === "application/pdf") {
        // A PDF picked on a computer is already a document: it is used as it is.
        onDone(f);
        return;
      }
      try {
        setBusy("Finding the paper…");
        const s = await prepareShot(f);
        setShot(s);
        setStep("crop");
        setBusy(null);
        return; // One photo at a time: Use page comes back for the next.
      } catch {
        setBusy(null);
        setError("That photo could not be read. Try another one.");
      }
    }
  }

  async function addPage() {
    if (!shot) return;
    setBusy("Straightening the page…");
    try {
      const p = await makePage(shot, mode);
      setPages((list) => [...list, p]);
      URL.revokeObjectURL(shot.url);
      setShot(null);
      setStep("pages");
    } catch {
      setError("The page could not be made. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function finish() {
    if (!pages.length) return;
    const bytes = pagesToPdf(pages.map((p) => ({ jpeg: p.jpeg, width: p.width, height: p.height })));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    onDone(new File([bytes as BlobPart], `scan-${stamp}.pdf`, { type: "application/pdf" }));
  }

  if (step === "capture") {
    return (
      <CameraCapture
        title={`${title}${pages.length ? ` · page ${pages.length + 1}` : ""}`}
        onCapture={(files) => void takeFiles(files)}
        onClose={() => (pages.length ? setStep("pages") : onClose())}
        onFallback={() => {
          setStep("pages");
          pickRef.current?.click();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink text-white" role="dialog" aria-modal="true" aria-label={title} data-doc-scanner>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-bold">{title}</span>
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-control border border-white/30 px-3 text-sm font-bold" aria-label="Close the scanner" data-scan-close>✕</button>
      </div>
      <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple={false} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; void takeFiles(list); }} className="sr-only" tabIndex={-1} aria-hidden />

      {step === "crop" && shot ? (
        <CropStep shot={shot} onQuad={(q) => setShot((s) => (s ? { ...s, quad: q } : s))} mode={mode} onMode={setMode} busy={busy} onRetake={() => { URL.revokeObjectURL(shot.url); setShot(null); if (touch) setStep("capture"); else { setStep("pages"); pickRef.current?.click(); } }} onUse={() => void addPage()} />
      ) : null}

      {step === "pages" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
          {pages.length ? (
            <>
              <div className="flex max-w-full gap-2 overflow-x-auto p-1" data-scan-pages>
                {pages.map((p, i) => (
                  <span key={p.thumb} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt={`Page ${i + 1}`} className="h-44 w-auto rounded-md border border-white/40 bg-white object-contain" data-scan-page={i + 1} />
                    <button type="button" onClick={() => setPages((l) => l.filter((x) => x !== p))} className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink/80 text-sm font-bold" aria-label={`Remove page ${i + 1}`}>×</button>
                  </span>
                ))}
              </div>
              <p className="text-sm font-semibold">{pages.length} page{pages.length === 1 ? "" : "s"} ready.</p>
            </>
          ) : (
            <p className="max-w-sm text-center text-sm text-white/80">{touch ? "Point the camera at the document." : "Choose a photo of the document (or a PDF)."}</p>
          )}
          {error ? <p className="text-sm font-semibold text-red-200" role="alert">{error}</p> : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => { if (touch) setStep("capture"); else pickRef.current?.click(); }} className="min-h-12 rounded-control border border-white/40 px-5 text-sm font-bold" data-scan-add-page>
              {pages.length ? "Add another page" : touch ? "Open the camera" : "Choose a photo"}
            </button>
            {pages.length ? (
              <button type="button" onClick={finish} className="min-h-12 rounded-control bg-white px-5 text-sm font-extrabold text-ink" data-scan-done>
                Save PDF ({pages.length} page{pages.length === 1 ? "" : "s"})
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The captured photo with the paper's frame on it: drag any corner, pick the cleaning, Use page. */
function CropStep({ shot, onQuad, mode, onMode, busy, onRetake, onUse }: { shot: Shot; onQuad: (q: Quad) => void; mode: EnhanceMode; onMode: (m: EnhanceMode) => void; busy: string | null; onRetake: () => void; onUse: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const r = holder.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: 0, y: 0 };
    return { x: ((e.clientX - r.left) * shot.w) / r.width, y: ((e.clientY - r.top) * shot.h) / r.height };
  };

  function down(i: number, e: React.PointerEvent) {
    dragging.current = i;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (dragging.current === null) return;
    const p = toImage(e);
    const next = shot.quad.map((q, i) => (i === dragging.current ? { x: Math.max(0, Math.min(shot.w, p.x)), y: Math.max(0, Math.min(shot.h, p.y)) } : q)) as Quad;
    onQuad(next);
  }

  const w = shot.w;
  const h = shot.h;
  const points = shot.quad.map((p) => `${p.x},${p.y}`).join(" ");
  const MODES: { key: EnhanceMode; label: string }[] = [
    { key: "bw", label: "Black & white" },
    { key: "grey", label: "Greyscale" },
    { key: "colour", label: "Colour" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" data-scan-crop>
      <p className="text-center text-sm font-semibold">{shot.auto ? "Paper found – drag a corner if the frame is off." : "Drag the corners onto the paper's edges."}</p>
      <div ref={holder} className="relative mx-auto w-full max-w-xl touch-none select-none" onPointerMove={move} onPointerUp={() => (dragging.current = null)} onPointerCancel={() => (dragging.current = null)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shot.url} alt="The captured document" className="w-full rounded-md" draggable={false} />
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <polygon points={points} fill="rgba(45, 212, 100, 0.14)" stroke="#2dd464" strokeWidth={Math.max(2, w / 300)} />
        </svg>
        {shot.quad.map((p, i) => (
          <button
            key={i}
            type="button"
            onPointerDown={(e) => down(i, e)}
            aria-label={["Top left", "Top right", "Bottom right", "Bottom left"][i] + " corner"}
            data-scan-corner={i}
            className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-green/80"
            style={{ left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2" data-scan-modes>
        {MODES.map((m) => (
          <button key={m.key} type="button" onClick={() => onMode(m.key)} aria-pressed={mode === m.key} data-scan-mode={m.key} className={`min-h-11 rounded-control border px-4 text-sm font-bold ${mode === m.key ? "border-white bg-white text-ink" : "border-white/40 text-white"}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 pb-2">
        <button type="button" onClick={onRetake} disabled={!!busy} className="min-h-12 rounded-control border border-white/40 px-5 text-sm font-bold" data-scan-retake>Retake</button>
        <button type="button" onClick={onUse} disabled={!!busy} className="min-h-12 rounded-control bg-white px-6 text-sm font-extrabold text-ink disabled:opacity-60" data-scan-use>
          {busy ?? "Use page"}
        </button>
      </div>
    </div>
  );
}
