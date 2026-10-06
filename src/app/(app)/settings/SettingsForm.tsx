"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input, Textarea } from "@/components/ui";

export function SettingsForm({ action, initialValues }: { action: FormAction; initialValues: Record<string, string> }) {
  return (
    <ActionForm action={action} initialValues={initialValues}>
      {(v) => (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company name" hint="Shown top left on every screen until a logo is added.">
              <Input name="company_name" defaultValue={v.company_name} required />
            </Field>
            <Field label="Company TRN" optional hint="15 digits. Used on tax invoices in a later phase.">
              <Input name="company_trn" defaultValue={v.company_trn} inputMode="numeric" maxLength={15} />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Tablet idle lock (seconds)" hint="A shared tablet locks after this long without a touch.">
              <Input name="tablet_idle_lock_seconds" defaultValue={v.tablet_idle_lock_seconds} inputMode="numeric" required />
            </Field>
            <Field label="Wrong PINs before lock">
              <Input name="pin_max_attempts" defaultValue={v.pin_max_attempts} inputMode="numeric" required />
            </Field>
            <Field label="PIN lock time (minutes)">
              <Input name="pin_lock_minutes" defaultValue={v.pin_lock_minutes} inputMode="numeric" required />
            </Field>
            <Field label="Advisor discount limit (%)" hint="Used from Phase 4.">
              <Input name="discount_limit_percent" defaultValue={v.discount_limit_percent} inputMode="numeric" required />
            </Field>
            <Field label="Gate-in video retention (months)" hint="Used from Phase 2.">
              <Input name="video_retention_months" defaultValue={v.video_retention_months} inputMode="numeric" required />
            </Field>
          </div>

          <Field label="Terms and conditions" hint="The text customers agree to when approving a job. Used from Phase 2.">
            <Textarea name="terms_and_conditions" defaultValue={v.terms_and_conditions} rows={10} />
          </Field>

          <div>
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
