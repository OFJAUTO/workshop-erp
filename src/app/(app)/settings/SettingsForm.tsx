"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, Field, Input, SectionLabel, Select, Textarea } from "@/components/ui";
import { STAGE_LABELS, STAGES } from "@/lib/jobs";
import { TonePicker } from "./TonePicker";

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
  labourByMake,
  qcChecksText,
  listTexts = {},
  limits = { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15 },
  prescanGate = false,
  labourJobsText = "",
  candidates = {},
  flags = {},
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
  labourByMake: Record<string, number>;
  qcChecksText: string;
  listTexts?: Record<string, string>;
  limits?: Record<string, number>;
  prescanGate?: boolean;
  labourJobsText?: string;
  candidates?: Record<string, number>;
  flags?: Record<string, boolean>;
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Legal name" hint="On the header of every PDF.">
                <Input name="company_legal_name" defaultValue={v.company_legal_name} required />
              </Field>
              <Field label="Legal name in Arabic" optional>
                <Input name="company_legal_name_ar" defaultValue={v.company_legal_name_ar} dir="rtl" lang="ar" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Address line 1">
                <Input name="company_address_1" defaultValue={v.company_address_1} />
              </Field>
              <Field label="Address line 2">
                <Input name="company_address_2" defaultValue={v.company_address_2} />
              </Field>
              <Field label="Address line 3">
                <Input name="company_address_3" defaultValue={v.company_address_3} />
              </Field>
              <Field label="Address on one line" hint="Older screens and messages.">
                <Input name="company_address" defaultValue={v.company_address} />
              </Field>
              <Field label="Company phone" optional>
                <Input name="company_phone" defaultValue={v.company_phone} type="tel" inputMode="tel" />
              </Field>
              <Field label="Company email" optional>
                <Input name="company_email" defaultValue={v.company_email} type="email" inputMode="email" />
              </Field>
              <Field label="Website" optional>
                <Input name="company_website" defaultValue={v.company_website} />
              </Field>
            </div>
            <details className="rounded-control border border-line p-4">
              <summary className="cursor-pointer text-sm font-bold">Bank transfer details (printed on invoices)</summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Bank"><Input name="bank_name" defaultValue={v.bank_name} /></Field>
                <Field label="Account name"><Input name="bank_account_name" defaultValue={v.bank_account_name} /></Field>
                <Field label="Account number"><Input name="bank_account_number" defaultValue={v.bank_account_number} inputMode="numeric" /></Field>
                <Field label="IBAN"><Input name="bank_iban" defaultValue={v.bank_iban} /></Field>
                <Field label="SWIFT"><Input name="bank_swift" defaultValue={v.bank_swift} /></Field>
              </div>
            </details>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Currency on customer documents" hint="The dirham symbol, or the letters AED. Staff screens always show AED.">
                <Select name="document_currency" defaultValue={v.document_currency || "symbol"}>
                  <option value="symbol">Dirham symbol</option>
                  <option value="aed">AED</option>
                </Select>
              </Field>
              <Field label="Next invoice number" hint="Numbering continues from here (INV-00001 and so on).">
                <Input name="next_invoice_number" defaultValue={v.next_invoice_number} inputMode="numeric" required />
              </Field>
              <Field label="Consumables line (AED)" hint="Default amount of the standard Consumables line on an invoice.">
                <Input name="consumables_default_aed" defaultValue={v.consumables_default_aed} inputMode="numeric" required />
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
              <Field label="Minimum parts markup (%)" hint="A quote cannot go out below this. No upper limit.">
                <Input name="parts_min_markup_percent" defaultValue={v.parts_min_markup_percent} inputMode="numeric" required />
              </Field>
              <Field label="Markup warning from (%)" hint="From here the markup shows amber on the quotation.">
                <Input name="markup_warn_percent" defaultValue={v.markup_warn_percent} inputMode="numeric" required />
              </Field>
              <Field label="Markup confirmation from (%)" hint="From here the advisor must confirm the selling price, spelled out, and the line is flagged.">
                <Input name="markup_confirm_percent" defaultValue={v.markup_confirm_percent} inputMode="numeric" required />
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
              <Field label="Bank charge, cash (%)" hint="Normally 0.">
                <Input name="bank_charge_cash_percent" defaultValue={v.bank_charge_cash_percent ?? "0"} inputMode="decimal" required />
              </Field>
              <Field label="Bank charge, cheque (%)" hint="Normally 0. The quotation's hidden Fee line assumes the highest of the four rates; the real charge is taken at payment.">
                <Input name="bank_charge_cheque_percent" defaultValue={v.bank_charge_cheque_percent ?? "0"} inputMode="decimal" required />
              </Field>
              <Field label="Remind Parts after (minutes)" hint="The advisor's Remind Parts button opens after this wait.">
                <Input name="parts_remind_minutes" defaultValue={v.parts_remind_minutes} inputMode="numeric" required />
              </Field>
              <Field label="Escalate to the owner after (minutes)">
                <Input name="parts_escalate_minutes" defaultValue={v.parts_escalate_minutes} inputMode="numeric" required />
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
            <details className="rounded-control border border-line p-4">
              <summary className="cursor-pointer text-sm font-bold">Standard labour rate per make (optional)</summary>
              <p className="text-xs text-muted mt-2 mb-3">The advisor can go higher on a quotation, never lower. Only the owner can go below. Leave blank for the general rate.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {makes.map((m) => (
                  <Field key={m} label={m}>
                    <Input name={`labour_make__${m}`} defaultValue={labourByMake[m]?.toString() ?? ""} inputMode="numeric" placeholder="AED/h" />
                  </Field>
                ))}
              </div>
            </details>
            <Field label="Bodyshop labour rate (AED per hour)" optional hint="Left empty until the bodyshop path is built.">
              <Input name="labour_rate_bodyshop_aed" defaultValue={v.labour_rate_bodyshop_aed} inputMode="numeric" className="max-w-40" />
            </Field>
            <p className="text-xs text-muted">The services list (categories, prices and default hours) is on its own page: Settings, Services.</p>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Parts</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Pending supplier invoice turns red after (days)">
                <Input name="supplier_invoice_pending_red_days" defaultValue={v.supplier_invoice_pending_red_days} inputMode="numeric" required />
              </Field>
              <Field label="Part label width (mm)" hint="The thermal label. Use Test print a label above.">
                <Input name="label_width_mm" defaultValue={v.label_width_mm} inputMode="numeric" required />
              </Field>
              <Field label="Part label height (mm)">
                <Input name="label_height_mm" defaultValue={v.label_height_mm} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="Quick remarks (one per line)" hint="One-tap remarks on every checklist item: Noise, Crack, Broken and so on, shown before the remarks learned from earlier reports.">
              <Textarea name="quick_remarks" defaultValue={v.quick_remarks ?? listTexts.quick_remarks} rows={4} required />
            </Field>
            <Field label="Part types (one per line)" hint="One-tap choice on every part: the first is the default. Genuine needs no brand; the others ask for one.">
              <Textarea name="part_types" defaultValue={v.part_types ?? listTexts.part_types} rows={4} required />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Inspection</SectionLabel>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" name="prescan_gate_enabled" defaultChecked={prescanGate} className="mt-1 h-5 w-5 accent-ink" />
              <span className="flex flex-col text-sm">
                <span className="font-semibold">Scan report gate</span>
                <span className="text-xs text-muted">When on, the technician must read the Autel scan report (or get &quot;Scan not possible&quot; approved by the manager) before the checklist opens. Keep it off until the scan email link is tested.</span>
              </span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Tread depth, max (mm)"><Input name="limit__tread_max" defaultValue={String(limits.tread_max)} inputMode="decimal" required /></Field>
              <Field label="Brake pads, max (mm)"><Input name="limit__pads_max" defaultValue={String(limits.pads_max)} inputMode="decimal" required /></Field>
              <Field label="Battery, max (V)"><Input name="limit__battery_max" defaultValue={String(limits.battery_max)} inputMode="decimal" required /></Field>
              <Field label="Fluids, max (L)"><Input name="limit__fluid_max" defaultValue={String(limits.fluid_max)} inputMode="decimal" required /></Field>
              <Field label="Vent temperature, min (°C)"><Input name="limit__vent_min" defaultValue={String(limits.vent_min)} inputMode="decimal" required /></Field>
              <Field label="Vent temperature, max (°C)"><Input name="limit__vent_max" defaultValue={String(limits.vent_max)} inputMode="decimal" required /></Field>
              <Field label="Tyre year pick-list (years back)"><Input name="limit__tyre_years" defaultValue={String(limits.tyre_years)} inputMode="numeric" required /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Fluid grades (one per line)" hint="One-tap suggestions on fluid items.">
                <Textarea name="fluid_grades" defaultValue={v.fluid_grades ?? listTexts.fluid_grades} rows={6} required />
              </Field>
              <Field label="Big-job tags (one per line)" hint="One-tap tags by the technician's notes.">
                <Textarea name="big_job_tags" defaultValue={v.big_job_tags ?? listTexts.big_job_tags} rows={6} required />
              </Field>
              <Field label="Labour actions (one per line)" hint="The Action pick-list of the labour description builder on quotations.">
                <Textarea name="labour_actions" defaultValue={v.labour_actions ?? listTexts.labour_actions} rows={6} required />
              </Field>
              <Field label="Labour positions (one per line)" hint="The Position pick-list of the builder.">
                <Textarea name="labour_positions" defaultValue={v.labour_positions ?? listTexts.labour_positions} rows={6} required />
              </Field>
            </div>
            <Field label="Safety warning shown to the customer (English)" hint="On the quotation page and PDF when a finding is marked dangerous. Have the wording checked legally.">
              <Textarea name="dangerous_customer_text" defaultValue={v.dangerous_customer_text} rows={3} required />
            </Field>
            <Field label="Safety warning (Arabic)">
              <Textarea name="dangerous_customer_text_ar" defaultValue={v.dangerous_customer_text_ar} rows={3} dir="rtl" lang="ar" />
            </Field>
            <Field label="Acknowledgement the customer ticks when declining dangerous work">
              <Textarea name="dangerous_acknowledgement_text" defaultValue={v.dangerous_acknowledgement_text} rows={2} required />
            </Field>
            <p className="text-xs text-muted">Tap-first suggestions per checklist item learn from every approved report on their own.</p>
          </Card>



          <Card className="flex flex-col gap-4">
            <SectionLabel>Notification sounds</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Sound for new notifications" hint="Soft and warm; each person can pick their own from the bell.">
                <TonePicker name="notification_tone" initial={v.notification_tone || "marimba"} />
              </Field>
              <Field label="Sound for the owner's approvals" hint="Things only the owner can approve, and a technician's additional work for the manager.">
                <TonePicker name="notification_tone_owner" initial={v.notification_tone_owner || "chord"} />
              </Field>
            </div>
            <Field label="Gentle reminder every (minutes)" hint="While something is unread and the bell is closed.">
              <Input name="notification_remind_minutes" defaultValue={v.notification_remind_minutes} inputMode="numeric" required className="max-w-40" />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Ready-made jobs</SectionLabel>
            <Field label="Jobs list" hint="A line ending with a colon starts a category (Engine:, Brakes:); the lines under it are the jobs the advisor picks from. Two letters find them.">
              <Textarea name="labour_jobs" defaultValue={v.labour_jobs ?? labourJobsText} rows={14} className="font-mono text-xs" />
            </Field>
            {Object.keys(candidates).length ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Built by advisors more than once, not on the list yet</span>
                {Object.entries(candidates).sort((a, b) => b[1] - a[1]).map(([title, n]) => (
                  <div key={title} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" name={`candidate__${title}`} className="h-5 w-5 accent-ink" /><span className="font-semibold">{title}</span><span className="text-muted">used {n}×</span></label>
                    <label className="inline-flex items-center gap-1 text-xs text-muted cursor-pointer"><input type="checkbox" name={`drop_candidate__${title}`} className="h-4 w-4 accent-ink" />forget it</label>
                  </div>
                ))}
                <span className="text-xs text-muted">Tick to add to the list (under General), then save.</span>
              </div>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Workshop floor</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="PIN needed for consumables above (AED)" hint="Below this, consumables are issued without the technician's PIN.">
                <Input name="pin_needed_above_aed" defaultValue={v.pin_needed_above_aed} inputMode="numeric" required />
              </Field>
              <Field label="Comeback window (days)" hint="A car back within this many days of its gate-out is asked whether it is a comeback.">
                <Input name="comeback_window_days" defaultValue={v.comeback_window_days} inputMode="numeric" required />
              </Field>
            </div>
            <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" name="advisor_labour_discount" defaultChecked={!!flags.advisor_labour_discount} className="mt-1 h-5 w-5 accent-ink" /><span className="flex flex-col text-sm"><span className="font-semibold">Advisors can discount labour</span><span className="text-xs text-muted">On: a small discount column on labour and service lines for advisors. Off: only the owner discounts. Parts are never discounted by advisors.</span></span></label>
            <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" name="customer_documents_uppercase" defaultChecked={!!flags.customer_documents_uppercase} className="mt-1 h-5 w-5 accent-ink" /><span className="flex flex-col text-sm"><span className="font-semibold">Print customer documents in CAPITALS</span><span className="text-xs text-muted">Every line on quotations, estimates, invoices and reports the customer sees, in capitals.</span></span></label>
            <Field label="Known words" hint="Words that keep their capitals when the system tidies names and descriptions as people type: BMW, AMG, A/C. Separate with commas.">
              <Textarea name="known_words" defaultValue={v.known_words ?? listTexts.known_words} rows={4} required />
            </Field>
            <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" name="wash_board_show_times" defaultChecked={!!flags.wash_board_show_times} className="mt-1 h-5 w-5 accent-ink" /><span className="flex flex-col text-sm"><span className="font-semibold">Wash board shows the needed-by date</span><span className="text-xs text-muted">The promised date on each tile of the wash board.</span></span></label>
            <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" name="test_mode_enabled" defaultChecked={flags.test_mode_enabled !== false} className="mt-1 h-5 w-5 accent-ink" /><span className="flex flex-col text-sm"><span className="font-semibold">Testing phase</span><span className="text-xs text-muted">Shows the owner&apos;s &quot;Clear test data&quot; button on this page. Switch off at go-live.</span></span></label>
            <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" name="wash_board_done_button" defaultChecked={!!flags.wash_board_done_button} className="mt-1 h-5 w-5 accent-ink" /><span className="flex flex-col text-sm"><span className="font-semibold">Wash board has a Done button</span><span className="text-xs text-muted">Not built yet: for now the advisor marks the wash done. The switch is kept for later.</span></span></label>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>QC, car ready and follow-up</SectionLabel>
            <Field label="QC general checks" hint="One per line. Every car gets these after its own complaints, work lines and parts.">
              <Textarea name="qc_general_checks" defaultValue={v.qc_general_checks ?? qcChecksText} rows={8} required />
            </Field>
            <Field label="WhatsApp car ready message (proforma)" hint="Sent with the proforma link; the bank details are added underneath (or where you write [bank]). Placeholders: [name], [make model], [plate], [link], [advisor], [bank].">
              <Textarea name="whatsapp_ready_template" defaultValue={v.whatsapp_ready_template} rows={3} required />
            </Field>
            <Field label="WhatsApp tax invoice message" hint="Sent with the tax invoice link once the proforma is paid. Placeholders: [name], [make model], [plate], [link], [advisor].">
              <Textarea name="whatsapp_invoice_template" defaultValue={v.whatsapp_invoice_template} rows={3} required />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Follow-up after gate-out (days)" hint="The advisor is reminded to call the customer.">
                <Input name="followup_days" defaultValue={v.followup_days} inputMode="numeric" required />
              </Field>
            </div>
            <Field label="WhatsApp follow-up message" hint="Placeholders: [name], [make model], [plate], [advisor].">
              <Textarea name="whatsapp_followup_template" defaultValue={v.whatsapp_followup_template} rows={3} required />
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
