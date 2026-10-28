"use client";

import { ViewerThumb } from "./PhotoViewer";

export type CustomerMediaItem = { id: string; kind: "photo" | "video" | "pdf"; url: string | null; /** The small picture for the page; the viewer opens `url`. */ thumbUrl?: string | null; label?: string | null; poster?: string | null };

/**
 * Photos and videos on a customer's page: small pictures that open THE page-wide viewer (PhotoViewer) - full screen,
 * pinch or double-tap to zoom the photo, swipe through every photo of the page, videos play in it muted.
 */
export function CustomerMedia({ items, size = "md", label }: { items: CustomerMediaItem[]; size?: "sm" | "md"; /** The item's name the viewer shows ("FRONT BRAKE PADS – 3 MM"). */ label?: string }) {
  const box = size === "sm" ? "h-24 w-24" : "h-32 w-32";
  const video = size === "sm" ? "h-24 w-36" : "h-32 w-48";
  if (!items.some((i) => i.url)) return null;
  return (
    <div className="flex flex-wrap gap-2 py-1" data-customer-media>
      {items.map((i) =>
        !i.url ? null : i.kind === "video" ? (
          <ViewerThumb key={i.id} src={i.url} kind="video" label={label ?? i.label ?? "Video"} detail={label && i.label ? i.label : null} poster={i.poster ?? null} viewerKey={i.id} className={`${video} relative overflow-hidden rounded-lg bg-black`}>
            {i.poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <video src={`${i.url}#t=0.5`} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center text-2xl text-white drop-shadow">▶</span>
          </ViewerThumb>
        ) : i.kind === "pdf" ? (
          <a key={i.id} href={i.url} className="inline-flex min-h-11 items-center rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-3 text-sm font-semibold">
            PDF · {i.label ?? "document"}
          </a>
        ) : (
          <ViewerThumb key={i.id} src={i.url} thumb={i.thumbUrl ?? null} label={label ?? i.label ?? "Photo"} detail={label && i.label ? i.label : null} viewerKey={i.id} className={`${box} overflow-hidden rounded-lg bg-[#F4F4F5]`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.thumbUrl ?? i.url} alt={i.label ?? "Photo"} className="h-full w-full object-cover" loading="lazy" />
          </ViewerThumb>
        ),
      )}
    </div>
  );
}
