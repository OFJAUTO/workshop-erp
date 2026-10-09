"use client";

import { useState } from "react";
import { Notice } from "@/components/ui";
import { aed } from "@/lib/quotes";

/**
 * The customer's answer, all or nothing: Approve the whole quotation with the terms tick and his
 * name; ask for a quotation with the urgent work only; or Decline, with the inspection fee notice.
 */
export function QuoteResponse({ token, customerName, total, declaration, declarationAr, feeNotice, feeNoticeAr, isEstimate, terms, termsAr, hasUrgent, dangerText = null }: { token: string; customerName: string; total: number; declaration: string; declarationAr: string | null; feeNotice: string; feeNoticeAr: string | null; isEstimate: boolean; terms: string; termsAr: string | null; hasUrgent: boolean; dangerText?: string | null }) {
  const [mode, setMode] = useState<"approve" | "urgent" | "decline">("approve");
  const nameBox = (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">Your full name</span>
      <input name="approver_name" defaultValue={customerName} required minLength={2} className="min-h-12 rounded-control border border-line-strong px-3.5 text-base" autoComplete="name" />
      <span className="text-xs text-muted">Please confirm or correct it.</span>
    </label>
  );

  return (
    <form method="post" action={`/api/quote/${token}`} className="flex flex-col gap-4">
      {mode === "approve" ? (
        <section className="bg-white border border-line rounded-card p-4 flex flex-col gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">{isEstimate ? "Accept" : "Approve"}</h2>
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
          <button type="submit" name="action" value="approve" className="min-h-16 w-full rounded-control bg-ink text-lg font-extrabold text-white">
            {isEstimate ? "Accept" : "Approve"} · {aed(total)}
          </button>
          {!isEstimate && hasUrgent ? (
            <button type="button" onClick={() => setMode("urgent")} className="min-h-12 w-full rounded-control border border-ink text-sm font-bold">
              Request a quotation for urgent work only
            </button>
          ) : null}
          <button type="button" onClick={() => setMode("decline")} className="min-h-11 w-full rounded-control border border-line-strong text-sm font-bold text-red">
            Decline
          </button>
        </section>
      ) : mode === "urgent" ? (
        <section className="bg-white border border-ink rounded-card p-4 flex flex-col gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Urgent work only</h2>
          <p className="text-sm">We will send you a new quotation with the lines marked Urgent. Nothing is approved yet.</p>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Note for us <span className="font-medium text-muted">(optional)</span></span>
            <textarea name="note" rows={2} className="rounded-control border border-line-strong px-3.5 py-2 text-base" />
          </label>
          {nameBox}
          <button type="submit" name="action" value="urgent" className="min-h-14 w-full rounded-control bg-ink text-base font-extrabold text-white">
            Send the request
          </button>
          <button type="button" onClick={() => setMode("approve")} className="min-h-11 w-full rounded-control border border-line-strong text-sm font-bold">
            Go back
          </button>
        </section>
      ) : (
        <section className="bg-white border border-red-bar rounded-card p-4 flex flex-col gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase text-red">Decline the {isEstimate ? "estimate" : "quotation"}?</h2>
          {!isEstimate ? <Notice tone="error">{feeNotice}</Notice> : null}
          {!isEstimate && feeNoticeAr ? <p className="text-sm" dir="rtl" lang="ar">{feeNoticeAr}</p> : null}
          {dangerText ? (
            <label className="flex items-start gap-3 cursor-pointer rounded-control border border-red-bar p-3">
              <input type="checkbox" name="danger_ack" className="mt-1 h-5 w-5 accent-ink" required />
              <span className="text-sm">{dangerText}</span>
            </label>
          ) : null}
          {nameBox}
          <button type="submit" name="action" value="decline" className="min-h-14 w-full rounded-control bg-red-bar text-base font-extrabold text-white">
            Yes, decline
          </button>
          <button type="button" onClick={() => setMode("approve")} className="min-h-11 w-full rounded-control border border-line-strong text-sm font-bold">
            Go back
          </button>
        </section>
      )}
    </form>
  );
}
