"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LightboxSlide } from "@/components/Lightbox";
import { ViewerThumb } from "@/components/PhotoViewer";
import { formatDateTime } from "@/lib/format";
import { MEDIA_KIND_LABELS, type GateInMediaRow } from "@/lib/types";
import { WHEEL_KINDS, WHEEL_LABELS, isWheelKind, wheelConditionText } from "@/lib/wheels";
import { captionWords } from "@/lib/damage";

const KIND_LABEL = MEDIA_KIND_LABELS;

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
  const words = captionWords(p.caption);
  if (words) parts.push(words);
  if (!compact) parts.push(formatDateTime(p.taken_at));
  return parts.join(" · ");
}

/** The X on a photo or video: one tap asks "Remove?", the second removes. The answer sits on the picture itself. */
function RemoveX({ onRemove, label }: { onRemove: () => void; label: string }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  return ask ? (
    <div className="absolute inset-x-1 top-1 z-10 flex items-center justify-between gap-1 rounded-control border border-line bg-white/95 px-2 py-1 text-xs shadow" data-remove-ask>
      <span className="font-semibold">Remove?</span>
      <span className="flex gap-1">
        <button type="button" className="min-h-9 rounded-control bg-ink px-2 py-1 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => { setBusy(true); onRemove(); }} data-remove-yes>
          Yes
        </button>
        <button type="button" className="min-h-9 rounded-control border border-line px-2 py-1 font-bold" onClick={() => setAsk(false)} data-remove-no>
          No
        </button>
      </span>
    </div>
  ) : (
    <button type="button" onClick={() => setAsk(true)} className="absolute right-1 top-1 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white/90 text-sm font-bold shadow hover:bg-white" aria-label={`Remove: ${label}`} data-media-remove>
      ×
    </button>
  );
}

