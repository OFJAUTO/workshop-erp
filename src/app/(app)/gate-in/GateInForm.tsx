"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, ChoiceButtons, Field, Input, SectionLabel, Textarea } from "@/components/ui";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS } from "@/lib/jobs";

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function GateInForm({
  action,
  isElectric,
  initialValues,
  mode = "create",
}: {
  action: FormAction;
  isElectric: boolean;
  initialValues?: Record<string, string>;
  mode?: "create" | "edit";
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => (
        <>
          <input type="hidden" name="is_electric" value={isElectric ? "yes" : "no"} />

          <Card className="flex flex-col gap-5">
            <SectionLabel>Arrival</SectionLabel>
            <Field label="Arrived by">
              <ChoiceButtons name="arrived_by" columns={2} defaultValue={v.arrived_by} options={ARRIVED_BY.map((o) => ({ ...o }))} />
            </Field>
            <Field label="Vehicle condition">
              <ChoiceButtons name="condition" columns={3} defaultValue={v.condition} options={CONDITIONS.map((o) => ({ ...o }))} />
            </Field>
            {isElectric ? (
              <Field label="Battery (%)">
                <Input name="battery_percent" inputMode="numeric" defaultValue={v.battery_percent} maxLength={3} className="max-w-32 text-lg font-bold" />
              </Field>
            ) : (
              <Field label="Fuel level">
                <ChoiceButtons name="fuel_level" columns={4} defaultValue={v.fuel_level} options={FUEL_LEVELS.map((o) => ({ ...o }))} />
              </Field>
            )}
            <Field label="Cleanliness">
              <ChoiceButtons name="cleanliness" columns={4} defaultValue={v.cleanliness} options={CLEANLINESS.map((o) => ({ ...o }))} />
            </Field>
            <Field label="Dash cam fitted" hint="Dash cam will be disconnected as per terms and conditions.">
              <ChoiceButtons name="dash_cam" columns={2} defaultValue={v.dash_cam} options={YES_NO} />
            </Field>
            <Field label="Mileage (km)" hint="Take the dashboard photo in the next step.">
              <Input name="mileage" inputMode="numeric" defaultValue={v.mileage} className="max-w-48 text-lg font-bold" required />
            </Field>
          </Card>

          <Card className="flex flex-col gap-5">
            <SectionLabel>Keys</SectionLabel>
            <Field label="Number of keys received">
              <ChoiceButtons
                name="keys_count"
                columns={4}
                defaultValue={v.keys_count}
                options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))}
              />
            </Field>
            <Field label="Came with keychain">
              <ChoiceButtons name="keys_keychain" columns={2} defaultValue={v.keys_keychain} options={YES_NO} />
            </Field>
          </Card>

          <Card className="flex flex-col gap-5">
            <SectionLabel>Customer</SectionLabel>
            <Field label="Customer requests, in their own words">
              <Textarea name="customer_requests" defaultValue={v.customer_requests} rows={4} required />
            </Field>
            <Field label="Notes for unusual cases" optional>
              <Textarea name="notes" defaultValue={v.notes} rows={2} />
            </Field>
            <Field label="Customer wants old parts returned">
              <ChoiceButtons name="old_parts_return" columns={2} defaultValue={v.old_parts_return} options={YES_NO} />
            </Field>
          </Card>

          <Card className="flex flex-col gap-5">
            <SectionLabel>Plan</SectionLabel>
            <Field label="Priority">
              <ChoiceButtons
                name="priority"
                columns={3}
                defaultValue={v.priority ?? "normal"}
                options={[
                  { value: "high", label: "High" },
                  { value: "normal", label: "Normal" },
                  { value: "low", label: "Low" },
                ]}
              />
            </Field>
            <Field label="Promised date">
              <Input name="promised_at" type="date" defaultValue={v.promised_at} className="max-w-56" required />
            </Field>
          </Card>

          <div>
            <SubmitButton>{mode === "create" ? "Save and continue to photos and video" : "Save amendments"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
