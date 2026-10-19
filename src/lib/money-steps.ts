/**
 * The money side of a job in five steps: JOB DONE, PROFORMA SENT, PAYMENT, TAX INVOICE, RELEASED. One rule for the
 * job card, the invoice page, the accounts dashboard and the invoices list, so every screen says the same thing.
 * Pure: no database, usable in client components.
 */

export type MoneyStepKey = "job_done" | "proforma_sent" | "payment" | "tax_invoice" | "released";

export const MONEY_STEPS: { key: MoneyStepKey; label: string }[] = [
  { key: "job_done", label: "Job done" },
  { key: "proforma_sent", label: "Proforma sent" },
  { key: "payment", label: "Payment" },
  { key: "tax_invoice", label: "Tax invoice" },
  { key: "released", label: "Released" },
];

export const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: "Cash", card: "Card", link: "Payment link", cheque: "Cheque", transfer: "Bank transfer" };

/** The five ways a customer pays, in the order the one-tap row shows them. */
export const PAYMENT_METHODS = ["cash", "card", "link", "cheque", "transfer"] as const;

/** The compulsory "how will the customer pay?" question before a proforma goes out: these four, this order. */
export const EXPECTED_METHODS = ["card", "link", "transfer", "cash"] as const;
export const EXPECTED_METHOD_LABELS: Record<string, string> = { card: "Card in the shop", link: "Payment link", transfer: "Bank transfer", cash: "Cash" };
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Who may record payments: ACCOUNTS and the OWNER only. Advisors never record, edit or delete a payment. */
export function methodsFor(role: string): PaymentMethod[] {
  if (role === "owner" || role === "accounts") return [...PAYMENT_METHODS];
  return [];
}

export type MoneyInvoice = {
  id: string;
  number: string;
  kind: "proforma" | "tax_invoice" | "credit_note";
  issued_at: string;
  sent_at: string | null;
  converted_to: string | null;
  expected_payment_method?: string | null;
  customer_says_paid_at?: string | null;
  pay_now_enabled?: boolean;
  token: string | null;
};

export type MoneyInput = {
  jobStatus: string;
  isOpen: boolean;
  gatedOutAt: string | null;
  /** The live proforma (not converted) and the live tax invoice, if any. */
  proforma: MoneyInvoice | null;
  taxInvoice: MoneyInvoice | null;
  /** The balance on the live invoice. */
  total: number;
  paid: number;
  balance: number;
  chequePending: number;
  /** An approved quotation or a fee exists, so a proforma is due. */
  needsInvoice: boolean;
  creditDays?: number;
  declinedOut?: boolean;
  now?: number;
  /** Hours a sent proforma may wait before the wait counts as long (default 24). */
  waitingHours?: number;
};

export type MoneyAction = "prepare_proforma" | "send_proforma" | "record_payment" | "send_tax_invoice" | "gate_out" | "none";

export type MoneyState = {
  current: MoneyStepKey;
  done: MoneyStepKey[];
  /** The one chip that says where the money stands. */
  chip: { text: string; tone: "green" | "amber" | "red" | "neutral" | "ink" };
  /** The one thing to do next, and who does it. */
  action: MoneyAction;
  actionLabel: string;
  /** Hours the proforma has waited unpaid since it was sent, when that wait is long. */
  waitingHours: number | null;
  /** The invoice the customer deals with right now. */
  live: MoneyInvoice | null;
};

const stepsBefore = (key: MoneyStepKey): MoneyStepKey[] => MONEY_STEPS.slice(0, MONEY_STEPS.findIndex((s) => s.key === key)).map((s) => s.key);

const money = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;

