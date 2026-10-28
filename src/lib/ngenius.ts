import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Network International, N-Genius Online: the hosted payment page behind the customer's "Pay now".
 *
 * Keys live in Vercel environment variables only:
 *   NGENIUS_API_KEY        the service account's API key (the long Basic-auth string from the N-Genius portal)
 *   NGENIUS_OUTLET_REF     the outlet reference (UUID) of the AED outlet
 *   NGENIUS_ENV            "sandbox" (default) or "live"; "mock" runs a local pretend gateway for tests (never in production)
 *   NGENIUS_WEBHOOK_SECRET a word of our choosing, put in the webhook address given to N-Genius (?key=…)
 *
 * The system never trusts what the webhook says: on every call it fetches the order from the gateway itself and
 * records the payment only when the gateway reports it captured. The same order can never be recorded twice.
 */

export type NgeniusOrder = { reference: string; paymentUrl: string };
export type NgeniusStatus = { state: "paid" | "pending" | "failed"; rawState: string; amountAed: number | null; cardLast4: string | null; /** The bank's authorisation code of the paid payment, when N-Genius sends it. */ authCode?: string | null };

const PAID_STATES = new Set(["CAPTURED", "PURCHASED"]);
const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DECLINED", "REVERSED", "EXPIRED"]);

export function ngeniusEnv(): "sandbox" | "live" | "mock" | null {
  const env = (process.env.NGENIUS_ENV ?? "sandbox").toLowerCase();
  if (env === "mock") return process.env.VERCEL_ENV === "production" ? null : "mock";
  if (!process.env.NGENIUS_API_KEY || !process.env.NGENIUS_OUTLET_REF) return null;
  return env === "live" ? "live" : "sandbox";
}

/** True when Pay now can be switched on: keys are in place (or the local pretend gateway is on). */
export function ngeniusConfigured(): boolean {
  return ngeniusEnv() !== null;
}

const base = () => (ngeniusEnv() === "live" ? "https://api-gateway.ngenius-payments.com" : "https://api-gateway.sandbox.ngenius-payments.com");

async function accessToken(): Promise<string> {
  const res = await fetch(`${base()}/identity/auth/access-token`, {
    method: "POST",
    headers: { Authorization: `Basic ${process.env.NGENIUS_API_KEY}`, "Content-Type": "application/vnd.ni-identity.v1+json", Accept: "application/vnd.ni-identity.v1+json" },
    body: JSON.stringify({ realmName: "ni" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`N-Genius login failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("N-Genius login gave no token");
  return json.access_token;
}

/** The pretend gateway for local tests: the order's state lives on its payment_links row; the "payment page" is our own mock route. */
export async function mockOrderGet(reference: string): Promise<{ amountAed: number; state: string; token: string | null } | null> {
  const { data } = await createAdminClient().from("payment_links").select("amount_aed, state, invoice:invoices(token)").eq("order_reference", reference).maybeSingle();
  if (!data) return null;
  const inv = data.invoice as unknown as { token: string | null } | null;
  return { amountAed: Number(data.amount_aed) || 0, state: String(data.state ?? "STARTED"), token: inv?.token ?? null };
}
export async function mockOrderSet(reference: string, state: string) {
  await createAdminClient().from("payment_links").update({ state }).eq("order_reference", reference);
  return mockOrderGet(reference);
}

/** Makes an order for the amount: the customer pays on N-Genius's page and comes back to ours. */
export async function createNgeniusOrder(input: { amountAed: number; merchantReference: string; email?: string | null; redirectUrl: string; cancelUrl: string; siteUrl: string }): Promise<NgeniusOrder> {
  const env = ngeniusEnv();
  if (!env) throw new Error("Pay now is not set up: the Network International keys are missing.");
  const value = Math.round(input.amountAed * 100);
  if (value <= 0) throw new Error("Nothing to pay.");
  if (env === "mock") {
    const reference = `mock-${crypto.randomUUID()}`;
    return { reference, paymentUrl: `${input.siteUrl}/api/pay/ngenius/mock?ref=${encodeURIComponent(reference)}` };
  }
  const token = await accessToken();
  const res = await fetch(`${base()}/transactions/outlets/${process.env.NGENIUS_OUTLET_REF}/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.ni-payment.v2+json", Accept: "application/vnd.ni-payment.v2+json" },
    body: JSON.stringify({
      action: "SALE",
      amount: { currencyCode: "AED", value },
      merchantOrderReference: input.merchantReference,
      language: "en",
      ...(input.email ? { emailAddress: input.email } : {}),
      merchantAttributes: { redirectUrl: input.redirectUrl, cancelUrl: input.cancelUrl, skipConfirmationPage: true, cancelText: "Back to your invoice" },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`N-Genius refused the order (${res.status})`);
  const json = (await res.json()) as { reference?: string; _links?: { payment?: { href?: string } } };
  if (!json.reference || !json._links?.payment?.href) throw new Error("N-Genius gave no payment page");
  return { reference: json.reference, paymentUrl: json._links.payment.href };
}

/** Asks the gateway where an order stands. Never trusts anything else. */
export async function fetchNgeniusStatus(reference: string): Promise<NgeniusStatus> {
  const env = ngeniusEnv();
  if (!env) throw new Error("Pay now is not set up.");
  if (env === "mock") {
    const o = await mockOrderGet(reference);
    const raw = o?.state ?? "FAILED";
    return { state: PAID_STATES.has(raw) ? "paid" : FAILED_STATES.has(raw) ? "failed" : "pending", rawState: raw, amountAed: o?.amountAed ?? null, cardLast4: o && PAID_STATES.has(raw) ? "4242" : null };
  }
  const token = await accessToken();
  const res = await fetch(`${base()}/transactions/outlets/${process.env.NGENIUS_OUTLET_REF}/orders/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.ni-payment.v2+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`N-Genius did not return the order (${res.status})`);
  const json = (await res.json()) as { _embedded?: { payment?: { state?: string; amount?: { value?: number }; paymentMethod?: { pan?: string }; authResponse?: { authorizationCode?: string } }[] }; amount?: { value?: number } };
  const payments = json._embedded?.payment ?? [];
  const paid = payments.find((p) => PAID_STATES.has(String(p.state ?? "").toUpperCase()));
  const latest = paid ?? payments.at(-1) ?? null;
  const raw = String(latest?.state ?? "STARTED").toUpperCase();
  const minor = paid?.amount?.value ?? json.amount?.value ?? null;
  const pan = latest?.paymentMethod?.pan ?? null;
  const auth = String(paid?.authResponse?.authorizationCode ?? "").replace(/\s+/g, "").toUpperCase();
  return { state: paid ? "paid" : FAILED_STATES.has(raw) ? "failed" : "pending", rawState: raw, amountAed: minor !== null ? Math.round(minor) / 100 : null, cardLast4: pan ? pan.slice(-4) : null, authCode: /^[A-Z0-9]{6}$/.test(auth) ? auth : null };
}
