import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * Zoho Books, phase 0 (26 October 2026, docs/zoho-plan.md): the connection only. One-way, ERP → Zoho; the ERP
 * stays where staff work and Zoho is the accountant's book. The owner connects once with Zoho's own sign-in
 * (server-based OAuth, data centre .com); the long-term token is kept encrypted (AES-256-GCM, key from the
 * client secret) in zoho_tokens, which only the server can read.
 *
 * THE GUARD: the REAL organization (942979945) is read-only until the owner turns the go-live switch on
 * (settings.zoho_live_enabled). Every write goes through zohoFetch, which refuses a write to REAL while the
 * switch is off — the rule lives here, not in the callers.
 *
 * Vercel environment variables (never in the code, never typed into the ERP):
 *   ZOHO_CLIENT_ID      the API console client's ID (1000.xxxx)
 *   ZOHO_CLIENT_SECRET  the API console client's secret
 */

export const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com";
export const ZOHO_API_URL = "https://www.zohoapis.com/books/v3";
/** O F J AUTOMOTIVE WORKS LLC: the real book. Read-only until go-live. */
export const ZOHO_REAL_ORG_ID = "942979945";
export const ZOHO_SCOPE = "ZohoBooks.fullaccess.all";
export const ZOHO_CALLBACK_PATH = "/api/zoho/callback";
export const ZOHO_STATE_COOKIE = "erp_zoho_state";

export function zohoConfigured(): boolean {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

const key = () => createHash("sha256").update(`erp-zoho:${process.env.ZOHO_CLIENT_SECRET ?? ""}`).digest();

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function openToken(sealed: string): string | null {
  try {
    const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Zoho's own sign-in page: a lasting permission (offline + consent) for the Books scope. */
export function consentUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: `${origin}${ZOHO_CALLBACK_PATH}`,
    scope: ZOHO_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?${p.toString()}`;
}

export type ZohoConnection = { id: string; connected_at: string; connected_by_name: string | null; last_error: string | null };

export async function zohoConnection(): Promise<ZohoConnection | null> {
  const { data } = await createAdminClient().from("zoho_tokens").select("id, connected_at, last_error, by:staff!zoho_tokens_connected_by_fkey(display_name)").eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const row = data as unknown as { id: string; connected_at: string; last_error: string | null; by: { display_name: string } | null };
  return { id: row.id, connected_at: row.connected_at, connected_by_name: row.by?.display_name ?? null, last_error: row.last_error };
}

/** Stores a connection (the token encrypted); any earlier one is closed. Logged without the token. */
export async function saveConnection(refreshToken: string, by: string | null): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("zoho_tokens").update({ is_active: false, revoked_at: now, updated_by: by }).eq("is_active", true);
  await admin.from("zoho_tokens").insert({ refresh_token_enc: sealToken(refreshToken), scope: ZOHO_SCOPE, connected_by: by, connected_at: now, created_by: by, updated_by: by });
  await admin.from("audit_log").insert({ table_name: "zoho_tokens", record_id: "zoho-books", action: "connect", new_data: { scope: ZOHO_SCOPE }, changed_by: by }).then(() => null, () => null);
  cached = null;
}

/** The owner's Disconnect: the permission is handed back to Zoho and the stored token closed. */
export async function disconnectZoho(by: string | null): Promise<void> {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("zoho_tokens").select("id, refresh_token_enc").eq("is_active", true);
  for (const r of rows ?? []) {
    const plain = openToken(String(r.refresh_token_enc));
    if (plain) await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token/revoke?token=${encodeURIComponent(plain)}`, { method: "POST", cache: "no-store" }).catch(() => null);
    await admin.from("zoho_tokens").update({ is_active: false, revoked_at: new Date().toISOString(), updated_by: by }).eq("id", r.id);
    await admin.from("audit_log").insert({ table_name: "zoho_tokens", record_id: "zoho-books", action: "disconnect", new_data: {}, changed_by: by }).then(() => null, () => null);
  }
  cached = null;
}

/** The callback: Zoho's one-time code becomes the long-term permission. */
export async function connectWithCode(origin: string, code: string, by: string | null): Promise<{ ok: true } | { error: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    redirect_uri: `${origin}${ZOHO_CALLBACK_PATH}`,
    code,
  });
  const res = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!res.ok || j.error || !j.refresh_token) return { error: `Zoho refused the sign-in${j.error ? `: ${j.error}` : ""}. Press Connect again.` };
  await saveConnection(j.refresh_token, by);
  return { ok: true };
}

