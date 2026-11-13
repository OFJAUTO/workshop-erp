"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import { Words } from "./Words";

/**
 * CHECK BEFORE YOU SEND (13 November 2026): THE window the parts desk sees before anything goes out - prices back to the
 * advisor, an LPO for approval, an LPO to the supplier, a receipt. It shows what is being sent (supplier, each part with
 * its part number, quantity and price, the total incl. VAT, the delivery time) and highlights what looks wrong
 * (src/lib/send-check-rules.ts). Nothing flagged = one tap; something flagged = tick "I checked the highlighted lines".
 * "GO BACK AND EDIT" closes it with nothing lost.
 */
export type CheckLine = { key: string; name: string; partNumber: string | null; qty: number; price: number | null; flags: string[] };
export type CheckGroup = { title: string; amount?: string | null; delivery?: string | null; lines: CheckLine[] };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CheckBeforeSend({ open, title, groups, total = null, extra = null, busy = false, error = null, onBack, onSend, sendLabel = "YES, ALL CORRECT - SEND" }: {
  open: boolean;
  title: string;
  groups: CheckGroup[];
  total?: string | null;
  /** The invoice number typed and the photo taken (a receipt), or anything else to show above the buttons. */
  extra?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onBack: () => void;
  /** The flags that were showing, for the log. */
  onSend: (flags: { key: string; name: string; flags: string[] }[]) => void;
  sendLabel?: string;
}) {
  const [ticked, setTicked] = useState(false);
  if (!open || typeof document === "undefined") return null;
  const flagged = groups.flatMap((g) => g.lines).filter((l) => l.flags.length);
  const mayGo = !busy && (!flagged.length || ticked);
  const back = () => { if (!busy) { setTicked(false); onBack(); } };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={back}>
      <div role="dialog" aria-modal="true" className="flex w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") back(); }} data-check-send data-check-flagged={flagged.length}>
        <span className="text-lg font-extrabold">{title}</span>
        <p className={`text-sm font-semibold ${flagged.length ? "text-red" : "text-green-text"}`} data-check-summary>
          {flagged.length ? `${flagged.length} line${flagged.length === 1 ? " looks" : "s look"} wrong: check the highlighted lines.` : "Nothing looks wrong. Check once and send."}
        </p>
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-1 rounded-card border border-line p-3" data-check-group={g.title}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold"><Words text={g.title} /></span>
              {g.amount ? <span className="whitespace-nowrap text-sm font-bold" data-check-amount>{g.amount}</span> : null}
            </div>
            {g.delivery ? <span className="text-xs text-muted" data-check-delivery>Delivery: {g.delivery}</span> : null}
            <ul className="flex flex-col gap-1">
              {g.lines.map((l) => (
                <li key={l.key} className={`rounded-control px-2 py-1 text-xs ${l.flags.length ? "border-2 border-red bg-red-soft" : ""}`} data-check-line={l.key} data-check-line-flagged={l.flags.length ? "1" : "0"}>
                  <span className="font-bold uppercase"><Words text={l.name} /></span>
                  <span className="text-muted"> · <Words text={`${l.partNumber || "no part number"} · × ${l.qty}${l.price !== null ? ` · ${aed(l.price)} each` : ""}`} /></span>
                  {l.flags.map((f) => <span key={f} className="block font-semibold text-red" data-check-flag>⚠ <Words text={f} /></span>)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {total ? <p className="text-sm font-bold" data-check-total>Total {total}</p> : null}
        {extra}
        {flagged.length ? (
          <label className="flex min-h-11 items-center gap-2 rounded-control bg-amber-soft px-3 text-sm font-bold" data-check-tick>
            <input type="checkbox" className="h-5 w-5" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            I checked the highlighted lines
          </label>
        ) : null}
        {error ? <p className="text-sm font-semibold text-red" role="alert" data-check-error>{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="lg" tone="secondary" onClick={back} disabled={busy} data-check-back>GO BACK AND EDIT</Button>
          <Button type="button" size="lg" onClick={() => onSend(flagged.map((l) => ({ key: l.key, name: l.name, flags: l.flags })))} disabled={!mayGo} data-check-yes>{busy ? "Sending…" : sendLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
