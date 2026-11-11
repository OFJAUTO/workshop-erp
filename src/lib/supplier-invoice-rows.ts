/**
 * The Supplier invoices tab (1 November 2026): one row per supplier invoice, built from the LPOs it was entered on
 * (purchase_orders carry the invoice number, date, amount and the scan). One invoice entered on several LPOs of the
 * same supplier (one per car) is ONE row split across them; an LPO received with the invoice "to follow" is a row of
 * its own waiting for it. Status, match and duplicate warnings are worked out here. Pure: no database.
 * The VAT is THE supplier VAT rule (5 November 2026): supplier-money.ts / supplierChargesVat.
 */
import { supplierMoney } from "./supplier-money";
import { supplierChargesVat } from "./supplier-rules";
import { invoiceDateWarning } from "./supplier-payment-rules";

export type SiPo = {
  id: string;
  /** A FURTHER supplier invoice on this LPO (10 November 2026, Section 3): the row is that invoice; null = the LPO's first. */
  invoice_id?: string | null;
  /** The LPO lines this invoice covers (null = all of them). */
  line_ids?: string[] | null;
  /** What the recorded supplier payments put on this LPO (6 November 2026); a part payment shows as part paid. */
  paid_aed?: number;
  number: string;
  job_id: string | null;
  supplier_id: string | null;
  supplier_name: string;
  status: string;
  total_cost_aed: number;
  supplier_invoice_status: string;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  supplier_invoice_amount: number | null;
  /** The invoice's own VAT (supplier invoice edit, 5 November 2026): suppliers round differently. Empty = 5% of the amount. */
  supplier_invoice_vat_aed?: number | null;
  supplier_invoice_at: string | null;
  received_at: string | null;
  /** The LPO's own date (approved, else made): the invoice date is checked against it (11 November 2026). */
  lpo_date?: string | null;
  checked_at: string | null;
  zoho_bill_id: string | null;
  paid_at: string | null;
  /** How and with what reference the supplier was paid (Parts accounts > Payments to suppliers). */
  paid_method?: string | null;
  paid_reference?: string | null;
  /** Fix 4 (4 November 2026): the proof of payment (bank slip, card slip) and who paid, per LPO. */
  proof_path?: string | null;
  paid_by?: string | null;
  query?: string | null;
  query_at?: string | null;
};
export type SiLine = { id?: string; po_id: string; description: string; quantity: number; received_qty: number; unit_cost: number; invoice_unit_cost: number | null; invoice_check: string | null };
export type SiJob = { id: string; job_number: string; plate: string; car: string };
export type SiSupplier = { id: string; name: string; trn: string | null; vat_registered: boolean | null };

export type InvoiceStatus = "waiting" | "queried" | "new" | "checked" | "zoho" | "paid";
export type InvoiceMatch = "matches" | "price_changed" | "quantity_different" | "not_linked";

export const STATUS_WORDS: Record<InvoiceStatus, string> = {
  waiting: "Waiting for invoice",
  queried: "Queried with Parts",
  new: "New",
  checked: "Checked by accounts",
  zoho: "Sent to Zoho (bill)",
  paid: "Paid to supplier",
};
export const MATCH_WORDS: Record<InvoiceMatch, string> = {
  matches: "Matches LPO ✓",
  price_changed: "Price changed",
  quantity_different: "Quantity different",
  not_linked: "Not linked to an LPO",
};

/**
 * One LPO's part of a supplier invoice. Payment is recorded LPO by LPO ("Paid to supplier" on each LPO page), so each
 * share carries its own paid stamp: a split invoice can be partly paid.
 */
