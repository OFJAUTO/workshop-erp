"use client";

import { useRef, useState } from "react";
import { ReasonChips } from "@/components/ReasonChips";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Button, ChoiceButtons, Field, Input, Notice } from "@/components/ui";

export type BalanceInfo = { state: "paid" | "part_paid" | "unpaid" | "cheque_pending" | "no_invoice" | "nothing"; balance: number; invoiceNumber: string | null };

/** A driver saved on the customer (customer_contacts). */
export type SavedContact = { id: string; name: string; phone: string | null; relationship: string | null };

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
}) {
  const [method, setMethod] = useState<string>("customer");
  const [driver, setDriver] = useState<string>(contacts[0]?.id ?? "new");
  const [company, setCompany] = useState<string>("our_truck");
  const [returned, setReturned] = useState<string>(String(keysCount));
  const [chain, setChain] = useState<string>(keychain ? "yes" : "no");
  const [keysConfirmed, setKeysConfirmed] = useState(false);
  const keysRef = useRef<HTMLDivElement>(null);
  const [photos, setPhotos] = useState<JobFile[]>([]);
  const mismatch = Number(returned) !== keysCount || (chain === "yes") !== keychain;
  const onCredit = balance.state !== "no_invoice" && balance.balance > 0 && creditDays > 0;
  // Nothing to pay on a declined job: no invoice at all, or none owed.
  const declinedFree = declinedOut && balance.balance <= 0 && (balance.state === "no_invoice" || balance.state === "nothing");
  const blocked = ((balance.state === "no_invoice" && !declinedFree) || balance.balance > 0) && !onCredit;
  const blockedText = balance.state === "no_invoice" ? "No invoice has been issued for this job." : `Balance due AED ${balance.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}${balance.invoiceNumber ? ` on ${balance.invoiceNumber}` : ""}.`;

  /** "No": the keys go back to what the gate-in recorded. */
  const resetKeys = () => {
    const root = keysRef.current;
    if (root) {
      for (const el of root.querySelectorAll<HTMLInputElement>('input[name="keys_returned"]')) el.checked = el.value === String(keysCount);
      for (const el of root.querySelectorAll<HTMLInputElement>('input[name="keychain_returned"]')) el.checked = el.value === (keychain ? "yes" : "no");
    }
    setReturned(String(keysCount));
    setChain(keychain ? "yes" : "no");
    setKeysConfirmed(false);
  };

  return (
    <ActionForm action={action}>
      {(v) => (
        <>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-card border border-line p-3" data-collector="recovery">
              <div className="sm:col-span-2">
                <Field label="Recovery company" hint="Our truck, a company from the list, or a new one (added to the list for next time).">
                  <div onChange={(e) => setCompany((e.target as HTMLInputElement).value)}>
                    <ChoiceButtons
                      name="delivery_company_choice"
                      columns={3}
                      defaultValue={v.delivery_company_choice ?? "our_truck"}
                      options={[{ value: "our_truck", label: "Our truck" }, ...recoveryCompanies.map((c) => ({ value: c, label: c })), { value: "other", label: "Other company" }]}
                    />
                  </div>
                </Field>
              </div>
              {company === "other" ? (
                <Field label="Company name">
                  <Input name="delivery_company" defaultValue={v.delivery_company} required data-new-company />
                </Field>
              ) : null}
              <Field label="Driver's name">
                <Input name="delivery_driver" defaultValue={v.delivery_driver} required />
              </Field>
              <Field label="Delivery address">
                <Input name="delivery_address" defaultValue={v.delivery_address} required />
              </Field>
              <Field label="Date and time" optional>
                <Input name="delivery_at" type="datetime-local" defaultValue={v.delivery_at} />
              </Field>
              <Field label="Fee (AED)" optional>
                <Input name="delivery_fee" defaultValue={v.delivery_fee} inputMode="decimal" placeholder="0" className="w-32" />
              </Field>
              <p className="sm:col-span-2 text-xs text-muted">Photos at loading, then the &quot;Left workshop&quot; stamp. The job closes once the car is marked delivered.</p>
            </div>
          )}

          <div ref={keysRef} className="flex flex-col gap-4">
            <Field label="Number of keys handed back" hint={`Gate-in recorded ${keysWords(keysCount, keychain)}.`}>
              <div className="grid grid-cols-4 gap-2" onChange={(e) => { setReturned((e.target as HTMLInputElement).value); setKeysConfirmed(false); }}>
                <ChoiceButtons name="keys_returned" columns={4} defaultValue={v.keys_returned ?? String(keysCount)} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} />
              </div>
            </Field>
            <Field label="Keychain handed back">
              <div onChange={(e) => { setChain((e.target as HTMLInputElement).value); setKeysConfirmed(false); }}>
                <ChoiceButtons name="keychain_returned" columns={2} defaultValue={v.keychain_returned ?? (keychain ? "yes" : "no")} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
              </div>
            </Field>
            {mismatch ? (
              <div className="rounded-card border-2 border-amber-bar bg-amber-soft px-4 py-3 flex flex-col gap-3 text-sm" data-keys-confirm={keysConfirmed ? "yes" : "ask"}>
                <p className="font-semibold">
                  Gate-in recorded {keysWords(keysCount, keychain)}. Confirm {keysWords(returned, chain === "yes")}?
                </p>
                {!keysConfirmed ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="md" onClick={() => setKeysConfirmed(true)} data-keys-yes>
                      Yes, confirm
                    </Button>
                    <Button type="button" tone="secondary" size="md" onClick={resetKeys} data-keys-no>
                      No, back to {keysWords(keysCount, keychain)}
                    </Button>
                  </div>
                ) : canOverride ? (
                  <>
                    <input type="hidden" name="keys_confirmed" value="yes" />
                    <ReasonChips name="override_reason" label="Why is it different? (written on the job)" rows={2} options={reasons.keys} defaultValue={v.override_reason ?? ""} required placeholder="Tap a reason, or type" />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="keys_confirmed" value="yes" />
                    <p>Only the owner or a workshop manager can gate out with a different count. Ask one of them, or correct the gate-in first.</p>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {dashCam ? (
            <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer">
              <input type="checkbox" name="dash_cam_reconnected" className="h-5 w-5 accent-ink" required />
              <span className="text-sm font-bold">Dash cam reconnected</span>
            </label>
          ) : null}
          {oldParts ? (
            <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer">
              <input type="checkbox" name="old_parts_handed" className="h-5 w-5 accent-ink" required />
              <span className="text-sm font-bold">Old parts handed over (the customer asked for them)</span>
            </label>
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

          <Field label="Notes" optional>
            <Input name="notes" defaultValue={v.notes} />
          </Field>

          <div>
            <SubmitButton tone={(mismatch && (!canOverride || !keysConfirmed)) || (blocked && !canApproveRelease) ? "secondary" : "primary"}>{method === "recovery" ? "Stamp: left the workshop" : "Gate out and close the job"}</SubmitButton>
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
