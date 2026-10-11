"use client";

import { useState } from "react";
import { Lightbox } from "./Lightbox";

export type CustomerMediaItem = { id: string; kind: "photo" | "video" | "pdf"; url: string | null; label?: string | null };

/**
 * Photos and videos on a customer's page: photos open in a full-size viewer with swipe and an X
 * (never a new tab); videos play where they are, muted until the customer turns the sound on.
 */
export function CustomerMedia({ items, size = "md" }: { items: CustomerMediaItem[]; size?: "sm" | "md" }) {
  const [open, setOpen] = useState<number | null>(null);
  const photos = items.filter((i) => i.kind === "photo" && i.url);
  const slides = photos.map((p) => ({ key: p.id, url: p.url as string, label: p.label ?? "Photo" }));
  const box = size === "sm" ? "h-24 w-24" : "h-32 w-32";
  const video = size === "sm" ? "h-24 w-36" : "h-32 w-48";
  if (!items.some((i) => i.url)) return null;
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {items.map((i) =>
        !i.url ? null : i.kind === "video" ? (
          <video key={i.id} src={i.url} muted playsInline controls preload="metadata" className={`${video} rounded-lg bg-black object-cover`} />
        ) : i.kind === "pdf" ? (
          <a key={i.id} href={i.url} className="inline-flex min-h-11 items-center rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-3 text-sm font-semibold">
            PDF · {i.label ?? "document"}
          </a>
        ) : (
          <button key={i.id} type="button" onClick={() => setOpen(photos.findIndex((p) => p.id === i.id))} className={`${box} overflow-hidden rounded-lg bg-[#F4F4F5] cursor-zoom-in`} aria-label={`Enlarge: ${i.label ?? "photo"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.url} alt={i.label ?? "Photo"} className="h-full w-full object-cover" loading="lazy" />
          </button>
        ),
      )}
      {open !== null && slides[open] ? <Lightbox slides={slides} index={open} onClose={() => setOpen(null)} onMove={setOpen} /> : null}
    </div>
  );
}
