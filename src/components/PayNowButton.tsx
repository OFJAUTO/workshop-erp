"use client";

import { useState } from "react";

/**
 * "Pay now" on the customer's proforma. The payment link works once, so the button asks first and
 * posts to our own route, which records the opening and sends the browser on. Nothing on the page
 * holds the address.
 */
export function PayNowButton({ token, amountText, once = true }: { token: string; amountText: string; /** A pasted link opens once and asks first; a Network International page opens straight away, as often as needed until paid. */ once?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!once) {
    return (
      <form method="post" action={`/api/pay/${token}`} className="flex flex-col gap-1" data-pay-now="card">
        <button type="submit" className="flex min-h-16 w-full items-center justify-center rounded-lg bg-[#111113] px-4 text-lg font-extrabold text-white">Pay now · {amountText}</button>
        <span className="text-center text-xs text-[#5F6368]">Card payment on a secure page by Network International.</span>
      </form>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setAsking(true)} className="flex min-h-16 w-full items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-lg font-extrabold">
        Pay now · {amountText}
      </button>
      {asking ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => setAsking(false)}>
          <form method="post" action={`/api/pay/${token}`} className="w-full max-w-md rounded-lg bg-white p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <span className="text-lg font-extrabold">This payment link can be opened once.</span>
            <p className="text-sm">Open it now and complete your payment?</p>
            <button type="submit" className="min-h-14 w-full rounded-lg bg-[#111113] text-base font-extrabold text-white">Pay now</button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-11 w-full rounded-lg border border-[#D4D4D8] text-sm font-bold">Not yet</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
