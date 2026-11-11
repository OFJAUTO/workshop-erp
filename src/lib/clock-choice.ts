/**
 * CLOCKING: START / PAUSE / STOP AFTER THE PIN (10 November 2026, Section 7). THE words of the clock choice, pure.
 * Tap your face → PIN → choose. Nothing changes until a button is pressed. One car at a time per person: starting
 * another car pauses the previous one ("moved to another car"). The break pauses by itself and the tablet asks
 * "Back on this car?" afterwards. Stop = "my part is done".
 */
export const PAUSE_REASONS = ["Break", "Waiting for parts", "Waiting for approval", "Moved to another car", "Other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export const isPauseReason = (r: string): r is PauseReason => (PAUSE_REASONS as readonly string[]).includes(r);

/** How a clocking ended, as stored on bodyshop_clockings.closed_reason. */
export const CLOSE_MOVED = "pause:Moved to another car";
export const CLOSE_DONE = "done";
export const CLOSE_BREAK = "pause:Break";
export const pauseClose = (reason: PauseReason) => `pause:${reason}`;

/** "Break", "Waiting for parts", … from a stored closed_reason; null when it was not a pause. */
export function pauseReasonOf(closed: string | null | undefined): string | null {
  if (!closed) return null;
  if (closed === "break") return "Break";
  return closed.startsWith("pause:") ? closed.slice(6) : null;
}

/** The few-second confirmation: "Usama: paused on Jeep Wrangler (waiting for parts)". */
export function clockWords(name: string, action: "start" | "pause" | "stop", car: string, opts: { reason?: string | null; movedFrom?: string | null; back?: boolean } = {}): string {
  if (action === "start") return `${name}: ${opts.back ? "back on" : "started on"} ${car}${opts.movedFrom ? ` (${opts.movedFrom} paused: moved to another car)` : ""}.`;
  if (action === "pause") return `${name}: paused on ${car}${opts.reason ? ` (${opts.reason.toLowerCase()})` : ""}.`;
  return `${name}: my part is done on ${car}.`;
}
