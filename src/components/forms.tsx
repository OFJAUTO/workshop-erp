"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice } from "./ui";

/** What a server action hands back to a form: an error to show, and the typed values to keep. */
export type FormState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
};

export const initialFormState: FormState = {};

export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

export function SubmitButton({
  children,
  size = "lg",
  tone = "primary",
  className = "",
}: {
  children: React.ReactNode;
  size?: "md" | "lg";
  tone?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} tone={tone} disabled={pending} className={className}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

/**
 * Wraps a form around a server action. Children receive the current values
 * (either the record being edited or what was typed before an error).
 */
export function ActionForm({
  action,
  initialValues = {},
  className = "flex flex-col gap-5",
  children,
}: {
  action: FormAction;
  initialValues?: Record<string, string>;
  className?: string;
  children: (values: Record<string, string>, state: FormState) => React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const values = { ...initialValues, ...(state.values ?? {}) };
  return (
    <form action={formAction} className={className}>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      {children(values, state)}
    </form>
  );
}

/** Turns submitted data into plain strings so a form can be re-filled after an error. */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}
