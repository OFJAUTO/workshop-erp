/**
 * CONFIRM + UNDO for money actions (1 November 2026, B3). After a money action is confirmed, the same person or the
 * owner can undo it for a short time (Setting money_undo_minutes, 10); nothing goes to Zoho Books before that time is
 * over. After it, only the owner or accounts reverse it, with a reason, as a proper reversal (logged, and by hand in
 * Zoho when it already posted). Pure: no database.
 */

export const DEFAULT_UNDO_MINUTES = 10;

/** The Zoho outbox kinds that wait out the undo window before they post. */
export const UNDO_HOLD_KINDS = new Set(["payment", "deposit", "billpayment"]);

/** Seconds left to undo (0 when the window is over). */
export function undoSecondsLeft(at: string | null | undefined, minutes = DEFAULT_UNDO_MINUTES, now = Date.now()): number {
  if (!at) return 0;
  return Math.max(0, Math.floor((Date.parse(at) + minutes * 60000 - now) / 1000));
}

/** "Undo (9:58)". */
export function undoLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `Undo (${m}:${String(s).padStart(2, "0")})`;
}

/** May this person undo it now: inside the window, and the one who did it or the owner. */
export function mayUndo(doneBy: string | null | undefined, staff: { id: string; role_id: string }, at: string | null | undefined, minutes = DEFAULT_UNDO_MINUTES, now = Date.now()): boolean {
  return undoSecondsLeft(at, minutes, now) > 0 && (staff.role_id === "owner" || (!!doneBy && doneBy === staff.id));
}

/** Is an outbox row still held back by the undo window? */
export function heldForUndo(kind: string, enqueuedAt: string, minutes = DEFAULT_UNDO_MINUTES, now = Date.now()): boolean {
  return UNDO_HOLD_KINDS.has(kind) && Date.parse(enqueuedAt) > now - minutes * 60000;
}
