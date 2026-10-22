"use client";

import { useState } from "react";
import { Input } from "@/components/ui";
import { fieldOf, PPF_AREAS } from "@/lib/warranty";

export type WarrantyFieldRow = { product: "ppf" | "tint" | "ceramic"; itemKey: string; label: string; rollBatch: string | null; productName: string | null; areas: string[]; suggestedAreas: string[] };

const TITLES = { ppf: "PPF film", tint: "Window tint", ceramic: "Ceramic coating" } as const;

/**
 * Section 12: what the team leader writes down for the warranty, one product at a time. PPF: the roll or batch
 * number (one tap on an open roll, or typed) and the areas covered, pre-ticked from the package. Tint: the roll
 * number. Ceramic: the product (one tap on one used before, or typed) and its batch number. ONE component for the
 * end of the stage and the Warranty details card.
 */
export function WarrantyFields({ row, rolls = [], products = [], disabled = false }: { row: WarrantyFieldRow; rolls?: string[]; products?: string[]; disabled?: boolean }) {
  const [roll, setRoll] = useState(row.rollBatch ?? "");
  const [product, setProduct] = useState(row.productName ?? "");
  const [areas, setAreas] = useState<string[]>(row.areas.length ? row.areas : row.suggestedAreas);
  const extra = areas.filter((a) => !(PPF_AREAS as readonly string[]).includes(a));
  const toggle = (a: string) => setAreas((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]));
  const chip = (on: boolean) => `min-h-11 rounded-control border px-3 text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line px-3 py-2" data-warranty-fields={`${row.product}:${row.itemKey}`}>
      <span className="text-sm font-bold">{TITLES[row.product]}{row.product === "ceramic" ? ` · ${row.label}` : ""}</span>
      {row.product === "ceramic" ? (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Product
          {products.length ? (
            <span className="flex flex-wrap gap-1.5">
              {products.map((p) => <button key={p} type="button" disabled={disabled} onClick={() => setProduct(p)} className={chip(product === p)}>{p}</button>)}
            </span>
          ) : null}
          <Input name={fieldOf(row, "product")} value={product} onChange={(e) => setProduct(e.target.value)} disabled={disabled} placeholder="Ceramic product name" textCase="title" data-warranty-product={`${row.product}:${row.itemKey}`} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        {row.product === "ppf" ? "Film roll or batch number" : row.product === "tint" ? "Tint roll number" : "Batch number"}
        {rolls.length && row.product !== "ceramic" ? (
          <span className="flex flex-wrap gap-1.5">
            {rolls.map((r) => <button key={r} type="button" disabled={disabled} onClick={() => setRoll(r)} className={chip(roll === r)}>{r}</button>)}
          </span>
        ) : null}
        <Input name={fieldOf(row, "roll")} value={roll} onChange={(e) => setRoll(e.target.value)} disabled={disabled} placeholder={row.product === "ceramic" ? "Batch number on the bottle" : "Number on the roll label"} textCase="upper" data-warranty-roll={`${row.product}:${row.itemKey}`} />
      </label>
      {row.product === "ppf" ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Areas covered (ticked from the package; change if needed)</span>
          <span className="flex flex-wrap gap-1.5">
            {PPF_AREAS.map((a) => (
              <button key={a} type="button" disabled={disabled} aria-pressed={areas.includes(a)} onClick={() => toggle(a)} className={chip(areas.includes(a))} data-warranty-area={a}>{a}</button>
            ))}
          </span>
          {areas.filter((a) => (PPF_AREAS as readonly string[]).includes(a)).map((a) => <input key={a} type="hidden" name={fieldOf(row, "areas")} value={a} />)}
          <Input name={fieldOf(row, "area_other")} defaultValue={extra.join(", ")} disabled={disabled} placeholder="Other areas (optional)" textCase="sentence" />
        </div>
      ) : null}
    </div>
  );
}
