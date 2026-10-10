import type { ReactNode } from "react";
import { Logo } from "./Logo";

export type DocMeta = { label: string; value: string };
export type DocBox = { title: string; strong: string; rows: [string, string | null | undefined][]; muted?: (string | null | undefined)[] };
type Company = { tradingName: string; legalName: string; legalNameAr?: string | null; address: string[]; phone: string; email: string; website: string; trn: string };

/**
 * The look of every page a customer opens from a link, the same as the PDF and docs/ofj-invoice-design.html:
 * white header with the logo on the left, the legal name and address beside the large TRN, a thick rule;
 * the title with its numbers; two pale boxes; the sections; the footer row and the contact row. On a
 * phone the tables reshape; on a PC it reads like the A4 page. A sticky bar at the bottom can hold buttons.
 */
export function CustomerDocument({ company, title, meta, boxes, pdfHref, pdfLabel = "Download PDF", bar, footer, preparedBy, children }: { company: Company; title: string; meta: DocMeta[]; boxes: DocBox[]; pdfHref?: string | null; pdfLabel?: string; bar?: ReactNode; footer?: ReactNode; preparedBy?: string | null; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#E9E9EC] text-[#111113]">
      <main className={`mx-auto w-full max-w-[794px] px-0 py-0 sm:px-4 sm:py-6 ${bar ? "pb-32" : "pb-10"}`}>
        <div className="bg-white sm:shadow-sm px-4 sm:px-11 flex flex-col">
          <header className="flex items-center justify-between gap-4 border-b-[3px] border-[#111113] pt-6 pb-4 sm:pt-[30px] sm:pb-[18px]">
            <Logo className="h-12 sm:h-20 w-auto" alt={company.tradingName} />
            <div className="flex items-stretch gap-3 sm:gap-[22px] text-[10px] sm:text-[10.5px] leading-[1.6]">
              <div className="flex flex-col">
                <span className="text-[11px] sm:text-xs font-bold tracking-[0.02em]">{company.legalName}</span>
                {company.address.map((a) => <span key={a} className="text-[#5F6368]">{a}</span>)}
              </div>
              <div className="border-l border-[#D4D4D8] pl-3 sm:pl-[22px] flex flex-col justify-center gap-0.5">
                <span className="text-[9px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Tax registration no.</span>
                <span className="text-sm sm:text-[15px] font-extrabold tracking-[0.03em] leading-[1.2]">{company.trn}</span>
              </div>
            </div>
          </header>
          <div className="flex flex-col gap-[18px] pt-[26px] pb-6 flex-1">
            <section className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-[0.02em] leading-none uppercase">{title}</h1>
              <div className="flex flex-wrap justify-end gap-x-[22px] gap-y-1 text-right">
                {meta.map((m) => (
                  <div key={m.label} className="flex flex-col">
                    <span className="text-[9.5px] font-semibold tracking-[0.08em] uppercase text-[#5F6368]">{m.label}</span>
                    <span className="text-[13px] font-bold">{m.value}</span>
                  </div>
                ))}
              </div>
            </section>
            {boxes.length ? (
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {boxes.map((b) => (
                  <div key={b.title} className="rounded-lg bg-[#F4F4F5] px-4 py-3.5 flex flex-col gap-[3px] text-xs">
                    <span className="text-[9.5px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{b.title}</span>
                    <span className="text-sm font-bold">{b.strong}</span>
                    {b.rows.filter(([, v]) => v).map(([k, v]) => (
                      <span key={k}><span className="text-[#5F6368]">{k} </span>{v}</span>
                    ))}
                    {(b.muted ?? []).filter(Boolean).map((m) => <span key={m as string} className="text-[#5F6368]">{m}</span>)}
                  </div>
                ))}
              </section>
            ) : null}
            {children}
            {pdfHref ? <a href={pdfHref} className="self-start inline-flex min-h-11 items-center rounded-lg border-2 border-[#111113] px-4 text-sm font-bold">{pdfLabel}</a> : null}
          </div>
          <footer className="mt-auto border-t border-[#D4D4D8] pt-3.5 pb-3 flex flex-wrap justify-between gap-4 text-[10px] text-[#5F6368]">
            <div className="flex flex-col gap-[3px]">
              {preparedBy ? <span className="text-[#111113] font-semibold">Prepared by {preparedBy}</span> : null}
              <span>This is a computer generated document which requires no stamp and signature.</span>
              {footer ? <span>{footer}</span> : null}
              <span>Terms and conditions apply · erp.ofjauto.com/terms</span>
            </div>
          </footer>
          <div className="border-t-[3px] border-[#111113] pt-2.5 pb-5 flex flex-wrap justify-center items-baseline gap-x-[34px] gap-y-1 text-[10.5px]">
            {company.phone ? <span><span className="text-[9px] font-bold tracking-[0.1em] uppercase text-[#5F6368] mr-2">Tel</span>{company.phone}</span> : null}
            {company.website ? <span><span className="text-[9px] font-bold tracking-[0.1em] uppercase text-[#5F6368] mr-2">Web</span>{company.website}</span> : null}
            {company.email ? <span><span className="text-[9px] font-bold tracking-[0.1em] uppercase text-[#5F6368] mr-2">Email</span>{company.email}</span> : null}
          </div>
        </div>
      </main>
      {bar ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D4D4D8] bg-white/95 backdrop-blur px-3 py-3 sm:px-6"><div className="mx-auto w-full max-w-[794px]">{bar}</div></div> : null}
    </div>
  );
}

/** A section of the document: an upper-case title over a thick rule. For tables, DocLines carries the title in its header row instead. */
export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-[9.5px] font-bold tracking-[0.08em] uppercase text-[#5F6368] border-b-2 border-[#111113] pb-1.5">{title}</h2>
      {children}
    </section>
  );
}

