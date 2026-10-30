import { ViewerThumb } from "./PhotoViewer";
import { Card, SectionLabel } from "./ui";
import type { VisitMileage } from "@/lib/visit-mileage";

/**
 * The job card's mileage (30 October 2026, batch 2 section 2): "Mileage in 48,210 km · out 48,226 km · driven 16 km",
 * and the two dashboard photos (gate-in and gate-out), which open in THE photo viewer. Internal only.
 */
export function MileagePanel({ m }: { m: VisitMileage }) {
  const photos = [m.inPhoto, m.outPhoto].filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <Card id="mileage" className="flex flex-col gap-2" data-mileage-panel>
      <SectionLabel>Mileage</SectionLabel>
      <p className="text-sm font-bold" data-mileage-line>{m.line}</p>
      {m.note ? <p className="text-sm font-semibold text-amber" data-mileage-not-read>Final km not read: {m.note}</p> : null}
      {photos.length ? (
        <div className="grid max-w-md grid-cols-2 gap-2" data-mileage-photos={photos.length}>
          {photos.map((p) => (
            <ViewerThumb key={p.id} src={p.url} thumb={p.thumb} label={p.label} viewerKey={`mileage-${p.id}`} className="flex flex-col gap-1 text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb ?? p.url} alt={p.label} className="aspect-[4/3] w-full rounded-control bg-chip object-cover" />
              <span className="text-xs font-semibold text-muted">{p.label}</span>
            </ViewerThumb>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
