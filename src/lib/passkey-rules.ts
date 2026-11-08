/**
 * THE passkey rules (7 November 2026, the owner's login security upgrade). Pure: imports only teams.ts.
 *
 * Who: the owner, service advisors, parts, gate-in, accounts, QC and the workshop manager (mechanical side).
 * Never the bodyshop manager (a workshop manager on the bodyshop side), team leaders or technicians: their
 * logins stay exactly as they were.
 * Rollout (settings.passkeys_rollout): "owner" = only the owner while he tries it, "all" = everyone above.
 * For a passkey person: the passkey is THE sign-in, the password is the backup (each use is logged and the owner
 * is told), a PIN no longer opens the ERP once a passkey exists (PINs still sign hand-overs), and a sign-in lasts
 * 12 hours from the moment it was made ("Keep me signed in" does not lengthen it).
 */
import { sideOfPerson } from "./teams";

export const PASSKEY_ROLES = ["owner", "service_advisor", "parts", "gate_in", "accounts", "qc_inspector", "workshop_manager"] as const;

export type PasskeyRollout = "owner" | "all";

export const PASSKEY_SESSION_HOURS = 12;

/** The role (and side) gets passkeys at all. */
export function passkeyRole(p: { role_id: string; team?: string | null; department_id?: string | null }): boolean {
  if (!(PASSKEY_ROLES as readonly string[]).includes(p.role_id)) return false;
  if (p.role_id === "workshop_manager" && sideOfPerson(p) === "bodyshop") return false;
  return true;
}

export function rolloutOf(value: unknown): PasskeyRollout {
  return value === "all" ? "all" : "owner";
}

/** Passkeys are switched on for this person now (their role, and the rollout reaches them). */
export function passkeyPerson(p: { role_id: string; team?: string | null; department_id?: string | null }, rollout: PasskeyRollout): boolean {
  if (!passkeyRole(p)) return false;
  return rollout === "all" || p.role_id === "owner";
}

/** A sign-in that ends later than 12 hours from now is cut back (a "Keep me signed in" session from before). */
export function sessionNeedsCap(untilMs: number, nowMs: number): boolean {
  if (!Number.isFinite(untilMs)) return false;
  return untilMs > nowMs + PASSKEY_SESSION_HOURS * 3600_000 + 5 * 60_000;
}

/** Common passkey providers by AAGUID, so a phone is named like the person sees it. */
const PROVIDERS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
};

export function providerOf(aaguid: string | null | undefined): string | null {
  return (aaguid && PROVIDERS[aaguid.toLowerCase()]) || null;
}

/** "iPhone", "Android phone", "iPad", "Windows PC", … from the browser that did the setting up. */
export function deviceKindOf(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Device";
}

/**
 * The name a new passkey gets when the person types none: where the key lives. Set up from a PC with a phone, the
 * provider says which phone ("iCloud Keychain" = an iPhone); set up on the phone itself, the browser says so.
 */
export function defaultPasskeyName(userAgent: string | null | undefined, aaguid: string | null | undefined): string {
  const provider = providerOf(aaguid);
  const kind = deviceKindOf(userAgent);
  if (provider === "iCloud Keychain") return kind === "iPad" ? "iPad" : "iPhone";
  if (provider === "Google Password Manager" || provider === "Samsung Pass") return kind.startsWith("Android") ? kind : "Android phone";
  if (provider === "Windows Hello") return "This Windows PC";
  if (provider) return provider;
  return kind;
}

/** A name for the passkey from the person's own words: trimmed, at most 60 characters. */
export function cleanPasskeyName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.slice(0, 60);
}

/** What the log calls each way in. */
export const METHOD_WORDS: Record<string, string> = {
  passkey: "Passkey",
  password: "Password",
  password_backup: "Password (backup)",
  pin: "PIN",
  setup_link: "Setup link",
  quick: "Phone code",
};

/** What the log calls each change of a person's ways in. */
export const CHANGE_WORDS: Record<string, string> = {
  passkey_added: "Phone added",
  passkey_removed: "Phone removed",
  passkeys_reset: "All phones removed (reset)",
  password_set: "Password chosen (setup link)",
  password_changed: "Password changed",
  setup_link: "Setup link made",
  pin_reset: "Temporary PIN set",
  login_type: "Login method changed",
  setup_skipped: "Phone setup skipped for now",
  rollout: "Passkeys switched on",
};
