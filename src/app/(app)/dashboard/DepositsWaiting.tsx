import { Card, LinkButton, SectionLabel } from "@/components/ui";
import { depositsWaiting } from "@/lib/deposits";

/** The owner's dashboard: deposits asked for on approved quotations that have not arrived. Nothing is shown when there are none. */
export async function DepositsWaiting() {
  const rows = await depositsWaiting();
  if (!rows.length) return null;
  return (
    <Card className="flex flex-col gap-3 border-amber-bar" data-deposits-waiting>
      <SectionLabel right={`${rows.length}`}>Deposits not received</SectionLabel>
      <ul className="flex flex-col divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.quotationId} className="py-2 flex flex-wrap items-center gap-3" data-deposit-waiting={r.jobId}>
            <span className="font-bold">{r.plate}</span>
            <span className="text-muted">{r.customer}</span>
            <span>{r.quotation}</span>
            <span className={`font-semibold ${r.hours >= 24 ? "text-red" : ""}`}>AED {r.required.toLocaleString("en-GB")} asked{r.received ? `, AED ${r.received.toLocaleString("en-GB")} received` : ""}</span>
            <span className="text-xs text-muted">{r.hours >= 24 ? `waiting ${Math.floor(r.hours / 24)} day${Math.floor(r.hours / 24) === 1 ? "" : "s"}` : `waiting ${r.hours} h`}</span>
            <span className="ml-auto">
              <LinkButton href={`/jobs/${r.jobId}/invoice`} tone="secondary" size="md">Money page</LinkButton>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
