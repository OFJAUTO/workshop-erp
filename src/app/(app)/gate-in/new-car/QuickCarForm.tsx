"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ModelYearSelect } from "@/components/ModelYearSelect";
import { SearchSelect } from "@/components/SearchSelect";
import { Button, Card, ChoiceButtons, Field, Input, SectionLabel, Select } from "@/components/ui";
import { makeFromVin, modelYearFromVin } from "@/lib/vin";
import { checkCustomerPhone } from "../actions";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";

export type VariantMap = Record<string, string[]>;
/** An existing customer the car is added to: name and mobile only (all the gate-in role may see). */
export type ExistingCustomer = { id: string; name: string; phone: string; cars?: number };

export function QuickCarForm({
  action,
  makes,
  models,
  variants,
  initialValues = {},
  customer = null,
}: {
  action: FormAction;
  makes: VehicleMakeRow[];
  models: VehicleModelRow[];
  variants: VariantMap;
  initialValues?: Record<string, string>;
  customer?: ExistingCustomer | null;
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => <Fields v={v} makes={makes} models={models} variants={variants} fixed={customer} />}
    </ActionForm>
  );
}

/** The customer box: fixed when the car is added to an existing customer, otherwise the new customer's details with the mobile checked against the customers on record. */
function CustomerCard({ v, fixed }: { v: Record<string, string>; fixed: ExistingCustomer | null }) {
  const fromValues = v.customer_id && v.customer_name ? { id: v.customer_id, name: v.customer_name, phone: v.customer_phone ?? "" } : null;
  const [existing, setExisting] = useState<ExistingCustomer | null>(fixed ?? fromValues);
  const [dup, setDup] = useState<ExistingCustomer | null>(v.dup_customer_id ? { id: v.dup_customer_id, name: v.dup_customer_name ?? "", phone: v.dup_customer_phone ?? "" } : null);
  const [different, setDifferent] = useState(v.phone_different === "1");
  const [checking, setChecking] = useState(false);
  // The server asks the same question when the form arrives without it (its answer comes back in the form values).
  const [seenDup, setSeenDup] = useState(v.dup_customer_id ?? "");
  if ((v.dup_customer_id ?? "") !== seenDup) {
    setSeenDup(v.dup_customer_id ?? "");
    if (v.dup_customer_id) {
      setDup({ id: v.dup_customer_id, name: v.dup_customer_name ?? "", phone: v.dup_customer_phone ?? "" });
      setDifferent(false);
    }
  }

  async function checkPhone(phone: string) {
    if (phone.replace(/\D/g, "").length < 7) { setDup(null); return; }
    setChecking(true);
    try {
      const hit = await checkCustomerPhone(phone);
      setDup(hit);
      if (!hit) setDifferent(false);
    } finally {
      setChecking(false);
    }
  }

  if (existing) {
    return (
      <Card className="flex flex-col gap-3" data-existing-customer={existing.id}>
        <input type="hidden" name="customer_id" value={existing.id} />
        <input type="hidden" name="customer_name" value={existing.name} />
        <input type="hidden" name="customer_phone" value={existing.phone} />
        <SectionLabel>Customer</SectionLabel>
        <span className="font-extrabold text-lg uppercase">{existing.name}</span>
        <span className="text-sm font-semibold">{existing.phone}</span>
        {existing.cars != null ? <span className="text-xs text-muted">{existing.cars === 0 ? "No car on record yet" : `${existing.cars} car${existing.cars === 1 ? "" : "s"} already on record`}. The new car is added to this customer.</span> : <span className="text-xs text-muted">The new car is added to this customer.</span>}
        {fixed ? (
          <a href="/gate-in/new-car" className="text-sm underline underline-offset-4 font-semibold self-start">Not this customer? New customer and car</a>
        ) : (
          <button type="button" className="text-sm underline underline-offset-4 font-semibold self-start min-h-11" onClick={() => { setExisting(null); setDifferent(true); }}>
            No, a different person: enter the new customer
          </button>
        )}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <SectionLabel>Customer</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name">
          <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus />
        </Field>
        <Field label="Phone (WhatsApp)" hint={checking ? "Checking the number…" : undefined}>
          <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} required placeholder="+971 50 123 4567" onBlur={(e) => void checkPhone(e.currentTarget.value)} data-new-customer-phone />
        </Field>
        <Field label="Email" optional>
          <Input name="email" type="email" inputMode="email" defaultValue={v.email} />
        </Field>
        <Field label="TRN" optional hint="15 digits, for companies.">
          <Input name="trn" inputMode="numeric" maxLength={15} defaultValue={v.trn} />
        </Field>
      </div>
      {different ? <input type="hidden" name="phone_different" value="1" /> : null}
      {dup && !different ? (
        <div className="rounded-control border-2 border-ink p-4 flex flex-col gap-3" data-dup-phone={dup.id}>
          <p className="font-semibold">
            This number belongs to <span className="uppercase">{dup.name}</span> – add the car to <span className="uppercase">{dup.name}</span> instead?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" onClick={() => { setExisting(dup); setDup(null); }} data-dup-yes>
              Yes, add the car to <span className="uppercase ml-1">{dup.name}</span>
            </Button>
            <Button type="button" size="lg" tone="secondary" onClick={() => setDifferent(true)} data-dup-no>
              No, a different person
            </Button>
          </div>
        </div>
      ) : null}
      {dup && different ? <p className="text-xs text-muted" data-dup-different>Saved as a different person who shares the number with <span className="uppercase">{dup.name}</span>.</p> : null}
    </Card>
  );
}

