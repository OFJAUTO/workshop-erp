"use client";

import { useState } from "react";
import { aed } from "@/lib/quotes";

/**
 * The one action on the customer's quotation page: "Approved". It asks once, "Approve this quotation for
 * AED <total>?", with the terms and the customer's name, and records the amount approved. There is no
 * Declined button: the advisor marks a quotation declined after talking to the customer.
 */
export function QuoteResponse({ token, customerName, total, declaration, declarationAr, isEstimate, terms, termsAr, removalAck = null, tintAck = null }: { token: string; customerName: string; total: number; declaration: string; declarationAr: string | null; isEstimate: boolean; terms: string; termsAr: string | null; /** Old PPF removal on the quotation: the customer ticks that they understand paint may lift. */ removalAck?: string | null; /** Section 11: a window darker than the legal limit - the customer ticks that it is their own request. */ tintAck?: string | null }) {
  const [open, setOpen] = useState(false);
  const word = isEstimate ? "estimate" : "quotation";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-16 w-full items-center justify-center rounded-lg border-2 border-green bg-green-soft text-lg font-extrabold">
        {isEstimate ? "Accepted" : "Approved"}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => setOpen(false)}>
          <form method="post" action={`/api/quote/${token}`} className="w-full max-w-md rounded-lg bg-white p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-quote-approve-sheet>
            <span className="text-lg font-extrabold">{isEstimate ? "Accept" : "Approve"} this {word} for {aed(total)}?</span>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">Terms and conditions</summary>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{terms || "Available at the workshop."}</p>
              {termsAr ? <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed" dir="rtl" lang="ar">{termsAr}</p> : null}
            </details>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" name="agree" className="mt-1 h-5 w-5 accent-ink" required />
              <span className="flex flex-col gap-1 text-sm">
                <span>{declaration}</span>
                {declarationAr ? <span dir="rtl" lang="ar">{declarationAr}</span> : null}
              </span>
            </label>
            {removalAck ? (
              <label className="flex items-start gap-3 cursor-pointer" data-removal-ack>
                <input type="checkbox" name="removal_ack" className="mt-1 h-5 w-5 accent-ink" required />
                <span className="text-sm">I understand old film removal may lift paint. <span className="text-xs text-[#5F6368]">{removalAck}</span></span>
              </label>
            ) : null}
            {tintAck ? (
              <label className="flex items-start gap-3 cursor-pointer" data-tint-ack>
                <input type="checkbox" name="tint_ack" className="mt-1 h-5 w-5 accent-ink" required />
                <span className="text-sm">Above the legal limit – my request. <span className="text-xs text-[#5F6368]">{tintAck} I asked for this darkness myself.</span></span>
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Your full name</span>
              <input name="approver_name" defaultValue={customerName} required minLength={2} spellCheck lang="en" autoCapitalize="words" className="min-h-12 rounded-lg border border-[#D4D4D8] px-3.5 text-base" autoComplete="name" />
            </label>
            <input type="hidden" name="approved_amount" value={total.toFixed(2)} />
            <button type="submit" name="action" value="approve" className="min-h-14 w-full rounded-lg bg-[#111113] text-base font-extrabold text-white">Yes, {isEstimate ? "accept" : "approve"} · {aed(total)}</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 w-full rounded-lg border border-[#D4D4D8] text-sm font-bold">Not yet</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
