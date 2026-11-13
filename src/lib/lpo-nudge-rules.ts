/** The 30-minute nudge of an LPO waiting for approval (13 November 2026, Section 1). Pure. */
export const NUDGE_MINUTES = 30;

/** Pure: is a nudge due for an LPO that has waited since `since`, last nudged at `last`? */
export function nudgeDue(since: string, last: string | null, now: number, minutes = NUDGE_MINUTES): boolean {
  const waited = now - Date.parse(since);
  if (waited < minutes * 60000) return false;
  return !last || now - Date.parse(last) >= minutes * 60000 - 30000;
}
