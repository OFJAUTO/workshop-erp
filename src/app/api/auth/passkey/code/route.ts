import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESET_CODE_MAX_TRIES, RESET_CODE_MINUTES } from "@/lib/passkey-rules";
import { logSignIn, logSignInChange, openSessionFor, passkeysReady, safeNext } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

/**
 * Lost phone (9 November 2026, Section 4): the owner's one-time sign-in code. Email + the 8-digit code the owner gave
 * (15 minutes, single use) opens a 12-hour sign-in and goes straight to setting up the new passkey. Five wrong tries
 * in 15 minutes stop the codes for that person until the owner gives a new one. Every try is logged.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const next = safeNext(form.get("next"));
  const origin = request.nextUrl.origin;
  const fail = (m: string) => NextResponse.redirect(`${origin}/login?lost=1&error=${encodeURIComponent(m)}`, { status: 303 });
  if (!(await passkeysReady())) return fail("Passkeys are not switched on yet.");
  if (!email || code.length !== 8) return fail("Type your email and the 8-digit code the owner gave you.");
  const admin = createAdminClient();
  const { data: who } = await admin.from("staff_private").select("staff_id").ilike("email", email).maybeSingle();
  const staffId = (who?.staff_id as string | undefined) ?? null;
  if (!staffId) return fail("That email and code do not match. Check with the owner.");
  const since = new Date(Date.now() - RESET_CODE_MINUTES * 60_000).toISOString();
  const { count } = await admin.from("sign_in_events").select("id", { count: "exact", head: true }).eq("staff_id", staffId).eq("method", "owner_code").eq("ok", false).gte("at", since);
  if ((count ?? 0) >= RESET_CODE_MAX_TRIES) {
    await admin.from("passkey_challenges").update({ used_at: new Date().toISOString() }).eq("purpose", "reset").eq("staff_id", staffId).is("used_at", null);
    return fail("Too many wrong tries. Ask the owner for a new code.");
  }
  const hash = createHash("sha256").update(`${staffId}:${code}`).digest("hex");
  const { data: row } = await admin.from("passkey_challenges").select("id").eq("purpose", "reset").eq("staff_id", staffId).eq("challenge", hash).is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!row) {
    await logSignIn({ staffId, method: "owner_code", ok: false, reason: "wrong or expired code" });
    return fail("That code is wrong or has expired (codes last 15 minutes). Ask the owner for a new one.");
  }
  // Single use: taken before the session opens, so a second try with the same code fails.
  const { data: took } = await admin.from("passkey_challenges").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id");
  if (!took?.length) return fail("That code was already used. Ask the owner for a new one.");
  const { data: staff } = await admin.from("staff").select("id, is_active").eq("id", staffId).maybeSingle();
  if (!staff?.is_active) return fail("This account is disabled. Ask the owner.");
  const opened = await openSessionFor(staffId, "passkey");
  if (!opened.ok) return fail(opened.words);
  await logSignIn({ staffId, method: "owner_code", ok: true, reason: "lost phone: one-time code from the owner" });
  await logSignInChange({ staffId, kind: "one_time_code", detail: "used to sign in (setting up a new phone)", by: staffId });
  return NextResponse.redirect(`${origin}/passkey/setup?next=${encodeURIComponent(next)}&lost=1`, { status: 303 });
}
