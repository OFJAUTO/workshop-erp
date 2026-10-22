/**
 * Section 11: the window tint on a customer's link page (quotation, proforma, tax invoice) when the tint is a service
 * line rather than a package item - the same words the PDF prints under that line. A package card already carries
 * the shades on its own tint items, so the page shows this card only for tint outside a package.
 */
export function TintCard({ words }: { words: string }) {
  return (
    <div className="rounded-lg border border-[#D4D4D8] px-4 py-3 flex flex-col gap-0.5" data-tint-card>
      <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Window tint</span>
      <span className="text-sm">{words}</span>
    </div>
  );
}
