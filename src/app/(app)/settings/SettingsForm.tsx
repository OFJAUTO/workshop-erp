"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, Field, Input, SectionLabel, Textarea } from "@/components/ui";
import { STAGE_LABELS, STAGES } from "@/lib/jobs";

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
  labourOverrides,
  workingDays,
  stageHours,
  branchesText,
}: {
  action: FormAction;
  initialValues: Record<string, string>;
  makes: string[];
  departments: { id: string; label: string }[];
  makeOverrides: Record<string, number>;
  departmentOverrides: Record<string, number>;
  labourOverrides: Record<string, number>;
  workingDays: string[];
  stageHours: Record<string, number>;
  branchesText: string;
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Company address" hint="In the header of every PDF.">
                <Input name="company_address" defaultValue={v.company_address} />
              </Field>
              <Field label="Company phone" optional>
                <Input name="company_phone" defaultValue={v.company_phone} type="tel" inputMode="tel" />
              </Field>
              <Field label="Company email" optional>
                <Input name="company_email" defaultValue={v.company_email} type="email" inputMode="email" />
              </Field>
            </div>
            <Field label="Branches" hint="One per line: Name | Address. The first one is the default at gate-in.">
              <Textarea name="branches" defaultValue={v.branches ?? branchesText} rows={3} />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Logins</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Handheld idle lock (seconds)" hint="A registered device locks after this long without a touch.">
                <Input name="tablet_idle_lock_seconds" defaultValue={v.tablet_idle_lock_seconds} inputMode="numeric" required />
              </Field>
              <Field label="Wrong PINs before lock">
                <Input name="pin_max_attempts" defaultValue={v.pin_max_attempts} inputMode="numeric" required />
              </Field>
              <Field label="PIN lock time (minutes)">
                <Input name="pin_lock_minutes" defaultValue={v.pin_lock_minutes} inputMode="numeric" required />
              </Field>
              <Field label="Keep me signed in: office staff (days)" hint="PC logins only. Never on handhelds.">
                <Input name="keep_signed_in_days_staff" defaultValue={v.keep_signed_in_days_staff} inputMode="numeric" required />
              </Field>
              <Field label="Keep me signed in: owner and accounts (days)">
                <Input name="keep_signed_in_days_owner_accounts" defaultValue={v.keep_signed_in_days_owner_accounts} inputMode="numeric" required />
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Gate-in and approvals</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Video retention (months)" hint="Videos are deleted automatically after this. Photos are kept forever.">
                <Input name="video_retention_months" defaultValue={v.video_retention_months} inputMode="numeric" required />
              </Field>
              <Field label="Approval link reminder (hours)" hint="Remind the advisor if a sent link is not opened in time.">
                <Input name="approval_reminder_hours" defaultValue={v.approval_reminder_hours} inputMode="numeric" required />
              </Field>
              <Field label="Inspection fee (AED)" hint="Charged when no work is approved after the inspection.">
                <Input name="inspection_fee_aed" defaultValue={v.inspection_fee_aed} inputMode="numeric" required />
              </Field>
              <Field label="Inspection target (minutes of working time)" hint="Past this the department manager and the owner are warned and the card turns red.">
                <Input name="inspection_target_minutes" defaultValue={v.inspection_target_minutes} inputMode="numeric" required />
              </Field>
              <Field label="Approved report opens for (hours)" hint="After the owner approves a change request, the report can be edited for this long.">
                <Input name="inspection_unlock_hours" defaultValue={v.inspection_unlock_hours} inputMode="numeric" required />
              </Field>
              <Field label="Assignment target (minutes of working time)" hint="How long a car may wait for a technician after the customer approves. Past it the card turns amber, then red, and the owner is told.">
                <Input name="assignment_target_minutes" defaultValue={v.assignment_target_minutes} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="Target hours per stage" hint="Without a promised date a car turns amber past the target and red at double.">
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
                {STAGES.map((s) => (
                  <label key={s} className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-muted">{STAGE_LABELS[s]}</span>
                    <Input name={`stage__${s}`} defaultValue={v[`stage__${s}`] ?? String(stageHours[s] ?? "")} inputMode="numeric" required />
                  </label>
                ))}
              </div>
            </Field>
            <Field label="WhatsApp approval message" hint="Placeholders: [name], [make model], [plate], [link], [advisor].">
              <Textarea name="whatsapp_approval_template" defaultValue={v.whatsapp_approval_template} rows={4} required />
            </Field>
            <Field label="WhatsApp inspection report message" hint="Sent with the customer's link to the approved report. Placeholders: [name], [make model], [plate], [link], [advisor].">
              <Textarea name="whatsapp_report_template" defaultValue={v.whatsapp_report_template} rows={3} required />
            </Field>
            <Field label="Terms and conditions (English)" hint="Shown in full on the approval page. Every approval keeps the exact version shown.">
              <Textarea name="terms_and_conditions" defaultValue={v.terms_and_conditions} rows={10} />
            </Field>
            <Field label="Terms and conditions (Arabic)" hint="Shown right to left under the English terms.">
              <Textarea name="terms_and_conditions_ar" defaultValue={v.terms_and_conditions_ar} rows={10} dir="rtl" lang="ar" />
            </Field>
            <Field label="Declaration (English)" hint="The tick-box text on the approval page.">
              <Textarea name="declaration_text" defaultValue={v.declaration_text} rows={3} required />
            </Field>
            <Field label="Declaration (Arabic)">
              <Textarea name="declaration_text_ar" defaultValue={v.declaration_text_ar} rows={3} dir="rtl" lang="ar" />
            </Field>
            <Field label="Inspection fee notice (English)" hint="Shown above the tick box on the approval page. [amount] is replaced by the fee. Every approval keeps the exact wording and amount shown.">
              <Textarea name="inspection_fee_notice" defaultValue={v.inspection_fee_notice} rows={2} required />
            </Field>
            <Field label="Inspection fee notice (Arabic)">
              <Textarea name="inspection_fee_notice_ar" defaultValue={v.inspection_fee_notice_ar} rows={2} dir="rtl" lang="ar" />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Calendar</SectionLabel>
            <Field label="Appointments per day" hint="A day shows as full at this number.">
              <Input name="appointments_per_day" defaultValue={v.appointments_per_day} inputMode="numeric" required className="max-w-40" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Bell reminder (hours before)" hint="The assigned person is told this long before a booking. Also the day before at opening time. Checked hourly.">
                <Input name="appointment_reminder_hours_before" defaultValue={v.appointment_reminder_hours_before} inputMode="numeric" required />
              </Field>
              <Field label="Evening reminder hour (collections)" hint="For 'We collect the car', the assigned person is also told the evening before, from this hour.">
                <Input name="appointment_evening_reminder_hour" defaultValue={v.appointment_evening_reminder_hour} inputMode="numeric" required />
              </Field>
              <Field label="Counts as missed after (minutes)" hint="Shows Not arrived or Not collected and notifies the assigned person.">
                <Input name="appointment_missed_after_minutes" defaultValue={v.appointment_missed_after_minutes} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="WhatsApp reminder: customer coming in" hint="Sent the day before. Placeholders: [name], [date], [time], [reason], [car], [advisor].">
              <Textarea name="whatsapp_reminder_template" defaultValue={v.whatsapp_reminder_template} rows={3} required />
            </Field>
            <Field label="WhatsApp reminder: car only arriving">
              <Textarea name="whatsapp_reminder_car_drop" defaultValue={v.whatsapp_reminder_car_drop} rows={3} required />
            </Field>
            <Field label="WhatsApp reminder: we collect the car" hint="Also [address].">
              <Textarea name="whatsapp_reminder_we_collect" defaultValue={v.whatsapp_reminder_we_collect} rows={3} required />
            </Field>
            <Field label="WhatsApp reminder: customer collects">
              <Textarea name="whatsapp_reminder_customer_collects" defaultValue={v.whatsapp_reminder_customer_collects} rows={3} required />
            </Field>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Opens at (hour, 0 to 23)" hint="Stage timers count working hours only.">
                <Input name="opening_hour" defaultValue={v.opening_hour} inputMode="numeric" required />
              </Field>
              <Field label="Closes at (hour, 1 to 24)" hint="A car gated in after closing starts its timer at opening time on the next working day.">
                <Input name="closing_hour" defaultValue={v.closing_hour} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="Working days" hint="Days that count towards the daily target and the stage timers.">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <label key={d.id} className="cursor-pointer">
                    <input type="checkbox" name="working_days" value={d.id} defaultChecked={workingDays.includes(d.id)} className="peer sr-only" />
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
                    <Input name={`cost_dept__${d.id}`} defaultValue={departmentOverrides[d.id]?.toString() ?? ""} inputMode="numeric" placeholder="AED/h" />
                  </Field>
                ))}
              </div>
            </details>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Quotations and estimates</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Labour rate (AED per hour)" hint="Hours typed on a labour line times this rate.">
                <Input name="labour_rate_aed" defaultValue={v.labour_rate_aed} inputMode="numeric" required />
              </Field>
              <Field label="Quotation validity (days)" hint="Quotations and estimates expire after this many days.">
                <Input name="quote_validity_days" defaultValue={v.quote_validity_days} inputMode="numeric" required />
              </Field>
              <Field label="Owner approval above (AED)" hint="Quotations above this total need the owner before sending. 0 switches it off.">
                <Input name="quote_owner_approval_above_aed" defaultValue={v.quote_owner_approval_above_aed} inputMode="numeric" required />
              </Field>
              <Field label="Deposit threshold (AED)" hint="When the parts on a quotation exceed this, a deposit is shown.">
                <Input name="deposit_threshold_aed" defaultValue={v.deposit_threshold_aed} inputMode="numeric" required />
              </Field>
              <Field label="Deposit (percent of parts)">
                <Input name="deposit_percent" defaultValue={v.deposit_percent} inputMode="numeric" required />
              </Field>
              <Field label="Estimate follow-up (days)" hint="Days after sending an estimate with no reply before the advisor is reminded.">
                <Input name="estimate_followup_days" defaultValue={v.estimate_followup_days} inputMode="numeric" required />
              </Field>
              <Field label="Parts pricing target (hours)" hint="Working hours for Parts to price a request before it turns amber, red at double.">
                <Input name="parts_pricing_target_hours" defaultValue={v.parts_pricing_target_hours} inputMode="numeric" required />
              </Field>
              <Field label="Quote sent after pricing (hours)" hint="Working hours for the advisor to send once the parts are priced.">
                <Input name="quote_send_target_hours" defaultValue={v.quote_send_target_hours} inputMode="numeric" required />
              </Field>
              <Field label="Bank charge, card machine (%)" hint="Of the total including VAT. Internal cost only, never shown to the customer.">
                <Input name="bank_charge_card_percent" defaultValue={v.bank_charge_card_percent} inputMode="decimal" required />
              </Field>
              <Field label="Bank charge, payment link (%)" hint="Of the total including VAT. Internal cost only, never shown to the customer.">
                <Input name="bank_charge_link_percent" defaultValue={v.bank_charge_link_percent} inputMode="decimal" required />
              </Field>
            </div>
            <details className="rounded-control border border-line p-4">
              <summary className="cursor-pointer text-sm font-bold">Labour rate per department (optional)</summary>
              <p className="text-xs text-muted mt-2 mb-3">Leave blank to use the general rate.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {departments.map((d) => (
                  <Field key={d.id} label={d.label}>
                    <Input name={`labour_dept__${d.id}`} defaultValue={labourOverrides[d.id]?.toString() ?? ""} inputMode="numeric" placeholder="AED/h" />
                  </Field>
                ))}
              </div>
            </details>
            <Field label="WhatsApp quotation message" hint="Placeholders: [name], [make model], [plate], [link], [advisor].">
              <Textarea name="whatsapp_quote_template" defaultValue={v.whatsapp_quote_template} rows={3} required />
            </Field>
            <Field label="WhatsApp estimate message" hint="Placeholders: [name], [make model], [plate], [link], [advisor].">
              <Textarea name="whatsapp_estimate_template" defaultValue={v.whatsapp_estimate_template} rows={3} required />
            </Field>
            <p className="text-xs text-muted">The services list (categories, prices and default hours) is on its own page: Settings, Services.</p>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Parts</SectionLabel>
            <Field label="Pending supplier invoice turns red after (days)" hint="Used from the parts phase.">
              <Input name="supplier_invoice_pending_red_days" defaultValue={v.supplier_invoice_pending_red_days} inputMode="numeric" required className="max-w-40" />
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
