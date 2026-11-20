/**
 * HOW A PURCHASE RETURN ENDS (20 November 2026, Section 1; LPO-00103-1, AL TAYER MOTORS, BLEEDING SCREW LR055301:
 * received against WIP 58399, wrong size, returned, never with the technician, no invoice, nothing paid - yet the line
 * said "Returned – credit note in" and the LPO kept "Invoice missing"). Pure and import-free: the screen, the server
 * and the unit tests read the same rules.
 *
 *   credit_note     the supplier's credit note: ONLY when a supplier invoice exists for the part (there is something
 *                   to credit). Accounts (or the owner) enter it.
 *   refund          money back from the supplier (it was paid). Accounts (or the owner).
 *   advance         no invoice, already paid: the money stays with the supplier as an advance, used later through
 *                   "Use the supplier's advance". The parts desk asks; accounts confirm the amount.
 *   before_invoice  no invoice, nothing paid: "RETURNED BEFORE INVOICING". Nothing is owed either way. The parts desk.
 *   exchange        a replacement on the same LPO ("replaces returned <part>"). The parts desk.
 *
 * Nothing is pre-selected: the ending the facts point to is SUGGESTED in words, the person picks.
 */

export type ReturnEndingKey = "credit_note" | "refund" | "advance" | "before_invoice" | "exchange";
export const RETURN_ENDING_KEYS: ReturnEndingKey[] = ["credit_note", "refund", "advance", "before_invoice", "exchange"];

export const RETURN_ENDING_LABEL: Record<ReturnEndingKey, string> = {
  credit_note: "Supplier's credit note",
  refund: "Refund from the supplier",
  advance: "Paid, no invoice: stays with the supplier as an advance",
  before_invoice: "RETURNED BEFORE INVOICING",
  exchange: "Exchanged – replacement on the same LPO",
};

/** On the LPO line and the part's row: what happened in the end. */
export const RETURN_LINE_WORDS: Record<ReturnEndingKey, string> = {
  credit_note: "Returned – credit note in",
  refund: "Returned – refunded by the supplier",
  advance: "Returned – kept as an advance with the supplier",
  before_invoice: "RETURNED BEFORE INVOICING – nothing to pay",
  exchange: "Returned – exchanged on the same LPO",
};

export type ReturnFacts = {
  /** A supplier invoice is entered for the part's LPO (or a further invoice on it). */
  invoiced: boolean;
  /** What was paid to the supplier on the part's LPO (incl. VAT), 0 = nothing. */
  paid: number;
  /** The part's value going back, incl. VAT. */
  value: number;
  /** The part is with the technician: he hands it back first. */
  withTech: boolean;
  /** A replacement line on the same LPO already covers it. */
  hasReplacement: boolean;
  /** A credit note is already recorded for it (number or scan). */
  creditIn: boolean;
};

export type ReturnRole = "owner" | "accounts" | "parts" | string;

export type ReturnEndingOption = { key: ReturnEndingKey; label: string; help: string; allowed: boolean; why: string | null; /** Who may complete it. */ who: string };

export type ReturnEndingChoices = {
  options: ReturnEndingOption[];
  /** The ending the facts point to (shown as words, never pre-ticked). */
  suggested: ReturnEndingKey | null;
  suggestedWords: string | null;
  /** Nothing can be chosen yet, and why. */
  refusal: string | null;
};

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ACCOUNTS = ["owner", "accounts"];
const DESK = ["owner", "accounts", "parts"];
const whoWords = (roles: string[]) => (roles.includes("parts") ? "Parts desk, accounts or the owner" : "Accounts or the owner");

/** The roles that may complete an ending. The advance is ASKED by the desk; only accounts confirm its amount. */
export const ENDING_ROLES: Record<ReturnEndingKey, string[]> = {
  credit_note: ACCOUNTS,
  refund: ACCOUNTS,
  advance: DESK,
  before_invoice: DESK,
  exchange: DESK,
};

