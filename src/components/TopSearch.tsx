"use client";

import { openCustomerPanel } from "./CustomerPanel";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = { href: string; plate: string; title: string; customer: string | null; jobId?: string | null; stage: string; pictureUrl: string | null; open: boolean };

/**
 * The one search bar at the top of every home screen: any car, open or gone - plate, customer, VIN or job
 * number. Results drop down as you type (from two letters), each with the photo, plate, model, customer and
 * stage; one tap opens the job card.
 */
/** `customers`: the person may find a car by its customer (owner, advisors, accounts); the words follow it. */
export function TopSearch({ customers = true }: { customers?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (term.length < 2) {
        if (seq.current === mine) setHits(null);
        return;
      }
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const j = (await r.json()) as { hits?: Hit[] };
        if (seq.current === mine) {
          setHits(j.hits ?? []);
          setOpen(true);
        }
      } catch {
        /* a lost request never clears what is on screen */
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  return (
    <div ref={box} className="relative w-full" data-top-search>
      <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" /></svg>
      </span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (hits) setOpen(true); }}
        placeholder={customers ? "Search any car: plate, customer, VIN, job number…" : "Search any car: plate, VIN, job number…"}
        aria-label="Search any car"
        spellCheck={false}
        className="h-12 w-full rounded-full bg-chip pl-10 pr-4 text-sm font-semibold text-ink placeholder:text-muted outline-none focus:ring-2 focus:ring-ink border-0"
        data-search-input
      />
      {open && hits ? (
        <div className="absolute left-0 right-0 top-[3.25rem] z-40 max-h-96 overflow-auto rounded-card border border-line bg-white shadow-xl" data-search-results>
          {hits.length === 0 ? (
            <p className="p-3 text-sm text-muted">No car matches.</p>
          ) : (
            <ul className="divide-y divide-line">
              {hits.map((h) => (
                <li key={h.href} className="flex items-center">
                  <button type="button" onClick={() => { setOpen(false); setQ(""); router.push(h.href); }} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left hover:bg-canvas" data-search-hit>
                    {h.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.pictureUrl} alt="" className="h-10 w-16 shrink-0 rounded-control object-cover bg-chip" />
                    ) : <span className="h-10 w-16 shrink-0 rounded-control bg-chip" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{h.plate}<span className="font-semibold text-muted"> · {h.title}</span></span>
                      <span className="block truncate text-xs text-muted">{[h.customer, h.stage].filter(Boolean).join(" · ")}</span>
                    </span>
                    {!h.open ? <span className="shrink-0 rounded-full bg-chip px-2 py-0.5 text-[11px] font-bold text-muted">Gone</span> : null}
                  </button>
                  {h.customer && h.jobId ? (
                    <button type="button" onClick={() => { setOpen(false); openCustomerPanel({ jobId: h.jobId }); }} className="min-h-11 shrink-0 px-3 text-xs font-bold underline decoration-dotted underline-offset-4" data-search-customer>
                      Customer
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
