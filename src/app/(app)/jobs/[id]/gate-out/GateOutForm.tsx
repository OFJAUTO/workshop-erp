"use client";

import { useState } from "react";
import { ReasonChips } from "@/components/ReasonChips";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { FinalMileage } from "@/components/FinalMileage";
import type { MileageUnit } from "@/lib/mileage";
import { Button, ChoiceButtons, Field, Input, Notice } from "@/components/ui";

export type BalanceInfo = { state: "paid" | "part_paid" | "unpaid" | "cheque_pending" | "no_invoice" | "nothing"; balance: number; invoiceNumber: string | null };

/** A driver saved on the customer (customer_contacts). */
export type SavedContact = { id: string; name: string; phone: string | null; relationship: string | null };

/** A saved recovery driver (Settings > Recovery drivers, or learned at gate-out). */
export type SavedDriver = { id: string; name: string; phone: string | null; truck_plate: string | null; company: string | null; is_default: boolean };

const keysWords = (n: number | string, chain: boolean) => `${n} key${Number(n) === 1 ? "" : "s"}, ${chain ? "with" : "no"} keychain`;

/**
 * The gate-out form: how the car leaves (the customer, prefilled from the record; a saved driver or a new one, saved
 * for next time; a recovery company from the list with the driver's name), the checks before release, the handover.
 * The keys are prefilled from the gate-in; a different count asks for an amber confirmation first.
 */
