/**
 * ALWAYS A WAY TO SEND OR RESEND A QUOTE (6 November 2026, Q-00062): THE rule for the one button on the job card's
 * quotation list, the quotation and estimate page headers and the lists' "…" menus. Pure.
 * - Never sent: "Send to customer" - greyed with the reason while it is not ready (one tap opens the missing lines).
 * - Sent, opened, approved, urgent-only asked, declined or expired: "Resend quote".
 * - A newer version still being prepared: the NEWEST FINISHED version goes out ("Resend v1 (v2 not finished)").
 */
export type SendVersion = { id: string; version: number; status: string; completed_at?: string | null; token?: string | null };
export type SendState = { label: string; enabled: boolean; reason: string | null; targetId: string; resend: boolean };

export const FINISHED_STATUSES = ["sent", "opened", "approved", "urgent_requested", "declined", "expired"];
const PREPARING = ["draft", "pending_owner"];

export function sendStateOf(versions: SendVersion[], opts: { kind?: string; unpricedParts?: number } = {}): SendState | null {
  if (!versions.length) return null;
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const current = sorted[sorted.length - 1];
  const word = opts.kind === "estimate" ? "estimate" : "quote";
  if (PREPARING.includes(current.status)) {
    const finished = [...sorted].reverse().find((v) => v.id !== current.id && FINISHED_STATUSES.includes(v.status));
    if (finished) return { label: `Resend v${finished.version} (v${current.version} not finished)`, enabled: true, reason: null, targetId: finished.id, resend: true };
    if (current.status === "pending_owner") return { label: "Send to customer", enabled: false, reason: "Waiting for the owner's approval", targetId: current.id, resend: false };
    const unpriced = opts.unpricedParts ?? 0;
    if (unpriced > 0) return { label: "Send to customer", enabled: false, reason: `${unpriced} part${unpriced === 1 ? "" : "s"} not priced`, targetId: current.id, resend: false };
    return { label: "Send to customer", enabled: true, reason: current.completed_at ? null : "Checks run first (Quotation complete)", targetId: current.id, resend: false };
  }
  if (FINISHED_STATUSES.includes(current.status)) return { label: `Resend ${word}`, enabled: true, reason: null, targetId: current.id, resend: true };
  return { label: `Resend ${word}`, enabled: false, reason: current.status === "cancelled" ? "Cancelled" : "Replaced by a newer version", targetId: current.id, resend: true };
}
