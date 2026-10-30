"use client";

import { JOB_DEPARTMENTS } from "@/lib/inspection";

import { useState } from "react";
import { ActionForm, type FormAction } from "@/components/forms";
import { GateInAssist } from "@/components/GateInAssist";
import { ImageCropper } from "@/components/ImageCropper";
import { MileageInput } from "@/components/MileageInput";
import { RequestsList } from "@/components/RequestsList";
import { InspectionFeeChoice } from "@/components/InspectionFeeChoice";
import type { FeeBounds, FeeInput } from "@/lib/inspection-fee";
import { FormDraft } from "@/components/FormDraft";
import { Card, ChoiceButtons, Field, Input, LinkButton, SectionLabel, Textarea } from "@/components/ui";
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
  comebacks = [],
  draftKey,
  returnTo,
  recoveryTypes = [],
  inspectionFee = null,
  rechecks = [],
  initialVisit = "normal",
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
  /** 30 October 2026: this car's delivered PPF jobs - a PPF RECHECK (FREE) visit is for one of them. */
  rechecks?: { id: string; number: string; date: string; what: string; checkDone: string | null }[];
  /** Opened with ?visit=recheck: the recheck is chosen already. */
  initialVisit?: "normal" | "recheck";
  /** Every open estimate of this car that no job has taken yet (30 October 2026: all carry over). */
  estimates?: { id: string; label: string; hint: string }[];
  /** Jobs of this car gated out within the comeback window. */
  comebacks?: { id: string; label: string; hint: string }[];
  /** Keeps what was typed in this browser until Save, so a closed tablet loses nothing. */
  draftKey?: string;
  /** Normal / Full down / Closed box (Settings): asked when the car came on our recovery, carried onto the quotation. */
  recoveryTypes?: { key: string; label: string }[];
  /** Where Save returns to: "media" for the photos step (its Back button leads here). */
  returnTo?: string;
  /** Section 8: the inspection fee if no work is approved - the default (premium brands higher), who may lower it, and the lock after approval. */
  /** 30 October 2026: the fee choice when an advisor or the owner does the gate-in (null for the gate-in person). */
  inspectionFee?: { initial: FeeInput; bounds: FeeBounds; isOwner: boolean; locked: boolean; words: string } | null;
}) {
  const [arrivedBy, setArrivedBy] = useState(initialValues?.arrived_by ?? "");
  const [location, setLocation] = useState(initialValues?.location_choice ?? (branches[0]?.name ?? "customer"));
  const [vip, setVip] = useState(initialValues?.vip === "on");
  const [visit, setVisit] = useState<"normal" | "recheck">(initialValues?.visit_type === "recheck" || (initialVisit === "recheck" && rechecks.length) ? "recheck" : "normal");
  const recheck = visit === "recheck";
  const atBranch = branches.some((b) => b.name === location);

  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => (
        <>
          {draftKey ? <FormDraft draftKey={draftKey} skip={["requests"]} /> : null}
          {v.open_job_id ? (
            <div className="rounded-control border-2 border-ink p-4 flex flex-wrap items-center gap-3" data-open-job={v.open_job_number}>
              <span className="font-semibold">The car is on job {v.open_job_number}.</span>
              <LinkButton href={`/jobs/${v.open_job_id}`} size="lg" data-open-job-link>Open {v.open_job_number}</LinkButton>
            </div>
          ) : null}
          <input type="hidden" name="is_electric" value={isElectric ? "yes" : "no"} />
          {v.appointment_id ? <input type="hidden" name="appointment_id" value={v.appointment_id} /> : null}
          {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

          {mode === "create" && rechecks.length ? (
            // 30 October 2026: the free 10-day final check after a PPF job is its own visit, next to the normal one.
            <Card className="flex flex-col gap-4" data-visit-type={visit}>
              <SectionLabel>Visit</SectionLabel>
              <input type="hidden" name="visit_type" value={visit} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([["normal", "Normal visit", "Inspection, quotation, the customer approves"], ["recheck", "PPF RECHECK (FREE)", "The 10-day final check of a PPF job: no fee, no quotation, no invoice"]] as const).map(([key, title, hint]) => (
                  <button key={key} type="button" onClick={() => setVisit(key)} aria-pressed={visit === key} data-visit={key} className={`min-h-20 rounded-card border-2 px-4 py-3 text-left flex flex-col gap-1 ${visit === key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                    <span className="text-base font-extrabold">{title}</span>
                    <span className={`text-xs ${visit === key ? "text-white/80" : "text-muted"}`}>{hint}</span>
                  </button>
                ))}
              </div>
              {recheck ? (
                <Field label="Which PPF job is this the final check for?">
                  <ChoiceButtons name="recheck_of" columns={2} defaultValue={v.recheck_of ?? (rechecks.length === 1 ? rechecks[0].id : null)} options={rechecks.map((r) => ({ value: r.id, label: `${r.number} · delivered ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(r.date))}`, hint: `${r.what}${r.checkDone ? " · final check already done" : ""}` }))} />
                </Field>
              ) : null}
              {recheck ? <p className="text-sm text-muted" data-recheck-note>Goes straight to the PPF team. The customer is not asked to approve anything and nothing is charged: the time and any film go to the original job.</p> : null}
            </Card>
          ) : null}

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
              <div className="flex flex-col gap-5" onChange={(e) => { const t = e.target as HTMLInputElement; if (t.name === "arrived_by") setArrivedBy(t.value); }}>
                <Field label="Arrived by">
                  <ChoiceButtons name="arrived_by" columns={2} defaultValue={v.arrived_by} options={ARRIVED_BY.map((o) => ({ ...o }))} />
                </Field>
                {arrivedBy === "our_recovery" && recoveryTypes.length ? (
                  <Field label="Recovery type" hint="Goes onto the quotation as the recovery line, with its usual price.">
                    <ChoiceButtons name="recovery_type" columns={3} defaultValue={v.recovery_type || recoveryTypes[0].key} options={recoveryTypes.map((t) => ({ value: t.key, label: t.label }))} />
                  </Field>
                ) : null}
              </div>
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
                  <RequestsList initial={requests} locked={requestsLocked} draftKey={draftKey} />
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
                {estimates.length && !recheck ? (
                  // 30 October 2026: every open estimate of the car carries over; each opens as its own quotation (the first as
                  // the original, the others as additional ones) once the inspection is approved. Untick one to leave it off.
                  <Field label={estimates.length === 1 ? "Estimate for this car" : `${estimates.length} estimates for this car`} hint="Ticked estimates carry over to the job: each opens as its own quotation, pre-filled, once the inspection is approved.">
                    <div className="flex flex-col gap-2" data-carry-estimates={estimates.length}>
                      {estimates.map((e) => (
                        <label key={e.id} className="flex min-h-11 items-start gap-3 rounded-control border border-line-strong bg-white px-3 py-2.5 cursor-pointer" data-carry-estimate={e.label.split(" ")[0]}>
                          <input type="checkbox" name="carry_estimate" value={e.id} defaultChecked className="mt-0.5 h-5 w-5 shrink-0 accent-ink" />
                          <span className="flex flex-col">
                            <span className="text-sm font-bold">{e.label}</span>
                            {e.hint ? <span className="text-xs text-muted">{e.hint}</span> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  </Field>
                ) : null}
                {recheck ? (
                  <input type="hidden" name="department" value="bodyshop" />
                ) : (
                  <Field label="Department" hint="Which side of the workshop the car goes to. Both: it moves on only when both sides are finished.">
                    <ChoiceButtons name="department" columns={3} defaultValue={v.department} options={JOB_DEPARTMENTS.map((d) => ({ value: d.value, label: d.label }))} />
                  </Field>
                )}
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
                {comebacks.length && !recheck ? (
                  <Field label="Is this a comeback for a previous job?" hint="A car back within the window for the same problem. The manager picks the cause after the inspection; only the owner can make it free.">
                    <ChoiceButtons name="comeback_of" columns={2} defaultValue={v.comeback_of ?? ""} options={[{ value: "", label: "No, a new visit" }, ...comebacks.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))]} />
                  </Field>
                ) : null}
                {recheck ? (
                  <p className="text-sm font-semibold text-green" data-recheck-no-fee>No inspection fee: the PPF final check is free.</p>
                ) : inspectionFee && !inspectionFee.locked ? (
                  // 30 October 2026: THE fee choice (Inspection fee with the amount, or No inspection fee with the reason).
                  <div data-inspection-fee>
                    <InspectionFeeChoice initial={inspectionFee.initial} bounds={inspectionFee.bounds} isOwner={inspectionFee.isOwner} />
                  </div>
                ) : inspectionFee?.locked ? (
                  <p className="text-sm text-muted" data-inspection-fee-locked><span className="font-bold">{inspectionFee.words}</span> — locked (the customer approved the job card). Only the owner changes it, on the job card.</p>
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
