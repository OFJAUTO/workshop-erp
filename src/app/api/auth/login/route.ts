import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { SENSITIVE_ROLES, type RoleId } from "@/lib/roles";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions, sessionWindow } from "@/lib/session";
import { notifyStaff } from "@/lib/notifications";
import { passkeyPerson, rolloutOf } from "@/lib/passkey-rules";
import { logSignIn, ownerIds, passkeyCount, passkeysReady, safeNext } from "@/lib/passkey-server";

/**
 * Office login with email and password. A plain form post, so browsers offer to save the password.
 * "Keep me signed in" extends the session to the number of days set in Settings, except for passkey users
 * (7 November 2026): their sign-in always lasts 12 hours, the password is their backup (each use is logged and the
 * owner is told), and one with no phone set up yet is taken to the phone setup first.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const keep = form.get("keep") === "on";
  const next = safeNext(form.get("next"));
  const origin = request.nextUrl.origin;

  const fail = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`, { status: 303 });

  if (!email || !password) return fail("Enter your email and password.");

  const ready = await passkeysReady();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (ready) {
      // A wrong password for a real person's email is written down (the owner sees repeated tries).
      const { data: who } = await createAdminClient().from("staff_private").select("staff_id").ilike("email", email).maybeSingle();
      if (who?.staff_id) await logSignIn({ staffId: who.staff_id as string, method: "password", ok: false, reason: "wrong password" });
    }
    return fail("Email or password is wrong.");
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("id, display_name, role_id, team, department_id, is_active, login_type")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!staff || !staff.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return fail("This account is disabled. Ask the owner.");
  }
  if (staff.login_type === "pin") {
    await supabase.auth.signOut({ scope: "local" });
    return fail("This person logs in on a handheld device with a PIN.");
  }

  const settings = await getSettings();
  const role = staff.role_id as RoleId;
  const passkeyUser = ready && passkeyPerson(staff, rolloutOf(settings.passkeys_rollout));
  const keepDays =
    keep && !passkeyUser
      ? Number(SENSITIVE_ROLES.includes(role) ? settings.keep_signed_in_days_owner_accounts : settings.keep_signed_in_days_staff)
      : null;
  const { untilMs, maxAgeSeconds } = sessionWindow(keepDays);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_UNTIL_COOKIE, String(untilMs), sessionCookieOptions(maxAgeSeconds));
  cookieStore.set(LOGIN_KIND_COOKIE, "pc", sessionCookieOptions(maxAgeSeconds));

  if (!passkeyUser) {
    await logSignIn({ staffId: staff.id, method: "password", ok: true });
    return NextResponse.redirect(`${origin}${next}`, { status: 303 });
  }

  const phones = await passkeyCount(staff.id).catch(() => 0);
  if (phones === 0) {
    await logSignIn({ staffId: staff.id, method: "password", ok: true, reason: "no phone set up yet" });
    return NextResponse.redirect(`${origin}/passkey/setup?next=${encodeURIComponent(next)}`, { status: 303 });
  }

  await logSignIn({ staffId: staff.id, method: "password_backup", ok: true, reason: "password used instead of the phone" });
  if (role !== "owner") {
    await notifyStaff(await ownerIds(), {
      type: "password_backup_sign_in",
      title: `${staff.display_name} signed in with the password instead of a phone`,
      body: "Lost phone, or someone else using the password? Check with them. Only you can remove a lost phone (Team).",
      href: `/team/${staff.id}#sign-in`,
    });
  }
  return NextResponse.redirect(`${origin}${next}`, { status: 303 });
}
