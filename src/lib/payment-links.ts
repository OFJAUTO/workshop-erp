import "server-only";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { formatDateTime } from "./format";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment } from "./invoice-data";
import { createNgeniusOrder, ngeniusConfigured } from "./ngenius";
import { notifyStaff } from "./notifications";
import { createAdminClient } from "./supabase/admin";

/**
 * Payment links from the separate payment system. The advisor pastes one; the customer's "Pay now"
 * opens it once. The system itself never requests, previews, validates or unfurls the address: it is
 * stored as text, shown to staff as text, and handed to the customer's browser only when they confirm.
 */
export type PaymentLinkRow = {
  id: string;
  invoice_id: string;
  job_id: string | null;
  url: string;
  added_by: string | null;
  added_at: string;
  opened_at: string | null;
  replaced_at: string | null;
  /** "manual": pasted by staff, opens once. "ngenius": made by Network International for the balance, opens until paid. */
  provider: "manual" | "ngenius";
  order_reference: string | null;
  amount_aed: number | null;
  state: string | null;
  paid_at: string | null;
  payment_id: string | null;
};
const SELECT = "id, invoice_id, job_id, url, added_by, added_at, opened_at, replaced_at, provider, order_reference, amount_aed, state, paid_at, payment_id";

export async function paymentLinksOf(invoiceId: string): Promise<PaymentLinkRow[]> {
  const { data } = await createAdminClient().from("payment_links").select(SELECT).eq("invoice_id", invoiceId).eq("is_active", true).order("added_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...r, amount_aed: r.amount_aed === null || r.amount_aed === undefined ? null : Number(r.amount_aed) })) as PaymentLinkRow[];
}

/** The link in force: the latest one not replaced. */
export function currentPaymentLink(rows: PaymentLinkRow[]): PaymentLinkRow | null {
  return rows.find((r) => !r.replaced_at) ?? null;
}

/** A new link replaces the old one (kept as history) and makes Pay now live again. An empty address removes Pay now. */
export async function replacePaymentLink(invoiceId: string, url: string | null, staff: { id: string; display_name: string }): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invoices").select("id, job_id, number").eq("id", invoiceId).maybeSingle();
  if (!inv) return { error: "Invoice not found." };
  const now = new Date().toISOString();
  await admin.from("payment_links").update({ replaced_at: now, updated_by: staff.id }).eq("invoice_id", invoiceId).is("replaced_at", null);
  if (url) {
    const { error } = await admin.from("payment_links").insert({ job_id: inv.job_id, invoice_id: invoiceId, url, added_by: staff.id, created_by: staff.id, updated_by: staff.id });
    if (error) return { error: error.message };
  }
  await admin.from("invoices").update({ payment_link_url: url, updated_by: staff.id }).eq("id", invoiceId);
  if (inv.job_id) await admin.from("job_events").insert({ job_id: inv.job_id, event_type: "payment_link", note: url ? `Payment link added to ${inv.number} by ${staff.display_name}` : `Payment link removed from ${inv.number} by ${staff.display_name}`, created_by: staff.id });
  return {};
}

/** The balance on an invoice right now (cheques count once cleared). */
async function balanceOf(invoiceId: string): Promise<{ balance: number; number: string; jobId: string | null; token: string | null; customerId: string } | null> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invoices").select(INVOICE_SELECT).eq("id", invoiceId).maybeSingle();
  if (!inv) return null;
  const invoice = toInvoice(inv as Record<string, unknown>);
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoiceId).eq("is_active", true);
  const bal = invoiceBalance(invoice, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  return { balance: bal.balance, number: invoice.number, jobId: invoice.job_id, token: invoice.token, customerId: invoice.customer_id };
}

/**
 * Pay now by Network International: an order for the balance, kept while the balance is unchanged. When the balance
 * moved (a part payment came in), the old order is dropped and a new one made for what is left. Returns the live link
 * or the reason there is none.
 */