function Fields({ v, makes, models, variants, fixed }: { v: Record<string, string>; makes: VehicleMakeRow[]; models: VehicleModelRow[]; variants: VariantMap; fixed: ExistingCustomer | null }) {
  const [noPlate, setNoPlate] = useState(v.no_plate === "on");
  const [country, setCountry] = useState(v.plate_country || "UAE");
  const [vin, setVin] = useState(v.vin || "");
  const [make, setMake] = useState({ id: v.make_id || "", text: v.make_text || "" });
  const [model, setModel] = useState({ id: v.model_id || "", text: v.model_text || "" });
  const [vinMake, setVinMake] = useState<string | null>(null);
  // The model year: read from the VIN and marked "from VIN" until the advisor picks one themselves.
  const [year, setYear] = useState<{ value: string; fromVin: boolean }>({ value: v.model_year_other || v.model_year_choice || "", fromVin: false });

  const makeOptions = makes.map((m) => ({ id: m.id, label: m.name }));
  const modelOptions = models.filter((m) => m.make_id === make.id).map((m) => ({ id: m.id, label: m.name }));
  const variantSuggestions = model.id && model.id !== "__new__" ? (variants[model.id] ?? []) : [];

  // Read the make from the VIN and pre-select it when nothing is chosen yet.
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

  const makeWarning = vinMake && make.text && make.text.toLowerCase() !== vinMake.toLowerCase() ? `The VIN suggests ${vinMake}. Check the make.` : null;

  return (
    <>
      {v.appointment_id ? <input type="hidden" name="appointment_id" value={v.appointment_id} /> : null}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="flex flex-col gap-6">
          {v.appointment_id ? (
            <Card className="flex flex-col gap-4">
              <SectionLabel>Customer</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name">
                  <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus />
                </Field>
                <Field label="Phone (WhatsApp)">
                  <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} required placeholder="+971 50 123 4567" />
                </Field>
                <Field label="Email" optional>
                  <Input name="email" type="email" inputMode="email" defaultValue={v.email} />
                </Field>
                <Field label="TRN" optional hint="15 digits, for companies.">
                  <Input name="trn" inputMode="numeric" maxLength={15} defaultValue={v.trn} />
                </Field>
              </div>
            </Card>
          ) : (
            <CustomerCard v={v} fixed={fixed} />
          )}

          <Card className="flex flex-col gap-4">
            <SectionLabel>Number plate</SectionLabel>
            <label className="flex items-center gap-3 min-h-11 cursor-pointer">
              <input type="checkbox" name="no_plate" checked={noPlate} onChange={(e) => setNoPlate(e.target.checked)} className="h-5 w-5 accent-ink" />
              <span className="text-sm font-semibold">No number plate</span>
            </label>
            {!noPlate ? (
              <>
                <Field label="Country">
                  <Select name="plate_country" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {PLATE_COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
                {country === "UAE" ? (
                  <Field label="Emirate">
                    <ChoiceButtons name="plate_emirate" columns={4} defaultValue={v.plate_emirate || "Dubai"} options={EMIRATES.map((e) => ({ value: e, label: e }))} />
                  </Field>
                ) : null}
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Code" optional>
                    <Input name="plate_code" defaultValue={v.plate_code} className="uppercase" maxLength={5} autoCapitalize="characters" />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Plate number">
                      <Input name="plate_number" defaultValue={v.plate_number} required className="uppercase text-lg font-bold tracking-[0.05em]" autoCapitalize="characters" />
                    </Field>
                  </div>
                </div>
              </>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Car</SectionLabel>
            <Field label="VIN" hint="17 characters. The make is read from it automatically.">
              <Input
                name="vin"
                value={vin}
                onChange={(e) => onVinChange(e.target.value)}
                className="uppercase font-mono"
                maxLength={17}
                minLength={17}
                required
                autoCapitalize="characters"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SearchSelect name="make" label="Make" options={makeOptions} value={make} onChange={(m) => { setMake(m); setModel({ id: "", text: "" }); }} placeholder="Type to search…" warning={makeWarning} />
              <SearchSelect name="model" label="Model" options={modelOptions} value={model} onChange={setModel} placeholder={make.text ? "Type to search…" : "Choose the make first"} disabled={!make.text} />
              <Field label="Variant" optional hint="For example: 4S, Turbo S, GTS.">
                <>
                  <Input name="variant" defaultValue={v.variant} list="variant-suggestions" autoComplete="off" />
                  <datalist id="variant-suggestions">
                    {variantSuggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              </Field>
              <Field label="Model year" hint={year.fromVin ? "Read from the 10th character of the VIN. Change it if the car's papers say otherwise." : undefined}>
                <ModelYearSelect value={year.value} onChange={(value) => setYear({ value, fromVin: false })} fromVin={year.fromVin} />
              </Field>
            </div>
            <Field label="Fuel" hint="Electric cars record battery percentage instead of fuel level.">
              <ChoiceButtons name="fuel_type" columns={4} defaultValue={v.fuel_type} options={FUEL_TYPES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
            </Field>
          </Card>

        </div>
      </div>

      <div>
        <SubmitButton>Save and gate in</SubmitButton>
      </div>
    </>
  );
}
