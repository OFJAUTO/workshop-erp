"use client";

import { useState } from "react";
import { Button, ChoiceButtons, Field, Input, Notice, Select } from "@/components/ui";

export function RegisterForm({
  action,
  error,
  people,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error: string | null;
  people: { id: string; label: string }[];
}) {
  const [kind, setKind] = useState<"shared" | "personal">("shared");
  return (
    <form action={action} className="flex flex-col gap-5">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field label="Device name" hint="For example: Workshop tablet 3, or Anas phone">
        <Input name="name" required minLength={2} autoFocus />
      </Field>
      <Field label="Type">
        <div onChange={(e) => setKind((e.target as HTMLInputElement).value as "shared" | "personal")}>
          <ChoiceButtons
            name="kind"
            columns={2}
            defaultValue="shared"
            options={[
              { value: "shared", label: "Shared", hint: "Name grid for everyone with handheld login" },
              { value: "personal", label: "Personal", hint: "One person, opens straight to their PIN" },
            ]}
          />
        </div>
      </Field>
      {kind === "shared" ? (
        <Field label="Where it lives">
          <ChoiceButtons
            name="location"
            options={[
              { value: "workshop", label: "Workshop" },
              { value: "bodyshop", label: "Bodyshop" },
              { value: "office", label: "Office" },
            ]}
          />
        </Field>
      ) : (
        <Field label="Assigned to">
          <Select name="staff_id" defaultValue="" required>
            <option value="" disabled>
              Choose the person…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Button type="submit" size="lg">
        Register and sign me out
      </Button>
    </form>
  );
}
