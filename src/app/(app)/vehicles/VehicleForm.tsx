"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, ChoiceButtons, Field, Input, Select, Textarea } from "@/components/ui";
import { EMIRATES, FUEL_TYPES, PLATE_COUNTRIES, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";
import { mergeVehicleAction } from "./actions";

export type CustomerOption = { id: string; label: string };

export function VehicleForm({
  action,
  initialValues,
  mode,
  vehicleId = null,
  customers,
  makes,
  models,
}: {
  action: FormAction;
  initialValues?: Record<string, string>;
  mode: "create" | "edit";
  /** The record being edited (the merge needs it: "this plate is on car X - merge THIS record into X"). */
  vehicleId?: string | null;
  customers: CustomerOption[];
  makes: VehicleMakeRow[];
  models: VehicleModelRow[];
}) {
  return (
    <ActionForm action={action} initialValues={initialValues}>
      {(v) => <Fields v={v} mode={mode} vehicleId={vehicleId} customers={customers} makes={makes} models={models} />}
    </ActionForm>
  );
}

function Fields({
  v,
  mode,
  vehicleId,
  customers,
  makes,
  models,
}: {
  v: Record<string, string>;
  mode: "create" | "edit";
  vehicleId: string | null;
  customers: CustomerOption[];
  makes: VehicleMakeRow[];
  models: VehicleModelRow[];
}) {
  const [noPlate, setNoPlate] = useState(v.has_plate === "no" && !v.plate_number);
  const [country, setCountry] = useState(v.plate_country || "UAE");
  // The plate boxes are controlled so typing can untick "No number plate" and so a transfer is noticed live.
  const [code, setCode] = useState(v.plate_code ?? "");
  const [number, setNumber] = useState(v.plate_number ?? "");
  const [emirate, setEmirate] = useState(v.plate_emirate || "Dubai");
  const [makeId, setMakeId] = useState(v.make_id || "");
  const [modelId, setModelId] = useState(v.model_id || "");
  const modelsForMake = models.filter((m) => m.make_id === makeId);

  // A car that already HAS a plate: changing it is a transfer and needs the remark (kept in the history).
  // The original plate is captured at mount: after a failed save the form's values are what was TYPED, never the record.
  const [orig] = useState(() => ({
    hadPlate: mode === "edit" && v.has_plate === "yes" && !!(v.plate_number ?? "").trim(),
    country: v.plate_country || "UAE",
    emirate: v.plate_emirate || "Dubai",
    code: (v.plate_code ?? "").trim().toUpperCase(),
    number: (v.plate_number ?? "").replace(/\s+/g, "").toUpperCase(),
  }));
  const plateDiffers =
    orig.hadPlate &&
    (noPlate ||
      country !== orig.country ||
      (country === "UAE" && emirate !== orig.emirate) ||
      code.trim().toUpperCase() !== orig.code ||
      number.replace(/\s+/g, "").toUpperCase() !== orig.number);

  // "This plate is on car X. Merge?" - the save answered with the twin; dismissing keeps editing (prev-value pattern).
  const [dismissedDup, setDismissedDup] = useState<string | null>(null);
  const dupId = v.dup_vehicle_id && v.dup_vehicle_id !== dismissedDup ? v.dup_vehicle_id : null;

  const typedPlate = (next: string) => {
    if (next.trim() && noPlate) setNoPlate(false);
  };

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
        <label className="flex items-center gap-3 min-h-11 cursor-pointer">
          <input type="checkbox" name="no_plate" checked={noPlate} onChange={(e) => setNoPlate(e.target.checked)} className="h-5 w-5 accent-ink" data-no-plate />
          <span className="text-sm font-semibold">No number plate</span>
          <span className="text-xs text-muted">Typing a plate below unticks this by itself.</span>
        </label>
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
            <div onChange={(e) => { const t = e.target as HTMLInputElement; if (t?.name === "plate_emirate" && t.value) setEmirate(t.value); }}>
              <ChoiceButtons
                name="plate_emirate"
                columns={4}
                defaultValue={v.plate_emirate || "Dubai"}
                options={EMIRATES.map((em) => ({ value: em, label: em }))}
              />
            </div>
          </Field>
        ) : null}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Code" optional hint="1-2 letters or numbers (AA, DD, 1, 16)">
            <Input name="plate_code" value={code} onChange={(e) => { setCode(e.target.value); typedPlate(e.target.value); }} className="uppercase" maxLength={5} textCase="upper" data-plate-code />
          </Field>
          <div className="col-span-2">
            <Field label="Number" hint={country === "UAE" ? "1-5 digits" : undefined} optional={noPlate}>
              <Input
                name="plate_number"
                value={number}
                onChange={(e) => { setNumber(e.target.value); typedPlate(e.target.value); }}
                required={!noPlate}
                className="uppercase text-lg font-bold tracking-[0.05em]"
                textCase="upper"
                autoFocus={mode === "create"}
                data-plate-number
              />
            </Field>
          </div>
        </div>
        {plateDiffers ? (
          <Field label="Why is the plate changing?" hint="A plate transfer is fine - say why in a few words. It is kept in the history, and the old plate still finds this car.">
            <Input name="plate_remark" defaultValue={v.plate_remark} required minLength={3} textCase="sentence" placeholder="For example: plate transferred to the new car" data-plate-remark />
          </Field>
        ) : (
          <input type="hidden" name="plate_remark" value="" />
        )}
      </div>

      {dupId && mode === "edit" && vehicleId ? (
        <div className="rounded-card border-2 border-red-bar bg-white p-4 flex flex-col gap-2" data-merge-ask>
          <span className="text-sm font-bold text-red">This {v.dup_kind === "vin" ? "VIN" : "plate"} is on another car record:</span>
          <span className="text-base font-extrabold" data-merge-keep-words>{v.dup_vehicle_words}</span>
          <p className="text-sm">
            Merge the two records? <span className="font-bold">{v.dup_vehicle_words}</span> is kept. Everything from THIS record - jobs, estimates and quotations, invoices, payments, bookings and photos - moves to it, and this record leaves the list with a note saying where it went.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="md" tone="danger" formAction={mergeVehicleAction.bind(null, dupId, vehicleId)} formNoValidate data-merge-confirm>
              Merge into {v.dup_vehicle_words}
            </Button>
            <Button type="button" tone="ghost" size="md" onClick={() => setDismissedDup(dupId)}>
              Keep editing instead
            </Button>
          </div>
        </div>
      ) : null}

      <Field label="VIN" optional hint="17 characters, from the door jamb or windscreen plate.">
        <Input name="vin" defaultValue={v.vin} className="uppercase font-mono" maxLength={17} textCase="upper" />
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
          <Input name="colour" defaultValue={v.colour} textCase="title" />
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
        <Textarea name="notes" defaultValue={v.notes} textCase="sentence" />
      </Field>

      <div>
        <SubmitButton>{mode === "create" ? "Save car" : "Save changes"}</SubmitButton>
      </div>
    </>
  );
}
