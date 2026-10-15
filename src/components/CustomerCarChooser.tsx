"use client";

import { useState } from "react";
import { ModelYearSelect } from "@/components/ModelYearSelect";
import { SearchSelect } from "@/components/SearchSelect";
import { ChoiceButtons, Field, Input, Select } from "@/components/ui";
import { makeFromVin, modelYearFromVin } from "@/lib/vin";
import { EMIRATES, PLATE_COUNTRIES } from "@/lib/types";

export type ChooserCustomer = { id: string; label: string };
export type ChooserCar = { id: string; customerId: string; label: string };
export type ChooserMake = { id: string; name: string };
export type ChooserModel = { id: string; make_id: string; name: string };
type Mode = "existing" | "new_car" | "new_customer";
type Dup = { kind: "customer" | "vehicle"; id: string; label: string; customerId: string; customerLabel: string } | null;

const CHOICES: { key: Mode; title: string; hint: string }[] = [
  { key: "existing", title: "Existing customer and car", hint: "Both are on record" },
  { key: "new_car", title: "Existing customer, new car", hint: "The customer is on record, the car is not" },
  { key: "new_customer", title: "New customer and car", hint: "Neither is on record yet" },
];

/**
 * One page, three big choices: existing customer and car, existing customer with a new car, or a new customer and
 * car. The customer is found by name, company or phone; the car's details are the few needed before arrival
 * (plate, VIN if known, make, model, year, colour). A phone, VIN or plate already on file is pointed out at once,
 * with one tap to use the record instead of doubling it. Renders inside an ActionForm; `v` holds the kept values.
 */
