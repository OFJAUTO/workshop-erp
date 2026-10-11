"use client";

import { useEffect, useRef } from "react";

export type LightboxSlide = { key: string; url: string; label: string; detail?: string };

/** Full-size photo viewer for every page: swipe or use the arrows to move, tap outside, the X or Escape to close. Never a new tab. */
export function Lightbox({ slides, index, onClose, onMove }: { slides: LightboxSlide[]; index: number; onClose: () => void; onMove: (next: number) => void }) {
  const touchX = useRef<number | null>(null);
  const slide = slides[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onMove(Math.min(slides.length - 1, index + 1));
      if (e.key === "ArrowLeft") onMove(Math.max(0, index - 1));
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [index, slides.length, onClose, onMove]);

  if (!slide) return null;
  const hasPrev = index > 0;
  const hasNext = index < slides.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={slide.label}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
      onClick={onClose}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null) return;
        const dx = end - start;
        if (dx < -40 && hasNext) onMove(index + 1);
        if (dx > 40 && hasPrev) onMove(index - 1);
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold truncate">{slide.label}</span>
          {slide.detail ? <span className="text-xs text-white/70 truncate">{slide.detail}</span> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-white/70">
            {index + 1} / {slides.length}
          </span>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg border border-white/30 px-3 text-sm font-bold" aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slide.url} alt={slide.label} className="max-h-full max-w-full object-contain select-none" onClick={(e) => e.stopPropagation()} draggable={false} />
        {hasPrev ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); onMove(index - 1); }} className="absolute left-2 top-1/2 -translate-y-1/2 min-h-12 min-w-12 rounded-full bg-white/15 text-2xl font-bold hover:bg-white/30" aria-label="Previous photo">
            ‹
          </button>
        ) : null}
        {hasNext ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); onMove(index + 1); }} className="absolute right-2 top-1/2 -translate-y-1/2 min-h-12 min-w-12 rounded-full bg-white/15 text-2xl font-bold hover:bg-white/30" aria-label="Next photo">
            ›
          </button>
        ) : null}
      </div>
      <p className="pb-3 text-center text-xs text-white/60">
        <span className="[@media(hover:hover)]:hidden">Swipe for the next photo</span>
        <span className="hidden [@media(hover:hover)]:inline">Use the arrows or the arrow keys</span>
      </p>
    </div>
  );
}
