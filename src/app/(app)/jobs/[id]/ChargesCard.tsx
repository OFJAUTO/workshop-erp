import { Badge, Button, Card, SectionLabel } from "@/components/ui";
import { ChargeLinesEditor } from "@/components/ChargeLinesEditor";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { chargeNet, chargeTotals, type ChargeLineRow } from "@/lib/charge-rules";

type Action = (formData: FormData) => void | Promise<void>;
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusOf(l: ChargeLineRow, approved: boolean): { text: string; tone: "amber" | "green" | "outline" | "ink" | "red" } {
  if (l.invoice_id) return { text: "On the invoice (locked)", tone: "green" };
  if (l.free_status === "pending_owner") return { text: "Free: waiting for the owner", tone: "amber" };
  if (l.free_status === "refused") return { text: "Free refused by the owner", tone: "red" };
  if (l.quotation_line_id) return { text: "In the quotation", tone: "ink" };
  if (l.agreed_at) return { text: "Agreed on the check-in", tone: "green" };
  return approved ? { text: "Waiting for the revised quotation", tone: "amber" } : { text: "Listed on the vehicle check-in", tone: "outline" };
}

/**
 * EARLY CHARGES on the job card (1 November 2026, B2): recovery, fuel and other costs, each with its cost (what we
 * pay, the supplier's bill attached) and its charge (what the customer pays, or free). The figures so far count in
 * the job's profit; before the approval they appear on the vehicle check-in, after it in the quotation.
 */
export function ChargesCard({ lines, canAdd, approved, onAdd, onDecide, isOwner, jobId, files, recoveryTypes, providers }: { lines: ChargeLineRow[]; canAdd: boolean; approved: boolean; onAdd: Action; onDecide: (lineId: string) => Action; isOwner: boolean; jobId: string; files: Record<string, JobFile[]>; recoveryTypes: { key: string; label: string; cost: number; price: number }[]; providers: string[] }) {
  const t = chargeTotals(lines);
  return (
    <Card id="charges" className="flex flex-col gap-3" data-charges-card>
      <SectionLabel right={lines.length ? `cost AED ${money(t.cost)} · charged AED ${money(t.net)} + VAT` : undefined}>Charges (recovery, fuel, other)</SectionLabel>
      {lines.length ? (
        <ul className="divide-y divide-line" data-charge-lines>
          {lines.map((l) => {
            const s = statusOf(l, approved);
            return (
              <li key={l.id} className="flex flex-col gap-1.5 py-2" data-charge-line={l.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold uppercase">{l.description}</span>
                  {l.provider ? <span className="text-sm text-muted">{l.provider}</span> : null}
                  <Badge tone={s.tone}>{s.text}</Badge>
                  <span className="ml-auto text-sm"><span className="text-muted">cost</span> <b>AED {money(l.cost_aed)}</b> · <span className="text-muted">charge</span> <b data-charge-amount>{l.free ? "Free" : `AED ${money(chargeNet(l))} + VAT`}</b></span>
                </div>
                {!l.free && l.cost_aed > l.charge_aed + 0.005 ? <span className="text-xs font-bold text-red">Costs more than it is charged: the owner is told.</span> : null}
                {isOwner && l.free_status === "pending_owner" ? (
                  <form action={onDecide(l.id)} className="flex flex-wrap gap-2">
                    <Button type="submit" name="decision" value="approve" size="md" data-free-approve>Approve free</Button>
                    <Button type="submit" name="decision" value="refuse" size="md" tone="secondary">Refuse</Button>
                  </form>
                ) : null}
                {canAdd && !l.invoice_id ? <JobFileUpload jobId={jobId} kind="supplier_invoice" refId={l.id} files={files[l.id] ?? []} accept="any" label="Supplier's bill or fuel receipt" caption={`Bill · ${l.description}`} compact removable /> : (files[l.id] ?? []).length ? <span className="text-xs text-muted">{(files[l.id] ?? []).length} bill file{(files[l.id] ?? []).length === 1 ? "" : "s"}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted">No recovery, fuel or other charges on this car.</p>}
      {lines.length ? <p className="text-xs text-muted" data-charges-profit>Profit on these so far AED {money(t.profit)} (counts in the job&apos;s profit).</p> : null}
      {canAdd ? (
        <details className="group" data-charge-add>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-control border border-ink px-4 text-sm font-bold [&::-webkit-details-marker]:hidden" data-charge-open>+ Add a charge</summary>
          <form action={onAdd} className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-muted">{approved ? "The check-in is approved: the charge goes into the quotation for the customer's approval." : "Before the approval: the charge is listed on the vehicle check-in with VAT, and the customer agrees to pay it even if no further work is approved."}</p>
            <ChargeLinesEditor recoveryTypes={recoveryTypes} providers={providers} />
            <div><Button type="submit" size="lg" data-charge-save>Save the charges</Button></div>
          </form>
        </details>
      ) : null}
    </Card>
  );
}
