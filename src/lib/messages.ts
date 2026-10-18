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

/** "Luxe Shortlet Holiday Homes Rental L.l.c" -> "Luxe Shortlet Holiday Homes Rental LLC". */
export function cleanCompanyName(name: string | null | undefined): string {
  let s = String(name ?? "").trim();
  for (const [re, to] of LEGAL_FIXES) s = s.replace(re, to);
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Who a message greets: a person by their name; a company by its saved contact person when there is one, else the
 * company name without the legal ending ("Dear Luxe Shortlet Holiday Homes,").
 */
export function greetingNameOf(customer: { full_name?: string | null; company_name?: string | null } | null | undefined): string {
  const company = cleanCompanyName(customer?.company_name);
  const person = String(customer?.full_name ?? "").trim();
  if (company && person && person.toLowerCase() !== company.toLowerCase()) return person;
  if (company) return company.replace(LEGAL_ENDING, "").trim() || company;
  return person || "Customer";
}

/** The customer's name for the body of a message (not the greeting): the company kept whole, only tidied. */
export function displayNameOf(customer: { full_name?: string | null; company_name?: string | null } | null | undefined): string {
  return cleanCompanyName(customer?.company_name) || String(customer?.full_name ?? "").trim() || "Customer";
}
