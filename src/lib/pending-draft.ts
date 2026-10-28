/**
 * Unsaved typing survives a reload (28 October 2026). An autosaving box writes what is waiting to be saved into this
 * browser the moment it is typed, clears it once the server confirmed the save, and on the next load puts it back and
 * saves it again. So a new-version reload, a tablet put to sleep or a closed tab within the half-second wait never
 * loses the last change. ONE helper for every autosaving box (Parts table rows, damage note, tint, panel marks).
 */
const PREFIX = "erp-pending:";
const TTL_MS = 12 * 3600 * 1000;

export function writePending(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {}
}

export function clearPending(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {}
}

/** What was waiting to be saved under this key (within the last 12 hours), or null. */
export function readPending<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as { t: number; v: T };
    if (Date.now() - d.t > TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return d.v;
  } catch {
    return null;
  }
}
