"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input, SectionLabel, Select } from "@/components/ui";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";

export function QuickCarForm({ action, makes, models }: { action: FormAction; makes: VehicleMakeRow[]; models: VehicleModelRow[] }) {
  return (
    <ActionForm action={action}>
      {(v) => <Fields v={v} makes={makes} models={models} />}
    </ActionForm>
  );
}

function Fields({ v, makes, models }: { v: Record<string, string>; makes: VehicleMakeRow[]; models: VehicleModelRow[] }) {
  const [country, setCountry] = useState(v.plate_country || "UAE");
  const [makeId, setMakeId] = useState(v.make_id || "");
  const [modelId, setModelId] = useState(v.model_id || "");
  const modelsForMake = models.filter((m) => m.make_id === makeId);

  return (
    <>
      <SectionLabel>Customer</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name">
          <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus />
        </Field>
        <Field label="Phone (WhatsApp)">
          <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} required placeholder="+971 50 123 4567" />
        </Field>
      </div>

      <SectionLabel>Car</SectionLabel>
      <Field label="Plate country">
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
      <Field label="VIN" optional>
        <Input name="vin" defaultValue={v.vin} className="uppercase font-mono" maxLength={17} autoCapitalize="characters" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Make">
          <Select name="make_id" value={makeId} onChange={(e) => { setMakeId(e.target.value); setModelId(""); }} required>
            <option value="" disabled>
              Choose…
            </option>
            {makes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="__new__">Other (type it)</option>
          </Select>
        </Field>
        {makeId === "__new__" ? (
          <Field label="New make name">
            <Input name="new_make" defaultValue={v.new_make} required />
          </Field>
        ) : (
          <Field label="Model">
            <Select name="model_id" value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!makeId}>
              <option value="">Choose…</option>
              {modelsForMake.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="__new__">Other (type it)</option>
            </Select>
          </Field>
        )}
        {makeId === "__new__" || modelId === "__new__" ? (
          <Field label="New model name">
            <Input name="new_model" defaultValue={v.new_model} />
          </Field>
        ) : null}
        {makeId === "__new__" ? <input type="hidden" name="model_id" value={v.new_model ? "__new__" : ""} /> : null}
      </div>
      <Field label="Fuel" optional hint="Electric cars record battery percentage instead of fuel level.">
        <ChoiceButtons name="fuel_type" columns={4} defaultValue={v.fuel_type} options={FUEL_TYPES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
      </Field>
      <div>
        <SubmitButton>Save and gate in</SubmitButton>
      </div>
    </>
  );
}
