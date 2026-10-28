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
/** Fired when a stale-version error is met but the page already reloaded a moment ago: the bar shows instead. */
export const STALE_EVENT = "erp:stale-version";

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

/**
 * For a catch around a server action: an error that only means "this tab still runs the previous version" reloads
 * the page (the typing is kept) and returns true; anything else returns false for the caller to show as before.
 */
export function reloadIfStale(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (!isStaleVersionError(msg)) return false;
  if (!reloadForNewVersion()) window.dispatchEvent(new Event(STALE_EVENT));
  return true;
}

/* ------------------------------------------------ forms survive a version reload ------------------------------------------------ */

const FORMS_KEY = "erp-version-forms";
const SKIP_TYPES = new Set(["hidden", "file", "password", "submit", "button", "reset", "image"]);
type FormSnap = { sig: string; values: Record<string, string[]> };

/** The named, typeable fields of a form (never passwords, PINs, files or hidden fields). */
function fieldsOf(form: HTMLFormElement): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
  if (form.hasAttribute("data-no-draft")) return [];
  return Array.from(form.elements).filter((el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
    if (!el.name || /pin|password/i.test(el.name)) return false;
    return !(el instanceof HTMLInputElement && SKIP_TYPES.has(el.type));
  });
}
const sigOf = (fields: { name: string }[]) => Array.from(new Set(fields.map((f) => f.name))).sort().join("|");

/** Keeps what is typed in this page's forms for two minutes (called just before a version reload and on submit). */
export function snapshotForms(only?: HTMLFormElement): void {
  try {
    const forms = only ? [only] : Array.from(document.forms);
    const snaps: FormSnap[] = [];
    for (const form of forms) {
      const fields = fieldsOf(form);
      if (!fields.length) continue;
      const values: Record<string, string[]> = {};
      let typed = false;
      for (const el of fields) {
        const v = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.checked ? el.value || "on" : null) : el.value;
        if (v === null) continue;
        (values[el.name] ??= []).push(v);
        const changed = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.checked !== el.defaultChecked : el instanceof HTMLSelectElement ? Array.from(el.options).some((o) => o.selected !== o.defaultSelected) : el.value !== el.defaultValue;
        if (changed) typed = true;
      }
      if (typed) snaps.push({ sig: sigOf(fields), values });
    }
    const all = JSON.parse(sessionStorage.getItem(FORMS_KEY) ?? "{}") as Record<string, { t: number; snaps: FormSnap[] }>;
    // One submitted form is added to what is kept; a whole-page snapshot (just before a reload) replaces it, so a form
    // already sent and emptied is never filled in again.
    const prev = only ? (all[location.pathname]?.snaps ?? []) : [];
    const merged = [...prev.filter((p) => !snaps.some((x) => x.sig === p.sig)), ...snaps];
    if (merged.length) all[location.pathname] = { t: Date.now(), snaps: merged };
    else delete all[location.pathname];
    sessionStorage.setItem(FORMS_KEY, JSON.stringify(all));
  } catch {}
}

/** After a version reload: puts the kept typing back into the matching forms (only into fields still at their start). */
export function restoreForms(): number {
  let restored = 0;
  try {
    const reloadedAt = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    const all = JSON.parse(sessionStorage.getItem(FORMS_KEY) ?? "{}") as Record<string, { t: number; snaps: FormSnap[] }>;
    const mine = all[location.pathname];
    if (!mine || Date.now() - reloadedAt > 2 * 60_000 || Date.now() - mine.t > 2 * 60_000) return 0;
    for (const form of Array.from(document.forms)) {
      const fields = fieldsOf(form);
      const snap = mine.snaps.find((s) => s.sig === sigOf(fields));
      if (!snap) continue;
      for (const el of fields) {
        const vals = snap.values[el.name];
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          const want = !!vals?.includes(el.value || "on");
          if (el.checked === el.defaultChecked && el.checked !== want) {
            el.checked = want;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            restored++;
          }
          continue;
        }
        const v = vals?.[0];
        if (v === undefined || el.value === v || el.value !== (el instanceof HTMLSelectElement ? el.value : el.defaultValue)) continue;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
        restored++;
      }
    }
    delete all[location.pathname];
    sessionStorage.setItem(FORMS_KEY, JSON.stringify(all));
  } catch {}
  return restored;
}

/** A submitted form that finished normally (no reload within 15 seconds) is forgotten. */
export function forgetFormSnapshot(form: HTMLFormElement): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(FORMS_KEY) ?? "{}") as Record<string, { t: number; snaps: FormSnap[] }>;
    const mine = all[location.pathname];
    if (!mine) return;
    const sig = sigOf(fieldsOf(form));
    mine.snaps = mine.snaps.filter((x) => x.sig !== sig);
    if (!mine.snaps.length) delete all[location.pathname];
    sessionStorage.setItem(FORMS_KEY, JSON.stringify(all));
  } catch {}
}
