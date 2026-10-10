import { Badge, Card, LinkButton, SectionLabel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { collectionLine, type JobItemRow } from "@/lib/loose-items";

/** The items of a loose-item job: what came in, the tag codes, and which ones have gone home. */
export function ItemsCard({ jobId, items, broughtBy, assessmentNote, photoUrls, canPrint }: { jobId: string; items: JobItemRow[]; broughtBy: string | null; assessmentNote: string | null; photoUrls: Map<string, string>; canPrint: boolean }) {
  const line = collectionLine(items);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel right={`${items.length}`}>Items received</SectionLabel>
        {line ? <Badge tone={line.startsWith("All") ? "green" : "amber"}>{line}</Badge> : null}
      </div>
      <ul className="divide-y divide-line">
        {items.map((it) => {
          const photo = photoUrls.get(it.id);
          return (
            <li key={it.id} className="py-2.5 flex flex-wrap items-center gap-3">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={photo} target="_blank" rel="noreferrer"><img src={photo} alt="" className="h-14 w-14 rounded-control object-cover bg-chip" /></a>
              ) : (
                <span className="h-14 w-14 rounded-control bg-chip flex items-center justify-center text-xs font-bold text-muted">{it.position}</span>
              )}
              <span className="flex flex-col min-w-0 flex-1">
                <span className="font-bold">{it.quantity > 1 ? `${it.quantity} × ` : ""}{it.item_type}{it.description ? ` · ${it.description}` : ""}</span>
                <span className="text-xs text-muted">{it.qr_code ? `Tag ${it.qr_code}` : "No tag"}{it.notes ? ` · ${it.notes}` : ""}</span>
              </span>
              {it.collected_at ? <Badge tone="green">Collected {formatDateTime(it.collected_at)}{it.collector_name ? ` by ${it.collector_name}` : ""}</Badge> : <Badge tone="outline">With us</Badge>}
            </li>
          );
        })}
      </ul>
      {broughtBy ? <p className="text-sm"><span className="text-muted">Brought by</span> <span className="font-semibold">{broughtBy}</span></p> : null}
      {assessmentNote ? <p className="text-sm whitespace-pre-wrap"><span className="text-muted">At the counter:</span> {assessmentNote}</p> : null}
      {canPrint ? <div><LinkButton href={`/print/item-tags/${jobId}`} tone="secondary" size="md">Print the tags</LinkButton></div> : null}
    </Card>
  );
}
