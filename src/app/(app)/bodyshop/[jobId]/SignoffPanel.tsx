"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { SIGNOFF_LABELS, type SignoffKey } from "@/lib/bodyshop-kinds";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The release sign-off: one row per person needed. A tap opens the PIN box (the owner needs none); signed rows turn
 * green with the name and time. "Not ready" asks for a short reason and sends the car back to that section's stage.
 */
export function SignoffPanel({ needed, signed, mine, isOwner, canAct, onSign, onNotReady }: { needed: SignoffKey[]; signed: { role_key: SignoffKey; name: string; signed_at: string; on_behalf: boolean }[]; mine: SignoffKey | null; isOwner: boolean; canAct: boolean; onSign: Action; onNotReady: Action }) {
  const [open, setOpen] = useState<SignoffKey | null>(null);
  const [notReady, setNotReady] = useState<SignoffKey | null>(null);
  const waiting = needed.filter((k) => !signed.some((s) => s.role_key === k));
  return (
    <div className="flex flex-col gap-3" data-signoff-panel>
      <p className="text-sm" data-waiting-on>{waiting.length ? <>Waiting on: <span className="font-bold">{waiting.map((k) => SIGNOFF_LABELS[k]).join(", ")}</span>. The handover stays locked until all have signed.</> : <span className="font-bold text-green">Every sign-off is in. The car can be handed over.</span>}</p>
      <ul className="divide-y divide-line">
        {needed.map((k) => {
          const s = signed.find((x) => x.role_key === k);
          const may = canAct && (isOwner || mine === k);
          return (
            <li key={k} className="py-2 flex flex-wrap items-center gap-2" data-signoff-row={k} data-signed={!!s}>
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold ${s ? "bg-green text-white" : "border border-line-strong text-transparent"}`}>✓</span>
              <span className="font-semibold">{SIGNOFF_LABELS[k]}</span>
              {s ? <span className="text-xs text-muted">signed by {s.name}{s.on_behalf ? " (owner, on behalf)" : ""} · {new Date(s.signed_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
              {!s && may ? (
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  {open === k ? (
                    <form action={onSign} className="flex items-center gap-2">
                      <input type="hidden" name="role_key" value={k} />
                      {!isOwner ? <Input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="PIN" autoFocus required className="w-20 text-center tracking-[0.3em]" aria-label="Your PIN" data-signoff-pin /> : null}
                      <Button type="submit" size="md" data-signoff-confirm>{isOwner ? `Sign${mine === k ? "" : " on behalf"}` : "Sign"}</Button>
                      <Button type="button" tone="ghost" size="md" onClick={() => setOpen(null)}>Cancel</Button>
                    </form>
                  ) : notReady === k ? (
                    <form action={onNotReady} className="flex items-center gap-2">
                      <input type="hidden" name="role_key" value={k} />
                      <Input name="reason" placeholder="What is not ready?" autoFocus required className="w-56" textCase="sentence" aria-label="Reason" data-not-ready-reason />
                      <Button type="submit" tone="secondary" size="md" data-not-ready-confirm>Send back</Button>
                      <Button type="button" tone="ghost" size="md" onClick={() => setNotReady(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <Button type="button" size="md" onClick={() => { setNotReady(null); setOpen(k); }} data-signoff-open={k}>Sign off</Button>
                      <Button type="button" tone="secondary" size="md" onClick={() => { setOpen(null); setNotReady(k); }} data-not-ready-open={k}>Not ready</Button>
                    </>
                  )}
                </span>
              ) : !s ? <span className="ml-auto text-xs text-muted">Waiting</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
