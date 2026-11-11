/**
 * PASSWORD SIGN-IN ALERTS (11 November 2026, Section 14). Pure. A person with a phone set up who signs in with the
 * password no longer rings the owner each time: one summary a day ("Password sign-ins today: ADARSH 3, MERT 1") that
 * never counts in the red badge. A sign-in from a device that person never used before still alerts the owner at once.
 */
export const SUMMARY_TYPE = "password_sign_in_summary";
export const NEW_DEVICE_TYPE = "password_new_device";
/** The summary goes at the first hourly run from this Dubai hour. */
export const SUMMARY_HOUR = 21;

export function summaryWords(rows: { name: string }[]): string | null {
  if (!rows.length) return null;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = (r.name || "Someone").trim().toUpperCase();
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => `${n} ${c}`);
  return `Password sign-ins today: ${parts.join(", ")}`;
}

/** The Dubai hour (0-23) and the start of the Dubai day as an instant. */
export function dubaiClock(nowMs: number): { hour: number; dayStartIso: string } {
  const d = new Date(nowMs + 4 * 3600_000);
  const day = d.toISOString().slice(0, 10);
  return { hour: d.getUTCHours(), dayStartIso: new Date(`${day}T00:00:00+04:00`).toISOString() };
}

/** A device is new for a person when no earlier successful sign-in of theirs came from the same browser. */
export function isNewDevice(userAgent: string | null, earlier: (string | null)[]): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return false;
  return !earlier.some((e) => (e ?? "").trim() === ua);
}
