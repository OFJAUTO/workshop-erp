import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { notifyRoles } from "./notifications";
import { createAdminClient } from "./supabase/admin";

/**
 * The scans mailbox, connected by a one-time Google sign-in as scans@ofjauto.com (OAuth, read only). Google itself
 * limits the permission to that one account: the system holds a token for scans@ofjauto.com and nothing else, with the
 * gmail.readonly scope only. No domain-wide delegation is involved.
 *
 * Vercel environment variables (never in the code, never typed into the ERP):
 *   GOOGLE_OAUTH_CLIENT_ID      the OAuth client's ID (…apps.googleusercontent.com)
 *   GOOGLE_OAUTH_CLIENT_SECRET  the OAuth client's secret
 *   SCANS_MAILBOX               scans@ofjauto.com: the only account the sign-in accepts
 * The long-term token Google gives at sign-in is kept encrypted (AES-256-GCM, key from the client secret) in the
 * table google_mailbox_tokens, which only the server can read.
 */

export const MAILBOX_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALLBACK_PATH = "/api/google/mailbox/callback";
export const STATE_COOKIE = "erp_mailbox_state";

export function oauthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

/** The one account the sign-in accepts (lower case), or "" when not set. */
export function expectedMailbox(): string {
  return String(process.env.SCANS_MAILBOX ?? "").trim().toLowerCase();
}

const key = () => createHash("sha256").update(`erp-mailbox:${process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ""}`).digest();

/** Encrypts the long-term token before it is stored. */
export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

/** The stored token in plain, or null when it cannot be read (for example the client secret changed). */
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

/** Google's sign-in page for the scans mailbox: read only, the address filled in, a long-term permission asked for. */
export function consentUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: MAILBOX_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  if (expectedMailbox()) p.set("login_hint", expectedMailbox());
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export type MailboxConnection = { id: string; mailbox: string; connected_at: string; connected_by_name: string | null; last_error: string | null };

/** The active connection, if any. */
export async function mailboxConnection(): Promise<MailboxConnection | null> {
  const { data } = await createAdminClient().from("google_mailbox_tokens").select("id, mailbox, connected_at, last_error, by:staff!google_mailbox_tokens_connected_by_fkey(display_name)").eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const row = data as unknown as { id: string; mailbox: string; connected_at: string; last_error: string | null; by: { display_name: string } | null };
  return { id: row.id, mailbox: row.mailbox, connected_at: row.connected_at, connected_by_name: row.by?.display_name ?? null, last_error: row.last_error };
}

/** Stores a connection (the token encrypted); any earlier one is closed. Written in the change log without the token. */
export async function saveConnection(mailbox: string, refreshToken: string, by: string | null): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("google_mailbox_tokens").update({ is_active: false, revoked_at: now, updated_by: by }).eq("is_active", true);
  await admin.from("google_mailbox_tokens").insert({ mailbox: mailbox.toLowerCase(), refresh_token_enc: sealToken(refreshToken), scope: MAILBOX_SCOPE, connected_by: by, connected_at: now, created_by: by, updated_by: by });
  await admin.from("audit_log").insert({ table_name: "google_mailbox_tokens", record_id: mailbox.toLowerCase(), action: "connect", new_data: { mailbox: mailbox.toLowerCase(), scope: MAILBOX_SCOPE }, changed_by: by }).then(() => null, () => null);
  cached = null;
}

const tokenEndpoint = "https://oauth2.googleapis.com/token";

/** The callback: Google's one-time code becomes a long-term permission for scans@ofjauto.com only. */
export async function connectWithCode(origin: string, code: string, by: string | null): Promise<{ mailbox: string } | { error: string }> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", redirect_uri: `${origin}${CALLBACK_PATH}`, grant_type: "authorization_code" }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) return { error: `Google refused the sign-in${json.error_description ? `: ${json.error_description.replace(/\.$/, "")}` : json.error ? `: ${json.error}` : ""}.` };
  if (!String(json.scope ?? "").split(" ").includes(MAILBOX_SCOPE)) return { error: "Google did not give permission to read the mailbox. Connect again and tick the permission on Google's page." };
  const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${json.access_token}` }, cache: "no-store" });
  const pj = (await profile.json().catch(() => ({}))) as { emailAddress?: string; error?: { message?: string } };
  const mailbox = String(pj.emailAddress ?? "").toLowerCase();
  const expected = expectedMailbox();
  if (!profile.ok || !mailbox) return { error: `The mailbox could not be read${pj.error?.message ? `: ${pj.error.message}` : ""}.` };
  if (expected && mailbox !== expected) {
    // The wrong account: its permission is given back to Google at once, nothing is kept.
    await revoke(json.refresh_token ?? json.access_token);
    return { error: `You signed in as ${mailbox}. Connect again and choose ${expected} on Google's page.` };
  }
  if (!json.refresh_token) return { error: "Google gave no long-term permission. In the scans mailbox's Google Account open Security, Third-party access, remove OFJ ERP, then connect again." };
  await saveConnection(mailbox, json.refresh_token, by);
  return { mailbox };
}

async function revoke(token: string | undefined | null) {
  if (!token) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store" }).catch(() => null);
}

/** The owner's Disconnect: the permission is given back to Google and the stored token closed. */
export async function disconnectMailbox(by: string | null): Promise<void> {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("google_mailbox_tokens").select("id, mailbox, refresh_token_enc").eq("is_active", true);
  for (const r of rows ?? []) {
    const plain = openToken(String(r.refresh_token_enc));
    await revoke(plain);
    await admin.from("google_mailbox_tokens").update({ is_active: false, revoked_at: new Date().toISOString(), updated_by: by }).eq("id", r.id);
    await admin.from("audit_log").insert({ table_name: "google_mailbox_tokens", record_id: String(r.mailbox), action: "disconnect", new_data: { mailbox: r.mailbox }, changed_by: by }).then(() => null, () => null);
  }
  cached = null;
}

let cached: { id: string; token: string; expires: number } | null = null;

/** A short-lived key to read the mailbox, from the stored permission. A refusal is written on the connection and the owner hears once. */
export async function mailboxAccessToken(): Promise<string> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("google_mailbox_tokens").select("id, mailbox, refresh_token_enc, last_error").eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) throw new Error("Mailbox not connected yet: the owner presses Connect on the Scan reports page.");
  if (cached && cached.id === row.id && cached.expires > Date.now() + 60000) return cached.token;
  const fail = async (message: string) => {
    if (row.last_error !== message) {
      await admin.from("google_mailbox_tokens").update({ last_error: message }).eq("id", row.id);
      if (!row.last_error) await notifyRoles(["owner"], { type: "scan_mailbox_problem", title: "Scan mailbox: connect again", body: message, href: "/scans" });
    }
    throw new Error(message);
  };
  const refresh = openToken(String(row.refresh_token_enc));
  if (!refresh) return fail("The saved sign-in cannot be read (the Google client secret was changed). Connect the mailbox again on the Scan reports page.");
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", refresh_token: refresh, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const why = json.error === "invalid_grant" ? "Google withdrew the permission (the password was changed or the access removed)" : `Google refused the sign-in${json.error_description ? `: ${json.error_description.replace(/\.$/, "")}` : json.error ? `: ${json.error}` : ""}`;
    return fail(`${why}. Connect the mailbox again on the Scan reports page.`);
  }
  if (row.last_error) await admin.from("google_mailbox_tokens").update({ last_error: null }).eq("id", row.id);
  cached = { id: row.id, token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}
