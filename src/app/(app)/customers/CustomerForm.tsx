"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input, Textarea } from "@/components/ui";

export function CustomerForm({
  action,
  initialValues,
  mode,
  isOwner = false,
}: {
  action: FormAction;
  initialValues?: Record<string, string>;
  mode: "create" | "edit";
  /** Only the owner sees and sets the credit terms. */
  isOwner?: boolean;
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
              <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus={mode === "create"} textCase="title" />
            </Field>
            <Field label="Company name" hint="Only for companies.">
              <Input name="company_name" defaultValue={v.company_name} textCase="title" />
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

          <div className="rounded-card border border-line p-4 flex flex-col gap-2" data-credit-terms>
            <span className="text-sm font-semibold">Payment terms</span>
            {isOwner ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {[["", "Pay before release"], ["7", "7 days credit"], ["15", "15 days credit"], ["30", "30 days credit"], ["60", "60 days credit"]].map(([val, label]) => (
                    <label key={val || "off"} className="cursor-pointer">
                      <input type="radio" name="credit_terms_days" value={val} defaultChecked={(v.credit_terms_days ?? "") === val} className="peer sr-only" />
                      <span className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white">{label}</span>
                    </label>
                  ))}
                </div>
                <span className="text-xs text-muted">Every customer pays in full before the car leaves unless you switch credit terms on here (B2B).</span>
              </>
            ) : (
              <span className="text-sm text-muted">{v.credit_terms_days ? `Credit terms: ${v.credit_terms_days} days (set by the owner).` : "Full payment before the car leaves. Only the owner can set credit terms."}</span>
            )}
          </div>

          <Field label="Notes" optional>
            <Textarea name="notes" defaultValue={v.notes} textCase="sentence" />
          </Field>

          <div>
            <SubmitButton>{mode === "create" ? "Save customer" : "Save changes"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
