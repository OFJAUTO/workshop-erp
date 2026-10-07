import type { JobMediaSummary } from "@/lib/job-media-strip";

/** Car picture plus a row of photo thumbnails for a job row on the dashboard. */
export function JobMediaStrip({ summary, max = 6 }: { summary: JobMediaSummary | undefined; max?: number }) {
  if (!summary) return null;
  const shown = summary.thumbs.slice(0, max);
  const extra = summary.thumbs.length - shown.length;
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <div className="h-16 w-24 shrink-0 rounded-control bg-chip overflow-hidden">
        {summary.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={summary.pictureUrl} alt="Car" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-[10px] font-semibold text-faint">No picture</div>
        )}
      </div>
      {shown.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.id} src={t.url} alt={t.label} title={t.label} className="h-16 w-16 shrink-0 rounded-control object-cover bg-chip" />
      ))}
      {extra > 0 ? <span className="text-xs font-semibold text-muted shrink-0">+{extra}</span> : null}
      {summary.videoCount ? (
        <span className="text-xs font-semibold text-muted shrink-0">
          ▶ {summary.videoCount} video{summary.videoCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
