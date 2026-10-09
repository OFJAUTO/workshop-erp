"use client";

import { useRef } from "react";
import { Button, Input } from "@/components/ui";

/** The invoice options: a tap on Labour itemised, One Labour charges line or Add Consumables changes the invoice at once. */
export function InvoiceOptions({ labourMode, consumables, consumablesDefault, agreed, discount, quotedDiscount }: { labourMode: "itemised" | "combined"; consumables: boolean; consumablesDefault: number; agreed: string; discount: string; quotedDiscount: number }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = () => form.current?.requestSubmit();
  return (
    <form ref={form} method="get" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <label className={`min-h-11 inline-flex items-center gap-2 rounded-control border px-3 text-sm font-bold cursor-pointer ${labourMode === "itemised" ? "border-ink bg-ink text-white" : "border-line-strong"}`}><input type="radio" name="labour" value="itemised" defaultChecked={labourMode === "itemised"} onChange={submit} className="sr-only" />Labour itemised per job</label>
        <label className={`min-h-11 inline-flex items-center gap-2 rounded-control border px-3 text-sm font-bold cursor-pointer ${labourMode === "combined" ? "border-ink bg-ink text-white" : "border-line-strong"}`}><input type="radio" name="labour" value="combined" defaultChecked={labourMode === "combined"} onChange={submit} className="sr-only" />One &quot;Labour charges&quot; line</label>
        <label className={`min-h-11 inline-flex items-center gap-2 rounded-control border px-3 text-sm font-bold cursor-pointer ${consumables ? "border-ink bg-ink text-white" : "border-line-strong"}`}><input type="checkbox" name="consumables" value="1" defaultChecked={consumables} onChange={submit} className="sr-only" />Add Consumables (AED {consumablesDefault})</label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Agreed total with VAT (optional)</span><Input name="agreed" defaultValue={agreed} inputMode="decimal" placeholder="A round final total" onBlur={submit} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Or discount % on labour and services</span><Input name="discount" defaultValue={discount} inputMode="decimal" placeholder={`quoted: ${quotedDiscount}%`} onBlur={submit} /></label>
        <div className="flex items-end"><Button type="submit" tone="secondary" size="md">Recalculate</Button></div>
      </div>
    </form>
  );
}