export function CustomerCarChooser({ v, customers, cars, makes, models }: { v: Record<string, string>; customers: ChooserCustomer[]; cars: ChooserCar[]; makes: ChooserMake[]; models: ChooserModel[] }) {
  const [mode, setMode] = useState<Mode>((["existing", "new_car", "new_customer"].includes(v.mode) ? v.mode : "existing") as Mode);
  const [customer, setCustomer] = useState({ id: v.customer_id || "", text: customers.find((c) => c.id === v.customer_id)?.label ?? "" });
  const [vehicleId, setVehicleId] = useState(v.vehicle_id || "");
  const [phone, setPhone] = useState(v.phone || "");
  const [noPlate, setNoPlate] = useState(v.no_plate === "on");
  const [country, setCountry] = useState(v.plate_country || "UAE");
  const [plateNumber, setPlateNumber] = useState(v.plate_number || "");
  const [vin, setVin] = useState(v.vin || "");
  const [make, setMake] = useState({ id: v.make_id || "", text: v.make_text || "" });
  const [model, setModel] = useState({ id: v.model_id || "", text: v.model_text || "" });
  const [year, setYear] = useState<{ value: string; fromVin: boolean }>({ value: v.model_year_other || v.model_year_choice || "", fromVin: false });
  const [vinMake, setVinMake] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [dup, setDup] = useState<Dup>(v.duplicate_kind ? { kind: v.duplicate_kind as "customer" | "vehicle", id: v.duplicate_id, label: v.duplicate_label, customerId: v.duplicate_customer_id, customerLabel: v.duplicate_customer_label } : null);
  const theirCars = cars.filter((c) => c.customerId === customer.id);
  const makeOptions = makes.map((m) => ({ id: m.id, label: m.name }));
  const modelOptions = models.filter((m) => m.make_id === make.id).map((m) => ({ id: m.id, label: m.name }));
  const makeWarning = vinMake && make.text && make.text.toLowerCase() !== vinMake.toLowerCase() ? `The VIN suggests ${vinMake}. Check the make.` : null;

  function onVinChange(value: string) {
    const next = value.toUpperCase();
    setVin(next);
    const detected = makeFromVin(next);
    setVinMake(detected);
    if (detected && !make.text) {
      const hit = makes.find((m) => m.name.toLowerCase() === detected.toLowerCase());
      setMake(hit ? { id: hit.id, text: hit.name } : { id: "__new__", text: detected });
    }
    const vinYear = modelYearFromVin(next);
    setYear((cur) => (cur.value && !cur.fromVin ? cur : vinYear ? { value: String(vinYear), fromVin: true } : cur.fromVin ? { value: "", fromVin: false } : cur));
  }

  async function lookup(params: Record<string, string>) {
    try {
      const q = new URLSearchParams(Object.entries(params).filter(([, val]) => val)).toString();
      const res = await fetch(`/api/lookup?${q}`);
      if (!res.ok) return;
      const j = (await res.json()) as { customer: Dup; vehicle: Dup };
      const hit = j.vehicle ?? j.customer;
      setDup(hit);
    } catch {}
  }
  const checkPhone = () => mode === "new_customer" && phone.trim().length >= 7 && lookup({ phone: phone.trim() });
  const checkCar = () => mode !== "existing" && (vin.length === 17 || (!noPlate && plateNumber.trim())) && lookup({ vin: vin.length === 17 ? vin : "", plate_country: noPlate ? "" : country, plate_emirate: noPlate ? "" : (document.querySelector<HTMLInputElement>('input[name="plate_emirate"]:checked')?.value ?? ""), plate_code: noPlate ? "" : (document.querySelector<HTMLInputElement>('input[name="plate_code"]')?.value ?? ""), plate_number: noPlate ? "" : plateNumber.trim() });

  function useDuplicate() {
    if (!dup) return;
    if (dup.kind === "vehicle") {
      setMode("existing");
      setCustomer({ id: dup.customerId, text: customers.find((c) => c.id === dup.customerId)?.label ?? dup.customerLabel });
      setVehicleId(dup.id);
    } else {
      setMode("new_car");
      setCustomer({ id: dup.customerId, text: customers.find((c) => c.id === dup.customerId)?.label ?? dup.label });
    }
    setDup(null);
    setForce(false);
  }

  return (
    <div className="flex flex-col gap-5" data-customer-car-chooser>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="force" value={force ? "1" : ""} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-chooser-choices>
        {CHOICES.map((c) => (
          <button key={c.key} type="button" onClick={() => { setMode(c.key); setDup(null); setForce(false); if (c.key === "new_customer") { setCustomer({ id: "", text: "" }); setVehicleId(""); } if (c.key === "new_car") setVehicleId(""); }} aria-pressed={mode === c.key} data-choice={c.key} className={`min-h-20 rounded-card border-2 px-4 py-3 text-left flex flex-col gap-1 ${mode === c.key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
            <span className="text-base font-extrabold">{c.title}</span>
            <span className={`text-xs ${mode === c.key ? "text-white/80" : "text-muted"}`}>{c.hint}</span>
          </button>
        ))}
      </div>

      {dup ? (
        <div className="rounded-card border-2 border-amber-bar bg-amber-soft px-4 py-3 flex flex-col gap-2" data-duplicate={dup.kind}>
          <span className="text-sm font-bold">{dup.kind === "vehicle" ? `${dup.label} is already on record under ${dup.customerLabel}.` : `This phone number belongs to ${dup.label}.`}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={useDuplicate} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white" data-use-duplicate>{dup.kind === "vehicle" ? "Use this car" : "Use this customer"}</button>
            {dup.kind === "customer" ? <button type="button" onClick={() => { setForce(true); setDup(null); }} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-create-anyway>Create a second customer anyway</button> : null}
          </div>
        </div>
      ) : null}
      {force ? <p className="text-xs font-semibold text-amber" data-force-on>A second customer will be created on this phone number.</p> : null}

      {mode !== "new_customer" ? (
        <SearchSelect name="customer" label="Customer" options={customers} value={customer} onChange={(c) => { setCustomer(c); setVehicleId(""); }} placeholder="Type a name, company or phone…" allowNew={false} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-new-customer>
          <Field label="Name"><Input name="full_name" defaultValue={v.full_name} required minLength={2} textCase="title" /></Field>
          <Field label="Phone (WhatsApp)"><Input name="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={checkPhone} required placeholder="+971 50 123 4567" data-phone /></Field>
          <Field label="Company" optional><Input name="company_name" defaultValue={v.company_name} textCase="title" /></Field>
          <Field label="Email" optional><Input name="email" type="email" inputMode="email" defaultValue={v.email} /></Field>
          <Field label="TRN" optional hint="15 digits, for companies."><Input name="trn" inputMode="numeric" maxLength={15} defaultValue={v.trn} /></Field>
        </div>
      )}

      {mode === "existing" ? (
        <Field label="Car" hint={customer.id && theirCars.length === 0 ? "This customer has no car on record yet: choose “Existing customer, new car”." : undefined}>
          <Select name="vehicle_id" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required disabled={!customer.id} data-vehicle-select>
            <option value="">{customer.id ? (theirCars.length ? "Choose the car…" : "No cars on record") : "Choose the customer first"}</option>
            {theirCars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      ) : (
        <div className="flex flex-col gap-4" data-new-car>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SearchSelect name="make" label="Make" options={makeOptions} value={make} onChange={(m) => { setMake(m); setModel({ id: "", text: "" }); }} placeholder="Type to search…" warning={makeWarning} />
            <SearchSelect name="model" label="Model" options={modelOptions} value={model} onChange={setModel} placeholder={make.text ? "Type to search…" : "Choose the make first"} disabled={!make.text} />
            <Field label="Model year" optional hint={year.fromVin ? "Read from the VIN. Change it if the papers say otherwise." : undefined}><ModelYearSelect value={year.value} onChange={(value) => setYear({ value, fromVin: false })} fromVin={year.fromVin} required={false} /></Field>
            <Field label="Colour" optional><Input name="colour" defaultValue={v.colour} textCase="title" /></Field>
            <Field label="Variant" optional hint="For example: 4S, Turbo S, GTS."><Input name="variant" defaultValue={v.variant} /></Field>
            <Field label="VIN" optional hint="17 characters when you have it; the make and year are read from it."><Input name="vin" value={vin} onChange={(e) => onVinChange(e.target.value)} onBlur={checkCar} className="uppercase font-mono" maxLength={17} autoCapitalize="characters" data-vin /></Field>
          </div>
          <label className="flex items-center gap-3 min-h-11 cursor-pointer">
            <input type="checkbox" name="no_plate" checked={noPlate} onChange={(e) => setNoPlate(e.target.checked)} className="h-5 w-5 accent-ink" />
            <span className="text-sm font-semibold">No number plate yet</span>
          </label>
          {!noPlate ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Plate country"><Select name="plate_country" value={country} onChange={(e) => setCountry(e.target.value)}>{PLATE_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              {country === "UAE" ? <Field label="Emirate"><ChoiceButtons name="plate_emirate" columns={4} defaultValue={v.plate_emirate || "Dubai"} options={EMIRATES.map((e) => ({ value: e, label: e }))} /></Field> : null}
              <Field label="Code" optional><Input name="plate_code" defaultValue={v.plate_code} className="uppercase" maxLength={5} autoCapitalize="characters" /></Field>
              <Field label="Plate number"><Input name="plate_number" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} onBlur={checkCar} required className="uppercase text-lg font-bold tracking-[0.05em]" autoCapitalize="characters" data-plate-number /></Field>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
