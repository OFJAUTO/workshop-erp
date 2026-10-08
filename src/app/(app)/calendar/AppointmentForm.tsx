"use client";

import { useState } from "react";
import { BookingIcon } from "@/components/BookingIcons";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect } from "@/components/SearchSelect";
import { Card, ChoiceButtons, Field, Input, SectionLabel, Select, Textarea } from "@/components/ui";
import { BOOKING_KINDS, BOOKING_KIND_HINTS, BOOKING_KIND_LABELS, COLLECT_METHODS, DURATIONS, type BookingKind } from "@/lib/calendar";

export type CustomerOption = { id: string; label: string; phone: string };
export type VehicleOption = { id: string; customerId: string; label: string };
export type AdvisorOption = { id: string; name: string; colour: string | null };
export type JobOption = { id: string; customerId: string; vehicleId: string; label: string };

/** Book or change a booking: type first, then only the fields that type needs. */
export function AppointmentForm({
  action,
  customers,
  vehicles,
  advisors,
  jobs,
  initialValues,
  submitLabel,
}: {
  action: FormAction;
  customers: CustomerOption[];
  vehicles: VehicleOption[];
  advisors: AdvisorOption[];
  jobs: JobOption[];
  initialValues: Record<string, string>;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => <Fields v={v} customers={customers} vehicles={vehicles} advisors={advisors} jobs={jobs} submitLabel={submitLabel} />}
    </ActionForm>
  );
}

function isKind(s: string | undefined): s is BookingKind {
  return (BOOKING_KINDS as readonly string[]).includes(s ?? "");
}

function Fields({ v, customers, vehicles, advisors, jobs, submitLabel }: { v: Record<string, string>; customers: CustomerOption[]; vehicles: VehicleOption[]; advisors: AdvisorOption[]; jobs: JobOption[]; submitLabel: string }) {
  const [kind, setKind] = useState<BookingKind | "">(isKind(v.kind) ? v.kind : "");
  const [mode, setMode] = useState<"existing" | "new">(v.customer_mode === "new" ? "new" : "existing");
  const [customer, setCustomer] = useState({ id: v.customer_id || "", text: v.customer_text || customers.find((c) => c.id === v.customer_id)?.label || "" });
  const [vehicleId, setVehicleId] = useState(v.vehicle_id || "");
  const cars = vehicles.filter((c) => c.customerId === customer.id);
  const options = customers.map((c) => ({ id: c.id, label: `${c.label} · ${c.phone}` }));

  return (
    <>
      <Card className="flex flex-col gap-3">
        <SectionLabel>What kind of booking</SectionLabel>
        <input type="hidden" name="kind" value={kind} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {BOOKING_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`min-h-16 rounded-control border px-3 py-2 text-left flex items-center gap-3 ${kind === k ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}
            >
              <span className="shrink-0">
                <BookingIcon kind={k} size={22} />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-bold">{BOOKING_KIND_LABELS[k]}</span>
                <span className={`text-[11px] ${kind === k ? "text-white/70" : "text-muted"}`}>{BOOKING_KIND_HINTS[k]}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {kind ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="flex flex-col gap-4">
            {kind === "customer_collects" ? (
              <>
                <SectionLabel>Finished car</SectionLabel>
                <Field label="Job card" hint="The customer and car come from the job card.">
                  <Select name="job_id" defaultValue={v.job_id ?? ""} required>
                    <option value="">Choose the job card…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note for the collection" optional>
                  <Input name="reason" defaultValue={v.reason} placeholder="For example: pay on collection, keys at reception" />
                </Field>
              </>
            ) : (
              <>
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
                      <Input name="new_name" defaultValue={v.new_name} required minLength={2} />
                    </Field>
                    <Field label="Phone (WhatsApp)">
                      <Input name="new_phone" type="tel" inputMode="tel" defaultValue={v.new_phone} required placeholder="+971 50 123 4567" />
                    </Field>
                  </div>
                )}

                <SectionLabel>Car</SectionLabel>
                {mode === "existing" && cars.length ? (
                  <Field label="Which car">
                    <Select name="vehicle_id" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                      <option value="">{kind === "customer_visit" ? "No car, or not in the system yet" : "Not in the system yet"}</option>
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
                  <Field label="Car (make, model, plate if known)" optional={kind === "customer_visit"} hint="The car record is created at gate-in.">
                    <Input name="vehicle_text" defaultValue={v.vehicle_text} placeholder="For example: Porsche Cayenne, Dubai A 12345" required={kind !== "customer_visit"} />
                  </Field>
                ) : null}
                <Field label="Reason for visit">
                  <Input name="reason" defaultValue={v.reason} required minLength={2} placeholder="For example: 40,000 km service, brake noise" />
                </Field>
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>{kind === "we_collect" ? "Collection" : "When"}</SectionLabel>
            {kind === "we_collect" ? (
              <>
                <Field label="Collection address">
                  <Textarea name="collect_address" defaultValue={v.collect_address} rows={2} required placeholder="Building, street, area, city" />
                </Field>
                <Field label="How we collect">
                  <ChoiceButtons name="collect_method" columns={3} defaultValue={v.collect_method} options={COLLECT_METHODS.map((m) => ({ value: m.value, label: m.label }))} />
                </Field>
              </>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date" hint="Any day, including days the workshop is closed.">
                <Input name="date" type="date" defaultValue={v.date} required />
              </Field>
              <Field label="Time">
                <Input name="time" type="time" defaultValue={v.time || "09:00"} required step={900} />
              </Field>
            </div>
            {kind === "customer_visit" ? (
              <Field label="How long">
                <ChoiceButtons name="duration_minutes" columns={4} defaultValue={v.duration_minutes || "30"} options={DURATIONS.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : "1 h" }))} />
              </Field>
            ) : null}
            <Field label="Assigned to" hint="A service advisor or the owner.">
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
      ) : null}

      {kind ? (
        <div>
          <SubmitButton>{submitLabel}</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">Choose the type of booking first.</p>
      )}
    </>
  );
}
