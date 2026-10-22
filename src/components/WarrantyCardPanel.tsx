import { Logo } from "@/components/Logo";

/**
 * Section 12: the framed "YOUR OFJ WARRANTY" panel on the customer's tax invoice page - the same panel as on the
 * PDF (src/lib/pdf/template.tsx WarrantyPanel): the OFJ logo, a large QR to the warranty page, the certificate
 * number and the status. On a phone the panel itself opens the warranty page (a screen cannot scan itself).
 */
export function WarrantyCardPanel({ href, qr, certificateNo, car, status }: { href: string; qr: string | null; certificateNo: string; car: string; status: { kind: string; title: string } }) {
  const tone = status.kind === "active" ? "bg-green-soft text-green" : status.kind === "not_activated" ? "bg-red-soft text-red" : status.kind === "pending" ? "bg-amber-soft text-amber" : "bg-[#F4F4F5] text-[#5F6368]";
  return (
    <a href={href} className="block rounded-xl border-2 border-[#111113] bg-white p-1" data-warranty-panel>
      <div className="flex flex-col items-center gap-4 rounded-lg border border-[#A1A1AA] px-5 py-5 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-center sm:text-left">
          <Logo className="mx-auto h-9 w-auto sm:mx-0" />
          <span className="mt-2 text-xl font-extrabold tracking-[0.12em]">YOUR OFJ WARRANTY</span>
          <span className="text-sm text-[#5F6368]">Scan to view and verify your warranty</span>
          <span className="mt-2 border-t border-[#D4D4D8] pt-2 text-xs">Certificate no. {certificateNo} · {car}</span>
          <span className={`mt-1 inline-flex w-fit self-center rounded-full px-3 py-1 text-xs font-extrabold sm:self-start ${tone}`} data-warranty-panel-status={status.kind}>{status.title}</span>
        </div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code to your OFJ warranty" className="h-40 w-40 shrink-0" />
        ) : null}
      </div>
    </a>
  );
}
