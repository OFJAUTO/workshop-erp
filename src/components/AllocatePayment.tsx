"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { allocatePaymentAction, loadPaymentChoices } from "@/app/(app)/invoices/payment-anywhere-actions";
import type { PayTarget } from "@/lib/customer-money";
import { reloadIfStale } from "@/lib/app-version";

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Allocating an unallocated advance (1 November 2026, 1.8): one step. With `target` fixed (the job card, the money page:
 * "Allocate to this job") it is one tap; otherwise a small window lists the customer's open jobs and invoices. More than
 * what is left asks for a note in the same place. The answer appears where the button was.
 */
export function AllocatePayment({ paymentId, number, amount, customerId, vehicleId = null, target = null, label }: { paymentId: string; number: string; amount: number; customerId: string; vehicleId?: string | null; target?: { key: string; title: string; balance: number | null } | null; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<PayTarget[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState(target?.key ?? "");
  const [state, formAction, pending] = useActionState(allocatePaymentAction, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const openWindow = () => {
    setOpen(true);
    if (target || targets) return;
    void loadPaymentChoices({ customerId, vehicleId })
      .then((a) => {
        if (a.error) setLoadError(a.error);
        const list = (a.choices?.targets ?? []).filter((t) => t.kind !== "unallocated");
        setTargets(list);
        setPicked((p) => p || list[0]?.key || "");
      })
      .catch((e) => {
        if (!reloadIfStale(e)) setLoadError("No connection – try again.");
      });
  };
  const chosen = target ?? targets?.find((t) => t.key === picked) ?? null;
  const over = !!chosen && chosen.balance !== null && amount > chosen.balance + 0.005;

  if (state?.ok) return <span className="text-sm font-bold text-green" data-allocated={number}>✓ {state.message}</span>;

  const form = (
    <form action={formAction} className="flex flex-col gap-2" data-allocate-form={number}>
      <input type="hidden" name="payment_id" value={paymentId} />
      <input type="hidden" name="target" value={chosen?.key ?? ""} />
      {over || state?.needsNote ? (
        <label className="flex flex-col gap-1 rounded-control border-2 border-amber-bar bg-amber-soft p-2" data-over-warning>
          <span className="text-xs font-bold">{number} ({money(amount)}) is more than what is left ({money(chosen?.balance ?? state?.needsNote?.balance ?? 0)}). Write why – refund or credit. It is logged.</span>
          <Input name="over_note" required minLength={3} placeholder="e.g. the rest stays as credit for the next visit" data-over-note />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="md" disabled={!chosen || pending} data-allocate-confirm>{pending ? "Allocating…" : target ? (label ?? "Allocate to this job") : "Allocate"}</Button>
        {!target ? <Button type="button" size="md" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button> : null}
      </div>
      {state?.error ? <p className="text-xs font-semibold text-red" data-allocate-error>{state.error}</p> : null}
    </form>
  );

  // Fixed target: the button IS the form (one tap), the note appears in place when needed.
  if (target) return form;

  return (
    <>
      <Button type="button" size="md" tone="secondary" onClick={openWindow} data-allocate-open={number}>{label ?? "Allocate"}</Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label={`Allocate ${number}`} data-allocate-dialog>
          <div className="w-full max-w-xl rounded-card bg-white p-5 shadow-xl flex flex-col gap-3 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-extrabold">Allocate {number} · {money(amount)}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="min-h-11 min-w-11 shrink-0 rounded-control border border-line-strong text-lg font-bold">✕</button>
            </div>
            {loadError ? <p className="text-sm font-semibold text-red">{loadError}</p> : null}
            {!targets && !loadError ? <p className="text-sm text-muted">Loading…</p> : null}
            {targets && !targets.length ? <p className="text-sm text-muted">This customer has no open job or invoice to allocate it to. It stays on the customer&apos;s account.</p> : null}
            {targets?.length ? (
              <div className="flex flex-col gap-2">
                {targets.map((t) => (
                  <button key={t.key} type="button" onClick={() => setPicked(t.key)} aria-pressed={picked === t.key} data-allocate-target={t.key} className={`min-h-12 rounded-control border-2 px-3 py-2 text-left flex flex-col ${picked === t.key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                    <span className="text-sm font-bold uppercase">{t.title}</span>
                    <span className={`text-xs ${picked === t.key ? "text-white/80" : "text-muted"}`}>{t.detail}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {targets?.length ? form : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
