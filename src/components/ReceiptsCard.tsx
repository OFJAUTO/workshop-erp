import "server-only";
import { loadReceipts } from "@/lib/receipts";
import { mayCorrectNumber, mayReplaceFile, mayTypeMissingNumber } from "@/lib/receipt-rules";
import { receiptFileAction, receiptNumberAction, receiptRetakeAction } from "@/app/(app)/parts/receipt-actions";
import { formatDateTime } from "@/lib/format";
import { ReceiptActions } from "./ReceiptActions";
import { Card, SectionLabel } from "./ui";
import { Words } from "./Words";

/**
 * Every receipt of an LPO (13 November 2026): when, who, what arrived, the supplier's invoice number (or the red/amber
 * "INVOICE DUE BY" tag), the delivery paper and invoice files with their history, and the buttons each role may use.
 * On the LPO page and on the Supplier invoices card.
 */
export async function ReceiptsCard({ poIds, role, viewingAs, bare = false }: { poIds: string[]; role: string; viewingAs: boolean; /** Inside another card (Supplier invoices): no card of its own. */ bare?: boolean }) {
  const receipts = await loadReceipts(poIds).catch(() => []);
  if (!receipts.length) return null;
  const body = (
    <ul className="flex flex-col gap-3" data-receipts>
      {receipts.map((r) => {
        const kinds = (["paper", "invoice"] as const).filter((k) => !viewingAs && mayReplaceFile(role, k, r.invoiceChecked));
        const current = r.files.filter((f) => !f.replacedAt);
        const old = r.files.filter((f) => f.replacedAt);
        return (
          <li key={r.id} className={`rounded-md border p-3 flex flex-col gap-2 ${r.overdue ? "border-red-bar border-2" : r.tag ? "border-amber-bar" : "border-line"}`} data-receipt={r.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-bold"><Words text={`${r.poNumber} · received ${formatDateTime(r.receivedAt)}${r.receivedBy ? ` by ${r.receivedBy}` : ""}`} /></span>
              {r.number ? (
                <span className="text-sm font-bold" data-receipt-invoice={r.number}>Invoice {r.number}</span>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${r.overdue ? "bg-red text-white" : "bg-amber-bar text-ink"}`} data-receipt-due={r.overdue ? "overdue" : "due"}>{r.tag}{r.overdue ? " · OVERDUE" : ""}</span>
              )}
            </div>
            <p className="text-xs text-muted"><Words text={r.lines.map((l) => `${l.description.toUpperCase()} × ${l.qty}`).join(" · ")} /></p>
            {r.noPaper ? <p className="text-xs font-semibold">No paper came with the part (logged).</p> : null}
            {r.retakeAsked && !r.retakeDone ? <p className="text-xs font-semibold text-red" data-receipt-retake-asked>Photo unclear: {r.retakeAsked.by ?? "accounts"} asked the parts desk to retake it{r.retakeAsked.note ? ` (${r.retakeAsked.note})` : ""}.</p> : null}
            {current.length ? (
              <div className="flex flex-wrap gap-2" data-receipt-files>
                {current.map((f) => (
                  <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="flex flex-col items-start gap-1 text-xs" data-receipt-file={f.kind}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage address, shown small */}
                    {f.url && (f.contentType ?? "").startsWith("image/") ? <img src={f.url} alt={f.kind === "paper" ? "Delivery paper" : "Invoice"} className="h-20 w-auto rounded-control border border-line" /> : <span className="rounded-control border border-line px-2 py-3 font-bold">PDF</span>}
                    <span>{f.kind === "paper" ? "Delivery paper" : "Invoice"} · {f.by ?? ""}</span>
                  </a>
                ))}
              </div>
            ) : null}
            {old.length || r.history.length ? (
              <details className="text-xs" data-receipt-history>
                <summary className="cursor-pointer font-semibold">History ({old.length + r.history.length})</summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {r.history.map((h, i) => <li key={`h${i}`}>Number {h.old ?? "(none)"} → {h.new} · {h.by_name}, {formatDateTime(h.at)}</li>)}
                  {old.map((f) => <li key={f.id}>{f.kind === "paper" ? "Delivery paper" : "Invoice"} by {f.by ?? ""} ({formatDateTime(f.at)}) replaced by {f.replacedBy ?? ""}, {formatDateTime(f.replacedAt ?? "")} {f.url ? <a className="underline" href={f.url} target="_blank" rel="noreferrer">open the old file</a> : null}</li>)}
                </ul>
              </details>
            ) : null}
            {!viewingAs ? (
              <ReceiptActions
                number={r.number}
                canNumber={r.number ? mayCorrectNumber(role) : mayTypeMissingNumber(role)}
                correcting={!!r.number}
                fileKinds={kinds}
                canAskRetake={role === "owner" || role === "accounts"}
                numberAction={receiptNumberAction.bind(null, r.id, r.poId)}
                fileAction={{ paper: receiptFileAction.bind(null, r.id, r.poId, "paper"), invoice: receiptFileAction.bind(null, r.id, r.poId, "invoice") }}
                retakeAction={receiptRetakeAction.bind(null, r.id, r.poId)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
  if (bare) return <div className="flex flex-col gap-2" id="receipts"><span className="text-xs font-bold uppercase tracking-[0.08em]">Receipts</span>{body}</div>;
  return (
    <Card className="flex flex-col gap-2" id="receipts" data-receipts-card>
      <SectionLabel>Receipts ({receipts.length})</SectionLabel>
      {body}
    </Card>
  );
}
