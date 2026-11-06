"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FloatingMenu } from "@/components/FloatingMenu";

/** The "…" menu on the Quotations list (6 November 2026): Send or resend opens the quotation ready to send. */
export function QuoteSendMenu({ href, number }: { href: string; number: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const router = useRouter();
  return (
    <span className="relative shrink-0" data-quote-menu={number}>
      <button type="button" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} aria-label={`More for ${number}`} aria-expanded={!!anchor} className="min-h-11 min-w-11 rounded-control border border-line bg-white text-lg font-extrabold">
        …
      </button>
      {anchor ? (
        <FloatingMenu anchor={anchor} onClose={() => setAnchor(null)} width={220} label={`More for ${number}`}>
          <button type="button" onClick={() => { setAnchor(null); router.push(`${href}?send=1`); }} className="block w-full min-h-11 px-3 text-left text-sm font-semibold hover:bg-canvas" data-quote-menu-send>
            Send or resend…
          </button>
        </FloatingMenu>
      ) : null}
    </span>
  );
}
