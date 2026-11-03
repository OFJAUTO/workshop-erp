/**
 * The bank's authorisation code (29 October 2026): card-machine and payment-link payments carry the 6-character code
 * from the card slip or the payment confirmation. It is the key that matches the payment to the bank's settlement
 * report (with the amount and the date). Pure, shared by the forms, the server, the lists and the bank-report matching.
 *
 * 3 November 2026 (section 5, RCT-00040): the code is OPTIONAL. A payment saved without it, or with a code a bank never
 * prints ("111111", "000000", "123456" - typed only to get past the box), is "Auth code missing": stored as no code,
 * flagged in amber inside the ERP (never on a customer document), added later by the owner or accounts, or filled in
 * from the bank's settlement report.
 */

/** The methods whose payments carry an auth code. */
export function needsAuthCode(method: string): boolean {
  return method === "card" || method === "link";
}

/** As the bank prints it: capitals, no spaces ("75 61 17" → "756117"). */
export function cleanAuthCode(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 12);
}

export const AUTH_CODE_RE = /^[A-Z0-9]{6}$/;

export const AUTH_MISSING_WORDS = "Auth code missing";
export const AUTH_OPTIONAL_HINT = "Optional – helps match the bank report";

/**
 * Codes a bank never prints, as ONE fixed list (so the database can be asked for them too): one character six times
 * (111111, 000000, AAAAAA), a straight run of digits up or down (123456, 012345, 654321, 987654 …) and a few made-up
 * patterns. A real bank code that looks like one of these is about 1 in 100,000: it only shows the amber flag.
 */
export const FAKE_AUTH_CODES: readonly string[] = (() => {
  const out = new Set<string>();
  for (const c of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") out.add(c.repeat(6));
  for (let start = 0; start <= 4; start++) {
    const up = Array.from({ length: 6 }, (_, i) => String(start + i)).join("");
    out.add(up);
    out.add([...up].reverse().join(""));
  }
  for (const c of ["123123", "121212", "112233", "ABCDEF", "ABC123", "QWERTY", "XXXXXX"]) out.add(c);
  return Array.from(out);
})();
const FAKE = new Set(FAKE_AUTH_CODES);

/** A code typed only to get past the box (empty or malformed is "missing" or a problem, never "fake"). */
export function isFakeAuthCode(raw: unknown): boolean {
  const c = cleanAuthCode(raw);
  return AUTH_CODE_RE.test(c) && FAKE.has(c);
}

/** The code worth keeping, matching and printing: null when empty, malformed or made up. */
export function realAuthCode(raw: unknown): string | null {
  const c = cleanAuthCode(raw);
  return AUTH_CODE_RE.test(c) && !FAKE.has(c) ? c : null;
}

/** "Auth code missing": a card or payment-link payment with no real code (empty or made up). Internal only. */
export function authCodeMissing(p: { method: string; auth_code?: string | null }): boolean {
  return needsAuthCode(p.method) && !realAuthCode(p.auth_code);
}

/** Why the flag is up, for a tooltip: "No auth code was typed" or "111111 is not a real code". */
export function authMissingWhy(code: string | null | undefined): string {
  const c = cleanAuthCode(code);
  return c ? `${c} is not a real code` : "No auth code was typed";
}

/** Where the code is found, in the words the forms use. */
export function authCodeWhere(method: string): string {
  return method === "link" ? "the payment confirmation" : "the card slip";
}

/**
 * Null when the box may be saved as it is (empty, a real code, or a made-up one that is saved as missing); otherwise
 * the sentence the form shows: only a typed code of the wrong length or with other characters is refused.
 */
export function authCodeProblem(method: string, code: string): string | null {
  if (!needsAuthCode(method)) return null;
  const c = cleanAuthCode(code);
  if (!c) return null;
  if (!AUTH_CODE_RE.test(c)) return `The auth code is 6 letters or digits (as on ${authCodeWhere(method)}); "${c}" has ${c.length}. Leave it empty if you don't have it.`;
  return null;
}

/** The amber words beside the box for a made-up code (the payment saves, flagged); null otherwise. */
export function authCodeNote(method: string, code: string): string | null {
  if (!needsAuthCode(method) || !isFakeAuthCode(code)) return null;
  return `${cleanAuthCode(code)} is not a real code: the payment is saved as "${AUTH_MISSING_WORDS}". Type the code from ${authCodeWhere(method)}, or leave it empty and add it later.`;
}

/**
 * The red words for a made-up code where a REAL code is the point - the "Add auth code" box and the server behind it
 * (review, 3 November 2026: that box must never say the payment "is saved as missing"). Null otherwise.
 */
export function authCodeRefusal(method: string, code: string): string | null {
  if (!needsAuthCode(method) || !isFakeAuthCode(code)) return null;
  return `${cleanAuthCode(code)} is not a real code: type the code from ${authCodeWhere(method)}.`;
}

/** The confirm question's words for the code: "auth 756117", or "auth code missing (flagged)". */
export function authConfirmWords(method: string, code: string | null | undefined): string | null {
  if (!needsAuthCode(method)) return null;
  const real = realAuthCode(code);
  return real ? `auth ${real}` : "auth code missing (flagged)";
}

/** A PostgREST filter for the payments whose code is missing: no code, or one of the made-up ones. */
export function authMissingFilter(): string {
  return `auth_code.is.null,auth_code.in.(${FAKE_AUTH_CODES.join(",")})`;
}
