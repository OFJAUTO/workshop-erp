"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input, Select, Textarea } from "@/components/ui";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";

export type CustomerOption = { id: string; label: string };

export function VehicleForm({
  action,
  initialValues,
  mode,
  customers,
  makes,
  models,
}: {
  action: FormAction;
  initialValues?: Record<string, string>;
  mode: "create" | "edit";
  customers: CustomerOption[];
  makes: VehicleMakeRow[];
  models: VehicleModelRow[];
}) {
  return (
    <ActionForm action={action} initialValues={initialValues}>
      {(v) => <Fields v={v} mode={mode} customers={customers} makes={makes} models={models} />}
    </ActionForm>
  );
}

function Fields({
  v,
  mode,
  customers,
  makes,
  models,
}: {
  v: Record<string, string>;
  mode: "create" | "edit";
  customers: CustomerOption[];
  makes: VehicleMakeRow[];
  models: VehicleModelRow[];
}) {
  const [country, setCountry] = useState(v.plate_country || "UAE");
  const [makeId, setMakeId] = useState(v.make_id || "");
  const [modelId, setModelId] = useState(v.model_id || "");
  const modelsForMake = models.filter((m) => m.make_id === makeId);

  return (
    <>
      <Field label="Customer">
        <Select name="customer_id" defaultValue={v.customer_id || ""} required>
          <option value="" disabled>
            Choose the customer…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="rounded-card border border-line p-4 flex flex-col gap-4">
        <span className="text-sm font-bold">Number plate</span>
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
            <ChoiceButtons
              name="plate_emirate"
              columns={4}
              defaultValue={v.plate_emirate || "Dubai"}
              options={EMIRATES.map((e) => ({ value: e, label: e }))}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Code" optional hint="Letter(s), e.g. F">
            <Input name="plate_code" defaultValue={v.plate_code} className="uppercase" maxLength={5} autoCapitalize="characters" />
          </Field>
          <div className="col-span-2">
            <Field label="Number">
              <Input
                name="plate_number"
                defaultValue={v.plate_number}
                required
                className="uppercase text-lg font-bold tracking-[0.05em]"
                autoCapitalize="characters"
                autoFocus={mode === "create"}
              />
            </Field>
          </div>
        </div>
      </div>

      <Field label="VIN" optional hint="17 characters, from the door jamb or windscreen plate.">
        <Input name="vin" defaultValue={v.vin} className="uppercase font-mono" maxLength={17} autoCapitalize="characters" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Make">
          <Select
            name="make_id"
            value={makeId}
            onChange={(e) => {
              setMakeId(e.target.value);
              setModelId("");
            }}
            required
          >
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
            <Input name="new_model" defaultValue={v.new_model} required={modelId === "__new__"} />
          </Field>
        ) : null}
        {makeId === "__new__" ? <input type="hidden" name="model_id" value={v.new_model ? "__new__" : ""} /> : null}
        <Field label="Variant" optional hint="For example: 4S, Turbo S, GTS">
          <Input name="variant" defaultValue={v.variant} />
        </Field>
        <Field label="Model year" optional>
          <Input name="model_year" inputMode="numeric" defaultValue={v.model_year} maxLength={4} />
        </Field>
        <Field label="Colour" optional>
          <Input name="colour" defaultValue={v.colour} />
        </Field>
        <Field label="Last known mileage (km)" optional>
          <Input name="last_mileage" inputMode="numeric" defaultValue={v.last_mileage} />
        </Field>
      </div>

      <Field label="Fuel" optional>
        <ChoiceButtons
          name="fuel_type"
          columns={4}
          defaultValue={v.fuel_type}
          options={FUEL_TYPES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))}
        />
      </Field>

      <Field label="Notes" optional>
        <Textarea name="notes" defaultValue={v.notes} />
      </Field>

      <div>
        <SubmitButton>{mode === "create" ? "Save car" : "Save changes"}</SubmitButton>
      </div>
    </>
  );
}
