"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input } from "@/components/ui";
import { ALL_ROLES, DEPARTMENT_LABELS, ROLE_LABELS, type DepartmentId } from "@/lib/roles";

export function StaffForm({
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name">
              <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus={mode === "create"} />
            </Field>
            <Field label="Short name" hint="What appears on screens and tablet tiles, e.g. Rashid">
              <Input name="display_name" defaultValue={v.display_name} required />
            </Field>
          </div>

          <Field label="Role">
            <ChoiceButtons
              name="role_id"
              columns={4}
              defaultValue={v.role_id}
              options={ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
          </Field>

          <Field label="Department">
            <ChoiceButtons
              name="department_id"
              columns={3}
              defaultValue={v.department_id}
              options={(Object.keys(DEPARTMENT_LABELS) as DepartmentId[]).map((d) => ({
                value: d,
                label: DEPARTMENT_LABELS[d],
              }))}
            />
          </Field>

          {mode === "create" ? (
            <Field label="How this person logs in">
              <ChoiceButtons
                name="login_type"
                columns={2}
                defaultValue={v.login_type}
                options={[
                  { value: "pin", label: "Shared tablet", hint: "Tap name, enter 4-digit PIN" },
                  { value: "password", label: "Office PC", hint: "Email and password" },
                ]}
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Email" hint="Needed for PC login. Optional for tablet users." optional>
              <Input name="email" type="email" inputMode="email" defaultValue={v.email} />
            </Field>
            <Field label="Phone" optional>
              <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} />
            </Field>
            <Field label="Employee number" optional>
              <Input name="employee_number" defaultValue={v.employee_number} />
            </Field>
            {mode === "create" ? (
              <Field label="4-digit PIN" hint="Needed for tablet login. The PIN is scrambled before it is stored.">
                <Input
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="1234"
                  defaultValue={v.pin}
                  autoComplete="off"
                />
              </Field>
            ) : null}
          </div>

          <label className="flex items-center gap-3 min-h-11 cursor-pointer">
            <input
              type="checkbox"
              name="is_head_accountant"
              defaultChecked={v.is_head_accountant === "on"}
              className="h-5 w-5 accent-ink"
            />
            <span className="text-sm font-semibold">Head accountant (can approve purchase orders later)</span>
          </label>

          <div className="flex gap-2">
            <SubmitButton>{mode === "create" ? "Add staff member" : "Save changes"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
