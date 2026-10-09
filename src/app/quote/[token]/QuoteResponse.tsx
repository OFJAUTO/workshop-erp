"use client";

import { useState } from "react";
import { aed } from "@/lib/quotes";

/**
 * The bar that stays at the bottom of the customer's quotation: Approved and Declined. Each opens
 * one confirmation window. Approving shows the total, the terms and the name; declining asks why
 * (optional), reminds of the inspection fee, and asks for the safety acknowledgement when a finding
 * was dangerous.
 */
export function QuoteResponse({ token, customerName, total, declaration, declarationAr, feeNotice, feeNoticeAr, isEstimate, terms, termsAr, dangerText = null }: { token: string; customerName: string; total: number; declaration: string; declarationAr: string | null; feeNotice: string; feeNoticeAr: string | null; isEstimate: boolean; terms: string; termsAr: string | null; dangerText?: string | null }) {
  const [mode, setMode] = useState<null | "approve" | "decline">(null);
  const nameBox = (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">Your full name</span>
      <input name="approver_name" defaultValue={customerName} required minLength={2} className="min-h-12 rounded-control border border-line-strong px-3.5 text-base" autoComplete="name" />
    </label>
  );
  return (
    <>
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("approve")} className="min-h-14 flex-1 rounded-control bg-ink text-base font-extrabold text-white">Approved</button>
        <button type="button" onClick={() => setMode("decline")} className="min-h-14 flex-1 rounded-control border-2 border-ink bg-white text-base font-extrabold">Declined</button>
      </div>
      {mode ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-3">
          <form method="post" action={`/api/quote/${token}`} className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            {mode === "approve" ? (
              <>
                <span className="text-lg font-extrabold">{isEstimate ? "Accept" : "Approve"} the {isEstimate ? "estimate" : "quotation"} for {aed(total)}?</span>
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
                {nameBox}
                <button type="submit" name="action" value="approve" className="min-h-14 w-full rounded-control bg-ink text-base font-extrabold text-white">Yes, {isEstimate ? "accept" : "approve"} · {aed(total)}</button>
              </>
            ) : (
              <>
                <span className="text-lg font-extrabold">Decline the {isEstimate ? "estimate" : "quotation"}?</span>
                {!isEstimate ? (
                  <div className="rounded-control border border-line-strong bg-chip px-3 py-2.5 text-sm">
                    <p className="font-semibold">{feeNotice}</p>
                    {feeNoticeAr ? <p className="mt-1" dir="rtl" lang="ar">{feeNoticeAr}</p> : null}
                  </div>
                ) : null}
                {dangerText ? (
                  <label className="flex items-start gap-3 cursor-pointer rounded-control border border-red-bar p-3">
                    <input type="checkbox" name="danger_ack" className="mt-1 h-5 w-5 accent-ink" required />
                    <span className="text-sm">{dangerText}</span>
                  </label>
                ) : null}
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Tell us why <span className="font-medium text-muted">(optional)</span></span>
                  <textarea name="note" rows={2} className="rounded-control border border-line-strong px-3.5 py-2 text-base" />
                </label>
                {nameBox}
                <button type="submit" name="action" value="decline" className="min-h-14 w-full rounded-control bg-ink text-base font-extrabold text-white">Yes, decline</button>
              </>
            )}
            <button type="button" onClick={() => setMode(null)} className="min-h-11 w-full rounded-control border border-line-strong text-sm font-bold">Go back</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
