"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input } from "@/components/ui";

export function ContactForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      {(v) => (
        <>
          <span className="text-sm font-bold">Add a contact</span>
          <Field label="Name">
            <Input name="name" defaultValue={v.name} required minLength={2} />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} required />
          </Field>
          <Field label="Relationship" optional hint="Driver, assistant, family member…">
            <Input name="relationship" defaultValue={v.relationship} />
          </Field>
          <label className="flex items-center gap-3 min-h-11 cursor-pointer">
            <input type="checkbox" name="can_approve" defaultChecked={v.can_approve === "on"} className="h-5 w-5 accent-ink" />
            <span className="text-sm font-semibold">May approve work on the customer&apos;s behalf</span>
          </label>
          <SubmitButton size="md" tone="secondary">
            Add contact
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
