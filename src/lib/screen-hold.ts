/**
 * "Not now" for the shared tablet's idle lock (12 November 2026, the inspection uploads fix). The idle lock signed a
 * technician out after two minutes without a touch, also while they were in the camera app recording a video or while
 * the tablet was getting the photos ready - and the video the camera handed back had no screen left to land on: it was
 * lost before it was ever saved. Anything that must not be interrupted holds the lock off while it runs: the cameras
 * inside the page, a file picker or the camera app being open, files being got ready. Browser only; pure counters.
 */

const holds = new Map<number, { reason: string; until: number }>();
let next = 1;

/** Holds the idle lock off until the returned release is called (or `maxMs` passes: a picker never answered). */
export function holdIdleLock(reason: string, maxMs = 10 * 60_000): () => void {
  const id = next++;
  holds.set(id, { reason, until: Date.now() + maxMs });
  return () => {
    holds.delete(id);
  };
}

/** Why the idle lock must wait now (null = it may lock). */
export function idleLockHeld(now = Date.now()): string | null {
  for (const [id, h] of holds) {
    if (h.until < now) holds.delete(id);
    else return h.reason;
  }
  return null;
}

/**
 * A file picker or the camera app is opening from this input: the lock waits until a file comes back, the page is back
 * and a moment has passed with nothing (the person cancelled), or ten minutes.
 */
export function holdWhilePicking(input: HTMLInputElement | null, reason = "picking"): void {
  if (!input || typeof window === "undefined") return;
  const release = holdIdleLock(reason);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    input.removeEventListener("change", onChange);
    input.removeEventListener("cancel", onCancel);
    window.removeEventListener("focus", onFocus);
    // The file is handed to the page a moment after the change: keep the hold a little longer so it is got ready first.
    setTimeout(release, 15_000);
  };
  const onChange = () => finish();
  const onCancel = () => finish();
  // Back on the page with no file after a while (the camera app was closed): the hold goes.
  const onFocus = () => setTimeout(() => { if (!input.files?.length) finish(); }, 90_000);
  input.addEventListener("change", onChange);
  input.addEventListener("cancel", onCancel);
  window.addEventListener("focus", onFocus);
}
