/**
 * New versions without dead clicks (27 October 2026). Every deploy has its own version, baked into the page at build
 * time (NEXT_PUBLIC_APP_VERSION) and written to the static /version.json (no server work to read it). A tab that sees
 * a different version offers "A new version is available – tap to refresh"; a click that fails because the tab still
 * runs the old version (a missing code chunk, a server action the new version no longer has) reloads by itself.
 * Before any reload the forms push what is typed into their saved drafts, so nothing is lost.
 */

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
/** Fired just before the page reloads for a new version: forms save what is waiting. Also fired on pagehide. */
export const BEFORE_RELOAD_EVENT = "erp:before-reload";

/** The errors an old tab meets after a deploy (missing chunks, server actions the new build no longer has). */
export function isStaleVersionError(message: string): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to find Server Action|Server Action .{0,80} (was )?not found|older or newer deployment/i.test(message);
}

/** Runs fn when the page is about to go away (closed, put in the background on a tablet, or reloaded for a new version). */
export function onPageLeave(fn: () => void): () => void {
  const vis = () => {
    if (document.visibilityState === "hidden") fn();
  };
  window.addEventListener("pagehide", fn);
  window.addEventListener(BEFORE_RELOAD_EVENT, fn);
  document.addEventListener("visibilitychange", vis);
  return () => {
    window.removeEventListener("pagehide", fn);
    window.removeEventListener(BEFORE_RELOAD_EVENT, fn);
    document.removeEventListener("visibilitychange", vis);
  };
}

/** Pushes every waiting debounced save through at once (the forms keep their queue in the browser). */
export function flushTimers<Op>(timers: Record<string, ReturnType<typeof setTimeout>>, ops: Record<string, () => Op>, save: (op: Op) => void): void {
  for (const key of Object.keys(timers)) {
    clearTimeout(timers[key]);
    delete timers[key];
    const op = ops[key];
    delete ops[key];
    if (op) save(op());
  }
}

const RELOAD_KEY = "erp-version-reload-at";

/**
 * Reloads once for a new version: the forms save first, then the page reloads. A second stale error within a minute
 * does not loop; it returns false and the bar is shown instead.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {}
  window.dispatchEvent(new Event(BEFORE_RELOAD_EVENT));
  setTimeout(() => window.location.reload(), 600);
  return true;
}
