import "server-only";
import { fetchNgeniusStatus } from "./ngenius";
import { recordPaymentCore } from "./payments";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

const SYSTEM_ACTOR = { id: null, display_name: "Network International", role_id: "accounts" as const };

/**
 * An order came back from Network International (the customer's return, or the webhook). The gateway is asked
 * where the order stands; a captured order becomes one payment by "Payment link" at the link's bank charge, the
 * proforma turns into the tax invoice when that settles it, and the advisor is told. Called twice, it records once.
 */
export async function settleNgeniusOrder(reference: string): Promise<{ paid: boolean; already?: boolean; error?: string; invoiceId?: string; token?: string | null }> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("payment_links").select("id, invoice_id, job_id, amount_aed, paid_at, payment_id").eq("order_reference", reference).eq("provider", "ngenius").maybeSingle();
  if (!row) return { paid: false, error: "Unknown order." };
  const { data: inv } = await admin.from("invoices").select("id, token, converted_to").eq("id", row.invoice_id).maybeSingle();
  const token = inv?.token ?? null;
  if (row.payment_id) return { paid: true, already: true, invoiceId: row.invoice_id, token };
  let status;
  try {
    status = await fetchNgeniusStatus(reference);
  } catch (e) {
    return { paid: false, error: e instanceof Error ? e.message : "Could not reach the gateway.", invoiceId: row.invoice_id, token };
  }
  await admin.from("payment_links").update({ state: status.rawState }).eq("id", row.id);
  if (status.state !== "paid") return { paid: false, invoiceId: row.invoice_id, token };
  const amount = status.amountAed ?? Number(row.amount_aed) ?? 0;
  const settings = await getSettings();
  // The invoice the money belongs to: the proforma, or the tax invoice it already became.
  const invoiceId = inv?.converted_to ?? row.invoice_id;
  // Section 12: the receipt names only the method and the card tail; the gateway's reference stays in client_key for tracing.
  const r = await recordPaymentCore(SYSTEM_ACTOR, { invoiceId, jobId: row.job_id, method: "link", amount, authCode: status.authCode ?? null, reference: status.cardLast4 ? `Paid online · card ****${status.cardLast4}` : "Paid online", clientKey: `ngenius:${reference}`, notes: "Paid online through Pay now" }, settings);
  if (r.error) return { paid: true, error: r.error, invoiceId: row.invoice_id, token };
  await admin.from("payment_links").update({ paid_at: new Date().toISOString(), payment_id: r.paymentId ?? null, state: status.rawState }).eq("id", row.id);
  return { paid: true, invoiceId: row.invoice_id, token };
}
