import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { SENSITIVE_ROLES, type RoleId } from "@/lib/roles";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions, sessionWindow } from "@/lib/session";

/**
 * Office login. A plain form post, so browsers offer to save the password.
 * "Keep me signed in" extends the session to the number of days set in Settings.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const keep = form.get("keep") === "on";
  const nextRaw = String(form.get("next") ?? "/home");
  const next = nextRaw.startsWith("/") ? nextRaw : "/home";
  const origin = request.nextUrl.origin;

  const fail = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`, { status: 303 });

  if (!email || !password) return fail("Enter your email and password.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return fail("Email or password is wrong.");

  const { data: staff } = await supabase
    .from("staff")
    .select("role_id, is_active, login_type")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!staff || !staff.is_active) {
    await supabase.auth.signOut();
    return fail("This account is disabled. Ask the owner.");
  }
  if (staff.login_type !== "password") {
    await supabase.auth.signOut();
    return fail("This person logs in on a workshop tablet with a PIN.");
  }

  const settings = await getSettings();
  const role = staff.role_id as RoleId;
  const keepDays = keep
    ? Number(
        SENSITIVE_ROLES.includes(role) ? settings.keep_signed_in_days_owner_accounts : settings.keep_signed_in_days_staff,
      )
    : null;
  const { untilMs, maxAgeSeconds } = sessionWindow(keepDays);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_UNTIL_COOKIE, String(untilMs), sessionCookieOptions(maxAgeSeconds));
  cookieStore.set(LOGIN_KIND_COOKIE, "pc", sessionCookieOptions(maxAgeSeconds));

  return NextResponse.redirect(`${origin}${next}`, { status: 303 });
}
