import type { ReactNode } from "react";
import { Logo } from "./Logo";

export type DocMeta = { label: string; value: string };
export type DocBox = { title: string; strong: string; rows: [string, string | null | undefined][] };

/**
 * The look of every page a customer opens from a link: the same document as the PDF. Header with
 * the logo, legal name and TRN; the title with its number and date; two pale boxes for the customer
 * and the car; then the sections. On a phone the tables reshape; on a PC it reads like the A4 page.
 * A sticky bar at the bottom can hold the two buttons. White, black and grey only.
 */
export function CustomerDocument({ company, title, meta, boxes, pdfHref, pdfLabel = "Download PDF", bar, footer, children }: { company: { tradingName: string; legalName: string; legalNameAr?: string | null; address: string[]; phone: string; email: string; website: string; trn: string }; title: string; meta: DocMeta[]; boxes: DocBox[]; pdfHref?: string | null; pdfLabel?: string; bar?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <main className={`mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-6 ${bar ? "pb-32" : "pb-10"}`}>
        <div className="bg-white sm:rounded-card sm:border sm:border-line sm:shadow-sm px-4 py-5 sm:px-10 sm:py-8 flex flex-col gap-5">
          <header className="flex items-start justify-between gap-3 border-b-[3px] border-ink pb-4">
            <Logo className="h-12 sm:h-14 w-auto" alt={company.tradingName} />
            <div className="text-right text-[11px] leading-tight sm:text-xs">
              <div className="font-extrabold text-sm sm:text-base">{company.legalName}</div>
              {company.legalNameAr ? <div dir="rtl" lang="ar">{company.legalNameAr}</div> : null}
              {company.address.map((a) => <div key={a} className="text-muted">{a}</div>)}
              <div className="mt-1 font-bold tracking-wide">TRN {company.trn}</div>
            </div>
          </header>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[0.12em] uppercase">{title}</h1>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
              {meta.map((m) => (
                <div key={m.label} className="flex flex-col"><dt className="text-[10px] uppercase tracking-[0.1em] text-muted">{m.label}</dt><dd className="font-bold">{m.value}</dd></div>
              ))}
            </dl>
            {pdfHref ? <a href={pdfHref} className="text-xs font-bold underline underline-offset-4">{pdfLabel}</a> : null}
          </div>
          {boxes.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {boxes.map((b) => (
                <div key={b.title} className="rounded-control bg-chip p-3 text-xs">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted mb-1">{b.title}</div>
                  <div className="text-sm font-extrabold mb-1">{b.strong}</div>
                  {b.rows.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex gap-2"><span className="w-16 shrink-0 text-muted">{k}</span><span className="font-medium">{v}</span></div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {children}
          {footer ? <div className="border-t border-line pt-3 text-[11px] text-muted">{footer}</div> : null}
          <div className="border-t-[3px] border-ink pt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px]">
            <span>{company.phone}</span><span>{company.email}</span><span>{company.website}</span>
          </div>
        </div>
      </main>
      {bar ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur px-3 py-3 sm:px-6"><div className="mx-auto w-full max-w-3xl">{bar}</div></div> : null}
    </div>
  );
}

/** A section of the document: an upper-case title and a table that reshapes on a phone. */
export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-[11px] font-extrabold tracking-[0.14em] uppercase border-b border-ink pb-1">{title}</h2>
      {children}
    </section>
  );
}

export type DocRow = { n?: number; description: string; details?: string | null; tag?: string | null; qty: string; rate: string; amount: string; strike?: boolean; muted?: boolean };

/** The lines table: number, description, quantity, rate, amount. On a phone the quantity and rate sit under the description. */
export function DocLines({ rows }: { rows: DocRow[] }) {
  return (
    <div className="text-sm">
      <div className="hidden sm:grid grid-cols-[1.5rem_1fr_4rem_6rem_7rem] gap-2 border-b border-line py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
        <span>#</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1.5rem_1fr_4rem_6rem_7rem] gap-x-2 gap-y-0.5 border-b border-line/70 py-1.5 ${r.muted ? "text-muted" : ""} ${r.strike ? "line-through text-muted" : ""}`}>
          <span className="hidden sm:inline text-muted">{r.n ?? i + 1}</span>
          <span className="min-w-0">
            <span className="font-semibold">{r.description}</span>
            {r.tag ? <span className="ml-1.5 rounded-control border border-ink px-1 text-[10px] font-bold uppercase tracking-wide">{r.tag}</span> : null}
            {r.details ? <span className="block text-xs text-muted">{r.details}</span> : null}
            <span className="block sm:hidden text-xs text-muted">{r.qty} × {r.rate}</span>
          </span>
          <span className="hidden sm:inline text-right">{r.qty}</span>
          <span className="hidden sm:inline text-right">{r.rate}</span>
          <span className="text-right font-bold">{r.amount}</span>
        </div>
      ))}
    </div>
  );
}

/** The totals, right-aligned like the PDF: label and amount, the total on a thick rule. */
export function DocTotals({ rows, total, after = [] }: { rows: { label: string; value: string; bold?: boolean }[]; total: { label: string; value: string }; after?: { label: string; value: string; bold?: boolean }[] }) {
  return (
    <div className="ml-auto w-full sm:w-72 text-sm">
      {rows.map((r) => (
        <div key={r.label} className={`flex justify-between py-0.5 ${r.bold ? "font-bold" : ""}`}><span className={r.bold ? "" : "text-muted"}>{r.label}</span><span>{r.value}</span></div>
      ))}
      <div className="flex justify-between border-t-2 border-ink mt-1 pt-1.5 text-lg font-extrabold"><span>{total.label}</span><span>{total.value}</span></div>
      {after.map((r) => (
        <div key={r.label} className={`flex justify-between py-0.5 ${r.bold ? "font-bold" : ""}`}><span className={r.bold ? "" : "text-muted"}>{r.label}</span><span>{r.value}</span></div>
      ))}
    </div>
  );
}
