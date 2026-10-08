"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { GateInMediaRow } from "@/lib/types";
import { WHEEL_KINDS, WHEEL_LABELS, isWheelKind, wheelConditionText } from "@/lib/wheels";

const KIND_LABEL: Record<GateInMediaRow["kind"], string> = {
  video: "Walk-around video",
  video_exterior: "Exterior video",
  video_interior: "Interior video",
  dashboard_photo: "Dashboard",
  keys_photo: "Keys",
  keys_photo_front: "Keys, front",
  keys_photo_back: "Keys, back",
  damage_photo: "Damage",
  gate_out_photo: "Gate-out",
  wheel_fl: "Front left wheel",
  wheel_fr: "Front right wheel",
  wheel_rl: "Rear left wheel",
  wheel_rr: "Rear right wheel",
};

type Slide = { key: string; url: string; label: string; detail?: string };

/**
 * A video with a real frame as its preview picture instead of a black box. The browser is
 * asked to show the frame half a second in; as a fallback a frame is drawn into a canvas and
 * used as the poster once the file's first bytes arrive.
 */
function VideoPreview({ url }: { url: string }) {
  const [poster, setPoster] = useState<string | null>(null);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = document.createElement("video");
    probe.crossOrigin = "anonymous";
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = "metadata";
    probe.src = url;
    const onLoaded = () => {
      try {
        probe.currentTime = Math.min(0.5, Math.max(0, (probe.duration || 1) / 10));
      } catch {
        // ignore
      }
    };
    const onSeeked = () => {
      if (cancelled || !probe.videoWidth) return;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 640 / probe.videoWidth);
      canvas.width = Math.round(probe.videoWidth * scale);
      canvas.height = Math.round(probe.videoHeight * scale);
      try {
        canvas.getContext("2d")?.drawImage(probe, 0, 0, canvas.width, canvas.height);
        setPoster(canvas.toDataURL("image/jpeg", 0.8));
      } catch {
        // Cross-origin without CORS headers: keep the browser's own frame.
      }
      probe.removeAttribute("src");
      probe.load();
    };
    probe.addEventListener("loadedmetadata", onLoaded);
    probe.addEventListener("seeked", onSeeked);
    return () => {
      cancelled = true;
      probe.removeEventListener("loadedmetadata", onLoaded);
      probe.removeEventListener("seeked", onSeeked);
      probe.removeAttribute("src");
    };
  }, [url]);

  return <video ref={ref} src={`${url}#t=0.5`} poster={poster ?? undefined} controls playsInline preload="metadata" className="w-full rounded-card bg-black aspect-video" />;
}

function captionFor(p: GateInMediaRow, compact: boolean) {
  const parts = [KIND_LABEL[p.kind]];
  if (isWheelKind(p.kind) && p.wheel_condition?.length) parts.push(wheelConditionText(p.wheel_condition));
  if (p.caption) parts.push(p.caption);
  if (!compact) parts.push(formatDateTime(p.taken_at));
  return parts.join(" · ");
}

