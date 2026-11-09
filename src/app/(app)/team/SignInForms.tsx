"use client";

import { ActionForm } from "@/components/forms";
import { Button, ChoiceButtons, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The owner removes one phone (a reason is needed: "phone lost"). */
export function RemovePhoneForm({ action, name }: { action: Action; name: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(v) => (
        <>
          <Field label={`Why remove “${name}”?`}>
            <Input name="reason" defaultValue={v.reason} placeholder="For example: phone lost" required minLength={3} data-remove-reason />
          </Field>
          <Button type="submit" tone="danger" data-remove-phone>
            Remove this phone
          </Button>
        </>
      )}
    </ActionForm>
  );
}

/** The owner removes every phone of a person; they set one up again at their next password sign-in. */
export function ResetPhonesForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(v) => (
        <>
          <Field label="Why reset?">
            <Input name="reason" defaultValue={v.reason} placeholder="For example: new phone" required minLength={3} data-reset-reason />
          </Field>
          <Button type="submit" tone="danger" data-reset-phones>
            Reset passkeys (remove all phones)
          </Button>
        </>
      )}
    </ActionForm>
  );
}

/** Who uses passkeys: the owner alone (while he tries it) or everyone in the passkey roles. */
/** "Require passkey" per role (9 November 2026): every passkey role, off until the owner ticks it. */
export function RequiredRolesForm({ action, roles, required }: { action: Action; roles: { id: string; label: string }[]; required: string[] }) {
  return (
    <ActionForm action={action} initialValues={{}} className="flex flex-col gap-3">
      {() => (
        <>
          <div className="flex flex-col gap-2">
            {roles.map((r) => (
              <label key={r.id} className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" name="required" value={r.id} defaultChecked={required.includes(r.id)} className="h-5 w-5 accent-ink" data-require-passkey={r.id} />
                <span className="font-semibold">{r.label}</span>
              </label>
            ))}
          </div>
          <Button type="submit" data-require-save>Save</Button>
        </>
      )}
    </ActionForm>
  );
}

export function RolloutForm({ action, mode }: { action: Action; mode: "owner" | "all" }) {
  return (
    <ActionForm action={action} initialValues={{ mode }} className="flex flex-col gap-3">
      {(v) => (
        <>
          <ChoiceButtons
            name="mode"
            columns={2}
            defaultValue={v.mode}
            options={[
              { value: "owner", label: "Only me (trying it)" },
              { value: "all", label: "Everyone in the passkey roles" },
            ]}
          />
          <Button type="submit" data-rollout-save>
            Save
          </Button>
        </>
      )}
    </ActionForm>
  );
}
