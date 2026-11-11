/** View as customer (10 November 2026, Section 10): pure words, safe in any component. */
/** The banner words: sent, or "Preview – not sent yet". */
export const previewWords = (notSent: boolean) => (notSent ? "Preview – not sent yet. This is what the customer will see." : "Staff preview – exactly what the customer sees. Read-only: opening it here never counts as opened by the customer.");