export async function ensureAutoPayLink(invoiceId: string, staff: { id: string | null; display_name: string } | null, siteUrl: string): Promise<{ link?: PaymentLinkRow; error?: string }> {
  if (!ngeniusConfigured()) return { error: "Pay now is not set up yet: the Network International keys are missing. Paste a payment link instead." };
  const admin = createAdminClient();
  const info = await balanceOf(invoiceId);
  if (!info) return { error: "Invoice not found." };
  if (info.balance <= 0.005) return { error: "This invoice is paid: nothing to pay." };
  const links = await paymentLinksOf(invoiceId);
  const cur = currentPaymentLink(links);
  if (cur && cur.provider === "ngenius" && !cur.paid_at && cur.amount_aed !== null && Math.abs(cur.amount_aed - info.balance) < 0.005) return { link: cur };
  const now = new Date().toISOString();
  let order: { reference: string; paymentUrl: string };
  try {
    const { data: cust } = await admin.from("customers").select("email").eq("id", info.customerId).maybeSingle();
    order = await createNgeniusOrder({
      amountAed: info.balance,
      merchantReference: info.number,
      email: cust?.email ?? null,
      siteUrl,
      redirectUrl: `${siteUrl}/api/pay/ngenius/return?t=${encodeURIComponent(info.token ?? "")}`,
      cancelUrl: `${siteUrl}/proforma/${info.token ?? ""}?cancelled=1`,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Pay now is unavailable right now. Paste a payment link instead." };
  }
  // The old link (pasted or automatic) is replaced; the new order is the one the customer's Pay now opens.
  await admin.from("payment_links").update({ replaced_at: now, updated_by: staff?.id ?? null }).eq("invoice_id", invoiceId).is("replaced_at", null);
  const { data: row, error } = await admin
    .from("payment_links")
    .insert({ job_id: info.jobId, invoice_id: invoiceId, url: order.paymentUrl, provider: "ngenius", order_reference: order.reference, amount_aed: info.balance, state: "STARTED", added_by: staff?.id ?? null, created_by: staff?.id ?? null, updated_by: staff?.id ?? null })
    .select(SELECT)
    .single();
  if (error || !row) return { error: error?.message ?? "Could not save the payment link." };
  await admin.from("invoices").update({ payment_link_url: order.paymentUrl, pay_now_enabled: true, updated_by: staff?.id ?? null }).eq("id", invoiceId);
  if (info.jobId) await admin.from("job_events").insert({ job_id: info.jobId, event_type: "payment_link", note: `Pay now (Network International) on ${info.number} for AED ${info.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}${cur ? ", replacing the earlier link" : ""}${staff ? ` by ${staff.display_name}` : ""}`, created_by: staff?.id ?? null });
  return { link: { ...(row as unknown as PaymentLinkRow), amount_aed: Number((row as { amount_aed: unknown }).amount_aed) } };
}

/**
 * The customer confirmed "Pay now": the link counts as opened, the advisor is told, and the address is
 * returned for the customer's browser to follow. A pasted link works once; a Network International link
 * works until it is paid (and is remade for the balance when a part payment came in meanwhile).
 */
export async function openPaymentLink(token: string, siteUrl?: string): Promise<{ url?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: byToken } = await admin.from("invoices").select("id, job_id, number, converted_to").eq("token", token).eq("is_active", true).maybeSingle();
  if (!byToken) return { error: "This link is not valid." };
  let inv: { id: string; job_id: string | null; number: string } = byToken;
  if (byToken.converted_to) {
    const { data: tax } = await admin.from("invoices").select("id, job_id, number").eq("id", byToken.converted_to).maybeSingle();
    if (tax) inv = tax;
  }
  let cur = currentPaymentLink(await paymentLinksOf(inv.id));
  if (!cur) return { error: "There is no payment link on this invoice yet. Please ask us for one." };
  if (cur.provider === "ngenius") {
    if (cur.paid_at) return { error: "This invoice is already paid. Thank you." };
    // The balance may have moved since the order was made: the order follows the balance.
    const fresh = await ensureAutoPayLink(inv.id, null, siteUrl ?? "");
    if (fresh.error || !fresh.link) return { error: fresh.error ?? "Pay now is unavailable right now. Please ask us for a payment link." };
    cur = fresh.link;
  } else if (cur.opened_at) {
    return { error: `This payment link was already opened on ${formatDateTime(cur.opened_at)} and works once. Please ask us for a new one.` };
  }
  const now = new Date().toISOString();
  const firstOpen = !cur.opened_at;
  if (firstOpen) {
    const { error } = await admin.from("payment_links").update({ opened_at: now }).eq("id", cur.id).is("opened_at", null);
    if (error) return { error: error.message };
  }
  if (inv.job_id && firstOpen) {
    const { data: job } = await admin.from("jobs").select("job_number, gated_in_by").eq("id", inv.job_id).maybeSingle();
    const ids = Array.from(new Set([...(await advisorsInCharge(inv.job_id)), cur.added_by].filter((x): x is string => !!x)));
    await notifyStaff(ids, { type: "payment_link_opened", title: `Customer opened the payment link · ${job?.job_number ?? inv.number}`, body: `${inv.number}, opened ${formatDateTime(now)}. Record the payment when it arrives. If they did not complete it, paste a new link.`, jobId: inv.job_id, href: `/invoices/${inv.id}` });
    await admin.from("job_events").insert({ job_id: inv.job_id, event_type: "payment_link", note: `Customer opened the payment link on ${inv.number}` });
  }
  return { url: cur.url };
}
