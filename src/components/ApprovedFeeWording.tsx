import { formatDateTime } from "@/lib/format";
import type { ApprovedFee } from "@/lib/inspection-fee-server";

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What the customer agreed to about the inspection fee (30 October 2026, batch 2 section 4.1): the exact words on the
 * approval page they approved, with the date, so it can always be proved. A wording without VAT (before 30 October) is
 * flagged: it is charged as that amount INCLUDING VAT.
 */
export function ApprovedFeeWording({ f }: { f: ApprovedFee }) {
  return (
    <div className="flex flex-col gap-1 rounded-control border border-line bg-canvas p-2 text-xs" data-approved-wording={f.oldWording ? "old" : f.noFee ? "no_fee" : "new"}>
      <span className="font-bold">The customer approved on {formatDateTime(f.at)}{f.by ? ` (${f.by})` : ""}:</span>
      <span data-approved-wording-text>{f.noFee ? "No inspection fee." : f.text ? `“${f.text}”` : `An inspection fee of AED ${money(f.amount)} (the words of the time were not saved on the link).`}</span>
      {f.oldWording ? <span className="font-bold text-amber" data-old-wording>Approved with the old wording – AED {money(f.amount)} total, VAT included</span> : null}
    </div>
  );
}
