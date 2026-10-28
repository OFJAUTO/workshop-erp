"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbox, type LightboxSlide } from "./Lightbox";

/**
 * The page-wide photo viewer (29 October 2026). Every thumbnail on a page is a `ViewerThumb`; tapping one opens THE
 * viewer (`Lightbox`) on it, and swiping runs through every photo and video of the page in the order they appear -
 * all of one item, then on to the next item. ONE host in the root layout listens for the taps.
 */
export const VIEWER_EVENT = "erp:viewer-open";

type OpenDetail = { slides: LightboxSlide[]; index: number };

/** The page's viewer items, in the order they appear. */
function pageSlides(): { slides: LightboxSlide[]; els: HTMLElement[] } {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-viewer-item]"));
  const slides = els.map((el, i) => ({
    key: el.dataset.viewerKey || `${i}`,
    url: el.dataset.viewerSrc ?? "",
    thumb: el.dataset.viewerThumb || null,
    label: el.dataset.viewerLabel || "Photo",
    detail: el.dataset.viewerDetail || undefined,
    kind: el.dataset.viewerKind === "video" ? ("video" as const) : ("image" as const),
    poster: el.dataset.viewerPoster || null,
  }));
  return { slides, els };
}

/** Opens the viewer on this thumbnail (with an override, e.g. a freshly signed video address). */
export function openViewerAt(el: HTMLElement, override?: Partial<LightboxSlide>) {
  const { slides, els } = pageSlides();
  const index = Math.max(0, els.indexOf(el));
  if (override && slides[index]) slides[index] = { ...slides[index], ...override };
  window.dispatchEvent(new CustomEvent<OpenDetail>(VIEWER_EVENT, { detail: { slides: slides.filter((s) => s.url), index } }));
}

/** THE host: one per page (the root layout). */
export function ViewerHost() {
  const [open, setOpen] = useState<OpenDetail | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent<OpenDetail>).detail);
    window.addEventListener(VIEWER_EVENT, on);
    return () => window.removeEventListener(VIEWER_EVENT, on);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const move = useCallback((i: number) => setOpen((o) => (o ? { ...o, index: i } : o)), []);
  if (!open || !open.slides[open.index]) return null;
  return <Lightbox slides={open.slides} index={open.index} onClose={close} onMove={move} />;
}

/**
 * A thumbnail that opens the viewer: `src` is the sharp address, `thumb` the small one shown on the page (also drawn
 * first in the viewer), `label` the item's name ("FRONT BRAKE PADS – 3 MM").
 */
export function ViewerThumb({ src, thumb = null, kind = "image", label, detail, poster = null, viewerKey, className = "", children, onOpen, ...rest }: { src: string; thumb?: string | null; kind?: "image" | "video"; label: string; detail?: string | null; poster?: string | null; viewerKey?: string; className?: string; children: React.ReactNode; /** Replaces the plain open (e.g. a video that renews its address first). */ onOpen?: (el: HTMLElement) => void } & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <button
      type="button"
      {...rest}
      className={`cursor-zoom-in ${className}`}
      aria-label={`${kind === "video" ? "Play" : "Enlarge"}: ${label}`}
      data-viewer-item
      data-viewer-key={viewerKey}
      data-viewer-src={src}
      data-viewer-thumb={thumb ?? ""}
      data-viewer-kind={kind}
      data-viewer-label={label}
      data-viewer-detail={detail ?? ""}
      data-viewer-poster={poster ?? ""}
      onClick={(e) => (onOpen ? onOpen(e.currentTarget) : openViewerAt(e.currentTarget))}
    >
      {children}
    </button>
  );
}
