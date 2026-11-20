"use client";

import { useActionState } from "react";
import { saveRoundingLimitAction, type PayState } from "@/app/(app)/parts/supplier-payment-actions";
import { Button, Input } from "@/components/ui";

/** The rounding limit on supplier payments (20 November 2026, Section 3): owner and accounts set it. */
export function RoundingLimitBox({ limit }: { limit: number }) {
  const [state, action, pending] = useActionState<PayState, FormData>(saveRoundingLimitAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm" data-rounding-limit>
      <span className="font-semibold">Rounding on a supplier payment closes an invoice up to AED</span>
      <Input name="limit" defaultValue={limit.toFixed(2)} inputMode="decimal" spell={false} style={{ width: "5.5rem" }} aria-label="Rounding limit in AED" data-rounding-limit-input />
      <Button type="submit" size="md" tone="secondary" disabled={pending}>Save</Button>
      <span className="text-xs text-muted">More than this: a discount from the supplier, or still owed, with a reason.</span>
      {state?.error ? <span className="text-xs font-bold text-red">{state.error}</span> : null}
      {state?.ok ? <span className="text-xs font-bold text-green-text" data-rounding-limit-done>{state.message}</span> : null}
    </form>
  );
}
