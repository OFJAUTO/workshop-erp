import { formatDateTime } from "@/lib/format";
import type { GateInMediaRow } from "@/lib/types";

const KIND_LABEL: Record<GateInMediaRow["kind"], string> = {
  video: "Walk-around video",
  dashboard_photo: "Dashboard",
  keys_photo: "Keys",
  damage_photo: "Damage",
  gate_out_photo: "Gate-out",
};

/** Video first, then photos. Files can be opened full size but never removed. */
export function MediaGallery({ media, urls, compact = false }: { media: GateInMediaRow[]; urls: Record<string, string>; compact?: boolean }) {
  if (media.length === 0) return <p className="text-sm text-muted">Nothing uploaded yet.</p>;
  const videos = media.filter((m) => m.kind === "video");
  const photos = media.filter((m) => m.kind !== "video");
  return (
    <div className="flex flex-col gap-4">
      {videos.map((v) => {
        const url = urls[v.storage_path];
        return (
          <figure key={v.id} className="flex flex-col gap-1">
            {url ? <video src={url} controls playsInline preload="metadata" className="w-full rounded-card bg-black aspect-video" /> : null}
            <figcaption className="text-xs text-muted">
              {KIND_LABEL.video}
              {v.duration_s ? ` · ${v.duration_s}s` : ""} · {formatDateTime(v.taken_at)}
            </figcaption>
          </figure>
        );
      })}
      {photos.length ? (
        <div className={`grid gap-3 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"}`}>
          {photos.map((p) => {
            const url = urls[p.storage_path];
            return (
              <figure key={p.id} className="flex flex-col gap-1">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={KIND_LABEL[p.kind]} className="aspect-square w-full rounded-card object-cover bg-chip" />
                  </a>
                ) : (
                  <div className="aspect-square rounded-card bg-chip" />
                )}
                <figcaption className="text-xs text-muted">
                  {KIND_LABEL[p.kind]}
                  {p.caption ? ` · ${p.caption}` : ""}
                  {compact ? "" : ` · ${formatDateTime(p.taken_at)}`}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
