"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LightboxSlide = {
  key: string;
  /** The sharp, full-size address the viewer shows. */
  url: string;
  /** The small picture the page showed: drawn first while the sharp one loads. */
  thumb?: string | null;
  /** The item's name in capitals, e.g. "FRONT BRAKE PADS – 3 MM". */
  label: string;
  detail?: string;
  /** A video plays inside the viewer (muted to start); the default is a photo. */
  kind?: "image" | "video";
  poster?: string | null;
};

const MAX_ZOOM = 4;
const DOUBLE_TAP_MS = 300;

/**
 * THE one full-screen viewer for every photo and video in the app (29 October 2026): on a dark background, ✕ to
 * close (also Escape, a swipe down, or the phone's back button); pinch or double-tap zooms the PHOTO, never the page,
 * and a zoomed photo can be dragged; swipe left/right (arrows and the keyboard on a computer) through every photo,
 * with "3 / 12" and the item's name; videos play in it, muted to start. The page's small picture shows at once and
 * the sharp one replaces it as soon as it has loaded.
 */
export function Lightbox({ slides, index, onClose, onMove }: { slides: LightboxSlide[]; index: number; onClose: () => void; onMove: (next: number) => void }) {
  const slide = slides[index];
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState<string | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; dist: number; s: number; x: number; y: number; moved: boolean; pinched?: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const pushed = useRef(false);
  const closing = useRef(false);
  const [dragging, setDragging] = useState(false);
  // The latest close handler, so the one history step below is taken once per opening (never on every render).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // A new slide starts unzoomed.
  const [seenIndex, setSeenIndex] = useState(index);
  if (seenIndex !== index) {
    setSeenIndex(index);
    setZoom({ s: 1, x: 0, y: 0 });
    setVideoFailed(false);
  }

  const hasPrev = index > 0;
  const hasNext = index < slides.length - 1;
  const go = useCallback((next: number) => { if (next >= 0 && next < slides.length) onMove(next); }, [onMove, slides.length]);

  // The phone's back button closes the viewer instead of leaving the page: one history step while it is open.
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (pushed.current && typeof window !== "undefined" && (window.history.state as { erpViewer?: boolean } | null)?.erpViewer) window.history.back();
    else onCloseRef.current();
  }, []);
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), erpViewer: true }, "");
    pushed.current = true;
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const zoomAt = useCallback((s: number, cx?: number, cy?: number) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, s));
      if (next === 1) return { s: 1, x: 0, y: 0 };
      const box = stage.current?.getBoundingClientRect();
      if (!box || cx === undefined || cy === undefined) return { ...z, s: next };
      // Keep the point under the finger where it is while the scale changes.
      const ox = cx - (box.left + box.width / 2);
      const oy = cy - (box.top + box.height / 2);
      const k = next / z.s;
      return { s: next, x: ox - (ox - z.x) * k, y: oy - (oy - z.y) * k };
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
      if (e.key === "+" || e.key === "=") setZoom((z) => ({ ...z, s: Math.min(MAX_ZOOM, z.s + 0.5) }));
      if (e.key === "-") setZoom((z) => (z.s - 0.5 <= 1 ? { s: 1, x: 0, y: 0 } : { ...z, s: z.s - 0.5 }));
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [index, go, close]);

  if (!slide) return null;
  const isVideo = slide.kind === "video";

  const onPointerDown = (e: React.PointerEvent) => {
    if (isVideo) return;
    // Keep the finger on the photo even when it slides off it; a browser that refuses still gets the gesture.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    // A second finger turns the gesture into a pinch for good (lifting the fingers is never a swipe or a tap).
    const pinched = gesture.current?.pinched || pts.length >= 2;
    gesture.current = { startX: e.clientX, startY: e.clientY, dist, s: zoom.s, x: zoom.x, y: zoom.y, moved: false, pinched };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (isVideo || !pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist > 0) {
      // Pinch: the photo scales around the middle of the two fingers.
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      g.moved = true;
      g.pinched = true;
      setDragging(true);
      zoomAt(g.s * (d / g.dist), (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
    if (zoom.s > 1) {
      setDragging(true);
      setZoom({ s: zoom.s, x: g.x + dx, y: g.y + dy });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (isVideo || !pointers.current.has(e.pointerId)) return;
    const wasPinch = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    setDragging(false);
    const g = gesture.current;
    if (!g || wasPinch || g.pinched) {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved) {
      // A double tap (or double click) zooms in on that point, or back out.
      const now = Date.now();
      const last = lastTap.current;
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        lastTap.current = null;
        if (zoom.s > 1) setZoom({ s: 1, x: 0, y: 0 });
        else zoomAt(2.5, e.clientX, e.clientY);
      } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      return;
    }
    if (zoom.s > 1) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1);
    else if (dy > 90 && dy > Math.abs(dx)) close();
  };

  const sharpReady = loaded === slide.url;
  return (
    <div role="dialog" aria-modal="true" aria-label={slide.label} className="fixed inset-0 z-[80] flex flex-col bg-black text-white" data-lightbox data-lightbox-index={index}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-extrabold uppercase leading-snug" data-lightbox-label>{slide.label}</span>
          {slide.detail ? <span className="text-xs text-white/70">{slide.detail}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm font-bold text-white/80" data-lightbox-count>{index + 1} / {slides.length}</span>
          <button type="button" onClick={close} className="min-h-11 min-w-11 rounded-full bg-white/15 text-lg font-bold hover:bg-white/30" aria-label="Close" data-lightbox-close>✕</button>
        </div>
      </div>
      <div
        ref={stage}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); gesture.current = null; setDragging(false); }}
        onWheel={(e) => { if (!isVideo) zoomAt(zoom.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }}
        data-lightbox-stage
      >
        {isVideo ? (
          <div className="absolute inset-0 flex items-center justify-center px-2">
            {videoFailed ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="text-sm font-bold">Couldn&apos;t load the video.</span>
                <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-full bg-white px-4 text-sm font-bold text-black">Reload the page and try again</button>
              </div>
            ) : (
              <video key={slide.key} src={slide.url} poster={slide.poster ?? undefined} controls autoPlay muted playsInline className="max-h-full max-w-full" onError={() => setVideoFailed(true)} data-lightbox-video />
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`, transition: dragging ? "none" : "transform 120ms ease-out" }} data-lightbox-zoom={zoom.s.toFixed(2)}>
            {/* The page's small picture at once, the sharp one over it when it has arrived. */}
            {slide.thumb && !sharpReady ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slide.thumb} alt="" aria-hidden className="absolute max-h-full max-w-full object-contain blur-[1px]" draggable={false} />
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={slide.key} src={slide.url} alt={slide.label} onLoad={() => setLoaded(slide.url)} className={`relative max-h-full max-w-full object-contain ${slide.thumb && !sharpReady ? "opacity-0" : "opacity-100"}`} draggable={false} data-lightbox-img />
          </div>
        )}
        {hasPrev ? (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(index - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 min-h-12 min-w-12 rounded-full bg-white/15 text-2xl font-bold hover:bg-white/30" aria-label="Previous" data-lightbox-prev>‹</button>
        ) : null}
        {hasNext ? (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(index + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 min-h-12 min-w-12 rounded-full bg-white/15 text-2xl font-bold hover:bg-white/30" aria-label="Next" data-lightbox-next>›</button>
        ) : null}
      </div>
      <p className="py-2 text-center text-xs text-white/60">
        <span className="[@media(hover:hover)]:hidden">{isVideo ? "Swipe with the arrows for the next one" : "Pinch or double-tap to zoom · swipe for the next one · swipe down to close"}</span>
        <span className="hidden [@media(hover:hover)]:inline">{isVideo ? "Arrow keys for the next one · Esc to close" : "Double-click or scroll to zoom · arrow keys for the next one · Esc to close"}</span>
      </p>
    </div>
  );
}
