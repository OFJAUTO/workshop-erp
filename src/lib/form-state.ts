/** What a server action hands back to a form: an error to show, and the typed values to keep. */
export type FormState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
};

export const initialFormState: FormState = {};

/** Turns submitted data into plain strings so a form can be re-filled after an error. */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}
