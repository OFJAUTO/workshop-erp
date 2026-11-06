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

const TITLES: Record<string, string> = { dr: "Dr", mr: "Mr", mrs: "Mrs", ms: "Ms", miss: "Miss", eng: "Eng", engr: "Eng", prof: "Prof", capt: "Capt", sheikh: "Sheikh", shaikh: "Sheikh", sh: "Sheikh", "h.e": "H.E.", he: "H.E.", sir: "Sir" };
const SURNAME_PARTICLES = new Set(["al", "el", "van", "von", "de", "da", "di"]);

/** A person's name in normal case for a message: "DHIA YAHYA" → "Dhia Yahya" (a mixed word like "McLaren" is kept). */
export function personNameCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (/\p{Ll}/u.test(w) ? w : w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, b: string, l: string) => `${b}${l.toUpperCase()}`)))
    .join(" ");
}

/**
 * How a message addresses a person when nobody saved a way (6 November 2026, Section 7): the title and the surname in
 * normal case ("DR DHIA YAHYA DHIA AL DIN JAFFAR" → "Dr Jaffar", "Ahmed Al Mansouri" with "Mr" → "Mr Al Mansouri");
 * without a title, the first name ("Dhia") - a title is never guessed. Never the whole legal name in capitals.
 */
export function personAddressAs(fullName: string | null | undefined): string {
  const words = String(fullName ?? "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!words.length) return "";
  const key = words[0].toLowerCase().replace(/\.$/, "");
  const title = TITLES[key];
  const rest = title ? words.slice(1) : words;
  if (!rest.length) return title ?? personNameCase(words.join(" "));
  if (!title) return personNameCase(rest[0]);
  const last = rest[rest.length - 1];
  const before = rest.length >= 2 ? rest[rest.length - 2] : null;
  const surname = before && SURNAME_PARTICLES.has(before.toLowerCase()) ? `${before} ${last}` : last;
  return `${title} ${personNameCase(surname)}`;
}

/**
 * THE greeting of every customer message (6 November 2026, Section 7): the "How to address" saved on the customer
 * when there is one; a person by title and surname in normal case (`personAddressAs`); a company by its saved contact
 * person when there is one, else the company name without the legal ending ("Dear Al Noor General Trading,").
 */
export function greetingNameOf(customer: { full_name?: string | null; company_name?: string | null; address_as?: string | null } | null | undefined): string {
  const saved = String(customer?.address_as ?? "").trim();
  if (saved) return saved;
  const company = cleanCompanyName(customer?.company_name);
  const person = String(customer?.full_name ?? "").trim();
  if (company && person && !sameName(person, company)) return personAddressAs(person);
  if (company) return company.replace(LEGAL_ENDING, "").trim() || company;
  return personAddressAs(person) || "Customer";
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