export type InvoiceShare = { /** The further invoice this share is (null = the LPO's first invoice). */ invoiceId: string | null; poId: string; poNumber: string; jobId: string | null; jobNumber: string | null; plate: string; car: string; amount: number; /** This share's VAT (the LPO's typed VAT when one was entered, else 5% of the amount) and the share with it. */ vat: number; withVat: number; lpoTotal: number; parts: number; paidAt: string | null; /** Fix 4 (4 November 2026): the payment's own facts, so the proof box reads per LPO. */ paidMethod: string | null; paidReference: string | null; proofPath: string | null; paidBy: string | null };
export type InvoiceRow = {
  key: string;
  /** 11 November 2026: ordered from the supplier, nothing delivered yet ("Not received yet"). */
  notReceived: boolean;
  /** Every LPO of the row is a stock purchase with no car. */
  stock: boolean;
  /** 11 November 2026 (Section 3): the invoice date looks wrong (future, or long before the LPO: day and month swapped?). */
  dateWarning: string | null;
  /** The earliest LPO date of the row. */
  lpoDate: string | null;
  supplier: string;
  supplierId: string | null;
  trn: string | null;
  vatRegistered: boolean;
  /** THE supplier VAT rule (5 November 2026): VAT counted on this invoice (registered with a TRN, or the invoice's own typed VAT). */
  vatCharged: boolean;
  number: string | null;
  date: string | null;
  beforeVat: number;
  vat: number;
  total: number;
  shares: InvoiceShare[];
  parts: number;
  match: InvoiceMatch[];
  status: InvoiceStatus;
  /** "Possible duplicate of …": the same invoice typed twice, or the same amount and date under another number. */
  duplicateOf: string | null;
  /** Every LPO of the invoice paid to the supplier. */
  paid: boolean;
  /** Some LPOs of a split invoice paid, others not yet. */
  partlyPaid: boolean;
  /** With VAT: what was paid (the paid shares) and what is still to pay (the rest). They add up to `total`. */
  paidAmount: number;
  unpaidAmount: number;
  /** When, how and with what reference it was paid (the first LPO of the invoice marked paid). */
  paidAt: string | null;
  paidMethod: string | null;
  paidReference: string | null;
  /** Fix 4 (4 November 2026): paid, but a share has no proof of payment on file. */
  proofMissing: boolean;
  /** When it arrived (the invoice entered, else the parts received). */
  at: string | null;
  query: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The invoice number as a key: no spaces, dashes or case ("INV-4512" = "inv 4512"). */
export const invoiceKeyNumber = (n: string | null | undefined) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * "Approved 12,228.30 → Invoiced 11,684.82 (−543.48)": the LPO's approved before-VAT total next to the invoice's own
 * figure (supplier invoice edit, 5 November 2026). Null when they agree to the fils or either figure is missing.
 */
export function approvedVsInvoiced(lpoTotal: number, invoiced: number | null | undefined): string | null {
  if (invoiced === null || invoiced === undefined || !(lpoTotal > 0) || !(invoiced > 0)) return null;
  const diff = r2(invoiced - lpoTotal);
  if (Math.abs(diff) <= 0.005) return null;
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Approved ${fmt(lpoTotal)} → Invoiced ${fmt(invoiced)} (${diff < 0 ? "−" : "+"}${fmt(Math.abs(diff))})`;
}


/** THE "ordered, not delivered yet" rule of the invoice list: sent to the supplier, no invoice, nothing received. */
export const isOrderedNotReceived = (po: { status: string; supplier_invoice_status: string | null; received_at?: string | null }) =>
  po.status === "ordered" && (po.supplier_invoice_status ?? "none") === "none" && !po.received_at;

/** The rows, newest first. */
export function groupInvoices(pos: SiPo[], lines: SiLine[], jobs: SiJob[], suppliers: SiSupplier[], vatPercent = 5, today: string | null = null): InvoiceRow[] {
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const supOf = new Map(suppliers.map((s) => [s.id, s]));
  const supByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]));
  const groups = new Map<string, SiPo[]>();
  for (const po of pos) {
    if (po.status === "cancelled" || po.status === "pending_approval") continue;
    const inv = po.supplier_invoice_status;
    // 11 November 2026 (Section 1): an LPO ordered from the supplier but not delivered yet is listed too ("Not received
    // yet"), car or stock alike, so accounts can enter the invoice that arrives with the delivery.
    const ordered = isOrderedNotReceived(po);
    if (inv !== "received" && inv !== "to_follow" && !ordered) continue;
    const supKey = po.supplier_id ?? po.supplier_name.trim().toLowerCase();
    const key = inv !== "received" || !invoiceKeyNumber(po.supplier_invoice_number) ? `follow:${po.id}${po.invoice_id ? `:${po.invoice_id}` : ""}` : `${supKey}|${invoiceKeyNumber(po.supplier_invoice_number)}`;
    groups.set(key, [...(groups.get(key) ?? []), po]);
  }
  const rows: InvoiceRow[] = [];
  for (const [key, items] of groups) {
    const first = items[0];
    const sup = (first.supplier_id ? supOf.get(first.supplier_id) : null) ?? supByName.get(first.supplier_name.trim().toLowerCase()) ?? null;
    const vatRegistered = sup?.vat_registered !== false;
    // THE supplier VAT rule (5 November 2026, Mathew): VAT only from a supplier registered with a TRN (never Our stock),
    // 5% of the amount rounded half up; the entered invoice's own typed VAT always wins.
    const chargesVat = supplierChargesVat(sup ? { ...sup, name: first.supplier_name || sup.name } : { name: first.supplier_name, trn: null, vat_registered: null });
    const waiting = items.every((p) => p.supplier_invoice_status !== "received");
    const notReceived = waiting && items.every((p) => isOrderedNotReceived(p));
    const shares: InvoiceShare[] = items.map((p) => {
      const j = p.job_id ? jobOf.get(p.job_id) : null;
      const mine = lines.filter((l) => l.po_id === p.id && (!p.line_ids || (l.id !== undefined && p.line_ids.includes(l.id))));
      const amount = r2(waiting ? p.total_cost_aed : (p.supplier_invoice_amount ?? p.total_cost_aed));
      // The LPO's own typed VAT wins (supplier invoice edit, 5 November 2026); an unentered invoice has none yet.
      const typedVat = waiting ? null : (p.supplier_invoice_vat_aed ?? null);
      const vat = supplierMoney(amount, { chargesVat, typedVat, vatPercent }).vat;
      return { invoiceId: p.invoice_id ?? null, poId: p.id, poNumber: p.number, jobId: p.job_id, jobNumber: j?.job_number ?? null, plate: j?.plate ?? "", car: j?.car ?? "", amount, vat, withVat: r2(amount + vat), lpoTotal: p.total_cost_aed, parts: mine.length, paidAt: p.paid_at, paidMethod: p.paid_method ?? null, paidReference: p.paid_reference ?? null, proofPath: p.proof_path ?? null, paidBy: p.paid_by ?? null };
    });
    const beforeVat = r2(shares.reduce((a, s) => a + s.amount, 0));
    const vat = r2(shares.reduce((a, s) => a + s.vat, 0));
    const total = r2(beforeVat + vat);
    // Paid LPO by LPO: the paid shares with their VAT, the rest still to pay (all or nothing is exactly the total).
    const paidShares = shares.filter((s) => s.paidAt);
    // A recorded payment may cover part of an LPO (6 November 2026): what it put on each LPO counts, never more than it owes.
    const paidOf = (s: InvoiceShare) => (s.paidAt ? s.withVat : Math.min(r2(items.find((p) => p.id === s.poId && (p.invoice_id ?? null) === s.invoiceId)?.paid_aed ?? 0), s.withVat));
    const paidAmount = paidShares.length === shares.length ? total : r2(shares.reduce((a, s) => a + paidOf(s), 0));
    const mine = lines.filter((l) => items.some((p) => p.id === l.po_id && (!p.line_ids || (l.id !== undefined && p.line_ids.includes(l.id)))));
    const match: InvoiceMatch[] = [];
    if (!mine.length) match.push("not_linked");
    else {
      if (mine.some((l) => ["mismatch", "accepted", "disputed"].includes(l.invoice_check ?? "") || (l.invoice_unit_cost !== null && Math.abs(l.invoice_unit_cost - l.unit_cost) > 0.005))) match.push("price_changed");
      if (!notReceived && mine.some((l) => l.received_qty + 0.001 < l.quantity)) match.push("quantity_different");
      if (!match.length) match.push("matches");
    }
    const query = items.find((p) => p.query)?.query ?? null;
    const status: InvoiceStatus = waiting
      ? "waiting"
      : query
        ? "queried"
        : items.some((p) => !p.checked_at)
          ? "new"
          : items.every((p) => p.paid_at)
            ? "paid"
            : items.every((p) => p.zoho_bill_id)
              ? "zoho"
              : "checked";
    // The same invoice typed twice: two of its LPOs carry the same amount, and that amount is not their own LPO's share.
    let duplicateOf: string | null = null;
    if (items.length > 1) {
      for (let i = 0; i < shares.length && !duplicateOf; i++)
        for (let k = i + 1; k < shares.length; k++)
          if (Math.abs(shares[i].amount - shares[k].amount) < 0.005 && (Math.abs(shares[i].amount - shares[i].lpoTotal) > 0.5 || Math.abs(shares[k].amount - shares[k].lpoTotal) > 0.5)) {
            duplicateOf = `${shares[i].poNumber} (the same invoice entered on ${shares[k].poNumber} too)`;
            break;
          }
    }
    const paidPo = items.filter((p) => p.paid_at).sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)))[0] ?? null;
    rows.push({
      key,
      notReceived,
      stock: items.every((p) => !p.job_id),
      lpoDate: items.map((p) => p.lpo_date ?? null).filter((x): x is string => !!x).sort()[0] ?? null,
      dateWarning: !waiting && today ? invoiceDateWarning(first.supplier_invoice_date, items.map((p) => p.lpo_date ?? null).filter(Boolean).sort()[0] ?? null, today) : null,
      supplier: sup?.name ?? first.supplier_name,
      supplierId: first.supplier_id,
      trn: sup?.trn ?? null,
      vatRegistered,
      vatCharged: chargesVat || vat > 0.004,
      number: waiting ? null : first.supplier_invoice_number,
      date: waiting ? null : first.supplier_invoice_date,
      beforeVat,
      vat,
      total,
      shares,
      parts: mine.length,
      match,
      status,
      duplicateOf,
      paid: items.every((p) => !!p.paid_at),
      partlyPaid: paidAmount > 0.004 && paidAmount < total - 0.004,
      paidAmount,
      unpaidAmount: r2(total - paidAmount),
      paidAt: paidPo?.paid_at ?? null,
      paidMethod: paidPo?.paid_method ?? null,
      paidReference: paidPo?.paid_reference ?? null,
      // Fix 4 (4 November 2026): a payment without its proof is flagged everywhere the invoice shows.
      proofMissing: shares.some((s) => s.paidAt && !s.proofPath),
      at: items.map((p) => p.supplier_invoice_at ?? p.received_at).filter((x): x is string => !!x).sort().at(-1) ?? null,
      query,
    });
  }
  // Another number, same supplier, same date and the same amount: possibly the same paper twice.
  for (const a of rows) {
    if (a.duplicateOf || a.status === "waiting" || !a.date) continue;
    // The same amount as the other invoice, or as one car's share of it (one paper typed twice, once per LPO).
    const b = rows.find((x) => x !== a && x.status !== "waiting" && x.supplier === a.supplier && x.date === a.date && invoiceKeyNumber(x.number) !== invoiceKeyNumber(a.number) && (Math.abs(x.beforeVat - a.beforeVat) < 0.005 || (a.shares.length === 1 && x.shares.some((s) => Math.abs(s.amount - a.beforeVat) < 0.005))));
    if (b) a.duplicateOf = `${invWords(b.number)} (${b.supplier}, same date and amount)`;
  }
  return rows.sort((x, y) => String(y.at ?? "").localeCompare(String(x.at ?? "")));
}

export type InvoiceFilter = { supplier?: string; from?: string; to?: string; status?: string; unpaid?: boolean; problems?: boolean; /** Fix 4: paid without a proof of payment on file. */ noProof?: boolean; q?: string; job?: string };

/**
 * The Supplier invoices filters as they travel in an address: ONE list read by the screen (its filter form and open
 * links), its Excel export, and Parts accounts' "Export this tab" on the same screen, so the file always holds what the
 * screen shows (Unpaid, Match problems and the car included).
 */
export const SI_FILTER_KEYS = ["supplier", "from", "to", "status", "unpaid", "problems", "no_proof", "q", "job"] as const;
export type SiFilterKey = (typeof SI_FILTER_KEYS)[number];

/** The filters to keep in an address, in a fixed order, empty ones left out. */
export function invoiceFilterParams(sp: Partial<Record<SiFilterKey, string | null | undefined>>): [string, string][] {
  return SI_FILTER_KEYS.map((k): [string, string] => [k, String(sp[k] ?? "").trim()]).filter(([, v]) => v !== "");
}

/** The filter from an address (the screen's search params, or an export's query). */
export function invoiceFilterOf(get: (key: SiFilterKey) => string | null | undefined): InvoiceFilter {
  const v = (k: SiFilterKey) => String(get(k) ?? "").trim() || undefined;
  return { supplier: v("supplier"), from: v("from"), to: v("to"), status: v("status"), unpaid: v("unpaid") === "1", problems: v("problems") === "1", noProof: v("no_proof") === "1", q: v("q"), job: v("job") };
}

/** The filters of the tab: supplier, date range, status, unpaid, match problems, a job, and the search box. */
export function filterInvoices(rows: InvoiceRow[], f: InvoiceFilter, partNames: Map<string, string[]> = new Map()): InvoiceRow[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.supplier && r.supplierId !== f.supplier && r.supplier !== f.supplier) return false;
    const day = r.date ?? (r.at ? r.at.slice(0, 10) : "");
    if (f.from && day && day < f.from) return false;
    if (f.to && day && day > f.to) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.unpaid && r.paid) return false;
    if (f.problems && !(r.match.some((m) => m !== "matches") || r.duplicateOf)) return false;
    if (f.noProof && !r.proofMissing) return false;
    if (f.job && !r.shares.some((s) => s.jobId === f.job)) return false;
    if (needle) {
      const hay = [r.number ?? "", r.supplier, ...r.shares.flatMap((s) => [s.poNumber, s.jobNumber ?? "", s.plate, s.car, ...(partNames.get(s.poId) ?? [])])].join(" ").toLowerCase();
      if (!hay.includes(needle) && !invoiceKeyNumber(hay).includes(invoiceKeyNumber(needle))) return false;
    }
    return true;
  });
}

export type UnpaidSupplier = { supplier: string; supplierId: string | null; count: number; total: number; /** The same balance before VAT and its VAT (THE rule, 5 November 2026). */ net: number; vat: number; vatCharged: boolean; /** The oldest unpaid invoice date (or arrival day). */ oldest: string | null };

/** The LPOs of an invoice still to pay (each one is paid on its own LPO page). */
export const unpaidShares = (r: InvoiceRow): InvoiceShare[] => (r.status === "waiting" ? [] : r.shares.filter((s) => !s.paidAt));

/**
 * "Unpaid per supplier": the open total of each supplier (with VAT), biggest first. Keyed by the supplier's id (by the
 * name only for an LPO typed with no supplier on the list), so two suppliers of the same name never merge. A split
 * invoice paid on one LPO and not the other counts only what is still to pay. THE one figure of the Supplier invoices
 * tab, Parts accounts > Payments to suppliers and the suppliers list.
 */
export function unpaidBySupplier(rows: InvoiceRow[]): UnpaidSupplier[] {
  const m = new Map<string, UnpaidSupplier>();
  for (const r of rows) {
    if (r.status === "waiting" || r.unpaidAmount <= 0.005) continue;
    const k = r.supplierId ?? `name:${r.supplier.trim().toLowerCase()}`;
    const cur = m.get(k) ?? { supplier: r.supplier, supplierId: r.supplierId, count: 0, total: 0, net: 0, vat: 0, vatCharged: false, oldest: null };
    cur.count++;
    cur.total = r2(cur.total + r.unpaidAmount);
    const open = r.shares.filter((s) => !s.paidAt);
    cur.net = r2(cur.net + open.reduce((a, s) => a + s.amount, 0));
    cur.vat = r2(cur.vat + open.reduce((a, s) => a + s.vat, 0));
    cur.vatCharged = cur.vatCharged || r.vatCharged;
    const day = r.date ?? (r.at ? r.at.slice(0, 10) : null);
    if (day && (!cur.oldest || day < cur.oldest)) cur.oldest = day;
    m.set(k, cur);
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total);
}

/** "INV 4512": the number with INV in front, never twice ("INV-4512" stays as typed). */
export const invWords = (number: string | null | undefined) => (!number ? "Invoice missing" : /^inv/i.test(number.trim()) ? number.trim() : `INV ${number.trim()}`);

/** The words of the accounts' notification: "Supplier invoice · SPARE HUB · INV 4512 · AED 1,040.00 + VAT". */
export function invoiceNoticeTitle(supplier: string, number: string, beforeVat: number, vatRegistered = true): string {
  return `Supplier invoice · ${supplier.toUpperCase()} · ${invWords(number)} · AED ${beforeVat.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${vatRegistered ? " + VAT" : ""}`;
}
