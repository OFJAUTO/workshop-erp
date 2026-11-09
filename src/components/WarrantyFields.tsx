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
  // 9 November 2026: one line can use more than one roll (1.5 rolls): a tap adds the roll, a second tap takes it off.
  const rollList = roll.split(",").map((x) => x.trim()).filter(Boolean);
  const toggleRoll = (r: string) => setRoll((cur) => { const list = cur.split(",").map((x) => x.trim()).filter(Boolean); return (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]).join(", "); });
  const chip = (on: boolean) => `min-h-11 rounded-control border px-3 text-xs font-bold ${on ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`;
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
      {row.product !== "ceramic" ? (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {row.product === "ppf" ? "Film roll or batch number (needed for the certificate)" : "Tint roll or batch number (needed for the certificate)"}
          {rolls.length ? (
            <span className="flex flex-wrap gap-1.5">
              {rolls.map((r) => <button key={r} type="button" disabled={disabled} aria-pressed={rollList.includes(r)} onClick={() => toggleRoll(r)} className={chip(rollList.includes(r))} data-warranty-roll-pick={r}>{r}</button>)}
            </span>
          ) : null}
          <Input name={fieldOf(row, "roll")} value={roll} onChange={(e) => setRoll(e.target.value)} disabled={disabled} placeholder="Number on the roll label (several: separate with a comma)" textCase="upper" data-warranty-roll={`${row.product}:${row.itemKey}`} />
        </label>
      ) : null}
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
