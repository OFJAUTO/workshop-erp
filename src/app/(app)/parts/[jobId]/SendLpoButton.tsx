"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";

/**
 * "Send LPO for approval" (1 November 2026, LPO-00038). When a line on the job is not finished yet, the button first
 * says so: "1 line not finished: TRANSMISSION MOUNT". Sending anyway leaves it off this LPO; once it is finished and
 * to order it joins the LPO waiting for approval by itself, so nothing is left out silently.
 */
export function SendLpoButton({ action, unfinished }: { action: (formData: FormData) => void | Promise<void>; unfinished: string[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [asking, setAsking] = useState(false);
  const n = unfinished.length;
  return (
    <form ref={form} action={action}>
      <Button type="button" size="lg" data-send-lpo onClick={() => (n ? setAsking(true) : form.current?.requestSubmit())}>Send LPO for approval</Button>
      {n ? <p className="mt-1 text-xs font-semibold text-amber" data-lpo-unfinished>{n} line{n === 1 ? "" : "s"} not finished: {unfinished.join(", ")}</p> : null}
      {asking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => setAsking(false)}>
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }} data-lpo-unfinished-ask>
            <span className="text-lg font-extrabold">{n} line{n === 1 ? "" : "s"} not finished</span>
            <p className="text-sm uppercase font-semibold">{unfinished.join(", ")}</p>
            <p className="text-sm text-muted">{n === 1 ? "It is" : "They are"} not on this LPO. Finish {n === 1 ? "it" : "them"} in the table: once priced and to order, {n === 1 ? "it joins" : "they join"} the LPO waiting for approval by {n === 1 ? "itself" : "themselves"}.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" tone="secondary" onClick={() => setAsking(false)} data-lpo-unfinished-back autoFocus>Go back and finish</Button>
              <Button type="button" size="md" onClick={() => { setAsking(false); form.current?.requestSubmit(); }} data-lpo-unfinished-send>Send without {n === 1 ? "it" : "them"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
