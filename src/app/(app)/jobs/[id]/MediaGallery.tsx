"use client";

import { useEffect, useRef, useState } from "react";
import { Lightbox, type LightboxSlide } from "@/components/Lightbox";
import { formatDateTime } from "@/lib/format";
import type { GateInMediaRow } from "@/lib/types";
import { WHEEL_KINDS, WHEEL_LABELS, isWheelKind, wheelConditionText } from "@/lib/wheels";

const KIND_LABEL: Record<GateInMediaRow["kind"], string> = {
  car_picture: "Car picture",
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
  item_photo: "Item photo",
  assessment_photo: "Assessment photo",
  item_collect_photo: "Item collected, photo",
};

type Slide = LightboxSlide;

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

  return <video ref={ref} src={`${url}#t=0.5`} poster={poster ?? undefined} muted playsInline preload="metadata" className="w-full rounded-card bg-black aspect-video pointer-events-none" />;
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
  hideVideos = false,
}: {
  media: GateInMediaRow[];
  urls: Record<string, string>;
  carPictureUrl?: string | null;
  damageNote?: string | null;
  compact?: boolean;
  /** Phone-first: videos large, one under the other. */
  stacked?: boolean;
  /** The customer page shows the videos through its own player (fresh addresses, "getting ready" slots). */
  hideVideos?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (media.length === 0 && !carPictureUrl) return hideVideos ? null : <p className="text-sm text-muted">Nothing uploaded yet.</p>;

  const videos = hideVideos ? [] : media.filter((m) => m.kind === "video_exterior" || m.kind === "video_interior" || m.kind === "video");
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
  function add(key: string, url: string | undefined, label: string, detail?: string, kind: "image" | "video" = "image"): Slide | null {
    if (!url) return null;
    const s: Slide = { key, url, label, detail, kind };
    slideIndex.set(key, slides.length);
    slides.push(s);
    return s;
  }
  const carSlide = carPictureUrl ? add("car", carPictureUrl, "Car picture") : null;
  const rowSlide = (p: GateInMediaRow) => add(p.id, urls[p.storage_path], KIND_LABEL[p.kind], captionFor(p, compact));
  const videoSlides = videos.map((v) => add(v.id, urls[v.storage_path], KIND_LABEL[v.kind], captionFor(v, compact), "video"));
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
          {videos.map((v, i) => {
            const url = urls[v.storage_path];
            return (
              <figure key={v.id} className="flex flex-col gap-1">
                {url ? (
                  <button type="button" onClick={() => openSlide(videoSlides[i])} className="relative block w-full overflow-hidden rounded-card" aria-label="Play the video">
                    <VideoPreview url={url} />
                    <span className="absolute inset-0 flex items-center justify-center text-white text-3xl drop-shadow">▶</span>
                  </button>
                ) : <div className="aspect-video rounded-card bg-chip" />}
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
