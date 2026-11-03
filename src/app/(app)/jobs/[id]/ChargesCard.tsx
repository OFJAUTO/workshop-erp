import Link from "next/link";
import { Badge, Button, Card, Notice, SectionLabel } from "@/components/ui";
import { ChargeLinesEditor } from "@/components/ChargeLinesEditor";
import type { FormAction } from "@/components/forms";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { belowCostWords, chargeAmountWords, chargedTotal, notBilledWords, readOnlyWords, recoveryAlready, recoveryCostWords, recoveryWords, type ChargeCosts, type ChargeItem } from "@/lib/charge-items";
import type { ChargeLineRow } from "@/lib/charge-rules";
import { QuoteChargeCostForm } from "./QuoteChargeCostForm";

type Action = (formData: FormData) => void | Promise<void>;
type Tone = "amber" | "green" | "outline" | "ink" | "red";
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A job-card charge's state; when it went into a quotation, the quotation's own words ("on Q-00039 · approved"). */
function statusOf(l: ChargeLineRow, approved: boolean, where: ChargeItem["where"], whereWords: string | null): { text: string; tone: Tone } {
  if (l.invoice_id) return { text: "On the invoice (locked)", tone: "green" };
  if (l.free_status === "pending_owner") return { text: "Free: waiting for the owner", tone: "amber" };
  if (l.free_status === "refused") return { text: "Free refused by the owner", tone: "red" };
  if (whereWords) return { text: whereWords, tone: where ? quoteTone(where.status) : "red" };
  if (l.quotation_line_id) return { text: "In the quotation", tone: "ink" };
  if (l.agreed_at) return { text: "Agreed on the check-in", tone: "green" };
  return approved ? { text: "Waiting for the revised quotation", tone: "amber" } : { text: "Listed on the vehicle check-in", tone: "outline" };
}

function quoteTone(status: string): Tone {
  if (status === "approved") return "green";
  if (status === "declined" || status === "expired") return "red";
  if (status === "draft") return "outline";
  return "amber";
}

/**
 * THE CHARGES OF THE CAR on the job card (1 November 2026, B2; rebuilt 3 November 2026, section 8 - J-00969): every
 * recovery, fuel and other charge ONCE, wherever it was typed. Job-card charges with their state; charges typed on a
 * quotation read-only with "on Q-00039 · approved" (how they change, with the quotation's number as a link for the
 * people who may open quotations), each with "Cost & bill": the real cost from the supplier's bill and the bill itself.
 * The totals and the profit line come from THE cost rule (charge-items.ts): every charge counts once; a recovery is
 * costed from its own trips (our trucks, or the same company) once the car has them.
 */
