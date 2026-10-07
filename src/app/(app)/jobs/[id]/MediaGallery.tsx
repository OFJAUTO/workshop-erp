import { formatDateTime } from "@/lib/format";
import type { GateInMediaRow } from "@/lib/types";

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
};

function Photo({ p, url, compact }: { p: GateInMediaRow; url: string | undefined; compact: boolean }) {
  return (
    <figure className="flex flex-col gap-1">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={KIND_LABEL[p.kind]} className="aspect-[4/3] w-full rounded-card object-cover bg-chip" />
        </a>
      ) : (
        <div className="aspect-[4/3] rounded-card bg-chip" />
      )}
      <figcaption className="text-xs text-muted">
        {KIND_LABEL[p.kind]}
        {p.caption ? ` · ${p.caption}` : ""}
        {compact ? "" : ` · ${formatDateTime(p.taken_at)}`}
      </figcaption>
    </figure>
  );
}

/**
 * Everything recorded for a job: car picture, both videos labelled, the dashboard
 * photo, the two keys photos side by side, then damage photos. Nothing can be removed.
 */
export function MediaGallery({
  media,
  urls,
  carPictureUrl,
  compact = false,
}: {
  media: GateInMediaRow[];
  urls: Record<string, string>;
  carPictureUrl?: string | null;
  compact?: boolean;
}) {
  if (media.length === 0 && !carPictureUrl) return <p className="text-sm text-muted">Nothing uploaded yet.</p>;
  const videos = media.filter((m) => m.kind === "video_exterior" || m.kind === "video_interior" || m.kind === "video");
  const dashboard = media.filter((m) => m.kind === "dashboard_photo");
  const keys = media.filter((m) => m.kind === "keys_photo_front" || m.kind === "keys_photo_back" || m.kind === "keys_photo");
  const damage = media.filter((m) => m.kind === "damage_photo");
  const other = media.filter((m) => m.kind === "gate_out_photo");
  const cols = compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  return (
    <div className="flex flex-col gap-5">
      {carPictureUrl ? (
        <figure className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={carPictureUrl} alt="Car picture" className={`rounded-card object-cover bg-chip aspect-[16/10] ${compact ? "w-full" : "w-full max-w-md"}`} />
          <figcaption className="text-xs text-muted">Car picture</figcaption>
        </figure>
      ) : null}

      {videos.length ? (
        <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
          {videos.map((v) => {
            const url = urls[v.storage_path];
            return (
              <figure key={v.id} className="flex flex-col gap-1">
                {url ? <video src={url} controls playsInline preload="metadata" className="w-full rounded-card bg-black aspect-video" /> : <div className="aspect-video rounded-card bg-chip" />}
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
          {dashboard.map((p) => (
            <Photo key={p.id} p={p} url={urls[p.storage_path]} compact={compact} />
          ))}
          {keys.length ? (
            <div className={`${compact ? "col-span-2" : "col-span-2"} grid grid-cols-2 gap-3 rounded-card border border-line p-2`}>
              {keys.map((p) => (
                <Photo key={p.id} p={p} url={urls[p.storage_path]} compact={compact} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {damage.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em]">Damage photos · {damage.length}</span>
          <div className={`grid gap-3 ${cols}`}>
            {damage.map((p) => (
              <Photo key={p.id} p={p} url={urls[p.storage_path]} compact={compact} />
            ))}
          </div>
        </div>
      ) : null}

      {other.length ? (
        <div className={`grid gap-3 ${cols}`}>
          {other.map((p) => (
            <Photo key={p.id} p={p} url={urls[p.storage_path]} compact={compact} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
