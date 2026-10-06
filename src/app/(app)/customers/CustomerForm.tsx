"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input, Textarea } from "@/components/ui";

export function CustomerForm({
  action,
  initialValues,
  mode,
}: {
  action: FormAction;
  initialValues?: Record<string, string>;
  mode: "create" | "edit";
}) {
  return (
    <ActionForm action={action} initialValues={initialValues}>
      {(v) => (
        <>
          <Field label="Customer type">
            <ChoiceButtons
              name="customer_type"
              columns={2}
              defaultValue={v.customer_type ?? "individual"}
              options={[
                { value: "individual", label: "Individual" },
                { value: "company", label: "Company" },
              ]}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" hint="For a company: the person you deal with.">
              <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus={mode === "create"} />
            </Field>
            <Field label="Company name" hint="Only for companies.">
              <Input name="company_name" defaultValue={v.company_name} />
            </Field>
            <Field label="Phone (WhatsApp)">
              <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} required placeholder="+971 50 123 4567" />
            </Field>
            <Field label="Second phone" optional>
              <Input name="phone2" type="tel" inputMode="tel" defaultValue={v.phone2} />
            </Field>
            <Field label="Email" optional>
              <Input name="email" type="email" inputMode="email" defaultValue={v.email} />
            </Field>
            <Field label="Area" optional hint="For example: Jumeirah, Business Bay">
              <Input name="area" defaultValue={v.area} />
            </Field>
            <Field label="TRN" optional hint="15-digit tax registration number, for company tax invoices.">
              <Input name="trn" inputMode="numeric" defaultValue={v.trn} maxLength={15} />
            </Field>
          </div>

          <div className="rounded-card border border-line p-4 flex flex-col gap-3">
            <label className="flex items-center gap-3 min-h-11 cursor-pointer">
              <input type="checkbox" name="is_vip" defaultChecked={v.is_vip === "on"} className="h-5 w-5 accent-ink" />
              <span className="text-sm font-semibold">VIP customer</span>
            </label>
            <Field label="VIP handling note" hint="Shown to every staff member who opens one of this customer's cars.">
              <Textarea name="vip_note" defaultValue={v.vip_note} placeholder="For example: always call before any extra work; prefers WhatsApp after 10am." />
            </Field>
          </div>

          <Field label="Notes" optional>
            <Textarea name="notes" defaultValue={v.notes} />
          </Field>

          <div>
            <SubmitButton>{mode === "create" ? "Save customer" : "Save changes"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
