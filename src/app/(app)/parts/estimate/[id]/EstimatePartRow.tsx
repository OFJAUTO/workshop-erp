"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Button, ChoiceButtons, Field, Input, Textarea } from "@/components/ui";
import { ESTIMATE_PART_WORDS, type EstimatePartState } from "@/lib/estimate-parts";
import { checkEstimatePrice, priceEstimatePart, tellAdvisorPrice } from "../../estimate-actions";

export type DeskPartLine = {
  id: string;
  title: string;
  quantity: number;
  positions: string[];
  note: string | null;
  state: EstimatePartState;
  cost: number | null;
  supplier: string | null;
  partNumber: string | null;
  partType: string | null;
  availability: "in_stock" | "to_order" | null;
  days: number | null;
  advisorName: string | null;
};

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY_CHOICES = [
  { value: "in_stock", label: "In stock" },
  { value: "0", label: "Same day" },
  { value: "1", label: "Next day" },
  { value: "2", label: "2 days" },
  { value: "3", label: "3 days" },
  { value: "other", label: "Other…" },
];

/**
 * One part of an estimate on the parts desk (30 October 2026): what the advisor asked for (name, quantity, positions,
 * note), then the price - part number, type, cost each before VAT, supplier and availability. A price the advisor
 * typed shows first with "Price is right ✓". An estimate already with the customer is not repriced here: the desk
 * checks the price or tells the advisor in words.
 */
export function EstimatePartRow({ quotationId, line, index, partTypes, suppliers, preparing }: { quotationId: string; line: DeskPartLine; index: number; partTypes: string[]; suppliers: string[]; preparing: boolean }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const advisorPriced = line.state === "advisor";
  const dayValue = line.availability === "in_stock" ? "in_stock" : line.days !== null && line.days <= 3 ? String(line.days) : line.days !== null ? "other" : "";
  const tone = line.state === "with_desk" ? "amber" : line.state === "advisor" ? "amber" : line.state === "draft" ? "outline" : "green";
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-white p-4" data-desk-part={line.id} data-desk-part-state={line.state}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="text-xs font-bold text-muted">{index}</span>
        <span className="min-w-0 flex-1 font-extrabold uppercase">{line.title || "(no name)"}</span>
        <span className="text-sm font-bold whitespace-nowrap">× {line.quantity}</span>
        <Badge tone={tone}>{ESTIMATE_PART_WORDS[line.state]}</Badge>
      </div>
      {line.positions.length ? <span className="text-xs font-semibold text-muted">{line.positions.join(", ")}</span> : null}
      {line.note ? <p className="rounded-control bg-chip px-3 py-2 text-sm" data-desk-part-note><span className="font-semibold">Note from {line.advisorName ?? "the advisor"}:</span> {line.note}</p> : null}
      {advisorPriced ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2" data-desk-check>
          <span className="text-sm font-semibold">Priced by advisor: {line.cost !== null ? money(line.cost) : ""} each from {line.supplier ?? "?"}. Check it.</span>
          <Button
            type="button"
            size="md"
            disabled={checking}
            data-desk-price-right
            onClick={async () => {
              setChecking(true);
              setCheckError(null);
              const r = await checkEstimatePrice(quotationId, line.id).catch(() => ({ error: "No connection. Try again." }));
              setChecking(false);
              if (r.error) setCheckError(r.error);
              else router.refresh();
            }}
          >
            {checking ? "Saving…" : "Price is right ✓"}
          </Button>
          {checkError ? <span className="w-full text-xs font-semibold text-red">{checkError}</span> : null}
        </div>
      ) : null}
      {preparing ? (
        <ActionForm action={priceEstimatePart.bind(null, quotationId, line.id)} initialValues={{ part_number: line.partNumber ?? "", part_type: line.partType ?? "", cost: line.cost !== null ? String(line.cost) : "", supplier: line.supplier ?? "", availability: dayValue, days_other: line.days !== null && line.days > 3 ? String(line.days) : "" }} className="flex flex-col gap-3">
          {(v) => (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Part number" optional hint="Internal: never on the customer's estimate.">
                  <Input name="part_number" defaultValue={v.part_number} autoCapitalize="characters" spellCheck={false} data-desk-part-number />
                </Field>
                <Field label="Cost each, before VAT (AED)">
                  <Input name="cost" defaultValue={v.cost} inputMode="decimal" required data-desk-cost />
                </Field>
                <Field label="Supplier">
                  <Input name="supplier" defaultValue={v.supplier} list={`desk-suppliers-${line.id}`} required textCase="title" data-desk-supplier />
                  <datalist id={`desk-suppliers-${line.id}`}>{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
                </Field>
              </div>
              <Field label="Type" optional>
                <ChoiceButtons name="part_type" columns={4} defaultValue={partTypes.find((t) => t.toLowerCase() === (v.part_type ?? "").toLowerCase()) ?? null} options={partTypes.map((t) => ({ value: t, label: t }))} />
              </Field>
              <Field label="Availability">
                <ChoiceButtons name="availability" columns={3} defaultValue={v.availability || null} options={DAY_CHOICES} />
              </Field>
              <Field label="Other: days to arrive" optional>
                <Input name="days_other" defaultValue={v.days_other} inputMode="numeric" className="max-w-32" data-desk-days />
              </Field>
              <div><SubmitButton>{line.state === "priced" || line.state === "checked" ? "Save the new price" : advisorPriced ? "Save the right price" : "Save price"}</SubmitButton></div>
            </>
          )}
        </ActionForm>
      ) : line.state !== "with_desk" ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer font-semibold underline underline-offset-4">The price is different: tell the advisor</summary>
          <ActionForm action={tellAdvisorPrice.bind(null, quotationId, line.id)} className="mt-2 flex flex-col gap-2">
            {() => (
              <>
                <Textarea name="note" rows={2} placeholder="For example: AED 1,250 each from Gargash, 2 days" data-desk-tell />
                <div><SubmitButton>Tell the advisor</SubmitButton></div>
              </>
            )}
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}
