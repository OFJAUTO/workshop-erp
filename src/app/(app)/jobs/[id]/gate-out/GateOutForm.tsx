"use client";

import { useState } from "react";
import { ReasonChips } from "@/components/ReasonChips";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { ChoiceButtons, Field, Input, Notice } from "@/components/ui";

export type BalanceInfo = { state: "paid" | "part_paid" | "unpaid" | "cheque_pending" | "no_invoice" | "nothing"; balance: number; invoiceNumber: string | null };

/** The gate-out form: how the car leaves, the checks before release, the handover. */
export function GateOutForm({ jobId, action, keysCount, keychain, dashCam, oldParts, canOverride, canApproveRelease, balance, reasons = { keys: [], release: [] }, finalCheck = null, creditDays = 0 }: { /** Agreed credit days on the customer (owner-set); 0 = pay before release. */ creditDays?: number; /** A PPF car: the final check visit, 7 to 14 days after the handover. */ finalCheck?: { defaultDate: string; min: string; max: string } | null; jobId: string; action: FormAction; keysCount: number; keychain: boolean; dashCam: boolean; oldParts: boolean; canOverride: boolean; canApproveRelease: boolean; balance: BalanceInfo; /** One-tap reasons for the keys override and for releasing (Settings). */ reasons?: { keys: string[]; release: string[] } }) {
  const [method, setMethod] = useState<string>("customer");
  const [returned, setReturned] = useState<string>(String(keysCount));
  const [chain, setChain] = useState<string>(keychain ? "yes" : "no");
  const [photos, setPhotos] = useState<JobFile[]>([]);
  const mismatch = Number(returned) !== keysCount || (chain === "yes") !== keychain;
  const onCredit = balance.state !== "no_invoice" && balance.balance > 0 && creditDays > 0;
  const blocked = (balance.state === "no_invoice" || balance.balance > 0) && !onCredit;
  const blockedText = balance.state === "no_invoice" ? "No invoice has been issued for this job." : `Balance due AED ${balance.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}${balance.invoiceNumber ? ` on ${balance.invoiceNumber}` : ""}.`;

  return (
    <ActionForm action={action}>
      {(v) => (
        <>
          <Field label="How does the car leave?">
            <div onChange={(e) => setMethod((e.target as HTMLInputElement).value)}>
              <ChoiceButtons name="leave_method" columns={3} defaultValue={v.leave_method ?? "customer"} options={[{ value: "customer", label: "Customer collects" }, { value: "customer_driver", label: "Customer's driver collects" }, { value: "recovery", label: "Delivery by recovery" }]} />
            </div>
          </Field>

          {method !== "recovery" ? (
            <Field label="Name of the person collecting">
              <Input name="collector_name" defaultValue={v.collector_name} required />
            </Field>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-card border border-line p-3">
              <Field label="Delivery address">
                <Input name="delivery_address" defaultValue={v.delivery_address} required />
              </Field>
              <Field label="Date and time">
                <Input name="delivery_at" type="datetime-local" defaultValue={v.delivery_at} />
              </Field>
              <Field label="Who delivers">
                <ChoiceButtons name="delivery_by" columns={2} defaultValue={v.delivery_by ?? "our_truck"} options={[{ value: "our_truck", label: "Our truck" }, { value: "outside", label: "Outside company" }]} />
              </Field>
              <Field label="Company and fee" optional>
                <div className="flex gap-2"><Input name="delivery_company" defaultValue={v.delivery_company} placeholder="Recovery company" /><Input name="delivery_fee" defaultValue={v.delivery_fee} inputMode="decimal" placeholder="Fee AED" className="w-32" /></div>
              </Field>
              <p className="sm:col-span-2 text-xs text-muted">Photos at loading, then the &quot;Left workshop&quot; stamp. The job closes once the car is marked delivered.</p>
            </div>
          )}

          <Field label="Number of keys handed back">
            <div className="grid grid-cols-4 gap-2" onChange={(e) => setReturned((e.target as HTMLInputElement).value)}>
              <ChoiceButtons name="keys_returned" columns={4} defaultValue={v.keys_returned ?? String(keysCount)} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} />
            </div>
          </Field>
          <Field label="Keychain handed back">
            <div onChange={(e) => setChain((e.target as HTMLInputElement).value)}>
              <ChoiceButtons name="keychain_returned" columns={2} defaultValue={v.keychain_returned ?? (keychain ? "yes" : "no")} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
            </div>
          </Field>
          {mismatch ? (
            canOverride ? (
              <>
                <Notice tone="error">Does not match gate-in ({keysCount} key{keysCount === 1 ? "" : "s"}, {keychain ? "with" : "no"} keychain). Blocked unless you override with a reason. The override is logged.</Notice>
                <ReasonChips name="override_reason" label="Reason for the keys override" rows={2} options={reasons.keys} defaultValue={v.override_reason ?? ""} required placeholder="Tap a reason, or type" />
              </>
            ) : (
              <Notice tone="error">Does not match gate-in ({keysCount} key{keysCount === 1 ? "" : "s"}, {keychain ? "with" : "no"} keychain). Gate-out is blocked. Only the owner or workshop manager can override.</Notice>
            )
          ) : null}

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
          ) : onCredit ? (
            <div data-credit-release><Notice tone="info">Credit terms ({creditDays} days): the balance of AED {balance.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })} is due within {creditDays} days. The car may leave; this is logged.</Notice></div>
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
