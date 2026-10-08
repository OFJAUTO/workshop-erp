"use client";

import { useState } from "react";
import { Input } from "./ui";
import { formatThousands, mileageChecks, parseMileage, toKm, toMiles, type MileageUnit } from "@/lib/mileage";

/**
 * The mileage box at gate-in: kilometres or miles with the converted figure beside it, thousands
 * separators while typing, and an "Are you sure?" box when the figure looks wrong (unusually high
 * for the car's age, lower than last time, or a big jump since the last visit). The advisor can
 * confirm and continue. The form receives the figure in km (`mileage`), the unit, the figure as
 * typed and whether it was confirmed.
 */
export function MileageInput({
  initialValue,
  initialUnit,
  initialConfirmed = false,
  context,
}: {
  /** The figure as typed last time, in the unit chosen. */
  initialValue?: string;
  initialUnit: MileageUnit;
  initialConfirmed?: boolean;
  context: { modelYear: number | null; lastKm: number | null; lastVisitAt: string | null };
}) {
  const [unit, setUnit] = useState<MileageUnit>(initialUnit);
  const [text, setText] = useState(formatThousands(initialValue ?? ""));
  const [confirmed, setConfirmed] = useState(initialConfirmed);

  const entered = parseMileage(text);
  const km = entered === null ? null : toKm(entered, unit);
  const converted = entered === null ? "" : unit === "km" ? `${formatThousands(toMiles(entered))} mi` : `${formatThousands(toKm(entered, "mi"))} km`;
  const checks = km === null ? [] : mileageChecks(km, { ...context, unit });
  const unitBtn = (on: boolean) => `min-h-11 px-4 text-sm font-bold rounded-control border ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="mileage" value={km ?? ""} />
      <input type="hidden" name="mileage_unit" value={unit} />
      <input type="hidden" name="mileage_entered" value={entered ?? ""} />
      <input type="hidden" name="mileage_confirmed" value={confirmed && checks.length ? "yes" : ""} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="mileage_display"
          value={text}
          onChange={(e) => {
            setText(formatThousands(e.target.value));
            setConfirmed(false);
          }}
          inputMode="numeric"
          required
          className="max-w-44 text-lg font-bold"
          aria-label={`Mileage in ${unit === "km" ? "kilometres" : "miles"}`}
        />
        <div className="flex gap-1" role="group" aria-label="Unit">
          <button type="button" onClick={() => { setUnit("km"); setConfirmed(false); }} aria-pressed={unit === "km"} className={unitBtn(unit === "km")}>
            km
          </button>
          <button type="button" onClick={() => { setUnit("mi"); setConfirmed(false); }} aria-pressed={unit === "mi"} className={unitBtn(unit === "mi")}>
            miles
          </button>
        </div>
        {converted ? <span className="text-sm font-semibold text-muted">= {converted}</span> : null}
      </div>
      {checks.length ? (
        <div className={`rounded-control border p-3 flex flex-col gap-2 text-sm ${confirmed ? "border-green bg-green-soft" : "border-amber-bar bg-amber-soft"}`}>
          <span className="font-bold">{confirmed ? "Mileage confirmed." : "Are you sure?"}</span>
          <ul className="list-disc pl-5 flex flex-col gap-0.5">
            {checks.map((c) => (
              <li key={c.kind}>{c.text}</li>
            ))}
          </ul>
          {!confirmed ? (
            <button type="button" onClick={() => setConfirmed(true)} className="self-start min-h-11 rounded-control border border-ink bg-white px-4 text-sm font-bold">
              Yes, the mileage is correct
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
