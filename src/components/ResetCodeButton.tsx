"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { reloadIfStale } from "@/lib/app-version";
import { giveResetCode } from "@/app/(app)/team/passkey-actions";

/** The owner's one-time sign-in code for a lost phone (9 November 2026): shown once, here, with its time limit. */
export function ResetCodeButton({ staffId, name }: { staffId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ code?: string; until?: string; error?: string } | null>(null);
  async function make() {
    setBusy(true);
    try {
      setAnswer(await giveResetCode(staffId));
    } catch (e) {
      if (!reloadIfStale(e)) setAnswer({ error: "No connection. Try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" data-reset-code>
      <p className="text-sm font-semibold">Lost phone</p>
      <p className="text-xs text-muted">Give {name} a one-time sign-in code: it works once, for 15 minutes, and takes them straight to setting up the new phone. Tell them the code in person or by phone call.</p>
      <div><Button type="button" size="md" tone="secondary" disabled={busy} onClick={() => void make()} data-reset-code-give>{busy ? "Making…" : "Give a one-time sign-in code"}</Button></div>
      {answer?.code ? <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-lg font-extrabold tracking-widest text-green-text" data-reset-code-value>{answer.code}<span className="ml-2 text-xs font-semibold tracking-normal">valid until {new Date(answer.until ?? "").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}</span></p> : null}
      {answer?.error ? <p className="text-sm font-semibold text-red" data-reset-code-error>{answer.error}</p> : null}
    </div>
  );
}
