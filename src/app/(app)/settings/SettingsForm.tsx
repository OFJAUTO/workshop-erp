"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, Field, Input, SectionLabel, Textarea } from "@/components/ui";

const DAYS: { id: string; label: string }[] = [
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
  { id: "sun", label: "Sun" },
];

export function SettingsForm({
  action,
  initialValues,
  makes,
  departments,
  makeOverrides,
  departmentOverrides,
  workingDays,
}: {
  action: FormAction;
  initialValues: Record<string, string>;
  makes: string[];
  departments: { id: string; label: string }[];
  makeOverrides: Record<string, number>;
  departmentOverrides: Record<string, number>;
  workingDays: string[];
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-6">
      {(v) => (
        <>
          <Card className="flex flex-col gap-4">
            <SectionLabel>Company</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Company name">
                <Input name="company_name" defaultValue={v.company_name} required />
              </Field>
              <Field label="Company TRN" optional hint="15 digits. Used on tax invoices in a later phase.">
                <Input name="company_trn" defaultValue={v.company_trn} inputMode="numeric" maxLength={15} />
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Logins</SectionLabel>
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
              <Field label="Keep me signed in: office staff (days)" hint="PC logins only. Never on tablets.">
                <Input name="keep_signed_in_days_staff" defaultValue={v.keep_signed_in_days_staff} inputMode="numeric" required />
              </Field>
              <Field label="Keep me signed in: owner and accounts (days)">
                <Input
                  name="keep_signed_in_days_owner_accounts"
                  defaultValue={v.keep_signed_in_days_owner_accounts}
                  inputMode="numeric"
                  required
                />
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Pricing</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Advisor discount limit (%)" hint="Used from Phase 4.">
                <Input name="discount_limit_percent" defaultValue={v.discount_limit_percent} inputMode="numeric" required />
              </Field>
              <Field label="Minimum parts markup (%)" hint="A quote cannot go out below this.">
                <Input name="parts_min_markup_percent" defaultValue={v.parts_min_markup_percent} inputMode="numeric" required />
              </Field>
            </div>
            <details className="rounded-control border border-line p-4">
              <summary className="cursor-pointer text-sm font-bold">Minimum markup per brand (optional)</summary>
              <p className="text-xs text-muted mt-2 mb-3">Leave blank to use the general minimum.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {makes.map((m) => (
                  <Field key={m} label={m}>
                    <Input name={`markup_make__${m}`} defaultValue={makeOverrides[m]?.toString() ?? ""} inputMode="numeric" placeholder="%" />
                  </Field>
                ))}
              </div>
            </details>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Profit and targets</SectionLabel>
            <p className="text-xs text-muted">Technician cost rates are visible to the owner and accounts only.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Technician cost rate (AED per hour)">
                <Input name="technician_cost_rate_aed" defaultValue={v.technician_cost_rate_aed} inputMode="numeric" required />
              </Field>
              <Field label="Daily profit target (AED)">
                <Input name="daily_profit_target_aed" defaultValue={v.daily_profit_target_aed} inputMode="numeric" required />
              </Field>
              <Field label="Target yellow threshold (%)" hint="Below this the panel is red.">
                <Input name="profit_target_yellow_percent" defaultValue={v.profit_target_yellow_percent} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="Working days" hint="Days that count towards the daily target.">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <label key={d.id} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name="working_days"
                      value={d.id}
                      defaultChecked={workingDays.includes(d.id)}
                      className="peer sr-only"
                    />
                    <span className="inline-flex min-h-11 min-w-14 items-center justify-center rounded-control border border-line-strong bg-white px-3 text-sm font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white">
                      {d.label}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <details className="rounded-control border border-line p-4">
              <summary className="cursor-pointer text-sm font-bold">Cost rate per department (optional)</summary>
              <p className="text-xs text-muted mt-2 mb-3">Leave blank to use the general rate.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {departments.map((d) => (
                  <Field key={d.id} label={d.label}>
                    <Input
                      name={`cost_dept__${d.id}`}
                      defaultValue={departmentOverrides[d.id]?.toString() ?? ""}
                      inputMode="numeric"
                      placeholder="AED/h"
                    />
                  </Field>
                ))}
              </div>
            </details>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Parts and gate-in</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Pending supplier invoice turns red after (days)" hint="Used from the parts phase.">
                <Input
                  name="supplier_invoice_pending_red_days"
                  defaultValue={v.supplier_invoice_pending_red_days}
                  inputMode="numeric"
                  required
                />
              </Field>
              <Field label="Gate-in video retention (months)" hint="Used from Phase 2.">
                <Input name="video_retention_months" defaultValue={v.video_retention_months} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="Terms and conditions" hint="The text customers agree to when approving a job.">
              <Textarea name="terms_and_conditions" defaultValue={v.terms_and_conditions} rows={10} />
            </Field>
          </Card>

          <div>
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
