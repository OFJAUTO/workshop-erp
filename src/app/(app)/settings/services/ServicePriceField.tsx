"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

/**
 * How a ready-made service is priced: by hours (the advisor's rate applies) or at a fixed price.
 * One tap picks the way, one box takes the number; the server stores it in the right column.
 */
export function ServicePriceField({ priceAed, defaultHours }: { priceAed: number | null; defaultHours: number | null }) {
  const [mode, setMode] = useState<"hours" | "fixed">(priceAed !== null ? "fixed" : "hours");
  const [value, setValue] = useState(priceAed !== null ? String(priceAed) : defaultHours !== null ? String(defaultHours) : "");
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">Price</span>
      <input type="hidden" name="pricing" value={mode} />
      <div className="grid grid-cols-2 gap-2">
        {([["hours", "By hours"], ["fixed", "Fixed price"]] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setMode(m); setValue(""); }} aria-pressed={mode === m} className={`min-h-11 rounded-control border-2 text-sm font-bold ${mode === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{label}</button>
        ))}
      </div>
      <Input name="price_value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={mode === "hours" ? "Hours, for example 1.5 (empty: the advisor types them)" : "AED, for example 350"} aria-label={mode === "hours" ? "Hours" : "Fixed price in AED"} />
      <span className="text-xs text-muted">{mode === "hours" ? "Charged at the labour rate for the car. 0.1 steps. Leave empty if the hours differ every time." : "One price whatever the hours; parts are extra."}</span>
    </div>
  );
}
