import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import { schemaReady } from "./schema-ready";
import { getSettings } from "./settings";
import { isTestEnvironment } from "./environment";
import { logAppError } from "./app-errors";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions } from "./session";
import { PASSKEY_SESSION_HOURS, passkeyPerson, rolloutOf, type PasskeyRollout } from "./passkey-rules";

/**
 * THE passkey server (7 November 2026). Our own WebAuthn with SimpleWebAuthn: the public keys live in the server-only
 * table staff_passkeys, every ceremony takes a one-time challenge from passkey_challenges, and a verified sign-in opens
 * the Supabase session the same way the PIN login always has (an admin magic link verified on the server). Supabase's
 * own beta passkeys stay switched off.
 */

export async function passkeysReady(): Promise<boolean> {
  return schemaReady("staff_passkeys", "id, credential_id, removed_at");
}

/**
 * The relying party. Live: erp.ofjauto.com only. The test server: localhost (any of its ports). A development
 * server on the live database gets none, so no passkey for "localhost" is ever stored in the live database.
 */
export function passkeyRp(): { rpID: string; rpName: string; origins: string[] } | null {
  const rpName = "OFJ Automotive ERP";
  if (process.env.PASSKEY_RP_ID && process.env.PASSKEY_ORIGINS) {
    return { rpID: process.env.PASSKEY_RP_ID, rpName, origins: process.env.PASSKEY_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (process.env.VERCEL) return { rpID: "erp.ofjauto.com", rpName, origins: ["https://erp.ofjauto.com"] };
  if (isTestEnvironment()) return { rpID: "localhost", rpName, origins: ["http://localhost:3100", "http://localhost:3101", "http://localhost:3102", "http://localhost:3000"] };
  return null;
}

export async function passkeyRollout(): Promise<PasskeyRollout> {
  const settings = await getSettings();
  return rolloutOf(settings.passkeys_rollout);
}

type PersonLike = { id: string; role_id: string; team?: string | null; department_id?: string | null };

/** Passkeys are on for this person (the tables exist, the rollout reaches them). */
export async function passkeyOnFor(p: PersonLike): Promise<boolean> {
  if (!(await passkeysReady())) return false;
  return passkeyPerson(p, await passkeyRollout());
}

export type PasskeyRow = {
  id: string;
  staff_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
  name: string;
  aaguid: string | null;
  device_type: string | null;
  backed_up: boolean | null;
  created_at: string;
  last_used_at: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_reason: string | null;
};

const PASSKEY_COLS = "id, staff_id, credential_id, public_key, counter, transports, name, aaguid, device_type, backed_up, created_at, last_used_at, removed_at, removed_by, removed_reason";

export async function passkeysOf(staffId: string, opts: { withRemoved?: boolean } = {}): Promise<PasskeyRow[]> {
  let q = createAdminClient().from("staff_passkeys").select(PASSKEY_COLS).eq("staff_id", staffId).order("created_at");
  if (!opts.withRemoved) q = q.is("removed_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PasskeyRow[];
}

export async function passkeyCount(staffId: string): Promise<number> {
  const { count, error } = await createAdminClient().from("staff_passkeys").select("id", { count: "exact", head: true }).eq("staff_id", staffId).is("removed_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Active passkey counts for many people at once (the tablet name grid, the owner's list). */
export async function passkeyCounts(staffIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (staffIds.length === 0) return out;
  const { data, error } = await createAdminClient().from("staff_passkeys").select("staff_id").in("staff_id", staffIds).is("removed_at", null);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.staff_id as string, (out.get(r.staff_id as string) ?? 0) + 1);
  return out;
}

export async function passkeyByCredential(credentialId: string): Promise<PasskeyRow | null> {
  const { data, error } = await createAdminClient().from("staff_passkeys").select(PASSKEY_COLS).eq("credential_id", credentialId).maybeSingle();
  if (error) throw error;
  return (data as PasskeyRow | null) ?? null;
}

// ---- One-time challenges ----------------------------------------------------------------------------------------

const CHALLENGE_MINUTES = 5;

export async function saveChallenge(purpose: "login" | "register" | "confirm", challenge: string, staffId: string | null): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("passkey_challenges")
    .insert({ purpose, challenge, staff_id: staffId, expires_at: new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString() })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("challenge not saved");
  return data.id as string;
}

/** Uses up a challenge: only once, only before it expires, only for its purpose (and person). Null when not valid. */
export async function takeChallenge(id: string, purpose: "login" | "register" | "confirm", staffId: string | null): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  let q = createAdminClient()
    .from("passkey_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .eq("purpose", purpose)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  q = staffId ? q.eq("staff_id", staffId) : q.is("staff_id", null);
  const { data, error } = await q.select("challenge").maybeSingle();
  if (error) throw error;
  return (data?.challenge as string | undefined) ?? null;
}

// ---- "Approved with a phone you already set up" (needed to add another phone) -----------------------------------

const CONFIRM_COOKIE = "erp_pk_ok";
const CONFIRM_MINUTES = 5;

function confirmKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createHmac("sha256", "erp-passkey-confirm-v1").update(secret).digest();
}

export async function markConfirmed(staffId: string): Promise<void> {
  const exp = Date.now() + CONFIRM_MINUTES * 60_000;
  const body = `${staffId}.${exp}`;
  const sig = createHmac("sha256", confirmKey()).update(body).digest("base64url");
  (await cookies()).set(CONFIRM_COOKIE, `${body}.${sig}`, sessionCookieOptions(CONFIRM_MINUTES * 60));
}

export async function isConfirmed(staffId: string): Promise<boolean> {
  const raw = (await cookies()).get(CONFIRM_COOKIE)?.value ?? "";
  const [id, exp, sig] = raw.split(".");
  if (!id || !exp || !sig || id !== staffId || !(Number(exp) > Date.now())) return false;
  const want = createHmac("sha256", confirmKey()).update(`${id}.${exp}`).digest();
  const got = Buffer.from(sig, "base64url");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function clearConfirmed(): Promise<void> {
  (await cookies()).delete(CONFIRM_COOKIE);
}

// ---- Opening the session -----------------------------------------------------------------------------------------

/**
 * Opens the Supabase session for a person after our own check (passkey verified): an admin magic link verified on
 * the server, the same way the PIN login does it. A passkey sign-in lasts 12 hours.
 */
export async function openSessionFor(staffId: string, kind: "passkey"): Promise<{ ok: true } | { ok: false; words: string }> {
  const admin = createAdminClient();
  const { data: u, error: uErr } = await admin.auth.admin.getUserById(staffId);
  if (uErr || !u.user?.email) return { ok: false, words: "Login record missing. Ask the owner." };
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (linkErr || !link.properties?.hashed_token) {
    await logAppError("passkey.openSession.link", linkErr ?? new Error("no hashed token"), { staffId });
    return { ok: false, words: "Could not start a session. Try again." };
  }
  const supabase = await createClient();
  const { error: sessErr } = await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (sessErr) {
    await logAppError("passkey.openSession.verify", sessErr, { staffId });
    return { ok: false, words: "Could not start a session. Try again." };
  }
  const seconds = PASSKEY_SESSION_HOURS * 3600;
  const jar = await cookies();
  jar.set(SESSION_UNTIL_COOKIE, String(Date.now() + seconds * 1000), sessionCookieOptions(seconds));
  jar.set(LOGIN_KIND_COOKIE, kind, sessionCookieOptions(seconds));
  return { ok: true };
}

// ---- The logs ----------------------------------------------------------------------------------------------------

async function userAgent(): Promise<string | null> {
  try {
    return ((await headers()).get("user-agent") ?? "").slice(0, 300) || null;
  } catch {
    return null;
  }
}

/** Writes one sign-in (or refused sign-in). Never fails the sign-in itself; a failed write is logged for the owner. */
export async function logSignIn(e: { staffId: string | null; method: string; ok: boolean; reason?: string | null; passkeyId?: string | null }): Promise<void> {
  try {
    if (!(await passkeysReady())) return;
    const { error } = await createAdminClient()
      .from("sign_in_events")
      .insert({ staff_id: e.staffId, method: e.method, ok: e.ok, reason: e.reason ?? null, passkey_id: e.passkeyId ?? null, user_agent: await userAgent() });
    if (error) throw error;
  } catch (err) {
    await logAppError("sign-in-log", err, { staffId: e.staffId, detail: { method: e.method, ok: e.ok } });
  }
}

/** Writes one change to how a person signs in (phones, passwords, PINs, login method, the rollout). */
export async function logSignInChange(c: { staffId: string | null; kind: string; detail?: string | null; passkeyId?: string | null; by: string | null }): Promise<void> {
  try {
    if (!(await passkeysReady())) return;
    const { error } = await createAdminClient()
      .from("sign_in_changes")
      .insert({ staff_id: c.staffId, kind: c.kind, detail: c.detail ?? null, passkey_id: c.passkeyId ?? null, by_staff_id: c.by, user_agent: await userAgent() });
    if (error) throw error;
  } catch (err) {
    await logAppError("sign-in-change-log", err, { staffId: c.staffId, detail: { kind: c.kind } });
  }
}

/** The owner(s), for the bells about sign-ins. */
export async function ownerIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("staff").select("id").eq("role_id", "owner").eq("is_active", true);
  return (data ?? []).map((r) => r.id as string);
}

/** A relative address inside the app, never another site (open redirect). */
export function safeNext(raw: unknown, fallback = "/home"): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : fallback;
}
