"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input } from "@/components/ui";

export function PhotoUploadForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col sm:flex-row sm:items-end gap-3">
      {() => (
        <>
          <Field label="Add a photo">
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              required
              className="text-sm file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line-strong file:bg-white file:px-4 file:text-sm file:font-bold"
            />
          </Field>
          <Field label="Caption" optional>
            <Input name="caption" placeholder="e.g. Front left scratch" />
          </Field>
          <SubmitButton size="md" tone="secondary">
            Upload
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
