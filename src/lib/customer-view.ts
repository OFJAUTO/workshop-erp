/**
 * How a job's customer reads on a car (29 October 2026, batch 2 section 1) - pure, shared by the car card, the job
 * card, search and the owner details panel. Only the owner, advisors and accounts ever receive these words
 * (`can(role, "viewCustomers")`); everyone else gets the car, its plate, VIN, make/model and job number only.
 */

export type JobCustomer = {
  customerId: string;
  number: string | null;
  name: string;
  isCompany: boolean;
  /** "contact: <name>" for a company with a contact person. */
  contact: string | null;
  /** "Dropped off by the customer's driver" and the like, when the customer did not drive it in. */
  arrived: string | null;
};

/** "LUXE SHORTLET HOLIDAY HOMES RENTAL LLC" for a company, the person's name otherwise. */
export function customerName(c: { full_name: string | null; company_name: string | null }): string {
  return (c.company_name?.trim() || c.full_name?.trim() || "Customer").trim();
}

/** The contact person shown after a company ("· contact: <name>"), never the company itself again. */
export function contactWords(company: string | null, contact: string | null): string | null {
  const name = contact?.trim();
  if (!company?.trim() || !name) return null;
  return name.toLowerCase() === company.trim().toLowerCase() ? null : `contact: ${name}`;
}

/** The gate-in records HOW the car arrived (no name is taken): a car not driven in by the customer gets its own line. */
export function arrivedWords(arrivedBy: string | null | undefined): string | null {
  switch (arrivedBy) {
    case "customer_driver":
      return "Dropped off by the customer's driver";
    case "our_recovery":
      return "Brought in by our recovery";
    case "outside_recovery":
      return "Brought in by an outside recovery";
    default:
      return null;
  }
}

/**
 * A note written for the office (history, notifications) made safe for a workshop screen: every known customer word
 * (names, contacts, the approver, addresses) becomes "the customer", and any phone number "(phone)".
 */
export function redactCustomer(text: string | null | undefined, secrets: (string | null | undefined)[]): string {
  let out = String(text ?? "");
  const words = [...new Set(secrets.map((s) => s?.trim()).filter((s): s is string => !!s && s.length >= 3))].sort((a, b) => b.length - a.length);
  for (const w of words) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the customer");
  return out.replace(/\+?\d[\d\s-]{7,}\d/g, "(phone)");
}

/** "Tech · Moayad" or "Tech · Moayad +1": the people on the car, never mixed into the customer line. */
export function staffTagWords(names: string[]): string | null {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!list.length) return null;
  return `Tech · ${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ""}`;
}
