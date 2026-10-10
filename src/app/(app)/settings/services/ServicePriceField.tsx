"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

const PER = ["job", "tyre", "wheel", "injector", "cylinder", "axle", "unit"];

/**
 * How a ready-made service is priced: by hours (the advisor's rate applies) or at a fixed price.
 * One tap picks the way, one box takes the number. A fixed price says what it is per (job, tyre,
 * wheel and so on), the usual quantity, and the time allowance that feeds the technician's countdown.
 */
export function ServicePriceField({ priceAed, defaultHours, pricePer = "job", usualQuantity = 1, timeAllowance = null }: { priceAed: number | null; defaultHours: number | null; pricePer?: string | null; usualQuantity?: number | null; timeAllowance?: number | null }) {
  const [mode, setMode] = useState<"hours" | "fixed">(priceAed !== null ? "fixed" : "hours");
  const [value, setValue] = useState(priceAed !== null ? String(priceAed) : defaultHours !== null ? String(defaultHours) : "");
  const initialPer = (pricePer ?? "job").toLowerCase();
  const [per, setPer] = useState(PER.includes(initialPer) ? initialPer : "other");
  const [perOther, setPerOther] = useState(PER.includes(initialPer) ? "" : initialPer);
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
      <span className="text-xs text-muted">{mode === "hours" ? "Charged at the labour rate for the car. 0.1 steps. Leave empty if the hours differ every time." : "One price per unit below; parts are extra."}</span>
      {mode === "fixed" ? (
        <div className="flex flex-col gap-2 rounded-control bg-chip p-3">
          <span className="text-xs font-semibold text-muted">Price is per</span>
          <input type="hidden" name="price_per" value={per === "other" ? perOther : per} />
          <div className="flex flex-wrap gap-1.5">
            {[...PER, "other"].map((p) => (
              <button key={p} type="button" onClick={() => setPer(p)} aria-pressed={per === p} className={`min-h-9 rounded-control border px-3 text-xs font-bold ${per === p ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{p === "other" ? "My own word" : p[0].toUpperCase() + p.slice(1)}</button>
            ))}
          </div>
          {per === "other" ? <Input name="price_per_other" value={perOther} onChange={(e) => setPerOther(e.target.value)} placeholder="For example: door" className="w-56" /> : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Usual quantity{per === "job" ? " (per job: 1)" : ""}<Input name="usual_quantity" defaultValue={String(usualQuantity ?? 1)} inputMode="numeric" disabled={per === "job"} /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Time allowance (hours per {per === "other" ? perOther || "unit" : per})<Input name="time_allowance_hours" defaultValue={timeAllowance === null ? "" : String(timeAllowance)} inputMode="decimal" placeholder="For example 0.3" /></label>
          </div>
          <span className="text-[11px] text-muted">The technician&apos;s countdown gets the allowance times the quantity; the price never changes with it.</span>
        </div>
      ) : null}
    </div>
  );
}
