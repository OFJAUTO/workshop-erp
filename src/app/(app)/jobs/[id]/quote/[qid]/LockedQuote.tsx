"use client";

import type { ReactNode } from "react";
import { Badge, Card, SectionLabel } from "@/components/ui";
import type { QuoteLock } from "@/lib/quote-lock";
import { aed, blockOf, discountLabelOf, hoursText, isHidden, isUnchosen, lineCost, lineTotal, lineUnitPrice, type QuoteLine, type QuoteRow, type QuoteTotals } from "@/lib/quotes";

/**
 * A locked quotation (approved by the customer, replaced, or invoiced): every figure as plain text, no boxes, no
 * delete buttons, no menus. The banner says why it is locked and what the way forward is; the bar at the bottom
 * carries the one action this person has (Revise, or Ask owner to revise), or nothing.
 */
export function LockedQuote({ quotation, lock, lines, totals, showProfit, actions, ownerBox, statusText }: {
  quotation: QuoteRow;
  lock: QuoteLock;
  lines: QuoteLine[];
  totals: QuoteTotals;
  showProfit: boolean;
  actions?: ReactNode;
  ownerBox?: ReactNode;
  statusText: string;
}) {
  const live = lines.filter((l) => l.is_active && !l.fee_kind);
  const labour = live.filter((l) => blockOf(l) === "labour");
  const parts = live.filter((l) => blockOf(l) === "parts");
  const others = live.filter((l) => blockOf(l) === "other");
  const margin = totals.net > 0 ? (totals.profit / totals.net) * 100 : 0;
  const detailOf = (l: QuoteLine) => {
    if (l.line_type === "labour") return `${hoursText(l.hours)} × ${aed(l.labour_rate)} per hour`;
    if (l.price_per && l.price_per !== "job") return `${l.quantity || 1} × ${aed(l.unit_price)} per ${l.price_per}`;
    return (l.quantity || 1) > 1 ? `${l.quantity} × ${aed(l.unit_price)}` : null;
  };
  return (
    <div className="flex flex-col gap-4 pb-20" data-quote-locked data-lock-reason={lock.reason ?? ""}>
      <div className="rounded-control border border-ink bg-chip px-4 py-3 text-sm font-bold" role="status" data-lock-banner>{lock.banner}</div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel right={`${labour.length}`}>Labour and services</SectionLabel>
            {labour.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ol className="divide-y divide-line text-sm">
                {labour.map((l, i) => (
                  <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2" data-locked-line data-line-id={l.id}>
                    <span className="w-5 shrink-0 text-right text-[11px] font-bold text-muted">{i + 1}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-2"><span className="font-semibold uppercase">{l.title || "(no name)"}</span>{l.urgency === "urgent" ? <Badge tone="red">Urgent</Badge> : null}{l.dangerous ? <Badge tone="red">Dangerous</Badge> : null}{l.positions?.length ? <span className="text-xs text-muted">{l.positions.join(", ")}</span> : null}</span>
                      {detailOf(l) ? <span className="text-xs text-muted">{detailOf(l)}</span> : null}
                      {l.details ? <span className="text-xs text-muted">Note: {l.details}</span> : null}
                      {showProfit && l.outside_work ? <span className="text-xs text-muted">Outside work, our cost {aed(lineCost(l))}</span> : null}
                    </span>
                    <span className="w-28 text-right font-bold">{aed(lineTotal(l))}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card className="flex flex-col gap-2">
            <SectionLabel right={`${parts.length}`}>Parts</SectionLabel>
            {parts.length === 0 ? <p className="text-sm text-muted">No parts on this quotation.</p> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-muted">
                    <th className="py-1 pr-2">#</th><th className="py-1 pr-2">Part</th><th className="py-1 pr-2 text-right">Qty</th>{showProfit ? <th className="py-1 pr-2 text-right">Cost</th> : null}<th className="py-1 pr-2 text-right">Selling</th><th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parts.map((l, i) => {
                    const off = isUnchosen(l);
                    return (
                      <tr key={l.id} className={off ? "opacity-50" : ""} data-locked-line data-line-id={l.id}>
                        <td className="py-2 pr-2 align-top text-xs font-bold text-muted">{i + 1}</td>
                        <td className="py-2 pr-2 align-top"><span className="font-semibold uppercase">{l.title}</span>{l.positions?.length ? <span className="ml-2 text-xs text-muted">{l.positions.join(", ")}</span> : null}{l.left_off ? <Badge tone="neutral">Left off</Badge> : null}{l.option_group && l.chosen === false ? <Badge tone="neutral">Not chosen</Badge> : null}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.quantity}</td>
                        {showProfit ? <td className="py-2 pr-2 align-top text-right text-muted">{aed(l.unit_cost)}</td> : null}
                        <td className="py-2 pr-2 align-top text-right">{off ? "" : aed(lineUnitPrice(l))}</td>
                        <td className="py-2 align-top text-right font-bold">{off ? aed(0) : aed(lineTotal(l))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          {others.length ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel right={`${others.length}`}>Other charges</SectionLabel>
              <ol className="divide-y divide-line text-sm">
                {others.map((l, i) => {
                  const hidden = isHidden(l);
                  return (
                    <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2" data-locked-line data-line-id={l.id}>
                      <span className="w-5 shrink-0 text-right text-[11px] font-bold text-muted">{i + 1}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{l.title}</span>{hidden ? <Badge tone="neutral">Internal only</Badge> : null}</span>
                        {(l.quantity || 1) > 1 ? <span className="text-xs text-muted">{l.quantity} × {aed(l.unit_price)}</span> : null}
                        {hidden && showProfit ? <span className="text-xs text-muted">Costs us {aed(lineCost(l))}</span> : null}
                        {l.details ? <span className="text-xs text-muted">Note: {l.details}</span> : null}
                      </span>
                      <span className="w-28 text-right font-bold">{hidden ? aed(0) : aed(lineTotal(l))}</span>
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Summary</SectionLabel>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Labour and services</dt><dd className="text-right">{aed(totals.labourSell)}</dd>
              <dt className="text-muted">Parts</dt><dd className="text-right">{aed(totals.partsSell)}</dd>
              <dt className="text-muted">Other charges</dt><dd className="text-right">{aed(totals.otherSell)}</dd>
              {totals.discount ? <><dt className="font-bold text-green">{discountLabelOf(quotation)}</dt><dd className="text-right font-bold text-green">− {aed(totals.discount)}</dd></> : null}
              {totals.rounding ? <><dt className={totals.rounding < 0 ? "font-bold text-green" : "text-muted"}>{totals.rounding < 0 ? "Round-off" : "Rounding"}</dt><dd className={`text-right ${totals.rounding < 0 ? "font-bold text-green" : ""}`}>{totals.rounding < 0 ? "− " : ""}{aed(Math.abs(totals.rounding))}</dd></> : null}
              <dt className="text-muted border-t border-line pt-1">Subtotal before VAT</dt><dd className="text-right border-t border-line pt-1">{aed(totals.net)}</dd>
              <dt className="text-muted">VAT {quotation.vat_percent}%</dt><dd className="text-right">{aed(totals.vat)}</dd>
              <dt className="font-extrabold">Grand total</dt><dd className="text-right text-lg font-extrabold" data-locked-total>{aed(totals.total)}</dd>
              {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold">{aed(totals.deposit)}</dd></> : null}
            </dl>
            {showProfit ? <p className="border-t border-line pt-2 text-xs text-muted">Internal: profit {aed(totals.profit)} ({margin.toFixed(0)}% of the net).</p> : null}
            {quotation.customer_note ? <p className="border-t border-line pt-2 text-xs text-muted">Note to the customer: {quotation.customer_note}</p> : null}
            <p className="text-xs text-muted">Every figure is as the customer approved it. Nothing here can be typed or removed.</p>
          </Card>
          {ownerBox}
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 md:left-60 z-40 border-t border-line bg-white px-4 py-2.5" data-locked-bar>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-semibold">{statusText}</span>
          <span className="ml-auto flex flex-wrap items-center gap-2">{actions}</span>
        </div>
      </div>
    </div>
  );
}