let cached: { id: string; token: string; expires: number } | null = null;

/** A short-lived key for the API, from the stored permission. A refusal is written on the connection. */
export async function zohoAccessToken(): Promise<string> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("zoho_tokens").select("id, refresh_token_enc, last_error").eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) throw new Error("Zoho Books is not connected yet: the owner presses Connect on Settings > Zoho Books.");
  if (cached && cached.id === row.id && cached.expires > Date.now() + 60000) return cached.token;
  const fail = async (message: string) => {
    if (row.last_error !== message) await admin.from("zoho_tokens").update({ last_error: message }).eq("id", row.id);
    throw new Error(message);
  };
  const plain = openToken(String(row.refresh_token_enc));
  if (!plain) return fail("The saved Zoho sign-in cannot be read (the client secret was changed). Connect again on Settings > Zoho Books.");
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: process.env.ZOHO_CLIENT_ID ?? "", client_secret: process.env.ZOHO_CLIENT_SECRET ?? "", refresh_token: plain });
  const res = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || j.error || !j.access_token) return fail(`Zoho refused the saved sign-in${j.error ? ` (${j.error})` : ""}. Connect again on Settings > Zoho Books.`);
  if (row.last_error) await admin.from("zoho_tokens").update({ last_error: null }).eq("id", row.id);
  cached = { id: row.id, token: j.access_token, expires: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
  return cached.token;
}

/** The chosen test organization (OFJ TEST), set on Settings > Zoho Books. */
export async function zohoTestOrgId(): Promise<string | null> {
  const settings = await getSettings();
  const id = String(settings.zoho_org_test ?? "").trim();
  return id && id !== ZOHO_REAL_ORG_ID ? id : null;
}

/* ------------------------------------------------------------------------------------------------------------
 * The one API door. Calls run one at a time with a gap (the plan's queue keeps us far under Zoho's limits:
 * 10,000/day on Elite, 100/minute, 10 concurrent) and a 429 is retried once after a pause.
 * ---------------------------------------------------------------------------------------------------------- */

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const GAP_MS = 650;

export class ZohoError extends Error {
  code: number | string | null;
  constructor(message: string, code: number | string | null = null) {
    super(message);
    this.code = code;
  }
}

export async function zohoFetch<T = Record<string, unknown>>(path: string, opts: { org?: string | null; method?: "GET" | "POST" | "PUT" | "DELETE"; body?: Record<string, unknown>; write?: boolean } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const write = opts.write ?? method !== "GET";
  if (write) {
    // THE guard: nothing writes to the real book while the go-live switch is off.
    if (!opts.org) throw new ZohoError("A write needs its organization.");
    if (opts.org === ZOHO_REAL_ORG_ID) {
      const settings = await getSettings();
      if (settings.zoho_live_enabled !== true) throw new ZohoError("Refused: the REAL Zoho organization is read-only until the owner declares go-live. Writes go to OFJ TEST.");
    }
  }
  const run = chain.then(async () => {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const call = async () => {
      const token = await zohoAccessToken();
      const url = new URL(`${ZOHO_API_URL}${path}`);
      if (opts.org) url.searchParams.set("organization_id", opts.org);
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { code?: number; message?: string };
      return { res, j };
    };
    let { res, j } = await call();
    if (res.status === 429 || res.status >= 500) {
      // Backoff on 429 and 5xx: one pause, one more try. Anything else is a real answer.
      await new Promise((r) => setTimeout(r, res.status === 429 ? 3000 : 1500));
      lastCall = Date.now();
      ({ res, j } = await call());
    }
    if (!res.ok || (typeof j.code === "number" && j.code !== 0)) throw new ZohoError(`Zoho said: ${j.message ?? `HTTP ${res.status}`}`, j.code ?? res.status);
    return j as T;
  });
  chain = run.then(() => undefined, () => undefined);
  return run as Promise<T>;
}

/* ---------------------------------------- Phase 0 reads and the mirror ---------------------------------------- */

export type ZohoOrg = { organization_id: string; name: string; is_default_org?: boolean; country?: string; currency_code?: string; version?: string };
export type ZohoTax = { tax_id: string; tax_name: string; tax_percentage: number; tax_type?: string };
export type ZohoAccount = { account_id: string; account_name: string; account_type: string; is_user_created?: boolean; is_active?: boolean };
export type ZohoBankAccount = { account_id: string; account_name: string; account_type: string };

