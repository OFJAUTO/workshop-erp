"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ImageCropper } from "@/components/ImageCropper";
import { SearchSelect } from "@/components/SearchSelect";
import { Card, ChoiceButtons, Field, Input, SectionLabel, Select } from "@/components/ui";
import { makeFromVin } from "@/lib/vin";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";

export type VariantMap = Record<string, string[]>;

export function QuickCarForm({
  action,
  makes,
  models,
  variants,
}: {
  action: FormAction;
  makes: VehicleMakeRow[];
  models: VehicleModelRow[];
  variants: VariantMap;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-6">
      {(v) => <Fields v={v} makes={makes} models={models} variants={variants} />}
    </ActionForm>
  );
}

function Fields({ v, makes, models, variants }: { v: Record<string, string>; makes: VehicleMakeRow[]; models: VehicleModelRow[]; variants: VariantMap }) {
  const [noPlate, setNoPlate] = useState(v.no_plate === "on");
  const [country, setCountry] = useState(v.plate_country || "UAE");
  const [vin, setVin] = useState(v.vin || "");
  const [make, setMake] = useState({ id: v.make_id || "", text: v.make_text || "" });
  const [model, setModel] = useState({ id: v.model_id || "", text: v.model_text || "" });
  const [vinMake, setVinMake] = useState<string | null>(null);

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
  }

  const makeWarning = vinMake && make.text && make.text.toLowerCase() !== vinMake.toLowerCase() ? `The VIN suggests ${vinMake}. Check the make.` : null;

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="flex flex-col gap-6">
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
              <Field label="Variant" hint="For example: 4S, Turbo S, GTS.">
                <>
                  <Input name="variant" defaultValue={v.variant} required list="variant-suggestions" autoComplete="off" />
                  <datalist id="variant-suggestions">
                    {variantSuggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              </Field>
              <Field label="Model year">
                <Input name="model_year" inputMode="numeric" defaultValue={v.model_year} required maxLength={4} pattern="\d{4}" />
              </Field>
            </div>
            <Field label="Fuel" hint="Electric cars record battery percentage instead of fuel level.">
              <ChoiceButtons name="fuel_type" columns={4} defaultValue={v.fuel_type} options={FUEL_TYPES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Car picture</SectionLabel>
            <p className="text-sm text-muted">Internal only: the Cars page, the dashboard and the job card. Customers never see it.</p>
            <ImageCropper name="car_picture" shape="wide" outputWidth={960} outputHeight={600} capture="environment" label="Take or choose a picture" />
          </Card>
        </div>
      </div>

      <div>
        <SubmitButton>Save and gate in</SubmitButton>
      </div>
    </>
  );
}
