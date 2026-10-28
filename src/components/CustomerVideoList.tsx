"use client";

import { useCallback } from "react";
import { VideoPlayer } from "./CustomerVideos";

export type LabelledVideo = { id: string; label: string; url: string; poster: string | null; duration_s: number | null };

/**
 * Videos on a customer link, each under its label ("Engine mounts – Bad"), with the ONE customer player: a picture
 * with a Play button, plays inside the page, muted with the controls to unmute, a fresh address when the page has
 * been open a while. Every video has its own anchor (#v-<id>) for the "Watch video" link in the PDF.
 */
export function CustomerVideoList({ videos, signedAt, refreshUrl }: { videos: LabelledVideo[]; signedAt: number; /** Returns { videos: [{ id, url }] } with fresh addresses. */ refreshUrl: string }) {
  const freshen = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(refreshUrl, { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as { videos?: { id: string; url: string | null }[] };
        return data.videos?.find((v) => v.id === id)?.url ?? null;
      } catch {
        return null;
      }
    },
    [refreshUrl],
  );
  if (!videos.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4" data-customer-video-list>
      {videos.map((v) => (
        <figure key={v.id} id={`v-${v.id}`} className="flex flex-col gap-1 scroll-mt-4 target:outline target:outline-2 target:outline-ink target:rounded-card" data-report-video={v.id}>
          <VideoPlayer video={{ id: v.id, url: v.url }} label={v.label} signedAt={signedAt} freshen={() => freshen(v.id)} poster={v.poster} />
          <figcaption className="text-sm font-semibold">
            {v.label}
            {v.duration_s ? <span className="text-xs text-[#5F6368] font-normal"> · {v.duration_s}s</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
