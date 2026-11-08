/**
 * THE password rule (7 November 2026, the owner's login security upgrade). Pure: no imports.
 * At least 10 characters with a small letter, a capital letter and a number. Symbols are allowed but never needed.
 * Supabase holds the same rule (password_min_length 10, lower:upper:digits) and refuses passwords found in known data
 * leaks; these words are what every screen shows, before and after Supabase answers. Existing passwords keep working:
 * the rule is checked only when a password is chosen.
 */

export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_RULE_WORDS = "At least 10 characters, with a small letter, a capital letter and a number. Symbols are allowed but not needed.";

export const PASSWORD_LEAKED_WORDS = "This password has appeared in a data leak on another website, so it is not safe. Choose a different one.";

export const PASSWORDS_DIFFER_WORDS = "The two passwords do not match.";

export type PasswordCheck = { key: "length" | "lower" | "upper" | "digit"; words: string; ok: boolean };

/** Each part of the rule with whether the password meets it, for the ticks under the box. */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { key: "length", words: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: password.length >= PASSWORD_MIN_LENGTH },
    { key: "lower", words: "A small letter (a–z)", ok: /[a-z]/.test(password) },
    { key: "upper", words: "A capital letter (A–Z)", ok: /[A-Z]/.test(password) },
    { key: "digit", words: "A number (0–9)", ok: /[0-9]/.test(password) },
  ];
}

const MISSING_WORDS: Record<PasswordCheck["key"], string> = {
  length: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  lower: "Add a small letter (a–z).",
  upper: "Add a capital letter (A–Z).",
  digit: "Add a number (0–9).",
};

/** The first thing the password still needs, in plain words, or null when it meets the rule. */
export function passwordProblem(password: string): string | null {
  const miss = passwordChecks(password).filter((c) => !c.ok);
  if (miss.length === 0) return null;
  if (miss.length === 1) return MISSING_WORDS[miss[0].key];
  const short: Record<PasswordCheck["key"], string> = { length: `at least ${PASSWORD_MIN_LENGTH} characters`, lower: "a small letter", upper: "a capital letter", digit: "a number" };
  return "The password needs " + miss.map((m) => short[m.key]).join(", ") + ".";
}

/** Supabase's refusal of a password, in our words (its own text never reaches a screen). */
export function supabasePasswordWords(err: { code?: string | null; message?: string | null; reasons?: string[] | null } | null | undefined): string | null {
  if (!err) return null;
  const reasons = err.reasons ?? [];
  const text = `${err.code ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (err.code === "same_password" || /different from the old/.test(text)) return "That is your current password. Choose a new one.";
  if (reasons.includes("pwned") || /pwned|leak|breach|known to be weak|compromised/.test(text)) return PASSWORD_LEAKED_WORDS;
  if (err.code === "weak_password" || reasons.length > 0 || /password should|weak password|at least/.test(text)) return PASSWORD_RULE_WORDS;
  return null;
}