export function GateOutForm({
  jobId,
  action,
  keysCount,
  keychain,
  dashCam,
  oldParts,
  canOverride,
  canApproveRelease,
  balance,
  reasons = { keys: [], release: [] },
  finalCheck = null,
  creditDays = 0,
  declinedOut = false,
  customer = null,
  contacts = [],
  recoveryCompanies = [],
  drivers = [],
  lastPin = null,
  mileage = null,
}: {
  jobId: string;
  action: FormAction;
  keysCount: number;
  keychain: boolean;
  dashCam: boolean;
  oldParts: boolean;
  canOverride: boolean;
  canApproveRelease: boolean;
  balance: BalanceInfo;
  /** One-tap reasons for the keys override and for releasing (Settings). */
  reasons?: { keys: string[]; release: string[] };
  /** A PPF car: the final check visit, 7 to 14 days after the handover. */
  finalCheck?: { defaultDate: string; min: string; max: string } | null;
  /** Agreed credit days on the customer (owner-set); 0 = pay before release. */
  creditDays?: number;
  /** The customer declined the quotation: the car goes out, free unless a charge was invoiced. */
  declinedOut?: boolean;
  /** The customer's own name and phone, prefilled when the customer collects. */
  customer?: { name: string; phone: string } | null;
  /** Drivers and other people saved on the customer. */
  contacts?: SavedContact[];
  /** Outside recovery companies from Settings; a typed one is added to the list. */
  recoveryCompanies?: string[];
  /** Saved recovery drivers: one tap, the regular one first. */
  drivers?: SavedDriver[];
  /** A returning customer's last delivery pin, prefilled (editable). */
  lastPin?: { url: string; details: string | null } | null;
  /** 30 October 2026: the final reading and the cluster photo (null for loose items: no car). */
  mileage?: { unit: MileageUnit; inReading: number | null; alertKm: number; photo: JobFile | null } | null;
}) {
  const [method, setMethod] = useState<string>("customer");
  const [oldPartsTicked, setOldPartsTicked] = useState(false);
  const [oldPartsPhotos, setOldPartsPhotos] = useState<JobFile[]>([]);
  const [driver, setDriver] = useState<string>(contacts[0]?.id ?? "new");
  const [company, setCompany] = useState<string>("our_truck");
  const companyDrivers = drivers.filter((d) => (company === "our_truck" ? !d.company : company !== "other" && (d.company ?? "").toLowerCase() === company.toLowerCase()));
  const defaultDriver = companyDrivers.find((d) => d.is_default) ?? companyDrivers[0] ?? null;
  const [truckDriver, setTruckDriver] = useState<string>(defaultDriver?.id ?? "new");
  const chosenDriver = companyDrivers.find((d) => d.id === truckDriver) ?? null;
  const [pin, setPin] = useState<string>(lastPin?.url ?? "");
  const pinOk = /^https?:\/\//.test(pin.trim()) && /(google\.|goo\.gl|maps\.app|maps\.apple|wa\.me)/.test(pin);
  // The chip writes the chosen date itself, so the clock is read on the tap, never during render.
  const [dateChoice, setDateChoice] = useState<string>("today");
  const [chipDate, setChipDate] = useState<string>("");
  const [slotChoice, setSlotChoice] = useState<string>("afternoon");
  const [keysDiffer, setKeysDiffer] = useState(false);
  const [returned, setReturned] = useState<string>(String(keysCount));
  const [chain, setChain] = useState<string>(keychain ? "yes" : "no");
  const [photos, setPhotos] = useState<JobFile[]>([]);
  const mismatch = keysDiffer && (Number(returned) !== keysCount || (chain === "yes") !== keychain);
  const onCredit = balance.state !== "no_invoice" && balance.balance > 0 && creditDays > 0;
  // Nothing to pay on a declined job: no invoice at all, or none owed.
  const declinedFree = declinedOut && balance.balance <= 0 && (balance.state === "no_invoice" || balance.state === "nothing");
  const blocked = ((balance.state === "no_invoice" && !declinedFree) || balance.balance > 0) && !onCredit;
  const blockedText = balance.state === "no_invoice" ? "No invoice has been issued for this job." : `Balance due AED ${balance.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}${balance.invoiceNumber ? ` on ${balance.invoiceNumber}` : ""}.`;

  return (
    <ActionForm action={action}>
      {(v) => (
        <>
          {mileage ? <FinalMileage jobId={jobId} unit={mileage.unit} inReading={mileage.inReading} alertKm={mileage.alertKm} initial={{ reading: v.mileage_out, reason: v.mileage_unreadable_reason, note: v.mileage_unreadable_note, photo: mileage.photo }} /> : null}
          <Field label="How does the car leave?">
            <div onChange={(e) => setMethod((e.target as HTMLInputElement).value)}>
              <ChoiceButtons name="leave_method" columns={3} defaultValue={v.leave_method ?? "customer"} options={[{ value: "customer", label: "Customer collects" }, { value: "customer_driver", label: "Customer's driver collects" }, { value: "recovery", label: "Delivery by recovery" }]} />
            </div>
          </Field>

          {method === "customer" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-collector="customer">
              <Field label="Name of the person collecting" hint="From the customer's record; change it if someone else collects.">
                <Input name="collector_name" defaultValue={v.collector_name ?? customer?.name ?? ""} required />
              </Field>
              <Field label="Phone" optional>
                <Input name="collector_phone" type="tel" inputMode="tel" defaultValue={v.collector_phone ?? customer?.phone ?? ""} />
              </Field>
            </div>
          ) : method === "customer_driver" ? (
            <div className="flex flex-col gap-3" data-collector="driver">
              {contacts.length ? (
                <Field label="Which driver?" hint="Saved on the customer. Tap one, or add a new driver.">
                  <div onChange={(e) => setDriver((e.target as HTMLInputElement).value)}>
                    <ChoiceButtons
                      name="collector_contact_id"
                      columns={2}
                      defaultValue={v.collector_contact_id ?? driver}
                      options={[...contacts.map((c) => ({ value: c.id, label: c.name, hint: [c.relationship, c.phone].filter(Boolean).join(" · ") || undefined })), { value: "new", label: "New driver" }]}
                    />
                  </div>
                </Field>
              ) : (
                <input type="hidden" name="collector_contact_id" value="new" />
              )}
              {driver === "new" || !contacts.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-new-driver>
                  <Field label="Driver's name">
                    <Input name="collector_name" defaultValue={v.collector_name} required />
                  </Field>
                  <Field label="Driver's phone">
                    <Input name="collector_phone" type="tel" inputMode="tel" defaultValue={v.collector_phone} required />
                  </Field>
                  <p className="sm:col-span-2 text-xs text-muted">Saved on the customer as a driver, so next time it is one tap.</p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-card border border-line p-3" data-collector="recovery">
              <Field label="Recovery company" hint="Our truck, a company from the list, or a new one (added to the list for next time).">
                <div onChange={(e) => { setCompany((e.target as HTMLInputElement).value); setTruckDriver("new"); }}>
                  <ChoiceButtons
                    name="delivery_company_choice"
                    columns={3}
                    defaultValue={v.delivery_company_choice ?? "our_truck"}
                    options={[{ value: "our_truck", label: "Our truck" }, ...recoveryCompanies.map((c) => ({ value: c, label: c })), { value: "other", label: "Other company" }]}
                  />
                </div>
              </Field>
              {company === "other" ? (
                <Field label="Company name">
                  <Input name="delivery_company" defaultValue={v.delivery_company} required data-new-company />
                </Field>
              ) : null}
              <Field label="Driver" hint="One tap; the usual driver comes first. A new one is saved for next time.">
                {companyDrivers.length ? (
                  <div onChange={(e) => setTruckDriver((e.target as HTMLInputElement).value)}>
                    <ChoiceButtons
                      name="driver_choice"
                      columns={2}
                      defaultValue={defaultDriver?.id ?? "new"}
                      options={[...companyDrivers.map((d) => ({ value: d.id, label: d.name, hint: [d.phone, d.truck_plate ? `Truck ${d.truck_plate}` : null].filter(Boolean).join(" · ") || undefined })), { value: "new", label: "New driver" }]}
                    />
                  </div>
                ) : (
                  <input type="hidden" name="driver_choice" value="new" />
                )}
              </Field>
              {truckDriver === "new" || !companyDrivers.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-new-truck-driver>
                  <Field label="Driver's name"><Input name="delivery_driver" defaultValue={v.delivery_driver} required /></Field>
                  <Field label="Driver's mobile"><Input name="driver_phone" type="tel" inputMode="tel" defaultValue={v.driver_phone} /></Field>
                  <Field label="Truck plate" optional><Input name="truck_plate" defaultValue={v.truck_plate} textCase="upper" /></Field>
                </div>
              ) : (
                <p className="text-xs text-muted" data-driver-filled>{chosenDriver?.name}{chosenDriver?.phone ? ` · ${chosenDriver.phone}` : ""}{chosenDriver?.truck_plate ? ` · Truck ${chosenDriver.truck_plate}` : ""}</p>
              )}
              <Field label="Delivery location: the pin the customer sent" hint="Paste the Google Maps or WhatsApp location link. The driver gets it exactly as it is.">
                <div className="flex flex-wrap items-center gap-2">
                  <Input name="location_url" value={pin} onChange={(e) => setPin(e.target.value)} required placeholder="https://maps.app.goo.gl/…" className="min-w-64 flex-1" data-location-url />
                  {pinOk ? <a href={pin.trim()} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-open-map>Open map</a> : pin.trim() ? <span className="text-xs font-semibold text-red" data-pin-bad>Not a map link</span> : null}
                </div>
              </Field>
              <Field label="Location details" optional hint={'For example "Villa 23, gate 2".'}>
                <Input name="location_details" defaultValue={v.location_details ?? lastPin?.details ?? ""} textCase="sentence" data-location-details />
              </Field>
              <Field label="Delivery day">
                {dateChoice !== "pick" ? <input type="hidden" name="delivery_date" value={chipDate} data-chip-date /> : null}
                <div className="flex flex-wrap items-center gap-2" data-date-chips>
                  {([["today", "Today", 0], ["tomorrow", "Tomorrow", 1], ["after", "Day after", 2], ["pick", "Pick date", -1]] as const).map(([vv, label, plus]) => (
                    <button key={vv} type="button" onClick={() => { setDateChoice(vv); if (plus >= 0) setChipDate(new Date(Date.now() + 4 * 3600000 + plus * 86400000).toISOString().slice(0, 10)); }} aria-pressed={dateChoice === vv} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${dateChoice === vv ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{label}</button>
                  ))}
                  {dateChoice === "pick" ? <Input type="date" name="delivery_date" className="w-44" /> : null}
                </div>
              </Field>
              <Field label="Time">
                <div className="flex flex-wrap items-center gap-2" data-time-chips>
                  {([["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["exact", "Exact time"]] as const).map(([vv, label]) => (
                    <button key={vv} type="button" onClick={() => setSlotChoice(vv)} aria-pressed={slotChoice === vv} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${slotChoice === vv ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{label}</button>
                  ))}
                  {slotChoice === "exact" ? <Input type="time" name="slot_time" className="w-32" /> : <input type="hidden" name="slot_time" value="" />}
                  <input type="hidden" name="delivery_slot" value={slotChoice} />
                </div>
              </Field>
              <p className="text-xs text-muted">No fee box: the driver enters his price on his one-button page when he delivers; it lands on the Recovery page. After the stamp, press &quot;Send to driver&quot; on the next screen.</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {!keysDiffer ? (
              <>
                <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer" data-keys-tick>
                  <input type="checkbox" name="keys_ok" className="h-5 w-5 accent-ink" required />
                  <span className="text-sm font-bold">{keysCount} key{keysCount === 1 ? "" : "s"} handed back ✓</span>
                </label>
                {keychain ? (
                  <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer" data-keychain-tick>
                    <input type="checkbox" name="keychain_ok" className="h-5 w-5 accent-ink" required />
                    <span className="text-sm font-bold">Keychain handed back ✓</span>
                  </label>
                ) : null}
                <button type="button" onClick={() => setKeysDiffer(true)} className="self-start text-xs font-semibold text-muted underline underline-offset-4 min-h-8" data-keys-differ>
                  Different number of keys?
                </button>
              </>
            ) : (
              <div className="rounded-card border-2 border-amber-bar bg-amber-soft px-4 py-3 flex flex-col gap-3 text-sm" data-keys-confirm="ask">
                <p className="font-semibold">Gate-in recorded {keysWords(keysCount, keychain)}. What is handed back?</p>
                <input type="hidden" name="keys_confirmed" value="yes" />
                <div className="grid grid-cols-4 gap-2" onChange={(e) => setReturned((e.target as HTMLInputElement).value)}>
                  <ChoiceButtons name="keys_returned" columns={4} defaultValue={v.keys_returned ?? String(keysCount)} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} />
                </div>
                <div onChange={(e) => setChain((e.target as HTMLInputElement).value)}>
                  <ChoiceButtons name="keychain_returned" columns={2} defaultValue={v.keychain_returned ?? (keychain ? "yes" : "no")} options={[{ value: "yes", label: "With keychain" }, { value: "no", label: "No keychain" }]} />
                </div>
                {mismatch ? (
                  canOverride ? (
                    <ReasonChips name="override_reason" label="Why is it different? (written on the job; the owner is told)" rows={2} options={reasons.keys} defaultValue={v.override_reason ?? ""} required placeholder="Tap a reason, or type" />
                  ) : (
                    <p>Only the owner or a workshop manager can gate out with a different count. Ask one of them, or correct the gate-in first.</p>
                  )
                ) : null}
                <Button type="button" tone="secondary" size="md" onClick={() => { setKeysDiffer(false); setReturned(String(keysCount)); setChain(keychain ? "yes" : "no"); }} data-keys-same>
                  Back to {keysWords(keysCount, keychain)}
                </Button>
              </div>
            )}
          </div>

          {dashCam ? (
            <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer">
              <input type="checkbox" name="dash_cam_reconnected" className="h-5 w-5 accent-ink" required />
              <span className="text-sm font-bold">Dash cam reconnected</span>
            </label>
          ) : null}
          {oldParts ? (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer">
                <input type="checkbox" name="old_parts_handed" className="h-5 w-5 accent-ink" required checked={oldPartsTicked} onChange={(e) => setOldPartsTicked(e.target.checked)} data-old-parts-tick />
                <span className="text-sm font-bold">Old parts handed over (the customer asked for them)</span>
              </label>
              {oldPartsTicked ? (
                <div className="flex flex-col gap-1 rounded-control border border-line bg-canvas p-3" data-old-parts-photos>
                  <span className="text-xs font-semibold text-muted">Photo of the old parts going with the customer (optional; kept on the job with the time and your name)</span>
                  <JobFileUpload jobId={jobId} kind="gate_out_photo" caption="Old parts handed over" files={oldPartsPhotos} accept="photo" label="Photo" compact removable onAdded={(f) => setOldPartsPhotos((p) => [...p, f])} onRemoved={(f) => setOldPartsPhotos((p) => p.filter((x) => x.id !== f.id))} />
                </div>
              ) : null}
            </div>
          ) : null}

          {blocked ? (
            canApproveRelease ? (
              <>
                <Notice tone="error">{blockedText} You can approve the release with a reason (logged).</Notice>
                <ReasonChips name="release_reason" label="Reason for releasing" rows={2} options={reasons.release} defaultValue={v.release_reason ?? ""} required placeholder="Tap a reason, or type" />
              </>
            ) : (
              <Notice tone="error">{blockedText} Gate-out is blocked until the owner or accounts approve the release.</Notice>
            )
          ) : declinedFree ? (
            <div data-declined-free><Notice tone="info">Declined quotation, no charge: the car leaves free of charge. This is written on the job.</Notice></div>
          ) : onCredit ? (
            <div data-credit-release><Notice tone="info">Credit terms ({creditDays} days): the balance of AED {balance.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })} is due within {creditDays} days. The car may leave; this is written on the job.</Notice></div>
          ) : balance.state === "paid" ? (
            <Notice tone="success">Paid in full{balance.invoiceNumber ? ` (${balance.invoiceNumber})` : ""}.</Notice>
          ) : null}

          <Field label={method === "recovery" ? "Photos at loading" : "Handover photos or video"} optional>
            <JobFileUpload jobId={jobId} kind={method === "recovery" ? "delivery_photo" : "handover_photo"} files={photos} accept="any" label="Add photos or video" onAdded={(f) => setPhotos((p) => [...p, f])} />
          </Field>

          {method !== "recovery" ? (
            <>
              {finalCheck ? (
                <Field label="Final check visit (PPF): 7 to 14 days from today" hint="On the calendar, linked to this job, with a WhatsApp reminder the day before.">
                  <Input type="date" name="final_check_date" defaultValue={v.final_check_date ?? finalCheck.defaultDate} min={finalCheck.min} max={finalCheck.max} className="w-44" data-final-check />
                </Field>
              ) : null}
              <label className="flex items-center gap-3 min-h-12 rounded-control border border-ink bg-white px-4 cursor-pointer">
                <input type="checkbox" name="handover_confirmed" className="h-5 w-5 accent-ink" required />
                <span className="text-sm font-bold">Handover confirmed with the collecting person</span>
              </label>
            </>
          ) : null}

          <div>
            <SubmitButton tone={(mismatch && !canOverride) || (blocked && !canApproveRelease) ? "secondary" : "primary"}>{method === "recovery" ? "Stamp: left the workshop" : "Gate out and close the job"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** The delivered stamp at the customer's door. */
export function DeliveredForm({ jobId, action }: { jobId: string; action: FormAction }) {
  const [photos, setPhotos] = useState<JobFile[]>([]);
  return (
    <ActionForm action={action}>
      {(v) => (
        <>
          <Field label="Received by (name)"><Input name="delivered_to" defaultValue={v.delivered_to} required /></Field>
          <Field label="Photo at the door" optional>
            <JobFileUpload jobId={jobId} kind="delivery_photo" files={photos} label="Add photo" onAdded={(f) => setPhotos((p) => [...p, f])} />
          </Field>
          <label className="flex items-center gap-3 min-h-12 rounded-control border border-ink bg-white px-4 cursor-pointer">
            <input type="checkbox" name="handover_confirmed" className="h-5 w-5 accent-ink" required />
            <span className="text-sm font-bold">Handover confirmed with the customer</span>
          </label>
          <div><SubmitButton>Stamp: delivered, close the job</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}
