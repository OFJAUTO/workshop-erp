/**
 * The lock on a quotation after the customer's approval. Pure rules, shared by the screens, the server guards and the
 * tests; the database holds the same rule in a trigger (migration 20261103090000).
 *
 * Approved by the customer: nothing on it changes any more, for anyone. The only way to change the work is a new
 * version: the owner makes one, an advisor only after the owner allowed it ("Ask owner to revise").
 * A proforma issued for the job: only the owner makes the new version.
 * A tax invoice issued: nobody revises; a difference is settled with a credit note on the invoice page.
 * A version replaced by a newer one is kept for the record and never changes either.
 */

export type LockInvoice = { kind: string; status: string; number: string; deposit_for_quotation_id?: string | null; converted_to?: string | null; is_active?: boolean | null };

export type QuoteLockReason = "approved" | "superseded" | "proforma" | "tax_invoice";

export type QuoteLock = {
  locked: boolean;
  reason: QuoteLockReason | null;
  /** When the customer approved (ISO), when known. */
  since: string | null;
  /** The proforma or tax invoice that tightens the lock. */
  invoiceNumber: string | null;
  /** Who may start a new version: the owner or an advisor the owner allowed; the owner only; nobody (credit note). */
  reviseBy: "owner_or_allowed" | "owner" | "nobody" | null;
  /** The sentence on the quotation page. */
  banner: string | null;
  /** The sentence given to a refused change (and written in the quotation's history). */
  refusal: string | null;
};

const OPEN: QuoteLock = { locked: false, reason: null, since: null, invoiceNumber: null, reviseBy: null, banner: null, refusal: null };

/** "16 Oct" in Dubai time. */
export function lockDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
}

/** The live documents of the job that matter to the lock: a tax invoice beats a proforma; deposit documents, cancelled, converted and credit notes do not count. */
export function liveInvoicesOf(invoices: LockInvoice[] | null | undefined): { tax: LockInvoice | null; proforma: LockInvoice | null } {
  const live = (invoices ?? []).filter((i) => i.is_active !== false && i.status === "issued" && !i.deposit_for_quotation_id && !i.converted_to);
  return { tax: live.find((i) => i.kind === "tax_invoice") ?? null, proforma: live.find((i) => i.kind === "proforma") ?? null };
}

export function quoteLockOf(
  q: { status: string; kind?: string | null; responded_at?: string | null },
  invoices: LockInvoice[] | null | undefined = [],
  viewer: { isOwner: boolean } = { isOwner: false },
): QuoteLock {
  if (q.status === "superseded") {
    return { locked: true, reason: "superseded", since: q.responded_at ?? null, invoiceNumber: null, reviseBy: "nobody", banner: "Replaced by a newer version. Locked, kept for the record.", refusal: "This version was replaced by a newer one and is kept for the record. It cannot be changed." };
  }
  if (q.status !== "approved") return OPEN;
  const who = q.kind === "estimate" ? "Accepted" : "Approved";
  const when = lockDate(q.responded_at);
  const head = `${who} by the customer${when ? ` on ${when}` : ""}. Locked.`;
  const { tax, proforma } = liveInvoicesOf(invoices);
  if (tax) {
    return { locked: true, reason: "tax_invoice", since: q.responded_at ?? null, invoiceNumber: tax.number, reviseBy: "nobody", banner: `${head} Tax invoice ${tax.number} issued: changes only by credit note.`, refusal: `This quotation is locked: ${who.toLowerCase()} by the customer${when ? ` on ${when}` : ""} and tax invoice ${tax.number} has been issued. Changes go through a credit note on the invoice page.` };
  }
  if (proforma) {
    return { locked: true, reason: "proforma", since: q.responded_at ?? null, invoiceNumber: proforma.number, reviseBy: "owner", banner: `${head} Proforma ${proforma.number} issued: only the owner can revise.`, refusal: `This quotation is locked: ${who.toLowerCase()} by the customer${when ? ` on ${when}` : ""} and proforma ${proforma.number} has been issued. Only the owner can revise it.` };
  }
  return {
    locked: true,
    reason: "approved",
    since: q.responded_at ?? null,
    invoiceNumber: null,
    reviseBy: "owner_or_allowed",
    banner: `${head} ${viewer.isOwner ? "Revise to change it: a new version goes to the customer." : "Ask the owner to revise."}`,
    refusal: `This quotation is locked: ${who.toLowerCase()} by the customer${when ? ` on ${when}` : ""}. Ask the owner to revise.`,
  };
}
