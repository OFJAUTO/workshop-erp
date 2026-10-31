/**
 * Tidy WhatsApp text: phone numbers with spaces, company names cleaned ("L.l.c" -> "LLC"), and greetings without
 * legal endings (a company with a saved contact person is greeted by the person). Pure; used wherever a message
 * to a customer or a driver is written.
 */

/** "+971529562232" -> "+971 52 956 2232"; "+97143303113" -> "+971 4 330 3113". Anything unclear comes back as typed. */
export function formatPhone(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const digits = s.replace(/[^\d]/g, "");
  const rest = digits.startsWith("971") ? digits.slice(3) : digits.startsWith("00971") ? digits.slice(5) : digits.startsWith("0") && digits.length === 10 ? digits.slice(1) : null;
  if (rest === null) return s;
  if (rest.length === 9 && rest.startsWith("5")) return `+971 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
  if (rest.length === 8) return `+971 ${rest.slice(0, 1)} ${rest.slice(1, 4)} ${rest.slice(4)}`;
  return `+971 ${rest}`;
}

const LEGAL_FIXES: [RegExp, string][] = [
  [/\bl\.?\s?l\.?\s?c\.?\b/gi, "LLC"],
  [/\bf\.?\s?z\.?\s?e\.?\b/gi, "FZE"],
  [/\bf\.?\s?z\.?\s?c\.?\s?o\.?\b/gi, "FZCO"],
  [/\bfz[\s-]?llc\b/gi, "FZ-LLC"],
  [/\bd\.?\s?m\.?\s?c\.?\s?c\.?\b/gi, "DMCC"],
];
const LEGAL_ENDING = /\s*(LLC|FZE|FZCO|FZ-LLC|DMCC|EST\.?|L\.L\.C\.?)\s*\.?$/i;

/** "Al Noor General Trading L.l.c" -> "Al Noor General Trading LLC". */
export function cleanCompanyName(name: string | null | undefined): string {
  let s = String(name ?? "").trim();
  for (const [re, to] of LEGAL_FIXES) s = s.replace(re, to);
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Who a message greets: a person by their name; a company by its saved contact person when there is one, else the
 * company name without the legal ending ("Dear Al Noor General Trading,").
 */
export function greetingNameOf(customer: { full_name?: string | null; company_name?: string | null } | null | undefined): string {
  const company = cleanCompanyName(customer?.company_name);
  const person = String(customer?.full_name ?? "").trim();
  if (company && person && !sameName(person, company)) return person;
  if (company) return company.replace(LEGAL_ENDING, "").trim() || company;
  return person || "Customer";
}

/** The customer's name for the body of a message (not the greeting): the company kept whole, only tidied. */
export function displayNameOf(customer: { full_name?: string | null; company_name?: string | null } | null | undefined): string {
  return cleanCompanyName(customer?.company_name) || String(customer?.full_name ?? "").trim() || "Customer";
}

/** One name written two ways ("AL NOOR TRADING LLC", "Al Noor Trading L.L.C.", "Al Noor Trading"): letters and digits only, the legal ending off. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (x: string | null | undefined) => cleanCompanyName(x).replace(LEGAL_ENDING, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const ka = key(a);
  return !!ka && ka === key(b);
}

/** The contact line under a company on a customer document: a real person's name only, never the company again (or nothing). */
export function contactNameOf(person: string | null | undefined, company: string | null | undefined): string | null {
  const p = String(person ?? "").trim();
  if (!p) return null;
  return company && sameName(p, company) ? null : p;
}
