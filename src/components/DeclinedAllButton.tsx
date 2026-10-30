"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { customerDeclinedAllAction } from "@/app/(app)/jobs/declined-actions";

/**
 * THE [CUSTOMER DECLINED ALL WORK] button (29 October 2026, batch 2 section 2), on the job card and the quotation:
 * a centre window asks to charge the inspection fee agreed at gate-in (pre-filled; another amount needs the owner or a
 * reason), records it and shows the answer in the same window.
 */
export function DeclinedAllButton({ jobId, fee, isOwner, oldWording = null }: { jobId: string; fee: number; isOwner: boolean; /** Approved with the old wording (no VAT): charged as the amount INCLUDING VAT (30 October 2026). */ oldWording?: { net: number; vat: number; total: number } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [amount, setAmount] = useState(String(oldWording ? oldWording.net : fee));
  const [reason, setReason] = useState("");
  const [answer, setAnswer] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();
  // The fee is before VAT; the invoice adds the VAT (30 October 2026: the job's own fee, as the customer approved it).
  const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plusVatText = `AED ${fee.toLocaleString("en-GB")} + VAT (AED ${money(Math.round(fee * 105) / 100)})`;
  // The old wording (no VAT on the approval page): the amount the customer read, VAT included.
  const feeText = oldWording ? `AED ${money(oldWording.total)} including VAT (${money(oldWording.net)} + VAT ${money(oldWording.vat)})` : plusVatText;
  const agreed = oldWording ? oldWording.net : fee;
  const value = Number(amount.replace(/,/g, "")) || 0;
  const send = (charge: number) => {
    const fd = new FormData();
    fd.set("amount", String(charge));
    fd.set("reason", reason);
    start(async () => {
      const r = await customerDeclinedAllAction(jobId, fd);
      setAnswer(r);
      if (r.ok) router.refresh();
    });
  };
  const close = () => {
    setOpen(false);
    setChanging(false);
    setAnswer(null);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-control border-2 border-ink bg-white px-4 text-sm font-bold" data-declined-all>
        Customer declined all work
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={close} onKeyDown={(e) => e.key === "Escape" && close()}>
          <div role="dialog" aria-modal="true" aria-label="Customer declined all work" onClick={(e) => e.stopPropagation()} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-card bg-white p-5 shadow-xl" data-declined-dialog>
            <span className="text-lg font-extrabold">Customer declined all work</span>
            {answer?.ok ? (
              <>
                <p className="text-sm font-semibold text-green" data-declined-result>{answer.ok}</p>
                <button type="button" onClick={close} className="inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white">Close</button>
              </>
            ) : (
              <>
                <p className="text-sm">The quotation stays in the history, marked declined by the customer. The declined work is saved for the next visit and the car goes to Ready to collect.</p>
                {fee > 0 && !changing ? (
                  <>
                    {oldWording ? <p className="text-sm font-bold text-amber" data-declined-old-wording>Approved with the old wording – AED {money(oldWording.total)} total</p> : null}
                    <p className="text-base font-bold" data-declined-question>Charge the inspection fee of {feeText} the customer agreed to?</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={pending} onClick={() => send(agreed)} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white disabled:opacity-50" data-declined-charge>
                        {pending ? "Recording…" : `Yes, charge ${feeText}`}
                      </button>
                      {oldWording && isOwner ? (
                        <button type="button" disabled={pending} onClick={() => send(fee)} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-declined-plus-vat>
                          Charge {plusVatText} instead
                        </button>
                      ) : null}
                      <button type="button" disabled={pending} onClick={() => setChanging(true)} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-declined-change>
                        Change the amount
                      </button>
                    </div>
                  </>
                ) : fee > 0 || changing ? (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      Amount to charge (AED, before VAT; 0 = no charge)
                      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="min-h-11 rounded-control border border-line-strong px-3 text-base" data-declined-amount />
                    </label>
                    {!isOwner && value !== agreed ? (
                      <label className="flex flex-col gap-1 text-sm font-semibold">
                        Why a different amount? (kept in the job&apos;s history)
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} spellCheck lang="en" className="rounded-control border border-line-strong px-3 py-2 text-base" data-declined-reason />
                      </label>
                    ) : null}
                    <button type="button" disabled={pending} onClick={() => send(value)} className="inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white disabled:opacity-50" data-declined-confirm>
                      {pending ? "Recording…" : value > 0 ? `Charge AED ${value.toLocaleString("en-GB")}` : "Record, no charge"}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold" data-declined-no-fee>No inspection fee on this car: no invoice. The time spent and the declined work are saved.</p>
                    <button type="button" disabled={pending} onClick={() => send(0)} className="inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white disabled:opacity-50" data-declined-confirm>
                      {pending ? "Recording…" : "Record the decline"}
                    </button>
                  </>
                )}
                {answer?.error ? <p className="text-sm font-semibold text-red" data-declined-error>{answer.error}</p> : null}
                <button type="button" onClick={close} className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Cancel</button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
