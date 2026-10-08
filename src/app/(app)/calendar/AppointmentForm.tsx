"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect } from "@/components/SearchSelect";
import { Card, ChoiceButtons, Field, Input, SectionLabel, Select, Textarea } from "@/components/ui";
import { DURATIONS } from "@/lib/calendar";

export type CustomerOption = { id: string; label: string; phone: string };
export type VehicleOption = { id: string; customerId: string; label: string };
export type AdvisorOption = { id: string; name: string };

/** Book or change an appointment: customer (existing or new), car, reason, date and time, advisor. */
export function AppointmentForm({
  action,
  customers,
  vehicles,
  advisors,
  initialValues,
  submitLabel,
}: {
  action: FormAction;
  customers: CustomerOption[];
  vehicles: VehicleOption[];
  advisors: AdvisorOption[];
  initialValues: Record<string, string>;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => <Fields v={v} customers={customers} vehicles={vehicles} advisors={advisors} submitLabel={submitLabel} />}
    </ActionForm>
  );
}

function Fields({ v, customers, vehicles, advisors, submitLabel }: { v: Record<string, string>; customers: CustomerOption[]; vehicles: VehicleOption[]; advisors: AdvisorOption[]; submitLabel: string }) {
  const [mode, setMode] = useState<"existing" | "new">(v.customer_mode === "new" ? "new" : "existing");
  const [customer, setCustomer] = useState({ id: v.customer_id || "", text: v.customer_text || customers.find((c) => c.id === v.customer_id)?.label || "" });
  const [vehicleId, setVehicleId] = useState(v.vehicle_id || "");
  const cars = vehicles.filter((c) => c.customerId === customer.id);
  const options = customers.map((c) => ({ id: c.id, label: `${c.label} · ${c.phone}` }));

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="flex flex-col gap-4">
          <SectionLabel>Customer</SectionLabel>
          <input type="hidden" name="customer_mode" value={mode} />
          <div className="grid grid-cols-2 gap-2">
            {(["existing", "new"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`min-h-12 rounded-control border px-3 text-sm font-semibold ${mode === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}
              >
                {m === "existing" ? "Existing customer" : "New customer"}
              </button>
            ))}
          </div>
          {mode === "existing" ? (
            <SearchSelect name="customer" label="Customer" options={options} value={customer} onChange={(c) => { setCustomer(c); setVehicleId(""); }} placeholder="Type a name or phone…" allowNew={false} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name">
                <Input name="new_name" defaultValue={v.new_name} required={mode === "new"} minLength={2} />
              </Field>
              <Field label="Phone (WhatsApp)">
                <Input name="new_phone" type="tel" inputMode="tel" defaultValue={v.new_phone} required={mode === "new"} placeholder="+971 50 123 4567" />
              </Field>
            </div>
          )}

          <SectionLabel>Car</SectionLabel>
          {mode === "existing" && cars.length ? (
            <Field label="Which car">
              <Select name="vehicle_id" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Not in the system yet</option>
                {cars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="vehicle_id" value="" />
          )}
          {!vehicleId ? (
            <Field label="Car (make, model, plate if known)" hint="The car record is created at gate-in.">
              <Input name="vehicle_text" defaultValue={v.vehicle_text} placeholder="For example: Porsche Cayenne, Dubai A 12345" />
            </Field>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-4">
          <SectionLabel>Visit</SectionLabel>
          <Field label="Reason for visit">
            <Input name="reason" defaultValue={v.reason} required minLength={2} placeholder="For example: 40,000 km service, brake noise" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date">
              <Input name="date" type="date" defaultValue={v.date} required />
            </Field>
            <Field label="Time">
              <Input name="time" type="time" defaultValue={v.time || "09:00"} required step={900} />
            </Field>
          </div>
          <Field label="Duration">
            <ChoiceButtons name="duration_minutes" columns={3} defaultValue={v.duration_minutes || "60"} options={DURATIONS.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min` }))} />
          </Field>
          <Field label="Advisor">
            <Select name="advisor_id" defaultValue={v.advisor_id ?? ""}>
              <option value="">Not assigned yet</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" optional>
            <Textarea name="notes" defaultValue={v.notes} rows={3} />
          </Field>
        </Card>
      </div>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </>
  );
}