export async function listOrganizations(): Promise<ZohoOrg[]> {
  const j = await zohoFetch<{ organizations?: ZohoOrg[] }>("/organizations");
  return j.organizations ?? [];
}

export async function listTaxes(org: string): Promise<ZohoTax[]> {
  const j = await zohoFetch<{ taxes?: ZohoTax[] }>("/settings/taxes", { org });
  return j.taxes ?? [];
}

export async function listAccounts(org: string): Promise<ZohoAccount[]> {
  const j = await zohoFetch<{ chartofaccounts?: ZohoAccount[] }>("/chartofaccounts?filter_by=AccountType.All", { org });
  return j.chartofaccounts ?? [];
}

export async function listBankAccounts(org: string): Promise<ZohoBankAccount[]> {
  const j = await zohoFetch<{ bankaccounts?: ZohoBankAccount[] }>("/bankaccounts", { org });
  return j.bankaccounts ?? [];
}

/** The payment modes, where the API exposes them (not documented on every plan): null means "not readable". */
export async function listPaymentModes(org: string): Promise<string[] | null> {
  try {
    const j = await zohoFetch<Record<string, unknown>>("/settings/preferences", { org });
    const dig = (o: unknown): string[] => {
      if (!o || typeof o !== "object") return [];
      const rec = o as Record<string, unknown>;
      const found: string[] = [];
      for (const [k, v] of Object.entries(rec)) {
        if (/payment_?modes/i.test(k) && Array.isArray(v)) for (const m of v) found.push(typeof m === "string" ? m : String((m as Record<string, unknown>).name ?? (m as Record<string, unknown>).payment_mode ?? ""));
        else if (v && typeof v === "object") found.push(...dig(v));
      }
      return found.filter(Boolean);
    };
    const modes = dig(j);
    return modes.length ? Array.from(new Set(modes)) : null;
  } catch {
    return null;
  }
}

export type MirrorResult = { taxesCreated: string[]; accountsCreated: string[]; alreadyThere: number; skipped: string[] };

/**
 * B4: OFJ TEST mirrors the REAL organization's lists — read from REAL (read-only), create what is missing in
 * TEST by name. Never deletes, never touches REAL (zohoFetch refuses the write anyway).
 */
export async function mirrorRealIntoTest(): Promise<MirrorResult> {
  const testOrg = await zohoTestOrgId();
  if (!testOrg) throw new ZohoError("Pick the OFJ TEST organization first (Settings > Zoho Books).");
  const [realTaxes, testTaxes, realAccounts, testAccounts] = await Promise.all([
    listTaxes(ZOHO_REAL_ORG_ID),
    listTaxes(testOrg),
    listAccounts(ZOHO_REAL_ORG_ID),
    listAccounts(testOrg),
  ]);
  const out: MirrorResult = { taxesCreated: [], accountsCreated: [], alreadyThere: 0, skipped: [] };
  const haveTax = new Set(testTaxes.map((t) => `${t.tax_name.toLowerCase()}|${Number(t.tax_percentage)}`));
  for (const t of realTaxes) {
    if (haveTax.has(`${t.tax_name.toLowerCase()}|${Number(t.tax_percentage)}`)) {
      out.alreadyThere++;
      continue;
    }
    try {
      await zohoFetch("/settings/taxes", { org: testOrg, method: "POST", body: { tax_name: t.tax_name, tax_percentage: t.tax_percentage, ...(t.tax_type ? { tax_type: t.tax_type } : {}) } });
      out.taxesCreated.push(`${t.tax_name} (${t.tax_percentage}%)`);
    } catch (e) {
      out.skipped.push(`Tax ${t.tax_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const haveAcc = new Set(testAccounts.map((a) => a.account_name.toLowerCase()));
  for (const a of realAccounts) {
    if (a.is_active === false) continue;
    if (haveAcc.has(a.account_name.toLowerCase())) {
      out.alreadyThere++;
      continue;
    }
    try {
      await zohoFetch("/chartofaccounts", { org: testOrg, method: "POST", body: { account_name: a.account_name, account_type: a.account_type } });
      out.accountsCreated.push(`${a.account_name} (${a.account_type})`);
    } catch (e) {
      out.skipped.push(`Account ${a.account_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
