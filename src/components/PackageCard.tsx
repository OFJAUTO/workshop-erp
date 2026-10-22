import type { PackageDoc } from "@/lib/packages";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Section 9 (21 October): the PROTECTION PACKAGE card on the customer's links (estimate, quotation,
 * proforma, tax invoice). The same model as the PDF section (packageDocOf): the name large, "finish ·
 * car", the package price, what's included with a green tick and the warranty in its own column, the
 * complimentary extras as green badges, the estimated completion, and the package subtotal.
 */
export function PackageCard({ doc, price, subtotal, discount = null }: { doc: PackageDoc; price: number; subtotal: number; discount?: { percent: number | null; amount: number } | null }) {
  return (
    <section className="overflow-hidden rounded-lg border-2 border-[#111113] bg-white" data-package-doc>
      <div className="bg-[#111113] px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white">Protection package</div>
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <div className="text-xl font-extrabold leading-tight" data-package-title>{doc.title}</div>
          {doc.subtitle ? <div className="mt-0.5 text-sm text-[#5F6368]" data-package-subtitle>{doc.subtitle}</div> : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#5F6368]">Package price</div>
          <div className="text-lg font-extrabold" data-package-price>{aed(price)}</div>
          {discount && discount.amount > 0.004 ? <div className="text-xs font-extrabold text-green">Discount{discount.percent ? ` ${discount.percent}%` : ""}: −{aed(discount.amount)}</div> : null}
        </div>
      </div>
      {doc.items.length ? (
        <div className="px-4">
          <div className="flex justify-between border-b-2 border-[#111113] pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#5F6368]">
            <span>What&apos;s included</span>
            <span>Warranty</span>
          </div>
          <ul>
            {doc.items.map((i) => (
              <li key={i.label} className="flex items-start justify-between gap-3 border-b border-[#E4E4E7] py-2.5 text-[15px]" data-package-item-doc>
                <span className="flex min-w-0 items-start gap-2">
                  <span className="font-extrabold text-green" aria-hidden>✓</span>
                  <span className="flex min-w-0 flex-col">
                    <span>{i.label}</span>
                    {i.note ? (
                      <span className="text-xs font-bold" data-cut-note>
                        {i.note}
                        {doc.explain ? (
                          <details className="inline">
                            <summary className="ml-1 inline cursor-pointer list-none text-[#5F6368]" aria-label="What does this mean?" data-cut-info>ⓘ</summary>
                            <span className="mt-1 block text-xs font-normal text-[#5F6368]" data-cut-explain>{doc.explain}</span>
                          </details>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm text-[#5F6368]">{i.warranty ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {doc.complimentary.length ? (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {doc.complimentary.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-green-soft px-3 py-1 text-xs font-bold text-green" data-package-badge>✓ {c}</span>
          ))}
        </div>
      ) : null}
      {doc.completion ? <p className="px-4 pb-1 pt-3 text-sm font-bold" data-package-completion>Estimated completion: {doc.completion}</p> : null}
      <div className="mt-3 flex justify-between bg-[#F4F4F5] px-4 py-2.5 text-sm font-extrabold">
        <span>Package subtotal</span>
        <span>{aed(subtotal)}</span>
      </div>
    </section>
  );
}
