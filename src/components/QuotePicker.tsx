"use client";

import Link from "next/link";
import { useState } from "react";
import { FloatingMenu } from "./FloatingMenu";
import type { QuotePickItem } from "@/lib/quote-history";

/**
 * "2 quotations ▾" on a car card or a visit row (29 October 2026): every quotation of the job, the original first,
 * each opening its newest version (older versions are one tap away inside). With one quotation it is a plain link.
 */
export function QuotePicker({ items }: { items: QuotePickItem[] }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  if (!items.length) return null;
  if (items.length === 1) {
    const i = items[0];
    return (
      <Link href={i.href} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold whitespace-nowrap" data-quote-picker="1">
        {i.number}
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
        aria-expanded={!!anchor}
        className="inline-flex min-h-11 items-center gap-1 rounded-control border border-line-strong bg-white px-3 text-xs font-bold whitespace-nowrap"
        data-quote-picker={items.length}
      >
        {items.length} quotations ▾
      </button>
      {anchor ? (
        <FloatingMenu anchor={anchor} onClose={() => setAnchor(null)} width={300} label="Quotations of this car" data-quote-picker-menu>
          {items.map((i) => (
            <Link key={i.number} href={i.href} onClick={() => setAnchor(null)} className="flex min-h-11 flex-col justify-center rounded-control px-3 py-1.5 hover:bg-canvas" data-quote-pick={i.number}>
              <span className="flex flex-wrap items-center gap-2 text-sm font-extrabold">
                {i.number}
                <span className="text-[10px] font-extrabold tracking-[0.08em] text-muted">{i.role === "original" ? "ORIGINAL" : "ADDITIONAL"}</span>
                <span className="ml-auto whitespace-nowrap">{i.amount}</span>
              </span>
              <span className="text-xs text-muted">
                {i.words}
                {i.versions > 1 ? ` · ${i.versions} versions` : ""}
              </span>
            </Link>
          ))}
        </FloatingMenu>
      ) : null}
    </>
  );
}
