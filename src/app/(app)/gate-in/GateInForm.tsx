"use client";

import { JOB_DEPARTMENTS } from "@/lib/inspection";

import { useState } from "react";
import { ActionForm, type FormAction } from "@/components/forms";
import { GateInAssist } from "@/components/GateInAssist";
import { ImageCropper } from "@/components/ImageCropper";
import { MileageInput } from "@/components/MileageInput";
import { RequestsList } from "@/components/RequestsList";
import { Card, ChoiceButtons, Field, Input, SectionLabel, Textarea } from "@/components/ui";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS } from "@/lib/jobs";
import type { MileageUnit } from "@/lib/mileage";
import type { Branch } from "@/lib/settings";
import { GeoCapture } from "./GeoCapture";

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
  branches = [],
  requests = [],
  requestsLocked = false,
  mileageUnit = "km",
  mileageContext = { modelYear: null, lastKm: null, lastVisitAt: null },
  estimates = [],
}: {
  action: FormAction;
  isElectric: boolean;
  initialValues?: Record<string, string>;
  mode?: "create" | "edit";
  /** required: the car has no picture yet; optional: it has one, a new one replaces it. */
  pictureMode?: "none" | "required" | "optional";
  branches?: Branch[];
  requests?: string[];
  /** After the gate-in is complete the request lines can no longer be changed. */
  requestsLocked?: boolean;
  /** The unit this car was last entered in. */
  mileageUnit?: MileageUnit;
  /** What the mileage checks compare against. */
  mileageContext?: { modelYear: number | null; lastKm: number | null; lastVisitAt: string | null };
  /** Accepted estimates for this car that no job has used yet. */
  estimates?: { id: string; label: string; hint: string }[];
}) {
  const [location, setLocation] = useState(initialValues?.location_choice ?? (branches[0]?.name ?? "customer"));
  const [vip, setVip] = useState(initialValues?.vip === "on");
  const atBranch = branches.some((b) => b.name === location);

  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => (
        <>
          <input type="hidden" name="is_electric" value={isElectric ? "yes" : "no"} />
          {v.appointment_id ? <input type="hidden" name="appointment_id" value={v.appointment_id} /> : null}

          {pictureMode !== "none" ? (
            <Card className="flex flex-col gap-4">
              <SectionLabel>Car picture</SectionLabel>
              <p className="text-sm text-muted">
                {pictureMode === "required"
                  ? "Take a picture of the car. Internal only: the Cars page, the dashboard and the job card."
                  : "The car already has a picture. Take a new one here to replace it."}
              </p>
              <ImageCropper name="car_picture" shape="wide" outputWidth={960} outputHeight={600} capture="environment" label="Take or choose a picture" />
            </Card>
          ) : null}

          {mode === "create" ? (
            <Card className="flex flex-col gap-4">
              <SectionLabel>Gate-in location</SectionLabel>
              <div onChange={(e) => setLocation((e.target as HTMLInputElement).value)}>
                <ChoiceButtons
                  name="location_choice"
                  columns={3}
                  defaultValue={location}
                  options={[
                    ...branches.map((b) => ({ value: b.name, label: b.name, hint: b.address || undefined })),
                    { value: "customer", label: "Customer location" },
                    { value: "other", label: "Other" },
                  ]}
                />
              </div>
              {!atBranch ? (
                <>
                  <Field label={location === "customer" ? "Customer address" : "Where is the car?"} hint="Address or a short description.">
                    <Textarea name="location_address" defaultValue={v.location_address} rows={2} required />
                  </Field>
                  <GeoCapture />
                </>
              ) : null}
              <p className="text-xs text-muted">The location is recorded with the gate-in time and cannot be changed afterwards.</p>
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
              <Field label="Mileage" hint="Kilometres or miles; both are kept. Take the dashboard photo in the next step.">
                <MileageInput initialValue={v.mileage_entered} initialUnit={(v.mileage_unit as MileageUnit) || mileageUnit} initialConfirmed={v.mileage_confirmed === "yes"} context={mileageContext} />
              </Field>
            </Card>

            <div className="flex flex-col gap-6">
              <Card className="flex flex-col gap-5">
                <SectionLabel>Keys</SectionLabel>
                <Field label="Number of keys received">
                  <ChoiceButtons name="keys_count" columns={4} defaultValue={v.keys_count} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} />
                </Field>
                <Field label="Came with keychain">
                  <ChoiceButtons name="keys_keychain" columns={2} defaultValue={v.keys_keychain} options={YES_NO} />
                </Field>
              </Card>

              <Card className="flex flex-col gap-5">
                <SectionLabel>Customer</SectionLabel>
                <Field label="Customer requests, one line each, in their own words" hint={requestsLocked ? "Locked once the gate-in is complete." : "Enter adds a line. At least one is required."}>
                  <RequestsList initial={requests} locked={requestsLocked} />
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
                {estimates.length ? (
                  <Field label="Accepted estimate" hint="Attach it and it opens as the quotation, pre-filled, once the inspection is approved.">
                    <ChoiceButtons name="estimate_id" columns={2} defaultValue={v.estimate_id ?? estimates[0].id} options={[...estimates.map((e) => ({ value: e.id, label: e.label, hint: e.hint })), { value: "", label: "No estimate" }]} />
                  </Field>
                ) : null}
                <Field label="Department" hint="Which side of the workshop the car goes to. Both: it moves on only when both sides are finished.">
                  <ChoiceButtons name="department" columns={3} defaultValue={v.department} options={JOB_DEPARTMENTS.map((d) => ({ value: d.value, label: d.label }))} />
                </Field>
                <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                  <input type="checkbox" name="vip" checked={vip} onChange={(e) => setVip(e.target.checked)} className="h-5 w-5 accent-ink" />
                  <span className="text-sm font-bold">VIP</span>
                  <span className="text-xs text-muted">Marks the customer as VIP for every visit. Logged.</span>
                </label>
                {vip ? (
                  <Field label="VIP handling note" hint="Shown to everyone who opens this customer's cars.">
                    <Textarea name="vip_note" defaultValue={v.vip_note} rows={2} />
                  </Field>
                ) : null}
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
                <p className="text-xs text-muted">The promised date is set in the quotation, once every part has its delivery date.</p>
              </Card>
            </div>
          </div>

          <div>
            <GateInAssist submitLabel={mode === "create" ? "Save and continue to photos and video" : "Save amendments"} />
          </div>
        </>
      )}
    </ActionForm>
  );
}
