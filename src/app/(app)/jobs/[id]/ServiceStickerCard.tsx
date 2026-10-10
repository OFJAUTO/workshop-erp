import { Badge, Button, Card, Input, SectionLabel } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ServiceStickerData } from "@/lib/stickers";
import { saveServiceSticker } from "../sticker-actions";

/**
 * The oil service sticker on the job card: "not printed yet" until it is. The dates and mileages
 * come filled in from the rules and can be corrected before printing. One button prints.
 */
export function ServiceStickerCard({ jobId, data, canPrint, printedBy }: { jobId: string; data: ServiceStickerData; canPrint: boolean; printedBy: string | null }) {
  const unit = data.mileage_unit === "miles" ? "miles" : "km";
  return (
    <Card id="service-sticker" className={`flex flex-col gap-3 ${data.printed_at ? "border-green" : "border-amber-bar"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Oil service sticker</SectionLabel>
        {data.printed_at ? <Badge tone="green">Printed {formatDateTime(data.printed_at)}{printedBy ? ` by ${printedBy}` : ""}</Badge> : <Badge tone="amber">Not printed yet</Badge>}
      </div>
      {canPrint ? (
        <form action={saveServiceSticker.bind(null, jobId)} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Serviced on<Input name="serviced_on" type="date" defaultValue={data.serviced_on} required /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Mileage ({unit})<Input name="mileage" inputMode="numeric" defaultValue={data.mileage === null ? "" : String(data.mileage)} /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Next service date<Input name="next_date" type="date" defaultValue={data.next_date} required /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Next service mileage ({unit})<Input name="next_mileage" inputMode="numeric" defaultValue={data.next_mileage === null ? "" : String(data.next_mileage)} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="print" value="1" size="md">{data.printed_at ? "Print again" : "Print the sticker"}</Button>
            <Button type="submit" tone="secondary" size="md">Save the details</Button>
          </div>
          <p className="text-xs text-muted">Next service, whichever comes first: {formatDate(data.next_date)}{data.next_mileage ? ` or ${data.next_mileage.toLocaleString("en-GB")} ${unit}` : ""}. Saved on the car&apos;s record. QC checks the sticker is fitted.</p>
        </form>
      ) : (
        <p className="text-sm">Serviced {formatDate(data.serviced_on)}{data.mileage ? ` at ${data.mileage.toLocaleString("en-GB")} ${unit}` : ""} · next {formatDate(data.next_date)}{data.next_mileage ? ` or ${data.next_mileage.toLocaleString("en-GB")} ${unit}` : ""}. {data.printed_at ? "" : "Gate-in, Parts, the advisor or the owner prints it from this card."}</p>
      )}
    </Card>
  );
}