function Thumb({
  slide,
  caption,
  aspect = "aspect-[4/3]",
  small = false,
  onRemove,
}: {
  slide: Slide | null;
  caption: string;
  aspect?: string;
  small?: boolean;
  /** Set when this person may take the photo off. */
  onRemove?: () => void;
}) {
  return (
    <figure className="relative flex flex-col gap-1 min-w-0">
      {onRemove ? <RemoveX onRemove={onRemove} label={caption} /> : null}
      {slide ? (
        <ViewerThumb src={slide.url} thumb={slide.thumb} label={slide.label} detail={caption} viewerKey={slide.key} className={`block w-full ${aspect} rounded-card overflow-hidden bg-chip focus-visible:ring-2 focus-visible:ring-ink/40`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.thumb ?? slide.url} alt={caption} className="h-full w-full object-cover" loading="lazy" />
        </ViewerThumb>
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
 * photos with the damage note. Photos open full size on tap. With canRemove, an X takes a photo or video off (marked, never deleted).
 */
export function MediaGallery({
  media,
  urls,
  thumbs = {},
  carPictureUrl,
  damageNote,
  compact = false,
  stacked = false,
  hideVideos = false,
  canRemove = false,
  damageElsewhere = false,
}: {
  media: GateInMediaRow[];
  urls: Record<string, string>;
  /** Small pictures for the page (the viewer opens the sharp `urls`); missing ones fall back to the sharp address. */
  thumbs?: Record<string, string>;
  carPictureUrl?: string | null;
  damageNote?: string | null;
  compact?: boolean;
  /** Phone-first: videos large, one under the other. */
  stacked?: boolean;
  /** The customer page shows the videos through its own player (fresh addresses, "getting ready" slots). */
  hideVideos?: boolean;
  /** Anyone doing the gate-in while it is open; only the owner once it is finished. */
  canRemove?: boolean;
  /** The page shows the damage photos and note in its own "Damage already on the car" section (DamageSection). */
  damageElsewhere?: boolean;
}) {
  const router = useRouter();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const remove = async (id: string) => {
    setRemoveError(null);
    try {
      const res = await fetch("/api/gate-in-media/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not remove it.");
      router.refresh();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Could not remove it.");
    }
  };
  const removeFor = (id: string) => (canRemove ? () => remove(id) : undefined);
  if (media.length === 0 && !carPictureUrl) return hideVideos ? null : <p className="text-sm text-muted">Nothing uploaded yet.</p>;

  const videos = hideVideos ? [] : media.filter((m) => m.kind === "video_exterior" || m.kind === "video_interior" || m.kind === "video");
  const dashboard = media.filter((m) => m.kind === "dashboard_photo");
  const keys = media.filter((m) => m.kind === "keys_photo_front" || m.kind === "keys_photo_back" || m.kind === "keys_photo");
  // Newest photo of each wheel, in the order they were taken.
  const wheels = WHEEL_KINDS.map((kind) => media.filter((m) => m.kind === kind).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]).filter((m): m is GateInMediaRow => !!m);
  const damage = damageElsewhere ? [] : media.filter((m) => m.kind === "damage_photo");
  const other = media.filter((m) => m.kind === "gate_out_photo");
  const cols = compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  // Every picture and video opens THE page-wide viewer (PhotoViewer): swiping runs through the whole page in order.
  let count = 0;
  function add(key: string, url: string | undefined, label: string, detail?: string, kind: "image" | "video" = "image", thumb?: string): Slide | null {
    if (!url) return null;
    count++;
    return { key, url, thumb: thumb ?? null, label, detail, kind };
  }
  const carSlide = carPictureUrl ? add("car", carPictureUrl, "Car picture") : null;
  const rowSlide = (p: GateInMediaRow) => add(p.id, urls[p.storage_path], KIND_LABEL[p.kind], captionFor(p, compact), "image", thumbs[p.storage_path]);
  const dashboardSlides = dashboard.map(rowSlide);
  const keysSlides = keys.map(rowSlide);
  const wheelSlides = wheels.map(rowSlide);
  const damageSlides = damage.map(rowSlide);
  const otherSlides = other.map(rowSlide);
  const hasPhotos = count > 0 || videos.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {hasPhotos ? (
        <p className="text-xs text-muted -mb-3">
          <span className="[@media(hover:hover)]:hidden">Tap any photo to enlarge</span>
          <span className="hidden [@media(hover:hover)]:inline">Click any photo to enlarge</span>
        </p>
      ) : null}
      {removeError ? <p className="text-sm font-semibold text-red" data-remove-error>{removeError}</p> : null}

      {carPictureUrl ? (
        <div className={compact ? "w-full" : "w-full max-w-md"}>
          <Thumb slide={carSlide} caption="Car picture" aspect="aspect-[16/10]" />
        </div>
      ) : null}

      {videos.length ? (
        <div className={`grid gap-4 ${compact || stacked ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
          {videos.map((v) => {
            const url = urls[v.storage_path];
            return (
              <figure key={v.id} className="relative flex flex-col gap-1">
                {canRemove ? <RemoveX onRemove={() => remove(v.id)} label={KIND_LABEL[v.kind]} /> : null}
                {url ? (
                  <ViewerThumb src={url} kind="video" label={KIND_LABEL[v.kind]} detail={captionFor(v, compact)} viewerKey={v.id} className="relative block w-full overflow-hidden rounded-card">
                    <VideoPreview url={url} />
                    <span className="absolute inset-0 flex items-center justify-center text-white text-3xl drop-shadow">▶</span>
                  </ViewerThumb>
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
            <Thumb key={p.id} slide={dashboardSlides[i]} caption={captionFor(p, compact)} onRemove={removeFor(p.id)} />
          ))}
          {keys.length ? (
            <div className="col-span-2 grid grid-cols-2 gap-3 rounded-card border border-line p-2">
              {keys.map((p, i) => (
                <Thumb key={p.id} slide={keysSlides[i]} caption={captionFor(p, compact)} onRemove={removeFor(p.id)} />
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
               
                onRemove={removeFor(p.id)}
                aspect="aspect-square"
                small
              />
            ))}
          </div>
        </div>
      ) : null}

      {damage.length || (damageNote && !damageElsewhere) ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em]">Damage photos · {damage.length}</span>
          {damage.length ? (
            <div className={`grid gap-3 ${cols}`}>
              {damage.map((p, i) => (
                <Thumb key={p.id} slide={damageSlides[i]} caption={captionFor(p, compact)} onRemove={removeFor(p.id)} />
              ))}
            </div>
          ) : null}
          {damageNote ? <p className="text-sm whitespace-pre-wrap rounded-card bg-chip px-3 py-2">{damageNote}</p> : null}
        </div>
      ) : null}

      {other.length ? (
        <div className={`grid gap-3 ${cols}`}>
          {other.map((p, i) => (
            <Thumb key={p.id} slide={otherSlides[i]} caption={captionFor(p, compact)} onRemove={removeFor(p.id)} />
          ))}
        </div>
      ) : null}

    </div>
  );
}
