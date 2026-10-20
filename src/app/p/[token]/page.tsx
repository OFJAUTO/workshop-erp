import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { CopyText } from "@/components/CopyText";
import { customerPageMetadata } from "@/lib/customer-pages";
import { payPageData } from "@/lib/pay-page";

export const dynamic = "force-dynamic";

const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const d = await payPageData(token);
  return customerPageMetadata("OFJ Automotive · Payment", d ? `${d.purpose} · AED ${m(d.amount)}` : "Payment page", `/p/${token}`);
}

/**
 * The payment page every pay-request message points at (1.4, 21 October 2026): the customer's first
 * name, the car, what the money is for, the AMOUNT large, then three ways to pay - Pay now (the
 * gateway link the advisor pasted; we never fetch or preview it), bank transfer with copy buttons,
 * or at the workshop. Once the money is recorded the page says Paid ✓ with the receipt.
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await payPageData(token);
  return (
    <div className="min-h-screen bg-[#E9E9EC] text-[#111113]">
      <main className="mx-auto w-full max-w-[640px] px-0 py-0 sm:px-4 sm:py-6">
        <div className="bg-white sm:shadow-sm sm:rounded-lg flex flex-col">
          <header className="sm:rounded-t-lg flex items-center justify-center bg-[#F4F4F5] border-b-[3px] border-[#111113] py-5 sm:py-7">
            <Logo className="h-14 sm:h-20 w-auto" />
          </header>
          {!d ? (
            <p className="p-6 text-sm">This link is not valid. Please ask the workshop for a new one.</p>
          ) : (
            <div className="flex flex-col gap-5 p-5 sm:p-8" data-pay-page>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#5F6368]">{d.carTitle}{d.plate ? ` · ${d.plate}` : ""}{d.number ? ` · ${d.number}` : ""}</span>
                <h1 className="text-2xl font-extrabold">Dear {d.firstName},</h1>
                <p className="text-sm text-[#5F6368]">{d.purpose}.</p>
              </div>
              <div className="rounded-lg border-2 border-[#111113] bg-[#F4F4F5] px-5 py-4 text-center">
                <span className="block text-[11px] font-bold tracking-[0.12em] uppercase text-[#5F6368]">{d.paid ? "Received" : "Amount"}</span>
                <span className="block text-4xl font-extrabold" data-pay-amount>AED {m(d.amount)}</span>
              </div>
              {d.paid ? (
                <div className="flex flex-col items-center gap-3" data-pay-paid>
                  <p className="text-lg font-extrabold text-[#1B7A3D]">Paid ✓ — thank you.</p>
                  {d.receiptHref ? <a href={d.receiptHref} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center rounded-md border border-[#111113] px-5 text-sm font-bold">Open your receipt (PDF)</a> : null}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {d.gatewayUrl ? (
                    <a href={d.gatewayUrl} className="inline-flex min-h-16 w-full items-center justify-center rounded-md bg-[#111113] text-white text-lg font-extrabold" data-pay-now>
                      Pay now
                    </a>
                  ) : null}
                  <details className="rounded-md border border-[#D9D9DE]" data-pay-bank>
                    <summary className="cursor-pointer min-h-12 px-4 flex items-center text-sm font-bold">Bank transfer</summary>
                    <div className="px-4 pb-4 flex flex-col gap-2 text-sm">
                      {[["Bank", d.bank.name], ["Account name", d.bank.accountName], ["Account number", d.bank.accountNumber], ["IBAN", d.bank.iban], ["SWIFT", d.bank.swift]].filter(([, v]) => v).map(([k, v]) => (
                        <p key={k} className="flex flex-wrap items-center gap-2"><span className="w-32 text-[#5F6368]">{k}</span><span className="font-semibold">{v}</span><CopyText text={String(v)} label="Copy" /></p>
                      ))}
                      <p className="text-xs text-[#5F6368]">Please put {d.number || "your plate"} in the transfer note.</p>
                    </div>
                  </details>
                  <details className="rounded-md border border-[#D9D9DE]" data-pay-workshop>
                    <summary className="cursor-pointer min-h-12 px-4 flex items-center text-sm font-bold">Pay at the workshop</summary>
                    <div className="px-4 pb-4 flex flex-col gap-1 text-sm">
                      <p className="font-semibold">{d.address}</p>
                      <p className="text-[#5F6368]">{d.hoursText}</p>
                      {d.mapUrl ? <a href={d.mapUrl} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">Open the map</a> : null}
                    </div>
                  </details>
                </div>
              )}
              <p className="text-[11px] text-[#5F6368]">OFJ Automotive · {d.address}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