export type DocRow = { n?: number; description: string; details?: string | null; tag?: string | null; qty: string; rate: string; amount: string; amountNum?: number; strike?: boolean; muted?: boolean };

const digits = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A lines table in the design's shape: the section name in the header row, then #, description, Qty,
 * Rate, Amount, VAT and Total; a bold discount row when there is one; a pale subtotal row. On a phone
 * the quantity and rate sit under the description and only the total shows on the right.
 */
export function DocLines({ title, rows, vatPercent = 5, discount = null, subtotalLabel }: { title?: string; rows: DocRow[]; vatPercent?: number; discount?: { label: string; amount: number } | null; subtotalLabel?: string }) {
  const nums = rows.map((r) => r.amountNum ?? 0);
  const amount = nums.reduce((a, b) => a + b, 0) - (discount?.amount ?? 0);
  const vatOf = (n: number) => Math.round(n * vatPercent) / 100;
  const dVat = discount ? vatOf(discount.amount) : 0;
  const grid = "grid-cols-[1fr_auto] sm:grid-cols-[1.5rem_1fr_3.4rem_4.75rem_5.25rem_4.4rem_5.5rem]";
  return (
    <div className="text-xs">
      <div className={`grid ${grid} gap-x-2 border-b-2 border-[#111113] pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#5F6368]`}>
        <span className="hidden sm:inline">#</span><span>{title ?? "Description"}</span><span className="hidden sm:inline text-right">Qty</span><span className="hidden sm:inline text-right">Rate</span><span className="hidden sm:inline text-right">Amount</span><span className="hidden sm:inline text-right">VAT {vatPercent}%</span><span className="text-right">Total AED</span>
      </div>
      {rows.map((r, i) => {
        const a = r.amountNum ?? 0;
        const v = vatOf(a);
        const free = r.amount === "Complimentary";
        return (
          <div key={i} className={`grid ${grid} gap-x-2 gap-y-0.5 border-b border-[#E4E4E7] py-[7px] ${r.muted ? "text-[#5F6368]" : ""} ${r.strike ? "line-through text-[#5F6368]" : ""}`}>
            <span className="hidden sm:inline text-[#5F6368]">{r.n ?? i + 1}</span>
            <span className="min-w-0">
              <span className="font-semibold">{r.description}</span>
              {r.tag ? <span className="ml-1.5 rounded border border-[#111113] px-1 text-[9px] font-bold uppercase tracking-wide">{r.tag}</span> : null}
              {r.details ? <span className="block text-[11px] text-[#5F6368]">{r.details}</span> : null}
              <span className="block sm:hidden text-[11px] text-[#5F6368]">{r.qty} × {r.rate}</span>
            </span>
            <span className="hidden sm:inline text-right">{r.qty}</span>
            <span className="hidden sm:inline text-right">{r.rate}</span>
            {free ? (
              <span className="text-right text-[#5F6368] sm:col-span-3">Complimentary</span>
            ) : (
              <>
                <span className="hidden sm:inline text-right">{digits(a)}</span>
                <span className="hidden sm:inline text-right">{digits(v)}</span>
                <span className="text-right font-semibold">{digits(a + v)}</span>
              </>
            )}
          </div>
        );
      })}
      {discount && discount.amount ? (
        <div className={`grid ${grid} gap-x-2 border-b border-[#E4E4E7] py-[7px] font-extrabold`}>
          <span className="hidden sm:inline" /><span className="sm:col-span-3">{discount.label}</span><span className="hidden sm:inline text-right">−{digits(discount.amount)}</span><span className="hidden sm:inline text-right">−{digits(dVat)}</span><span className="text-right font-semibold">−{digits(discount.amount + dVat)}</span>
        </div>
      ) : null}
      {subtotalLabel ? (
        <div className={`grid ${grid} gap-x-2 bg-[#F4F4F5] py-[7px] font-bold`}>
          <span className="hidden sm:inline pl-2" /><span className="pl-2 sm:pl-0 sm:col-span-3">{subtotalLabel}</span><span className="hidden sm:inline text-right">{digits(amount)}</span><span className="hidden sm:inline text-right">{digits(vatOf(amount))}</span><span className="text-right pr-2">{digits(amount + vatOf(amount))}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The totals, right-aligned like the PDF: label and amount, "Total AED" on a thick rule, then the outlined balance box. */
export function DocTotals({ rows, total, after = [], box }: { rows: { label: string; value: string; bold?: boolean }[]; total: { label: string; value: string }; after?: { label: string; value: string; bold?: boolean }[]; box?: { label: string; value: string | null; note?: string | null } | null }) {
  return (
    <div className="ml-auto w-full sm:w-[262px] text-xs flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className={`flex justify-between ${r.bold ? "font-extrabold" : ""}`}><span className={r.bold ? "" : "text-[#5F6368]"}>{r.label}</span><span>{r.value}</span></div>
      ))}
      <div className="flex justify-between border-t-2 border-[#111113] pt-2 text-[15px] font-extrabold"><span>{total.label}</span><span>{total.value}</span></div>
      {after.map((r) => (
        <div key={r.label} className={`flex justify-between ${r.bold ? "font-extrabold" : ""}`}><span className={r.bold ? "" : "text-[#5F6368]"}>{r.label}</span><span>{r.value}</span></div>
      ))}
      {box ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-[#111113] px-3 py-[9px] font-extrabold">
          <span className="flex flex-col"><span className="text-[11px] tracking-[0.08em] uppercase">{box.label}</span>{box.note ? <span className="text-[10px] font-medium text-[#5F6368]">{box.note}</span> : null}</span>
          {box.value ? <span className="text-base">{box.value}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
