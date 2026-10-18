"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";

type Driver = { id: string; name: string };
type Company = { id: string; name: string; phone: string | null };

/**
 * One new pick-up or delivery: first the choice, two big buttons - Our truck or External recovery. Our truck
 * uses the saved driver (pre-selected) and shows none of his details; External asks the truck type (Flatbed or
 * Closed box) and the company, saved with its mobile for next time. Then just the pin, the location details,
 * the date and an optional job number. The driver or the company gets the same one-button link.
 */
export function NewTripForm({ ourDriver, companies, action }: { ourDriver: Driver | null; companies: Company[]; action: (formData: FormData) => void }) {
  const [side, setSide] = useState<"ours" | "external" | null>(null);
  const [kind, setKind] = useState<"pickup" | "delivery">("pickup");
  const [companyChoice, setCompanyChoice] = useState<string>("");
  const [truckType, setTruckType] = useState<"flatbed" | "closed_box" | null>(null);
  // The Dubai day, read once when the form opens.
  const [today] = useState(() => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10));
  if (!side) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-trip-side>
        <button type="button" onClick={() => setSide("ours")} className="min-h-20 rounded-card border-2 border-ink bg-white text-lg font-extrabold" data-side-ours>
          Our truck{ourDriver ? <span className="block text-sm font-semibold text-muted">{ourDriver.name}</span> : null}
        </button>
        <button type="button" onClick={() => setSide("external")} className="min-h-20 rounded-card border-2 border-line-strong bg-white text-lg font-extrabold" data-side-external>
          External recovery
        </button>
      </div>
    );
  }
  const newCompany = companyChoice === "__new__";
  return (
    <form action={action} className="flex flex-col gap-3" data-new-trip>
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{side === "ours" ? "Our truck" : "External recovery"}</span>
        <button type="button" onClick={() => setSide(null)} className="min-h-9 px-2 text-xs font-bold underline underline-offset-4 text-muted">Change</button>
        <div className="ml-auto flex gap-1" data-trip-kind>
          {(["pickup", "delivery"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-10 rounded-control border-2 px-3 text-sm font-bold ${kind === k ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
              {k === "pickup" ? "Pick-up" : "Delivery"}
            </button>
          ))}
        </div>
      </div>
      {side === "external" ? (
        <div className="flex flex-col gap-3" data-external-fields>
          <div className="flex flex-wrap gap-2">
            {([["flatbed", "Flatbed"], ["closed_box", "Closed box"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setTruckType(v)} aria-pressed={truckType === v} data-truck-type={v} className={`min-h-12 rounded-control border-2 px-4 text-sm font-bold ${truckType === v ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                {label}
              </button>
            ))}
          </div>
          <input type="hidden" name="truck_type" value={truckType ?? ""} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Company
              <Select name="company_choice" value={companyChoice} onChange={(e) => setCompanyChoice(e.target.value)} data-company-choice>
                <option value="">Pick a company…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">New company…</option>
              </Select>
            </label>
            {newCompany ? (
              <>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Company name<Input name="company_name" required data-company-name /></label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Company mobile<Input name="company_phone" type="tel" inputMode="tel" data-company-phone /></label>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">{kind === "pickup" ? "Pick-up pin" : "Delivery pin"}<Input name="location_url" placeholder="Paste the map link" data-pin-box /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Location details<Input name="location_details" placeholder="Villa 23, gate 2" textCase="sentence" /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Date<Input type="date" name="date" defaultValue={today} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Job number (optional)<Input name="job_number" placeholder="J-00123" textCase="upper" /></label>
      </div>
      <div><Button type="submit" size="lg" data-save-trip>{kind === "pickup" ? "Save the pick-up" : "Save the delivery"}</Button></div>
    </form>
  );
}