/** The endings for a returned part, from the facts, greyed with their reason. */
export function returnEndingsFor(f: ReturnFacts, role: ReturnRole): ReturnEndingChoices {
  if (f.withTech) return { options: [], suggested: null, suggestedWords: null, refusal: "The part is with the technician: he hands it back to Parts first (Parts → Returns and leftovers), then choose how the return ends." };
  const paid = f.paid > 0.004;
  const roleOk = (k: ReturnEndingKey) => ENDING_ROLES[k].includes(role);
  const notYours = (k: ReturnEndingKey) => (roleOk(k) ? null : `${whoWords(ENDING_ROLES[k])} complete this ending.`);
  const options: ReturnEndingOption[] = [
    {
      key: "credit_note",
      label: RETURN_ENDING_LABEL.credit_note,
      help: "The supplier sends a credit note against their invoice: it comes off what we owe them.",
      allowed: f.invoiced && !notYours("credit_note"),
      why: !f.invoiced ? "There is no supplier invoice for this part, so there is nothing to credit." : notYours("credit_note"),
      who: whoWords(ENDING_ROLES.credit_note),
    },
    {
      key: "refund",
      label: RETURN_ENDING_LABEL.refund,
      help: "The supplier gives the money back (cash, transfer, card or cheque).",
      allowed: paid && !notYours("refund"),
      why: !paid ? "Nothing was paid to the supplier for it, so there is nothing to refund." : notYours("refund"),
      who: whoWords(ENDING_ROLES.refund),
    },
    {
      key: "advance",
      label: RETURN_ENDING_LABEL.advance,
      help: `The supplier keeps ${aed(Math.min(f.value, f.paid))} as an advance, used on their next invoice. Accounts confirm the amount.`,
      allowed: paid && !f.invoiced && !notYours("advance"),
      why: f.invoiced ? "There is a supplier invoice: use the credit note." : !paid ? "Nothing was paid: nothing stays with the supplier." : notYours("advance"),
      who: "Parts desk asks, accounts confirm",
    },
    {
      key: "before_invoice",
      label: RETURN_ENDING_LABEL.before_invoice,
      help: "It went back before the supplier invoiced it and nothing was paid: nothing is owed either way, and no invoice is waited for.",
      allowed: !f.invoiced && !paid && !notYours("before_invoice"),
      why: f.invoiced ? "There is a supplier invoice for it: the supplier must credit it." : paid ? "It was paid: it is a refund or an advance." : notYours("before_invoice"),
      who: whoWords(ENDING_ROLES.before_invoice),
    },
    {
      key: "exchange",
      label: RETURN_ENDING_LABEL.exchange,
      help: f.hasReplacement ? "The replacement line on the same LPO takes its place: the supplier invoices the replacement." : "A replacement line is added to the same LPO (\"replaces returned …\"): the supplier invoices the replacement.",
      allowed: !notYours("exchange"),
      why: notYours("exchange"),
      who: whoWords(ENDING_ROLES.exchange),
    },
  ];
  const suggested: ReturnEndingKey = f.hasReplacement ? "exchange" : f.invoiced ? "credit_note" : paid ? "advance" : "before_invoice";
  const suggestedWords = f.hasReplacement
    ? "A replacement is on the same LPO: exchange."
    : f.invoiced
      ? "A supplier invoice exists: the supplier's credit note."
      : paid
        ? `No invoice, but ${aed(f.paid)} was paid: it stays with the supplier as an advance (or the supplier refunds it).`
        : "No invoice and nothing paid: RETURNED BEFORE INVOICING.";
  return { options, suggested, suggestedWords, refusal: null };
}

/** The server's check of a choice (the same rule the window greys with): null when allowed. */
export function returnEndingRefusal(f: ReturnFacts, role: ReturnRole, key: string): string | null {
  const c = returnEndingsFor(f, role);
  if (c.refusal) return c.refusal;
  const o = c.options.find((x) => x.key === key);
  if (!o) return "Pick how the return ended.";
  return o.allowed ? null : (o.why ?? "This ending does not fit this return.");
}

/** Endings after which the supplier will never invoice the part (no "Invoice missing" for it, no supplier credit). */
export const NO_INVOICE_ENDINGS: ReturnEndingKey[] = ["before_invoice", "advance"];
/** Endings that never become a supplier credit in Zoho. */
export const NO_CREDIT_ENDINGS: ReturnEndingKey[] = ["before_invoice", "advance", "exchange"];

export type PoPartFacts = { id: string; isActive: boolean; disposition: string | null; returnEnding: string | null; removed: boolean };

/**
 * Does the LPO still wait for a supplier invoice? Not when every part on it went back before invoicing (or was
 * cancelled, never delivered). A part still here, or returned for a credit, still needs its invoice.
 */
export function invoiceStillExpected(parts: PoPartFacts[]): boolean {
  if (!parts.length) return true;
  return parts.some((p) => {
    if (p.returnEnding && (NO_INVOICE_ENDINGS as string[]).includes(p.returnEnding)) return false;
    if (p.disposition === "cancelled") return false;
    if (!p.isActive && p.removed && !p.disposition) return false;
    return true;
  });
}

/** The words for the LPO when no invoice will ever come. */
export const NOT_EXPECTED_WORDS = "No invoice expected – returned before invoicing";

/** A supplier invoice typed later that names a part which went back before invoicing: the warning. */
export function returnedOnInvoiceWarning(names: string[]): string | null {
  if (!names.length) return null;
  return `${names.map((n) => n.toUpperCase()).join(", ")} went back to the supplier before invoicing. Check this invoice does not charge ${names.length === 1 ? "it" : "them"}: if it does, ask the supplier for a corrected invoice or a credit note.`;
}

export type EndingHistoryEntry = { at: string; by: string; from: string | null; to: string; reason: string; voided?: { creditNote: string | null; amount: number | null; note: string | null } };

/** One line of the correction history: "20 Nov · Mathew: Supplier's credit note → RETURNED BEFORE INVOICING (credit note WIP - 58399 voided, kept): <reason>". */
export function historyWords(h: EndingHistoryEntry, when: (iso: string) => string): string {
  const label = (k: string | null) => (k && k in RETURN_ENDING_LABEL ? RETURN_ENDING_LABEL[k as ReturnEndingKey] : k ? k : "no ending");
  const voided = h.voided && (h.voided.creditNote || h.voided.amount) ? ` (credit note ${h.voided.creditNote ?? ""}${h.voided.amount ? ` ${aed(h.voided.amount)}` : ""} voided, kept)` : "";
  return `${when(h.at)} · ${h.by}: ${label(h.from)} → ${label(h.to)}${voided}: ${h.reason}`;
}

/** What a stored part without the new column says it ended as (the old storage: "returned" with a credit note typed). */
export function legacyEndingOf(p: { disposition: string | null; return_ending?: string | null; credit_note_number?: string | null; credit_note_path?: string | null; disposition_note?: string | null }): ReturnEndingKey | null {
  if (p.return_ending && (RETURN_ENDING_KEYS as string[]).includes(p.return_ending)) return p.return_ending as ReturnEndingKey;
  if (p.disposition !== "returned") return null;
  if (/^refund/i.test(String(p.disposition_note ?? ""))) return "refund";
  if (/^replaced by the supplier/i.test(String(p.disposition_note ?? ""))) return "exchange";
  return "credit_note";
}
