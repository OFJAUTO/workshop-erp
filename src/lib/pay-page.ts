import "server-only";
import { round2 } from "./money";
import { depositState } from "./deposits";
import { PAYMENT_SELECT, creditsOnDocs, invoiceBalance, toInvoice, toPayment } from "./invoice-data";
import { greetingNameOf } from "./messages";
import { getSettings, type Settings } from "./settings";
import { shortFor } from "./short-links";
import { PRODUCTION_SITE_URL } from "./site";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * The /p/<token> payment page (1.4, 21 October 2026). Every pay-request message carries OUR short
 * link to this page, never the gateway's own address: the page greets the customer by first name,
 * names the car and what the money is for, shows the AMOUNT large, and offers Pay now (opening the
 * pasted gateway link), the bank transfer details and pay-at-the-workshop. The gateway link can be
 * replaced later; the same /p/ link keeps working.
 */

export const DEFAULT_GATEWAY_DOMAINS = ["paypage.ngenius-payments.com", "paypage.sandbox.ngenius-payments.com"];

/** Only an https link on one of the owner's allowed pay-page domains counts as a payment link. */
export function validateGatewayUrl(url: string, settings: Settings): { ok: true; host: string } | { ok: false; error: string } {
  const clean = url.trim();
  if (!clean) return { ok: false, error: "Paste the payment link first." };
  let u: URL;
  try {
    u = new URL(clean);
  } catch {
    return { ok: false, error: "This doesn't look like a payment link." };
  }
  const allowed = ((settings.payment_gateway_domains ?? []) as string[]).flatMap((d) => String(d).toLowerCase().split(/[\s,;]+/)).map((d) => d.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_GATEWAY_DOMAINS;
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || !list.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { ok: false, error: "This doesn't look like a payment link. Paste the pay-page link from the gateway (not a website address)." };
  }
  return { ok: true, host };
}

export type PaymentRequestRow = {
  id: string;
  /** The job, or null for a request on an ESTIMATE before the car arrives (4 November 2026). */
  job_id: string | null;
  estimate_id?: string | null;
  quotation_id: string | null;
  invoice_id: string | null;
  kind: "deposit" | "proforma" | "invoice" | "advance";
  amount_aed: number;
  purpose: string | null;
  gateway_url: string | null;
  token: string;
};

/** One live request per job (or estimate) and kind: made on first send, updated (amount, link) on every send after. The /p/ link never changes. */
export async function ensurePaymentRequest(input: { jobId?: string | null; estimateId?: string | null; kind: "deposit" | "proforma" | "invoice" | "advance"; amount: number; quotationId?: string | null; invoiceId?: string | null; purpose?: string | null; gatewayUrl?: string | null; by: string | null }): Promise<{ row: PaymentRequestRow; shortLink: string }> {
  const admin = createAdminClient();
  if (!input.jobId && !input.estimateId) throw new Error("A payment page belongs to a job or an estimate.");
  const place = input.jobId ? ({ col: "job_id", id: input.jobId } as const) : ({ col: "estimate_id", id: input.estimateId! } as const);
  const { data: existing } = await admin.from("payment_requests").select("*").eq(place.col, place.id).eq("kind", input.kind).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let row = existing as PaymentRequestRow | null;
  if (row) {
    const patch: Record<string, unknown> = { amount_aed: round2(input.amount), updated_by: input.by };
    if (input.purpose !== undefined) patch.purpose = input.purpose;
    if (input.quotationId !== undefined) patch.quotation_id = input.quotationId;
    if (input.invoiceId !== undefined) patch.invoice_id = input.invoiceId;
    if (input.gatewayUrl !== undefined) patch.gateway_url = input.gatewayUrl;
    const { data: upd } = await admin.from("payment_requests").update(patch).eq("id", row.id).select("*").single();
    row = (upd as PaymentRequestRow) ?? row;
  } else {
    const { data: made, error } = await admin
      .from("payment_requests")
      .insert({ job_id: input.jobId ?? null, ...(input.estimateId ? { estimate_id: input.estimateId } : {}), kind: input.kind, amount_aed: round2(input.amount), quotation_id: input.quotationId ?? null, invoice_id: input.invoiceId ?? null, purpose: input.purpose ?? null, gateway_url: input.gatewayUrl ?? null, created_by: input.by, updated_by: input.by })
      .select("*")
      .single();
    if (error || !made) throw new Error(error?.message ?? "Could not make the payment page.");
    row = made as PaymentRequestRow;
  }
  const shortLink = await shortFor(`${PRODUCTION_SITE_URL}/p/${row.token}`);
  return { row, shortLink };
}

export type PayPageData = {
  firstName: string;
  carTitle: string;
  plate: string;
  number: string;
  purpose: string;
  amount: number;
  gatewayUrl: string | null;
  paid: boolean;
  receiptHref: string | null;
  bank: { name: string; accountName: string; accountNumber: string; iban: string; swift: string };
  address: string;
  hoursText: string;
  mapUrl: string | null;
};

