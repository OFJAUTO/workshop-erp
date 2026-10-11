import "server-only";
import { formatDateTime } from "./format";
import { notifyStaff } from "./notifications";
import { createAdminClient } from "./supabase/admin";

/**
 * Payment links from the separate payment system. The advisor pastes one; the customer's "Pay now"
 * opens it once. The system itself never requests, previews, validates or unfurls the address: it is
 * stored as text, shown to staff as text, and handed to the customer's browser only when they confirm.
 */
export type PaymentLinkRow = { id: string; invoice_id: string; job_id: string | null; url: string; added_by: string | null; added_at: string; opened_at: string | null; replaced_at: string | null };
const SELECT = "id, invoice_id, job_id, url, added_by, added_at, opened_at, replaced_at";

export async function paymentLinksOf(invoiceId: string): Promise<PaymentLinkRow[]> {
  const { data } = await createAdminClient().from("payment_links").select(SELECT).eq("invoice_id", invoiceId).eq("is_active", true).order("added_at", { ascending: false });
  return (data ?? []) as PaymentLinkRow[];
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

/**
 * The customer confirmed "Pay now": the link counts as opened, the advisor is told, and the address is
 * returned for the customer's browser to follow. A second tap gets a message instead of the address.
 */
export async function openPaymentLink(token: string): Promise<{ url?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: byToken } = await admin.from("invoices").select("id, job_id, number, converted_to").eq("token", token).eq("is_active", true).maybeSingle();
  if (!byToken) return { error: "This link is not valid." };
  let inv: { id: string; job_id: string | null; number: string } = byToken;
  if (byToken.converted_to) {
    const { data: tax } = await admin.from("invoices").select("id, job_id, number").eq("id", byToken.converted_to).maybeSingle();
    if (tax) inv = tax;
  }
  const cur = currentPaymentLink(await paymentLinksOf(inv.id));
  if (!cur) return { error: "There is no payment link on this invoice yet. Please ask us for one." };
  if (cur.opened_at) return { error: `This payment link was already opened on ${formatDateTime(cur.opened_at)} and works once. Please ask us for a new one.` };
  const now = new Date().toISOString();
  const { error } = await admin.from("payment_links").update({ opened_at: now }).eq("id", cur.id).is("opened_at", null);
  if (error) return { error: error.message };
  if (inv.job_id) {
    const [{ data: job }, { data: appr }] = await Promise.all([admin.from("jobs").select("job_number, gated_in_by").eq("id", inv.job_id).maybeSingle(), admin.from("approval_requests").select("sent_by").eq("job_id", inv.job_id)]);
    const ids = Array.from(new Set([job?.gated_in_by, cur.added_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
    await notifyStaff(ids, { type: "payment_link_opened", title: `Customer opened the payment link · ${job?.job_number ?? inv.number}`, body: `${inv.number}, opened ${formatDateTime(now)}. Record the payment when it arrives. If they did not complete it, paste a new link.`, jobId: inv.job_id, href: `/invoices/${inv.id}` });
    await admin.from("job_events").insert({ job_id: inv.job_id, event_type: "payment_link", note: `Customer opened the payment link on ${inv.number}` });
  }
  return { url: cur.url };
}