export function moneyState(i: MoneyInput): MoneyState {
  const now = i.now ?? Date.now();
  const limitHours = i.waitingHours ?? 24;
  const live = i.taxInvoice ?? i.proforma ?? null;
  const paidInFull = !!live && i.balance <= 0.005;
  const onCredit = !!i.creditDays && i.creditDays > 0 && !!live && i.balance > 0.005;

  // Released: the car has gone out (or the job is closed).
  if (!i.isOpen || i.gatedOutAt || i.jobStatus === "closed") {
    return { current: "released", done: [...MONEY_STEPS.map((s) => s.key)], chip: { text: onCredit ? `Released on credit · ${money(i.balance)} due` : "Released", tone: onCredit ? "amber" : "green" }, action: "none", actionLabel: "", waitingHours: null, live };
  }
  // A tax invoice exists.
  if (i.taxInvoice) {
    if (!paidInFull && !onCredit) {
      const waiting = i.taxInvoice.sent_at ? Math.floor((now - Date.parse(i.taxInvoice.sent_at)) / 3600000) : null;
      return { current: "payment", done: ["job_done", "proforma_sent"], chip: i.paid > 0 ? { text: `Part paid · ${money(i.balance)} due`, tone: "amber" } : i.chequePending > 0 ? { text: "Cheque pending", tone: "amber" } : { text: `Tax invoice issued, ${money(i.balance)} due`, tone: "amber" }, action: "record_payment", actionLabel: "Record payment", waitingHours: waiting !== null && waiting >= limitHours ? waiting : null, live };
    }
    if (!i.taxInvoice.sent_at) return { current: "tax_invoice", done: ["job_done", "proforma_sent", "payment"], chip: { text: onCredit ? `On credit · ${money(i.balance)} due` : "Paid · tax invoice to send", tone: onCredit ? "amber" : "green" }, action: "send_tax_invoice", actionLabel: "Send the tax invoice", waitingHours: null, live };
    return { current: "released", done: ["job_done", "proforma_sent", "payment", "tax_invoice"], chip: { text: onCredit ? `On credit · ${money(i.balance)} due` : "Paid · ready for gate-out", tone: "green" }, action: "gate_out", actionLabel: "Gate out", waitingHours: null, live };
  }
  // A proforma exists.
  if (i.proforma) {
    if (!i.proforma.sent_at) return { current: "proforma_sent", done: ["job_done"], chip: { text: "Proforma ready to send", tone: "ink" }, action: "send_proforma", actionLabel: "Send the proforma", waitingHours: null, live };
    const waited = Math.floor((now - Date.parse(i.proforma.sent_at)) / 3600000);
    const long = waited >= limitHours;
    if (i.proforma.customer_says_paid_at) return { current: "payment", done: ["job_done", "proforma_sent"], chip: { text: "Customer says paid, checking", tone: "amber" }, action: "record_payment", actionLabel: "Confirm the payment", waitingHours: long ? waited : null, live };
    if (i.paid > 0) return { current: "payment", done: ["job_done", "proforma_sent"], chip: { text: `Part paid · ${money(i.balance)} due`, tone: "amber" }, action: "record_payment", actionLabel: "Record payment", waitingHours: long ? waited : null, live };
    if (i.chequePending > 0) return { current: "payment", done: ["job_done", "proforma_sent"], chip: { text: "Cheque pending clearance", tone: "amber" }, action: "record_payment", actionLabel: "Record payment", waitingHours: long ? waited : null, live };
    if (onCredit) return { current: "released", done: ["job_done", "proforma_sent"], chip: { text: `Credit terms · ${money(i.balance)} due in ${i.creditDays} days`, tone: "amber" }, action: "gate_out", actionLabel: "Gate out", waitingHours: null, live };
    const expected = i.proforma.expected_payment_method ? ` · ${PAYMENT_METHOD_LABELS[i.proforma.expected_payment_method] ?? i.proforma.expected_payment_method}` : "";
    return { current: "payment", done: ["job_done", "proforma_sent"], chip: { text: `Awaiting payment${expected}`, tone: long ? "red" : "amber" }, action: "record_payment", actionLabel: "Record payment", waitingHours: long ? waited : null, live };
  }
  // No invoice yet.
  if (i.declinedOut) return { current: "released", done: ["job_done", "proforma_sent", "payment", "tax_invoice"], chip: { text: "Declined, leaves free", tone: "neutral" }, action: "gate_out", actionLabel: "Gate out", waitingHours: null, live: null };
  const ready = ["ready", "pending_payment", "in_delivery"].includes(i.jobStatus);
  if (ready && i.needsInvoice) return { current: "job_done", done: [], chip: { text: "Proforma to prepare", tone: "ink" }, action: "prepare_proforma", actionLabel: "Prepare the proforma", waitingHours: null, live: null };
  if (ready) return { current: "released", done: ["job_done", "proforma_sent", "payment", "tax_invoice"], chip: { text: "Nothing to pay", tone: "neutral" }, action: "gate_out", actionLabel: "Gate out", waitingHours: null, live: null };
  return { current: "job_done", done: [], chip: { text: "Work in progress", tone: "neutral" }, action: "none", actionLabel: "", waitingHours: null, live: null };
}

/** "Confirm full payment …" text for the final step: one wording everywhere. */
export function confirmFullText(opts: { amount: number; method: string; reference?: string | null; invoiceNumber: string; isProforma: boolean; nextTaxNumber: string | null }) {
  const m = PAYMENT_METHOD_LABELS[opts.method] ?? opts.method;
  const ref = opts.reference ? ` (ref ${opts.reference})` : "";
  const amount = `AED ${opts.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (opts.isProforma) {
    return `Confirm full payment: ${amount} received by ${m}${ref}. This completes the payment and creates tax invoice ${opts.nextTaxNumber ?? "INV-…"}. A tax invoice can't be cancelled or deleted. Corrections are only possible by credit note, approved by the owner.`;
  }
  return `Confirm full payment: ${amount} received by ${m}${ref}. This settles tax invoice ${opts.invoiceNumber}.`;
}

export { stepsBefore };