/** Everything the public /p/ page shows. Null when the token is unknown. */
export async function payPageData(token: string): Promise<PayPageData | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payment_requests").select("*").eq("token", token).eq("is_active", true).maybeSingle();
  if (!raw) return null;
  const r = raw as PaymentRequestRow;
  const settings = await getSettings();
  // A request on an ESTIMATE (the car not here yet, 4 November 2026) reads its people from the estimate.
  const est = !r.job_id && r.estimate_id
    ? (await admin.from("quotations").select(`number, customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))`).eq("id", r.estimate_id).maybeSingle()).data
    : null;
  const { data: job } = r.job_id
    ? await admin
        .from("jobs")
        .select(`job_number, customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))`)
        .eq("id", r.job_id)
        .maybeSingle()
    : { data: null };
  const customer = ((job?.customer ?? est?.customer) as unknown as { full_name: string; company_name: string | null } | null) ?? null;
  const v = ((job?.vehicle ?? est?.vehicle) as unknown as (Parameters<typeof formatPlate>[0] & { model_year?: number | null; make?: { name: string } | null; model?: { name: string } | null }) | null) ?? null;

  let number = job?.job_number ?? (est?.number as string | undefined) ?? "";
  let paid = false;
  let receiptHref: string | null = null;
  const amount = Number(r.amount_aed) || 0;
  if (!r.job_id && r.invoice_id) {
    // The estimate's link asks for a FIGURE against its proforma: paid once that much has come in on it
    // since the link was last sent (a partial link must not wait for the whole bill).
    const since = String((raw as { updated_at?: string }).updated_at ?? (raw as { created_at?: string }).created_at ?? "");
    // The payments may already sit on the tax invoice the proforma became: count both documents.
    const { data: inv } = await admin.from("invoices").select("id, converted_to").eq("id", r.invoice_id).maybeSingle();
    const ids = [r.invoice_id, (inv as { converted_to?: string | null } | null)?.converted_to].filter((x): x is string => !!x);
    const { data: estPays } = await admin.from("payments").select("id, amount_aed, token, received_at").in("invoice_id", ids).eq("is_active", true).eq("status", "recorded").gte("received_at", since).order("received_at", { ascending: false });
    const got = round2((estPays ?? []).reduce((a, p) => a + (Number(p.amount_aed) || 0), 0));
    paid = got + 0.005 >= amount;
    const last = (estPays ?? [])[0] as { id: string; token: string | null } | undefined;
    if (paid && last) receiptHref = `/api/pdf/receipt/${last.id}${last.token ? `?p=${last.token}` : ""}`;
  } else if (r.job_id && r.kind === "deposit") {
    const st = await depositState(r.job_id);
    if (r.quotation_id) {
      const { data: q } = await admin.from("quotations").select("number, token").eq("id", r.quotation_id).maybeSingle();
      if (q?.number) number = q.number as string;
      paid = st.received + 0.005 >= amount;
      if (paid) {
        const { data: pay } = await admin.from("payments").select("id").eq("job_id", r.job_id).is("invoice_id", null).eq("is_active", true).eq("status", "recorded").order("received_at", { ascending: false }).limit(1).maybeSingle();
        if (pay) receiptHref = `/api/pdf/receipt/${pay.id}${q?.token ? `?q=${q.token}` : ""}`;
      }
    } else paid = st.received + 0.005 >= amount;
  } else if (r.kind === "advance") {
    // 1 November 2026: the advisor's link for any amount - paid once that much has come in on the job since it was sent.
    const since = String((raw as { updated_at?: string }).updated_at ?? (raw as { created_at?: string }).created_at ?? "");
    const { data: pays } = await admin.from("payments").select("id, amount_aed, token, received_at").eq("job_id", r.job_id).eq("is_active", true).eq("status", "recorded").gte("received_at", since).order("received_at", { ascending: false });
    const got = round2((pays ?? []).reduce((a, p) => a + (Number(p.amount_aed) || 0), 0));
    paid = got + 0.005 >= amount;
    const last = (pays ?? [])[0] as { id: string; token: string | null } | undefined;
    if (paid && last) receiptHref = `/api/pdf/receipt/${last.id}${last.token ? `?p=${last.token}` : ""}`;
  } else if (r.invoice_id) {
    const { data: invRaw } = await admin.from("invoices").select("*").eq("id", r.invoice_id).maybeSingle();
    if (invRaw) {
      const inv = toInvoice(invRaw as Record<string, unknown>);
      number = inv.number;
      const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", inv.id).eq("is_active", true);
      const b = invoiceBalance(inv, ((pays ?? []) as Record<string, unknown>[]).map(toPayment), (await creditsOnDocs([inv.id])).get(inv.id) ?? 0);
      paid = b.balance <= 0.005;
      if (paid) {
        const { data: pay } = await admin.from("payments").select("id").eq("invoice_id", inv.id).eq("is_active", true).eq("status", "recorded").order("received_at", { ascending: false }).limit(1).maybeSingle();
        if (pay) receiptHref = `/api/pdf/receipt/${pay.id}?t=${inv.token}`;
      }
    }
  }
  const pin = String(settings.workshop_location_pin ?? "").trim();
  return {
    firstName: greetingNameOf(customer),
    carTitle: [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" "),
    plate: v ? formatPlate(v) : (job?.job_number ?? ""),
    number,
    purpose: r.purpose ?? (r.kind === "deposit" ? "Advance payment to order the parts" : r.kind === "proforma" || r.kind === "advance" ? "Payment for the work on your car" : "Invoice payment"),
    amount,
    gatewayUrl: r.gateway_url,
    paid,
    receiptHref,
    bank: { name: String(settings.bank_name ?? ""), accountName: String(settings.company_legal_name || settings.bank_account_name || ""), accountNumber: String(settings.bank_account_number ?? ""), iban: String(settings.bank_iban ?? ""), swift: String(settings.bank_swift ?? "") },
    address: String(settings.company_address ?? ""),
    hoursText: String(settings.workshop_hours_text ?? "Monday to Saturday, 8:00–17:00"),
    mapUrl: pin && /^https?:\/\//.test(pin) ? pin : null,
  };
}
