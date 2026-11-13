"use client";

import { ActionForm, type FormAction } from "./forms";
import { Button, controlClass } from "./ui";

/** "Invoice later allowed" on a supplier (13 November 2026): owner and accounts only, at most 5 days. */
export function SupplierInvoiceLater({ allowed, days, action }: { allowed: boolean; days: number; action: FormAction }) {
  return (
    <ActionForm action={action} className="mt-2 flex flex-wrap items-end gap-3 rounded-control bg-surface p-3">
      {() => (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="allowed" defaultChecked={allowed} className="h-5 w-5" data-invoice-later-allowed />
            Invoice later allowed
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Days (1 to 5)</span>
            <input name="days" type="number" min={1} max={5} defaultValue={days} className={controlClass} style={{ width: "6rem" }} data-invoice-later-days />
          </label>
          <Button type="submit" size="md" tone="secondary" data-invoice-later-save>Save</Button>
        </>
      )}
    </ActionForm>
  );
}
