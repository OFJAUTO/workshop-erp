"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AuthCodeInput } from "@/components/AuthCodeInput";
import { ReleaseFormLock } from "@/components/forms";
import { Badge, Button } from "@/components/ui";
import { addAuthCodeAction } from "@/app/(app)/invoices/actions";
import { AUTH_MISSING_WORDS, authCodeRefusal, authMissingWhy } from "@/lib/auth-code";
import { reloadIfStale } from "@/lib/app-version";

type Answer = { ok?: boolean; error?: string; message?: string; at?: number };

/*
 * The answer window (review, 3 November 2026). On a money list (Invoices and payments, the accounts dashboard) the flag
 * sits on a row that the saved code itself takes away - the row's flag strip empties, and under the "Auth code missing"
 * chip the whole row leaves the list - so the answer is shown in a centre window held here, outside every row, until
 * the person taps OK. One window for the whole page: `AuthAddedWindow` is mounted once in the app layout.
 */
type Added = { number: string; message: string; label: string | null };
let added: Added | null = null;
const listeners = new Set<() => void>();
const announce = (a: Added | null) => {
  added = a;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The centre window "Auth code saved ✓" for a code added on a money list row. Mounted once, in the app layout. */
export function AuthAddedWindow() {
  const a = useSyncExternalStore(subscribe, () => added, () => null);
  useEffect(() => {
    if (!a) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") announce(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);
  if (!a) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Auth code saved" onClick={() => announce(null)} data-auth-added-window={a.number}>
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-green-text">Auth code saved ✓</h2>
        <p className="text-sm font-semibold" data-auth-added-message>{a.message}</p>
        {a.label ? <p className="text-sm text-muted">{a.label}</p> : null}
        <p className="text-sm text-muted">The amber &quot;{AUTH_MISSING_WORDS}&quot; flag is gone from this receipt. Nothing was recorded again.</p>
        <Button type="button" size="lg" onClick={() => announce(null)} autoFocus data-auth-added-ok>OK</Button>
      </div>
    </div>
  );
}

/**
 * THE "Auth code missing" flag (3 November 2026, section 5): the amber badge on a card or payment-link payment saved
 * without a real auth code, wherever payments are listed inside the ERP (the money page, the invoice page, Invoices and
 * payments, money not allocated). Internal only, never on a customer document. The owner and accounts get "Add auth
 * code" (never while viewing as someone else): the real code is saved on the same receipt, nothing is recorded again,
 * the answer shows here - and, on a money list row that the save takes away (`answerWindow`), in the centre window too.
 */
export function AuthCodeMissing({ paymentId, number, method, code = null, canAdd, label = null, answerWindow = false }: { paymentId: string; number: string; method: string; /** What is stored (null, or the made-up code) - for the tooltip. */ code?: string | null; canAdd: boolean; /** Words before the badge ("RCT-00040 · AED 30,000.00 · Payment link") where the row does not already say them. */ label?: string | null; /** A money list row: the save removes the flag's row, so the answer also opens the centre window. */ answerWindow?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  // A made-up code is never saved here: the box names it in red and Save waits for a real one.
  const refused = authCodeRefusal(method, value);

  // Called straight (not as a form action): React resets a form after its action, which would blank the typed code.
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || refused) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("payment_id", paymentId);
    fd.set("auth_code", value);
    const r = await addAuthCodeAction(null, fd).catch((err) => ({ error: reloadIfStale(err) ? "A new version is loading – nothing was saved, try again in a moment." : "No connection – nothing was saved. Try again.", at: Date.now() }) as Answer);
    setBusy(false);
    setAnswer(r);
    if (r.ok) {
      if (answerWindow) announce({ number, message: r.message ?? `Auth code saved on ${number}.`, label });
      router.refresh();
    }
  };

  if (answer?.ok) return <span className="text-xs font-bold text-green-text" data-auth-added={number}>✓ {answer.message}</span>;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2" data-auth-missing={number}>
      {label ? <span className="text-xs font-semibold">{label}</span> : null}
      <span className="inline-flex" title={`${authMissingWhy(code)} – add it, or the bank's settlement report fills it in.`}><Badge tone="amber">{AUTH_MISSING_WORDS}</Badge></span>
      {canAdd && !open ? (
        <Button type="button" size="md" tone="secondary" onClick={() => setOpen(true)} data-auth-add={number}>
          Add auth code
        </Button>
      ) : null}
      {canAdd && open ? (
        <form onSubmit={(e) => void save(e)} className="flex max-w-full flex-wrap items-end gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-2" data-auth-add-form={number}>
          <AuthCodeInput method={method} value={value} onChange={setValue} required />
          <Button type="submit" size="md" disabled={busy || value.length !== 6 || !!refused} data-auth-add-save>{busy ? "Saving…" : `Save on ${number}`}</Button>
          <Button type="button" size="md" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          {answer?.error ? <span className="basis-full text-xs font-semibold text-red" data-auth-add-error>{answer.error}<ReleaseFormLock key={answer.at} /></span> : null}
        </form>
      ) : null}
    </span>
  );
}
