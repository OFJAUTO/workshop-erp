"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ImageCropper } from "@/components/ImageCropper";
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
  pictureMode = "none",
}: {
  action: FormAction;
  isElectric: boolean;
  initialValues?: Record<string, string>;
  mode?: "create" | "edit";
  /** required: the car has no picture yet; optional: it has one, a new one replaces it. */
  pictureMode?: "none" | "required" | "optional";
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => (
        <>
          <input type="hidden" name="is_electric" value={isElectric ? "yes" : "no"} />

          {pictureMode !== "none" ? (
            <Card className="flex flex-col gap-4">
              <SectionLabel>Car picture</SectionLabel>
              <p className="text-sm text-muted">
                {pictureMode === "required"
                  ? "Take a picture of the car. It is shown on the Cars page, the dashboard, the job card and the customer's approval page."
                  : "The car already has a picture. Take a new one here to replace it."}
              </p>
              <ImageCropper name="car_picture" shape="wide" outputWidth={960} outputHeight={600} capture="environment" label="Take or choose a picture" />
            </Card>
          ) : null}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
              <Field label="Major damage" hint="If yes, at least one damage photo is required in the next step.">
                <ChoiceButtons name="major_damage" columns={2} defaultValue={v.major_damage} options={YES_NO} />
              </Field>
              <Field label="Mileage (km)" hint="Take the dashboard photo in the next step.">
                <Input name="mileage" inputMode="numeric" defaultValue={v.mileage} className="max-w-48 text-lg font-bold" required />
              </Field>
            </Card>

            <div className="flex flex-col gap-6">
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
            </div>
          </div>

          <div>
            <SubmitButton>{mode === "create" ? "Save and continue to photos and video" : "Save amendments"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