export function ChargesCard({ items, costs, costReady, canAdd, canCost, approved, onAdd, onDecide, onSaveCost, isOwner, seesTripPrices, jobId, files, recoveryTypes, providers, quoteHref, mayOpenQuote, message, error }: {
  items: ChargeItem[];
  costs: ChargeCosts;
  /** The database update for typing a quotation charge's cost is in (else the bill only). */
  costReady: boolean;
  canAdd: boolean;
  /** May type a cost and attach a bill (owner, advisors, accounts; not while viewing as someone). */
  canCost: boolean;
  approved: boolean;
  onAdd: Action;
  onDecide: (lineId: string) => Action;
  onSaveCost: (lineId: string) => FormAction;
  isOwner: boolean;
  /** The trips' prices are owner and accounts only (19 October 2026); advisors read "with accounts". */
  seesTripPrices: boolean;
  jobId: string;
  files: Record<string, JobFile[]>;
  recoveryTypes: { key: string; label: string; cost: number; price: number }[];
  providers: string[];
  quoteHref: (quotationId: string) => string;
  /** May open the quotation page (owner and advisors): the quotation's number is a link only for them - for accounts
   *  the quotation page sends them straight back to this job card (review fix, 3 November 2026). */
  mayOpenQuote: boolean;
  message?: string | null;
  error?: string | null;
}) {
  const charged = chargedTotal(items);
  const hideCosts = costs.fromTrips && costs.tripsTotal > 0 && !seesTripPrices;
  const already = recoveryAlready(items).map(recoveryWords);
  // Every part of the recovery cost named: priced trips, the estimate for trips still to price, charges with no trip.
  const tripWords = costs.fromTrips ? (seesTripPrices ? recoveryCostWords(costs) : "Recovery cost from the trips – the prices are with accounts") : null;
  return (
    <Card id="charges" className="flex flex-col gap-3" data-charges-card>
      <SectionLabel right={items.length ? (hideCosts ? `charged AED ${money(charged)} + VAT` : `cost AED ${money(costs.total)} · charged AED ${money(charged)} + VAT`) : undefined}>Charges (recovery, fuel, other)</SectionLabel>
      {items.length ? (
        <ul className="divide-y divide-line" data-charge-lines>
          {items.map((item) => {
            const row = item.row;
            const s = row ? statusOf(row, approved, item.where, item.whereWords) : { text: item.whereWords ?? "", tone: item.where ? quoteTone(item.where.status) : ("outline" as Tone) };
            // Costed from its own trips (our trucks, or the same company) - never from someone else's trip.
            const fromTrips = item.kind === "recovery" && costs.tripKeys.includes(item.key);
            const billFiles = files[item.billRefId] ?? [];
            const notBilled = notBilledWords(item);
            const ro = item.source === "quotation" && item.where ? readOnlyWords(item.where.status) : null;
            return (
              <li key={item.key} className="flex flex-col gap-1.5 py-2" data-charge-line={item.id} data-charge-source={item.source} data-charge-kind-of={item.kind}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-semibold uppercase" data-charge-description>{item.description || "(no name yet)"}</span>
                  {item.provider ? <span className="text-sm text-muted">{item.provider}</span> : null}
                  <Badge tone={s.tone} data-charge-where={item.where ? `${item.where.number}${item.where.version > 1 ? ` v${item.where.version}` : ""}` : ""}>{s.text}</Badge>
                  <span className="ml-auto text-sm" data-charge-figures>
                    <span className="text-muted">cost</span>{" "}
                    <b data-charge-cost>{fromTrips ? "from the trips" : item.source === "quotation" && item.actualCost === null ? `est. AED ${money(item.cost)}` : `AED ${money(item.cost)}${item.source === "quotation" ? " (bill)" : ""}`}</b>
                    {" · "}<span className="text-muted">charge</span> <b data-charge-amount>{row && !item.where && !item.notCharged ? (row.free ? "Free" : `AED ${money(item.charge)} + VAT`) : chargeAmountWords(item)}</b>
                  </span>
                </div>
                {item.source === "quotation" && item.actualCost !== null && item.quotedCost !== null && !fromTrips ? <span className="text-xs text-muted" data-charge-quoted>Quoted estimate AED {money(item.quotedCost)}; the bill&apos;s figure counts.</span> : null}
                {item.source === "quotation" && !item.counted ? <span className="text-xs text-muted" data-charge-not-counted>Counts in the profit once {item.where?.number ?? "the quotation"} is approved.</span> : null}
                {notBilled ? <span className="text-xs text-muted" data-charge-not-billed>{notBilled}</span> : null}
                {!item.free && !item.hidden && !item.notCharged && !fromTrips && item.counted && item.cost > item.charge + 0.005 ? <span className="text-xs font-bold text-red" data-charge-below-cost={item.ownerKnows ?? "none"}>{belowCostWords(item)}</span> : null}
                {isOwner && row?.free_status === "pending_owner" ? (
                  <form action={onDecide(row.id)} className="flex flex-wrap gap-2">
                    <Button type="submit" name="decision" value="approve" size="md" data-free-approve>Approve free</Button>
                    <Button type="submit" name="decision" value="refuse" size="md" tone="secondary">Refuse</Button>
                  </form>
                ) : null}
                {ro && item.where ? (
                  <span className="text-xs text-muted" data-charge-read-only={item.where.status}>
                    {ro.lead}
                    {mayOpenQuote ? <Link href={quoteHref(item.where.id)} className="font-bold text-ink underline underline-offset-4" data-charge-open-quote>{item.where.number}</Link> : <b className="text-ink" data-charge-quote-number>{item.where.number}</b>}
                    {ro.tail}
                  </span>
                ) : null}
                {row ? (
                  canAdd && !row.invoice_id ? <JobFileUpload jobId={jobId} kind="supplier_invoice" refId={row.id} files={billFiles} accept="any" label="Supplier's bill or fuel receipt" caption={`Bill · ${item.description}`} compact removable /> : billFiles.length ? <span className="text-xs text-muted">{billFiles.length} bill file{billFiles.length === 1 ? "" : "s"}</span> : null
                ) : canCost ? (
                  <details className="group" data-charge-cost={item.rootLineId ?? item.id}>
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control border border-line-strong px-4 text-sm font-bold [&::-webkit-details-marker]:hidden" data-charge-cost-open>
                      Cost &amp; bill{item.actualCost !== null ? " ✓" : ""}{billFiles.length ? ` · ${billFiles.length} bill${billFiles.length === 1 ? "" : "s"}` : ""}
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                      {fromTrips ? (
                        <p className="text-xs text-muted" data-charge-cost-trips>This recovery is costed from its own trips on the Recovery page ({item.who === "ours" ? "our drivers' prices" : item.provider ? `${item.provider}'s prices` : "the drivers' and companies' prices"}). Attach the bill for the paper only.</p>
                      ) : costReady ? (
                        <QuoteChargeCostForm action={onSaveCost(item.rootLineId ?? item.id)} cost={item.actualCost} provider={item.provider} trn={item.supplierTrn} quoted={item.quotedCost} />
                      ) : (
                        <p className="text-xs text-muted" data-charge-cost-waiting>Typing the real cost opens once the database update is applied. The bill can be attached now.</p>
                      )}
                      <JobFileUpload jobId={jobId} kind="supplier_invoice" refId={item.billRefId} files={billFiles} accept="any" label="Supplier's bill" caption={`Bill · ${item.description}`} compact removable />
                    </div>
                  </details>
                ) : billFiles.length ? <span className="text-xs text-muted">{billFiles.length} bill file{billFiles.length === 1 ? "" : "s"}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted" data-charges-empty>No recovery, fuel or other charges on this car.</p>}
      {tripWords ? <p className="text-xs text-muted" data-charges-trips>{tripWords}{costs.provisional.length ? ` · ${costs.provisional.join(" · ")}` : ""}.</p> : null}
      {items.length && !hideCosts ? <p className="text-xs text-muted" data-charges-profit>Profit on these so far AED {money(charged - costs.total)} (each charge counts once in the job&apos;s profit; estimates until the bill or the driver&apos;s price).</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {canAdd ? (
        <details className="group" data-charge-add open={!!error || undefined}>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-control border border-ink px-4 text-sm font-bold [&::-webkit-details-marker]:hidden" data-charge-open>+ Add a charge</summary>
          <form action={onAdd} className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-muted">{approved ? "The check-in is approved: the charge goes into the quotation for the customer's approval." : "Before the approval: the charge is listed on the vehicle check-in with VAT, and the customer agrees to pay it even if no further work is approved."}</p>
            <ChargeLinesEditor recoveryTypes={recoveryTypes} providers={providers} recoveryAlready={already} />
            <div><Button type="submit" size="lg" data-charge-save>Save the charges</Button></div>
          </form>
        </details>
      ) : null}
    </Card>
  );
}
