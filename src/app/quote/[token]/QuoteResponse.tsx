"use client";

import { useState } from "react";
import { Notice } from "@/components/ui";
import { aed, lineTotal, round2, type QuoteLine } from "@/lib/quotes";

type Group = { label: string; lines: (QuoteLine & { photo_urls: string[]; remark: string | null })[] };

/**
 * The customer's answer: every line on, switch individual lines off, totals update as he does,
 * then the terms tick, his name and Approve. Decline all sits apart, with the inspection fee notice.
 */
export function QuoteResponse({ token, groups, vatPercent, discountPercent, declaration, declarationAr, feeNotice, feeNoticeAr, isEstimate, terms, termsAr, depositThreshold, depositPercent }: { token: string; groups: Group[]; vatPercent: number; discountPercent: number; declaration: string; declarationAr: string | null; feeNotice: string; feeNoticeAr: string | null; isEstimate: boolean; terms: string; termsAr: string | null; depositThreshold: number; depositPercent: number }) {
  const all = groups.flatMap((g) => g.lines);
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(all.map((l) => [l.id, true])));
  const [declining, setDeclining] = useState(false);
  const chosen = all.filter((l) => on[l.id]);
  const subtotal = round2(chosen.reduce((a, l) => a + lineTotal(l), 0));
  const discount = round2(subtotal * (discountPercent / 100));
  const net = round2(subtotal - discount);
  const vat = round2(net * (vatPercent / 100));
  const total = round2(net + vat);
  const partsSell = round2(chosen.filter((l) => l.line_type === "part" || l.line_type === "outside").reduce((a, l) => a + lineTotal(l), 0));
  const deposit = depositThreshold > 0 && partsSell > depositThreshold ? round2(partsSell * (depositPercent / 100)) : 0;
  const toggle = (id: string) => setOn((p) => ({ ...p, [id]: !p[id] }));

  return (
    <form method="post" action={`/api/quote/${token}`} className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.label} className="bg-white border border-line rounded-card p-4 flex flex-col gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">{g.label}</h2>
          {g.lines.map((l) => (
            <label key={l.id} className={`flex items-start gap-3 rounded-control border p-3 cursor-pointer ${on[l.id] ? "border-ink" : "border-line opacity-60"}`}>
              <input type="checkbox" name={`line_${l.id}`} checked={!!on[l.id]} onChange={() => toggle(l.id)} className="mt-1 h-5 w-5 accent-ink" />
              <span className="flex-1 flex flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{l.title}</span>
                  <span className="font-extrabold">{aed(lineTotal(l))}</span>
                </span>
                {l.quantity && l.quantity !== 1 ? <span className="text-xs text-muted">Quantity {l.quantity}</span> : null}
                {l.details ? <span className="text-sm text-muted whitespace-pre-wrap">{l.details}</span> : null}
                {l.remark ? <span className="text-sm whitespace-pre-wrap"><span className="text-muted">Inspection note:</span> {l.remark}</span> : null}
                {l.photo_urls.length ? (
                  <span className="flex flex-wrap gap-2 mt-1">
                    {l.photo_urls.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Inspection photo" className="h-24 w-24 rounded-control object-cover bg-chip" /></a>
                    ))}
                  </span>
                ) : null}
                {!on[l.id] ? <span className="text-xs font-semibold text-red">Switched off: this will be declined</span> : null}
              </span>
            </label>
          ))}
        </section>
      ))}

      <section className="bg-white border border-line rounded-card p-4 flex flex-col gap-2">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Your total</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">{chosen.length} of {all.length} lines</dt><dd className="text-right">{aed(subtotal)}</dd>
          {discount ? <><dt className="text-muted">Discount {discountPercent}%</dt><dd className="text-right">− {aed(discount)}</dd></> : null}
          <dt className="text-muted">Before VAT</dt><dd className="text-right font-semibold">{aed(net)}</dd>
          <dt className="text-muted">VAT {vatPercent}%</dt><dd className="text-right">{aed(vat)}</dd>
          <dt className="text-lg font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">{aed(total)}</dd>
          {deposit ? <><dt className="text-muted">Deposit required for parts</dt><dd className="text-right font-semibold">{aed(deposit)}</dd></> : null}
        </dl>
      </section>

      {!declining ? (
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
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Your full name</span>
            <input name="approver_name" required minLength={2} className="min-h-12 rounded-control border border-line-strong px-3.5 text-base" autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Your phone number <span className="font-medium text-muted">(optional)</span></span>
            <input name="approver_phone" type="tel" className="min-h-12 rounded-control border border-line-strong px-3.5 text-base" autoComplete="tel" />
          </label>
          <button type="submit" name="action" value="approve" disabled={chosen.length === 0} className="min-h-16 w-full rounded-control bg-ink text-lg font-extrabold text-white disabled:bg-faint">
            {isEstimate ? "Accept" : "Approve"} {chosen.length === all.length ? "everything" : `${chosen.length} line${chosen.length === 1 ? "" : "s"}`} · {aed(total)}
          </button>
          <button type="button" onClick={() => setDeclining(true)} className="min-h-11 w-full rounded-control border border-line-strong text-sm font-bold text-red">
            Decline all
          </button>
        </section>
      ) : (
        <section className="bg-white border border-red-bar rounded-card p-4 flex flex-col gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase text-red">Decline everything?</h2>
          <Notice tone="error">{feeNotice}</Notice>
          {feeNoticeAr ? <p className="text-sm" dir="rtl" lang="ar">{feeNoticeAr}</p> : null}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Your full name</span>
            <input name="approver_name" required minLength={2} className="min-h-12 rounded-control border border-line-strong px-3.5 text-base" autoComplete="name" />
          </label>
          <button type="submit" name="action" value="decline" className="min-h-14 w-full rounded-control bg-red-bar text-base font-extrabold text-white">
            Yes, decline all
          </button>
          <button type="button" onClick={() => setDeclining(false)} className="min-h-11 w-full rounded-control border border-line-strong text-sm font-bold">
            Go back
          </button>
        </section>
      )}
    </form>
  );
}
