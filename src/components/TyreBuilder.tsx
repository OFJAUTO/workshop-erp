"use client";

import { useState } from "react";
import { TyreSizeInput } from "@/components/TyreSizeInput";
import { Button, Input } from "@/components/ui";
import { TYRE_MARKS, tyreName, tyreSpecComplete, tyreYears, type TyreSpec } from "@/lib/tyres";

const chip = (on: boolean) => `min-h-10 rounded-control border px-3 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;

/**
 * The tyre details window on a Parts row: brand (one tap, or typed), model per brand (one tap, or typed), the size as
 * three boxes prefilled from the car, the DOT year with one tap, and the chips Run-flat, MO, N0, AO, ★. The name is
 * built live and goes on the row with Apply. New brands and models are remembered for next time.
 */
export function TyreBuilder({ initial, defaultSize, brands, models, onApply, onClose }: { initial: TyreSpec | null; defaultSize: string; brands: string[]; models: Record<string, string[]>; onApply: (spec: TyreSpec) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<TyreSpec>(initial ?? { brand: "", model: "", size: defaultSize, year: "", marks: [] });
  const [otherBrand, setOtherBrand] = useState(initial?.brand && !brands.some((b) => b.toLowerCase() === initial.brand.toLowerCase()) ? initial.brand : "");
  const brandModels = Object.entries(models).find(([b]) => b.toLowerCase() === spec.brand.toLowerCase())?.[1] ?? [];
  const set = (p: Partial<TyreSpec>) => setSpec((s) => ({ ...s, ...p }));
  const toggleMark = (m: string) => set({ marks: spec.marks.includes(m) ? spec.marks.filter((x) => x !== m) : [...spec.marks, m] });
  const complete = tyreSpecComplete(spec);
  const name = tyreName(spec);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Tyre details" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-tyre-builder>
        <div className="flex items-start justify-between gap-3">
          <span className="text-lg font-extrabold">Tyre details</span>
          <button type="button" onClick={onClose} className="min-h-11 rounded-control px-3 text-sm font-bold text-muted hover:bg-chip">Close</button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Brand</span>
          <div className="flex flex-wrap gap-1.5" data-tyre-brands>
            {brands.filter((b) => !/^other$/i.test(b)).map((b) => (
              <button key={b} type="button" onClick={() => { set({ brand: b, model: spec.brand.toLowerCase() === b.toLowerCase() ? spec.model : "" }); setOtherBrand(""); }} aria-pressed={spec.brand.toLowerCase() === b.toLowerCase()} className={chip(spec.brand.toLowerCase() === b.toLowerCase())}>
                {b}
              </button>
            ))}
          </div>
          <Input value={otherBrand} onChange={(e) => { setOtherBrand(e.target.value); set({ brand: e.target.value, model: "" }); }} placeholder="Another brand: type it (saved for next time)" aria-label="Other brand" data-tyre-brand-other />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Model{spec.brand ? ` (${spec.brand})` : ""}</span>
          {brandModels.length ? (
            <div className="flex flex-wrap gap-1.5" data-tyre-models>
              {brandModels.map((m) => (
                <button key={m} type="button" onClick={() => set({ model: m })} aria-pressed={spec.model.toLowerCase() === m.toLowerCase()} className={chip(spec.model.toLowerCase() === m.toLowerCase())}>
                  {m}
                </button>
              ))}
            </div>
          ) : null}
          <Input value={spec.model} onChange={(e) => set({ model: e.target.value })} placeholder={spec.brand ? `Model, for example P Zero (saved under ${spec.brand})` : "Pick the brand first, then the model"} aria-label="Tyre model" data-tyre-model />
        </div>

        <TyreSizeInput label="Size" value={spec.size} onChange={(text) => set({ size: text })} />

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Year (DOT)</span>
          <div className="flex flex-wrap items-center gap-1.5" data-tyre-years>
            {tyreYears().map((y) => (
              <button key={y} type="button" onClick={() => set({ year: spec.year === y ? "" : y })} aria-pressed={spec.year === y} className={chip(spec.year === y)}>
                {y}
              </button>
            ))}
            <Input value={spec.year} onChange={(e) => set({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" placeholder="Year" aria-label="Tyre year" className="w-24" style={{ width: "6rem" }} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Marks</span>
          <div className="flex flex-wrap gap-1.5" data-tyre-marks>
            {TYRE_MARKS.map((m) => (
              <button key={m} type="button" onClick={() => toggleMark(m)} aria-pressed={spec.marks.includes(m)} className={chip(spec.marks.includes(m))}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-control bg-chip px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Name on the quotation</span>
          <p className="text-sm font-extrabold" data-tyre-preview>{name || "—"}</p>
          {!complete ? <p className="text-xs text-amber font-semibold">A brand and the full size are needed before the tyre can be priced.</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button type="button" tone="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button type="button" size="md" disabled={!complete} onClick={() => onApply({ ...spec, brand: spec.brand.trim(), model: spec.model.trim(), year: spec.year.trim() })} data-tyre-apply>Use this name</Button>
        </div>
      </div>
    </div>
  );
}
