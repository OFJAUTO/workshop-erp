/**
 * PROOF ON EVERY PAYMENT METHOD (10 November 2026, Section 6). THE rule, pure: every method can carry a proof
 * ("Add proof" or "Scan document"); a cheque needs a photo of the cheque, a card the slip, a transfer the
 * screenshot; cash and a payment link are optional. Used by every place a payment is recorded and by the server.
 */
export const PROOF_REQUIRED = new Set(["card", "transfer", "cheque"]);

export const proofRequired = (method: string | null | undefined): boolean => PROOF_REQUIRED.has(String(method ?? ""));

/** The words over the proof box. */
export function proofLabel(method: string | null | undefined): string {
  switch (method) {
    case "card": return "Photo of the card slip (required)";
    case "transfer": return "Transfer proof: screenshot or photo (required)";
    case "cheque": return "Photo of the cheque (required)";
    case "link": return "Payment link receipt: screenshot (optional)";
    case "cash": return "Cash: photo of the signed receipt (optional)";
    default: return "Proof (optional)";
  }
}

/** The refusal when a required proof is missing. */
export function proofMissingWords(method: string | null | undefined): string {
  switch (method) {
    case "card": return "Attach a photo of the card slip first.";
    case "transfer": return "Attach the transfer proof (screenshot or photo) first.";
    case "cheque": return "Attach a photo of the cheque first.";
    default: return "Attach the proof first.";
  }
}

/** A stored proof is a PDF (an icon) or a picture (a thumbnail). */
export const proofIsPdf = (path: string | null | undefined, contentType?: string | null): boolean => /pdf/i.test(contentType ?? "") || /\.pdf$/i.test(path ?? "");