function Thumb({
  slide,
  caption,
  onOpen,
  aspect = "aspect-[4/3]",
  small = false,
}: {
  slide: Slide | null;
  caption: string;
  onOpen: () => void;
  aspect?: string;
  small?: boolean;
}) {
  return (
    <figure className="flex flex-col gap-1 min-w-0">
      {slide ? (
        <button type="button" onClick={onOpen} className={`block w-full ${aspect} rounded-card overflow-hidden bg-chip cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ink/40`} aria-label={`Enlarge: ${caption}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.url} alt={caption} className="h-full w-full object-cover" loading="lazy" />
        </button>
      ) : (
        <div className={`${aspect} rounded-card bg-chip`} />
      )}
      <figcaption className={`${small ? "text-[11px] leading-tight" : "text-xs"} text-muted`}>{caption}</figcaption>
    </figure>
  );
}

/** Full-size viewer: swipe or use the arrows to move between photos, tap outside or press Escape to close. */
function Lightbox({ slides, index, onClose, onMove }: { slides: Slide[]; index: number; onClose: () => void; onMove: (next: number) => void }) {
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
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-control border border-white/30 px-3 text-sm font-bold" aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slide.url} alt={slide.label} className="max-h-full max-w-full object-contain select-none" onClick={(e) => e.stopPropagation()} draggable={false} />
        {hasPrev ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMove(index - 1);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 min-h-12 min-w-12 rounded-full bg-white/15 text-2xl font-bold hover:bg-white/30"
            aria-label="Previous photo"
          >
            ‹
          </button>
        ) : null}
        {hasNext ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMove(index + 1);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-12 min-w-12 rounded-full bg-white/15 text-2xl font-bold hover:bg-white/30"
            aria-label="Next photo"
          >
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

/**
 * Everything recorded for a job: car picture, both videos labelled, the dashboard
 * photo, the two keys photos side by side, the four wheels in one row, then damage
 * photos with the damage note. Photos open full size on tap. Nothing can be removed.
 */
export function MediaGallery({
  media,
  urls,
  carPictureUrl,
  damageNote,
  compact = false,
  stacked = false,
}: {
  media: GateInMediaRow[];
  urls: Record<string, string>;
  carPictureUrl?: string | null;
  damageNote?: string | null;
  compact?: boolean;
  /** Phone-first: videos large, one under the other. */
  stacked?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (media.length === 0 && !carPictureUrl) return <p className="text-sm text-muted">Nothing uploaded yet.</p>;

  const videos = media.filter((m) => m.kind === "video_exterior" || m.kind === "video_interior" || m.kind === "video");
  const dashboard = media.filter((m) => m.kind === "dashboard_photo");
  const keys = media.filter((m) => m.kind === "keys_photo_front" || m.kind === "keys_photo_back" || m.kind === "keys_photo");
  // Newest photo of each wheel, in the order they were taken.
  const wheels = WHEEL_KINDS.map((kind) => media.filter((m) => m.kind === kind).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]).filter((m): m is GateInMediaRow => !!m);
  const damage = media.filter((m) => m.kind === "damage_photo");
  const other = media.filter((m) => m.kind === "gate_out_photo");
  const cols = compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  // One ordered list of everything that can be enlarged, so swiping moves through all of it.
  const slides: Slide[] = [];
  const slideIndex = new Map<string, number>();
  function add(key: string, url: string | undefined, label: string, detail?: string): Slide | null {
    if (!url) return null;
    const s = { key, url, label, detail };
    slideIndex.set(key, slides.length);
    slides.push(s);
    return s;
  }
  const carSlide = carPictureUrl ? add("car", carPictureUrl, "Car picture") : null;
  const rowSlide = (p: GateInMediaRow) => add(p.id, urls[p.storage_path], KIND_LABEL[p.kind], captionFor(p, compact));
  const dashboardSlides = dashboard.map(rowSlide);
  const keysSlides = keys.map(rowSlide);
  const wheelSlides = wheels.map(rowSlide);
  const damageSlides = damage.map(rowSlide);
  const otherSlides = other.map(rowSlide);
  const openSlide = (s: Slide | null) => {
    if (s) setOpen(slideIndex.get(s.key) ?? null);
  };
  const hasPhotos = slides.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {hasPhotos ? (
        <p className="text-xs text-muted -mb-3">
          <span className="[@media(hover:hover)]:hidden">Tap any photo to enlarge</span>
          <span className="hidden [@media(hover:hover)]:inline">Click any photo to enlarge</span>
        </p>
      ) : null}

      {carPictureUrl ? (
        <div className={compact ? "w-full" : "w-full max-w-md"}>
          <Thumb slide={carSlide} caption="Car picture" onOpen={() => openSlide(carSlide)} aspect="aspect-[16/10]" />
        </div>
      ) : null}

      {videos.length ? (
        <div className={`grid gap-4 ${compact || stacked ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
          {videos.map((v) => {
            const url = urls[v.storage_path];
            return (
              <figure key={v.id} className="flex flex-col gap-1">
                {url ? <VideoPreview url={url} /> : <div className="aspect-video rounded-card bg-chip" />}
                <figcaption className="text-xs font-semibold">
                  {KIND_LABEL[v.kind]}
                  {v.duration_s ? ` · ${v.duration_s}s` : ""}
                  {compact ? "" : ` · ${formatDateTime(v.taken_at)}`}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : null}

      {dashboard.length || keys.length ? (
        <div className={`grid gap-3 ${cols}`}>
          {dashboard.map((p, i) => (
            <Thumb key={p.id} slide={dashboardSlides[i]} caption={captionFor(p, compact)} onOpen={() => openSlide(dashboardSlides[i])} />
          ))}
          {keys.length ? (
            <div className="col-span-2 grid grid-cols-2 gap-3 rounded-card border border-line p-2">
              {keys.map((p, i) => (
                <Thumb key={p.id} slide={keysSlides[i]} caption={captionFor(p, compact)} onOpen={() => openSlide(keysSlides[i])} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {wheels.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em]">Wheels</span>
          <div className={`grid grid-cols-4 gap-2 ${compact ? "" : "max-w-xl"}`}>
            {wheels.map((p, i) => (
              <Thumb
                key={p.id}
                slide={wheelSlides[i]}
                caption={`${WHEEL_LABELS[p.kind as (typeof WHEEL_KINDS)[number]]}${p.wheel_condition?.length ? ` · ${wheelConditionText(p.wheel_condition)}` : ""}`}
                onOpen={() => openSlide(wheelSlides[i])}
                aspect="aspect-square"
                small
              />
            ))}
          </div>
        </div>
      ) : null}

      {damage.length || damageNote ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em]">Damage photos · {damage.length}</span>
          {damage.length ? (
            <div className={`grid gap-3 ${cols}`}>
              {damage.map((p, i) => (
                <Thumb key={p.id} slide={damageSlides[i]} caption={captionFor(p, compact)} onOpen={() => openSlide(damageSlides[i])} />
              ))}
            </div>
          ) : null}
          {damageNote ? <p className="text-sm whitespace-pre-wrap rounded-card bg-chip px-3 py-2">{damageNote}</p> : null}
        </div>
      ) : null}

      {other.length ? (
        <div className={`grid gap-3 ${cols}`}>
          {other.map((p, i) => (
            <Thumb key={p.id} slide={otherSlides[i]} caption={captionFor(p, compact)} onOpen={() => openSlide(otherSlides[i])} />
          ))}
        </div>
      ) : null}

      {open !== null ? <Lightbox slides={slides} index={open} onClose={() => setOpen(null)} onMove={setOpen} /> : null}
    </div>
  );
}
