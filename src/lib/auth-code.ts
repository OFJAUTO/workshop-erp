/**
 * The bank's authorisation code (29 October 2026): every card-machine and payment-link payment carries the 6-character
 * code from the card slip or the payment confirmation. It is the key that matches the payment to the bank's settlement
 * report (with the amount and the date). Pure, shared by the forms and the server.
 */

/** The methods whose payments need an auth code. */
export function needsAuthCode(method: string): boolean {
  return method === "card" || method === "link";
}

/** As the bank prints it: capitals, no spaces ("75 61 17" → "756117"). */
export function cleanAuthCode(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 12);
}

export const AUTH_CODE_RE = /^[A-Z0-9]{6}$/;

/** Where the code is found, in the words the forms use. */
export function authCodeWhere(method: string): string {
  return method === "link" ? "the payment confirmation" : "the card slip";
}

/** Null when fine; otherwise the sentence the form shows. */
export function authCodeProblem(method: string, code: string): string | null {
  if (!needsAuthCode(method)) return null;
  if (!code) return `Type the auth code from ${authCodeWhere(method)} (6 letters or digits).`;
  if (!AUTH_CODE_RE.test(code)) return `The auth code is 6 letters or digits (as on ${authCodeWhere(method)}); "${code}" has ${code.length}.`;
  return null;
}
