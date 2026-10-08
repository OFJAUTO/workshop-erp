"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Select } from "@/components/ui";

export type EstimateCustomer = { id: string; label: string };
export type EstimateVehicle = { id: string; customerId: string; label: string };

/** Pick the customer, then one of their cars. New customers and cars are added on their own pages first. */
export function NewEstimateForm({ action, customers, vehicles, initialCustomer, initialVehicle }: { action: FormAction; customers: EstimateCustomer[]; vehicles: EstimateVehicle[]; initialCustomer: string; initialVehicle: string }) {
  const [customerId, setCustomerId] = useState(initialCustomer);
  const cars = vehicles.filter((v) => v.customerId === customerId);
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {() => (
        <>
          <Field label="Customer">
            <Select name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="" disabled>
                Choose the customer…
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Car" hint={customerId && cars.length === 0 ? "This customer has no car on record yet. Add one under Cars, then come back." : undefined}>
            <Select name="vehicle_id" defaultValue={initialVehicle} required disabled={!customerId}>
              <option value="" disabled>
                {customerId ? "Choose the car…" : "Choose the customer first"}
              </option>
              {cars.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </Select>
          </Field>
          <div>
            <SubmitButton>Start the estimate</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
